import fs from "fs-extra";
import path from "path";
import type { LanguageSpec } from "./languages";

// Where the DaemonSet (language-rootfs-puller) writes per-language rootfs trees.
// In production this is mounted readonly from a hostPath; for local development
// docker-compose can bind-mount a host directory to the same path.
export const DEFAULT_ROOTFS_BASE_DIR = "/var/lib/oct/rootfs";

export interface RootfsResolverOptions {
  baseDir?: string;
}

export class RootfsNotReadyError extends Error {
  constructor(public readonly languageId: string, public readonly path: string) {
    super(`Language rootfs not ready: id="${languageId}" path="${path}"`);
    this.name = "RootfsNotReadyError";
  }
}

export class RootfsResolver {
  readonly baseDir: string;

  constructor(options: RootfsResolverOptions = {}) {
    this.baseDir = options.baseDir ?? DEFAULT_ROOTFS_BASE_DIR;
  }

  // Returns the absolute path to a language's rootfs directory.
  // Throws RootfsNotReadyError if the directory is missing — Worker should
  // surface this as a "system error / retry later" instead of a verdict.
  async resolve(spec: LanguageSpec): Promise<string> {
    const target = spec.rootfsPath ?? path.join(this.baseDir, spec.id);
    const exists = await fs.pathExists(target);
    if (!exists) throw new RootfsNotReadyError(spec.id, target);
    const stat = await fs.stat(target);
    if (!stat.isDirectory() && !stat.isSymbolicLink()) {
      throw new RootfsNotReadyError(spec.id, target);
    }
    return target;
  }

  // True iff every enabled language has its rootfs on disk. Used by the
  // Worker readiness probe.
  async readyForAll(specs: LanguageSpec[]): Promise<boolean> {
    for (const spec of specs) {
      if (!spec.enabled) continue;
      try {
        await this.resolve(spec);
      } catch {
        return false;
      }
    }
    return true;
  }
}
