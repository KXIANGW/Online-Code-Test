import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Puller } from "../puller";
import type { OciClient } from "../oci";

function fakeOciClient(): OciClient & {
  inspectDigest: ReturnType<typeof vi.fn>;
  pullAndUnpack: ReturnType<typeof vi.fn>;
} {
  return {
    inspectDigest: vi.fn(),
    pullAndUnpack: vi.fn(),
  };
}

async function writeLangsYaml(dir: string, languages: unknown[]): Promise<string> {
  const file = path.join(dir, "languages.yaml");
  // Hand-rolled YAML to avoid dragging js-yaml into the test surface.
  const lines: string[] = ["version: 1", "languages:"];
  for (const lang of languages as Record<string, unknown>[]) {
    lines.push("  - id: " + JSON.stringify(lang["id"]));
    lines.push("    image: " + JSON.stringify(lang["image"]));
    lines.push("    enabled: " + (lang["enabled"] === false ? "false" : "true"));
    lines.push("    source:");
    lines.push("      filename: " + JSON.stringify("solution"));
    lines.push("    run:");
    lines.push("      cmd: [\"solution\"]");
  }
  await fs.writeFile(file, lines.join("\n") + "\n");
  return file;
}

describe("Puller.reconcile", () => {
  let tmpRoot: string;
  let langsFile: string;
  let client: ReturnType<typeof fakeOciClient>;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "puller-test-"));
    langsFile = await writeLangsYaml(tmpRoot, [
      { id: "cpp17", image: "ghcr.io/oct/cpp17:v1", enabled: true },
      { id: "python3", image: "ghcr.io/oct/python3:v1", enabled: true },
    ]);
    client = fakeOciClient();
  });

  afterEach(async () => {
    await fs.remove(tmpRoot).catch(() => undefined);
  });

  it("pulls every enabled language on first run", async () => {
    client.inspectDigest.mockImplementation(async (image: string) =>
      image.includes("cpp") ? "sha256:aaa" : "sha256:bbb"
    );
    client.pullAndUnpack.mockImplementation(async (_image: string, destDir: string) => {
      await fs.ensureDir(destDir);
      await fs.writeFile(path.join(destDir, "marker"), "");
    });

    const puller = new Puller({
      languagesFile: langsFile,
      rootfsBaseDir: tmpRoot,
      client,
      pollIntervalMs: 60 * 60 * 1000,
    });

    const summary = await puller.reconcile();

    expect(summary.pulled.sort()).toEqual(["cpp17", "python3"]);
    expect(summary.failed).toHaveLength(0);
    expect(client.pullAndUnpack).toHaveBeenCalledTimes(2);

    // Symlinks should resolve to a digest-named directory
    const cppSymlink = path.join(tmpRoot, "cpp17");
    const target = await fs.readlink(cppSymlink);
    expect(target).toMatch(/^cpp17-sha256_aaa$/);
  });

  it("skips when digest unchanged", async () => {
    client.inspectDigest.mockResolvedValue("sha256:aaa");
    client.pullAndUnpack.mockImplementation(async (_image: string, destDir: string) => {
      await fs.ensureDir(destDir);
    });

    const puller = new Puller({
      languagesFile: langsFile,
      rootfsBaseDir: tmpRoot,
      client,
      pollIntervalMs: 60 * 60 * 1000,
    });

    await puller.reconcile(); // first run pulls
    client.pullAndUnpack.mockClear();

    const second = await puller.reconcile(); // unchanged digest
    expect(second.pulled).toEqual([]);
    expect(second.skipped.sort()).toEqual(["cpp17", "python3"]);
    expect(client.pullAndUnpack).not.toHaveBeenCalled();
  });

  it("atomic symlink swap retains old version dir until GC", async () => {
    client.inspectDigest.mockResolvedValue("sha256:v1");
    client.pullAndUnpack.mockImplementation(async (_image: string, destDir: string) => {
      await fs.ensureDir(destDir);
    });

    const puller = new Puller({
      languagesFile: langsFile,
      rootfsBaseDir: tmpRoot,
      client,
      pollIntervalMs: 60 * 60 * 1000,
    });
    await puller.reconcile();

    const oldTarget = await fs.readlink(path.join(tmpRoot, "cpp17"));
    expect(oldTarget).toMatch(/^cpp17-sha256_v1$/);

    // Simulate a new digest landing
    client.inspectDigest.mockResolvedValueOnce("sha256:v2").mockResolvedValueOnce("sha256:v2");
    await puller.reconcile();

    const newTarget = await fs.readlink(path.join(tmpRoot, "cpp17"));
    expect(newTarget).toMatch(/^cpp17-sha256_v2$/);

    // GC should have removed the v1 directory (it's no longer the symlink target)
    expect(await fs.pathExists(path.join(tmpRoot, "cpp17-sha256_v1"))).toBe(false);
  });

  it("does not crash when a single language fails; others still pull", async () => {
    client.inspectDigest.mockImplementation(async (image: string) => {
      if (image.includes("cpp")) throw new Error("registry unreachable");
      return "sha256:py";
    });
    client.pullAndUnpack.mockImplementation(async (_image: string, destDir: string) => {
      await fs.ensureDir(destDir);
    });

    const puller = new Puller({
      languagesFile: langsFile,
      rootfsBaseDir: tmpRoot,
      client,
      pollIntervalMs: 60 * 60 * 1000,
      logger: () => undefined,
    });
    const summary = await puller.reconcile();

    expect(summary.pulled).toEqual(["python3"]);
    expect(summary.failed.map((f) => f.id)).toEqual(["cpp17"]);
  });

  it("ignores disabled languages", async () => {
    langsFile = await writeLangsYaml(tmpRoot, [
      { id: "cpp17", image: "ghcr.io/oct/cpp17:v1", enabled: true },
      { id: "ruby", image: "ghcr.io/oct/ruby:v1", enabled: false },
    ]);
    client.inspectDigest.mockResolvedValue("sha256:any");
    client.pullAndUnpack.mockImplementation(async (_image: string, destDir: string) => {
      await fs.ensureDir(destDir);
    });

    const puller = new Puller({
      languagesFile: langsFile,
      rootfsBaseDir: tmpRoot,
      client,
      pollIntervalMs: 60 * 60 * 1000,
    });
    const summary = await puller.reconcile();

    expect(summary.pulled).toEqual(["cpp17"]);
    expect(summary.failed).toEqual([]);
    expect(client.pullAndUnpack).toHaveBeenCalledTimes(1);
  });

  it("persists state across instances (digest skip works after restart)", async () => {
    client.inspectDigest.mockResolvedValue("sha256:aaa");
    client.pullAndUnpack.mockImplementation(async (_image: string, destDir: string) => {
      await fs.ensureDir(destDir);
    });

    const first = new Puller({
      languagesFile: langsFile,
      rootfsBaseDir: tmpRoot,
      client,
      pollIntervalMs: 60 * 60 * 1000,
    });
    await first.reconcile();

    const callsAfterFirst = client.pullAndUnpack.mock.calls.length;

    // New puller instance — should load the state file and skip
    const second = new Puller({
      languagesFile: langsFile,
      rootfsBaseDir: tmpRoot,
      client,
      pollIntervalMs: 60 * 60 * 1000,
    });
    // Manually call start which loads state, but skip the long poll setup.
    await second["loadState"]();
    const summary = await second.reconcile();

    expect(summary.skipped.sort()).toEqual(["cpp17", "python3"]);
    expect(client.pullAndUnpack.mock.calls.length).toBe(callsAfterFirst);
  });
});
