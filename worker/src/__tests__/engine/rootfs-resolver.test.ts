import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RootfsNotReadyError,
  RootfsResolver,
} from "../../engine/rootfs-resolver";
import type { LanguageSpec } from "../../engine/languages";

const baseSpec: LanguageSpec = {
  id: "cpp17",
  image: "ghcr.io/example/oct-rootfs-cpp17:v1",
  source: { filename: "solution.cpp" },
  compile: { cmd: ["g++", "solution.cpp", "-o", "solution"] },
  run: { cmd: ["/code/solution"] },
  enabled: true,
};

describe("RootfsResolver", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rootfs-resolver-"));
  });

  afterEach(async () => {
    await fs.remove(tmpRoot).catch(() => undefined);
  });

  it("resolves to baseDir/id when rootfsPath is not set", async () => {
    const langDir = path.join(tmpRoot, "cpp17");
    await fs.ensureDir(langDir);

    const resolver = new RootfsResolver({ baseDir: tmpRoot });
    const resolved = await resolver.resolve(baseSpec);
    expect(resolved).toBe(langDir);
  });

  it("uses explicit rootfsPath override when provided", async () => {
    const customDir = path.join(tmpRoot, "custom-cpp");
    await fs.ensureDir(customDir);

    const resolver = new RootfsResolver({ baseDir: tmpRoot });
    const resolved = await resolver.resolve({ ...baseSpec, rootfsPath: customDir });
    expect(resolved).toBe(customDir);
  });

  it("follows a symlink (used by atomic version-swap)", async () => {
    const targetDir = path.join(tmpRoot, "cpp17-sha256");
    await fs.ensureDir(targetDir);
    const symlink = path.join(tmpRoot, "cpp17");
    await fs.symlink(targetDir, symlink);

    const resolver = new RootfsResolver({ baseDir: tmpRoot });
    const resolved = await resolver.resolve(baseSpec);
    expect(resolved).toBe(symlink);
  });

  it("throws RootfsNotReadyError when the rootfs directory is missing", async () => {
    const resolver = new RootfsResolver({ baseDir: tmpRoot });
    await expect(resolver.resolve(baseSpec)).rejects.toBeInstanceOf(RootfsNotReadyError);
  });

  it("readyForAll returns false if any enabled language is missing", async () => {
    await fs.ensureDir(path.join(tmpRoot, "cpp17"));
    const resolver = new RootfsResolver({ baseDir: tmpRoot });
    const ready = await resolver.readyForAll([
      baseSpec,
      { ...baseSpec, id: "python3" },
    ]);
    expect(ready).toBe(false);
  });

  it("readyForAll ignores disabled languages", async () => {
    await fs.ensureDir(path.join(tmpRoot, "cpp17"));
    const resolver = new RootfsResolver({ baseDir: tmpRoot });
    const ready = await resolver.readyForAll([
      baseSpec,
      { ...baseSpec, id: "python3", enabled: false },
    ]);
    expect(ready).toBe(true);
  });
});
