import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareSandboxWorkDir } from "../../engine/sandbox";

describe("prepareSandboxWorkDir", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "oct-sandbox-workdir-"));
  });

  afterEach(async () => {
    await fs.remove(workDir).catch(() => undefined);
  });

  it("secures the work directory with owner-only permissions by default", async () => {
    // given: a freshly-created per-submission work directory

    // when
    await prepareSandboxWorkDir(workDir);

    // expect
    const stat = await fs.stat(workDir);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it("allows an explicit mode without making the directory world-writable", async () => {
    // given
    const mode = 0o750;

    // when
    await prepareSandboxWorkDir(workDir, { mode });

    // expect
    const stat = await fs.stat(workDir);
    expect(stat.mode & 0o777).toBe(mode);
    expect(stat.mode & 0o002).toBe(0);
  });

  it("rejects world-writable modes before changing the work directory", async () => {
    // given
    const unsafeMode = 0o777;

    // when / expect
    await expect(prepareSandboxWorkDir(workDir, { mode: unsafeMode })).rejects.toThrow(
      "sandbox work directory must not be world-writable",
    );
  });
});
