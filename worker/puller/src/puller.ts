import fs from "fs-extra";
import path from "path";
import { loadLanguages, type PullerLanguageSpec } from "./languages";
import type { OciClient } from "./oci";

// State persisted across polling cycles. Stored on the same hostPath as the
// rootfs so DaemonSet restarts can resume incrementally.
interface LangState {
  digest: string;
  versionDir: string;
}

export interface PullerOptions {
  languagesFile: string;
  rootfsBaseDir: string;
  client: OciClient;
  stateFile?: string;
  // Tunables (defaults match plan: every 5 min poll)
  pollIntervalMs?: number;
  logger?: (level: "info" | "warn" | "error", msg: string) => void;
}

export interface PullSummary {
  pulled: string[];
  skipped: string[];
  failed: { id: string; error: string }[];
}

const DEFAULT_STATE_FILE = ".puller-state.json";

export class Puller {
  private readonly opts: Required<Omit<PullerOptions, "stateFile" | "logger">> & {
    stateFile: string;
    logger: NonNullable<PullerOptions["logger"]>;
  };
  private state: Record<string, LangState> = {};
  private pollTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options: PullerOptions) {
    this.opts = {
      languagesFile: options.languagesFile,
      rootfsBaseDir: options.rootfsBaseDir,
      client: options.client,
      pollIntervalMs: options.pollIntervalMs ?? 5 * 60 * 1000,
      stateFile: options.stateFile ?? path.join(options.rootfsBaseDir, DEFAULT_STATE_FILE),
      logger:
        options.logger ??
        ((level, msg) => {
          const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
          console[method](`[puller] ${msg}`);
        }),
    };
  }

  // Eagerly pull every enabled language once, then start the poll loop.
  async start(): Promise<void> {
    await fs.ensureDir(this.opts.rootfsBaseDir);
    await this.loadState();
    await this.reconcile();
    this.scheduleNextPoll();
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // Pull all enabled languages, comparing remote digests against cached state.
  // Returns a summary so callers can log / surface via metrics.
  async reconcile(): Promise<PullSummary> {
    if (this.running) {
      return { pulled: [], skipped: [], failed: [] };
    }
    this.running = true;
    const summary: PullSummary = { pulled: [], skipped: [], failed: [] };
    try {
      const langs = await loadLanguages(this.opts.languagesFile);
      for (const lang of langs) {
        if (!lang.enabled) continue;
        try {
          const result = await this.reconcileOne(lang);
          if (result === "pulled") summary.pulled.push(lang.id);
          else summary.skipped.push(lang.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          summary.failed.push({ id: lang.id, error: message });
          this.opts.logger("error", `reconcile ${lang.id}: ${message}`);
        }
      }
      await this.saveState();
    } finally {
      this.running = false;
    }
    this.opts.logger(
      "info",
      `reconcile complete: pulled=${summary.pulled.length} skipped=${summary.skipped.length} failed=${summary.failed.length}`
    );
    return summary;
  }

  private async reconcileOne(lang: PullerLanguageSpec): Promise<"pulled" | "skipped"> {
    const digest = await this.opts.client.inspectDigest(lang.image);
    const cached = this.state[lang.id];
    const currentSymlink = path.join(this.opts.rootfsBaseDir, lang.id);

    // umoci unpacks an OCI image into <versionDir>/rootfs. Worker expects
    // /var/lib/oct/rootfs/<lang> itself to be the runtime rootfs containing
    // /bin, /usr, etc., so the public symlink must point one level deeper.
    const currentRootfsReady = await fs.pathExists(path.join(currentSymlink, "bin"));
    if (cached && cached.digest === digest && currentRootfsReady) {
      return "skipped";
    }

    const safeDigest = digest.replace(/[^a-zA-Z0-9.-]/g, "_");
    const versionDirName = `${lang.id}-${safeDigest}`;
    const versionDir = path.join(this.opts.rootfsBaseDir, versionDirName);

    if (!(await fs.pathExists(versionDir))) {
      this.opts.logger("info", `pulling ${lang.image} → ${versionDir}`);
      await this.opts.client.pullAndUnpack(lang.image, versionDir);
    }

    const unpackedRootfs = path.join(versionDir, "rootfs");
    if (!(await fs.pathExists(path.join(unpackedRootfs, "bin")))) {
      throw new Error(`unpacked rootfs missing /bin for ${lang.id}: ${unpackedRootfs}`);
    }

    await this.atomicSwap(currentSymlink, path.join(versionDirName, "rootfs"));
    this.state[lang.id] = { digest, versionDir };

    // Best-effort GC of previously-active version directories. Only delete
    // ones the symlink no longer points to AND that aren't the brand-new
    // target. Anything currently in use by an in-flight isolate process is
    // still safe thanks to Linux inode reference counting (see plan §2.5-C).
    await this.gcOldVersions(lang.id, versionDirName);

    return "pulled";
  }

  // Linux-atomic symlink swap: `ln -sfn` then `mv -T`. Implemented in pure JS
  // so we don't shell out for something filesystem-native.
  private async atomicSwap(linkPath: string, targetName: string): Promise<void> {
    const tmpLink = `${linkPath}.new-${process.pid}`;
    await fs.remove(tmpLink).catch(() => undefined);
    await fs.symlink(targetName, tmpLink);
    await fs.rename(tmpLink, linkPath);
  }

  private async gcOldVersions(langId: string, keepName: string): Promise<void> {
    const prefix = `${langId}-`;
    const entries = await fs.readdir(this.opts.rootfsBaseDir);
    for (const entry of entries) {
      if (!entry.startsWith(prefix) || entry === keepName) continue;
      const full = path.join(this.opts.rootfsBaseDir, entry);
      try {
        const stat = await fs.lstat(full);
        if (stat.isDirectory()) {
          await fs.remove(full).catch(() => undefined);
          await fs.remove(`${full}.oci`).catch(() => undefined);
        }
      } catch {
        // ignore
      }
    }
  }

  private async loadState(): Promise<void> {
    try {
      const raw = await fs.readFile(this.opts.stateFile, "utf8");
      this.state = JSON.parse(raw);
    } catch {
      this.state = {};
    }
  }

  private async saveState(): Promise<void> {
    await fs.writeFile(this.opts.stateFile, JSON.stringify(this.state, null, 2), "utf8");
  }

  private scheduleNextPoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.reconcile()
        .catch((err) => this.opts.logger("error", `poll cycle failed: ${err}`))
        .finally(() => this.scheduleNextPoll());
    }, this.opts.pollIntervalMs);
    // Allow process to exit naturally during tests.
    this.pollTimer.unref?.();
  }
}
