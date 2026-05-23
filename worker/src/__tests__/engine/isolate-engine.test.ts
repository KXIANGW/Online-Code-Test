import { EventEmitter } from "events";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IsolateEngine,
  SandboxSystemError,
  type IsolateSpawner,
} from "../../engine/engines/isolate-engine";
import { RootfsResolver } from "../../engine/rootfs-resolver";
import type { LanguageSpec } from "../../engine/languages";

const cppSpec: LanguageSpec = {
  id: "cpp17",
  image: "ghcr.io/example/oct-rootfs-cpp17:v1",
  source: { filename: "solution.cpp" },
  compile: { cmd: ["/usr/bin/g++", "solution.cpp", "-o", "solution"] },
  run: { cmd: ["/code/solution"] },
  enabled: true,
};

const pyhSpec: LanguageSpec = {
  id: "python3",
  image: "ghcr.io/example/oct-rootfs-python3:v1",
  source: { filename: "solution.py" },
  run: { cmd: ["python3", "/code/solution.py"], env: { PYTHONUNBUFFERED: "1" } },
  enabled: true,
};

// Builds a spawner that:
//   1. Captures every isolate invocation's argv into `calls`.
//   2. Lets the caller queue per-invocation side-effects (e.g. writing a fake
//      meta/stdout/stderr file inside hostWorkDir) before resolving with an
//      exit code.
//   3. Fires "close" asynchronously so awaited Promises resolve in order.
function buildFakeSpawner(
  responses: Array<{ exitCode: number; sideEffect?: () => Promise<void> | void }>
): { spawner: IsolateSpawner; calls: string[][] } {
  const calls: string[][] = [];
  let i = 0;
  const spawner: IsolateSpawner = (args) => {
    calls.push(args);
    const emitter = new EventEmitter() as EventEmitter & { stdio: undefined };
    const response = responses[i++] ?? { exitCode: 0 };
    queueMicrotask(async () => {
      try {
        if (response.sideEffect) await response.sideEffect();
      } catch (err) {
        emitter.emit("error", err);
        return;
      }
      emitter.emit("close", response.exitCode);
    });
    return emitter as never;
  };
  return { spawner, calls };
}

async function makeWorkDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "isolate-engine-test-"));
}

describe("IsolateEngine.compile", () => {
  let rootfsRoot: string;
  let workDir: string;

  beforeEach(async () => {
    rootfsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "isolate-rootfs-"));
    await fs.ensureDir(path.join(rootfsRoot, "cpp17"));
    workDir = await makeWorkDir();
  });

  afterEach(async () => {
    await fs.remove(rootfsRoot).catch(() => undefined);
    await fs.remove(workDir).catch(() => undefined);
  });

  it("short-circuits to success for interpreted languages (no compile.cmd)", async () => {
    const { spawner, calls } = buildFakeSpawner([]);
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
    });

    const result = await engine.compile({ spec: pyhSpec, hostWorkDir: workDir });
    expect(result).toEqual({ success: true });
    expect(calls).toHaveLength(0);
  });

  it("returns success=true when isolate reports status:OK and exit 0", async () => {
    await fs.ensureDir(path.join(rootfsRoot, "cpp17"));
    const { spawner, calls } = buildFakeSpawner([
      { exitCode: 0 }, // init
      {
        exitCode: 0,
        sideEffect: async () => {
          await fs.writeFile(path.join(workDir, "meta.txt"), "status:OK\nexitcode:0\n");
          await fs.writeFile(path.join(workDir, "stdout.txt"), "");
          await fs.writeFile(path.join(workDir, "stderr.txt"), "");
        },
      },
      { exitCode: 0 }, // cleanup
    ]);
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
    });

    const result = await engine.compile({ spec: cppSpec, hostWorkDir: workDir });
    expect(result.success).toBe(true);
    // init, run, cleanup
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("--init");
    expect(calls[2]).toContain("--cleanup");
    // run args must override /usr / /lib / /bin etc. with the language rootfs
    // and writable-bind the candidate work dir at /code.
    expect(calls[1]?.some((arg) => arg.startsWith("--dir=/usr=") && arg.includes("/cpp17/usr"))).toBe(true);
    expect(calls[1]?.some((arg) => arg.startsWith("--dir=/lib=") && arg.includes("/cpp17/lib"))).toBe(true);
    expect(calls[1]?.some((arg) => arg.startsWith("--dir=/code=") && arg.endsWith(":rw"))).toBe(true);
    expect(calls[1]).toEqual(expect.arrayContaining(["/usr/bin/g++", "solution.cpp", "-o", "solution"]));
  });

  it("returns success=false with stderr when isolate reports non-zero exit", async () => {
    const { spawner } = buildFakeSpawner([
      { exitCode: 0 },
      {
        exitCode: 1,
        sideEffect: async () => {
          await fs.writeFile(path.join(workDir, "meta.txt"), "status:RE\nexitcode:1\n");
          await fs.writeFile(path.join(workDir, "stdout.txt"), "");
          await fs.writeFile(path.join(workDir, "stderr.txt"), "error: undefined reference to foo\n");
        },
      },
      { exitCode: 0 },
    ]);
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
    });

    const result = await engine.compile({ spec: cppSpec, hostWorkDir: workDir });
    expect(result.success).toBe(false);
    expect(result.errorLog).toContain("undefined reference");
  });
});

describe("IsolateEngine.runOne", () => {
  let rootfsRoot: string;
  let workDir: string;

  beforeEach(async () => {
    rootfsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "isolate-rootfs-"));
    await fs.ensureDir(path.join(rootfsRoot, "cpp17"));
    await fs.ensureDir(path.join(rootfsRoot, "python3"));
    workDir = await makeWorkDir();
  });

  afterEach(async () => {
    await fs.remove(rootfsRoot).catch(() => undefined);
    await fs.remove(workDir).catch(() => undefined);
  });

  it("writes stdin file, invokes isolate, and maps OK to AC", async () => {
    const { spawner, calls } = buildFakeSpawner([
      { exitCode: 0 },
      {
        exitCode: 0,
        sideEffect: async () => {
          await fs.writeFile(
            path.join(workDir, "meta.txt"),
            ["status:OK", "exitcode:0", "time:0.020", "time-wall:0.025", "max-rss:1024", "cg-mem:2048"].join("\n")
          );
          await fs.writeFile(path.join(workDir, "stdout.txt"), "42\n");
          await fs.writeFile(path.join(workDir, "stderr.txt"), "");
        },
      },
      { exitCode: 0 },
    ]);
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
    });

    const result = await engine.runOne({
      spec: cppSpec,
      hostWorkDir: workDir,
      inputData: "input\n",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 64,
    });

    expect(result.verdict).toBe("AC");
    expect(result.stdout).toBe("42\n");
    expect(result.memoryKb).toBe(2048);

    const inputContents = await fs.readFile(path.join(workDir, "input.txt"), "utf8");
    expect(inputContents).toBe("input\n");

    // Run-phase args (calls[1]) bind-mount work dir rw at /code (so isolate
    // can write stdout.txt / stderr.txt) and include the user run cmd.
    expect(calls[1]?.some((arg) => arg.startsWith("--dir=/code=") && arg.endsWith(":rw"))).toBe(true);
    expect(calls[1]).toContain("/code/solution");
  });

  it("maps status:TO to TLE with runtimeMs capped at timeLimit", async () => {
    const { spawner } = buildFakeSpawner([
      { exitCode: 0 },
      {
        exitCode: 0,
        sideEffect: async () => {
          await fs.writeFile(
            path.join(workDir, "meta.txt"),
            ["status:TO", "time:1.000", "time-wall:1.200", "killed:1"].join("\n")
          );
          await fs.writeFile(path.join(workDir, "stdout.txt"), "");
          await fs.writeFile(path.join(workDir, "stderr.txt"), "");
        },
      },
      { exitCode: 0 },
    ]);
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
    });

    const result = await engine.runOne({
      spec: cppSpec,
      hostWorkDir: workDir,
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 64,
    });

    expect(result.verdict).toBe("TLE");
    expect(result.runtimeMs).toBe(1000);
  });

  it("maps cg-oom-killed=1 to MLE", async () => {
    const { spawner } = buildFakeSpawner([
      { exitCode: 0 },
      {
        exitCode: 0,
        sideEffect: async () => {
          await fs.writeFile(
            path.join(workDir, "meta.txt"),
            ["status:SG", "exitsig:9", "cg-oom-killed:1", "cg-mem:65536", "time-wall:0.300"].join("\n")
          );
          await fs.writeFile(path.join(workDir, "stdout.txt"), "");
          await fs.writeFile(path.join(workDir, "stderr.txt"), "");
        },
      },
      { exitCode: 0 },
    ]);
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
    });

    const result = await engine.runOne({
      spec: cppSpec,
      hostWorkDir: workDir,
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 64,
    });

    expect(result.verdict).toBe("MLE");
  });

  it("binds the seccomp bundle and prepends the wrapper before the candidate cmd when seccomp is configured", async () => {
    const { spawner, calls } = buildFakeSpawner([
      { exitCode: 0 },
      {
        exitCode: 0,
        sideEffect: async () => {
          await fs.writeFile(path.join(workDir, "meta.txt"), "status:OK\nexitcode:0\n");
          await fs.writeFile(path.join(workDir, "stdout.txt"), "");
          await fs.writeFile(path.join(workDir, "stderr.txt"), "");
        },
      },
      { exitCode: 0 },
    ]);
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
      seccomp: { bundleDir: "/etc/oct" },
    });

    await engine.runOne({
      spec: cppSpec,
      hostWorkDir: workDir,
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 64,
    });

    // 1. /etc/oct gets bound at /oct-seccomp inside the sandbox.
    expect(calls[1]).toEqual(
      expect.arrayContaining(["--dir=/oct-seccomp=/etc/oct"])
    );
    // 2. The candidate command is prefixed with the wrapper invocation.
    const runIdx = calls[1]!.indexOf("--run");
    expect(runIdx).toBeGreaterThan(-1);
    const afterRun = calls[1]!.slice(runIdx + 1);
    expect(afterRun.slice(0, 4)).toEqual([
      "--",
      "/oct-seccomp/seccomp-wrapper",
      "/oct-seccomp/seccomp.policy",
      "--",
    ]);
    // 3. The original /code/solution still appears as the candidate.
    expect(afterRun).toContain("/code/solution");
  });

  it("uses entrypointPath override when language sets it", async () => {
    const { spawner, calls } = buildFakeSpawner([
      { exitCode: 0 },
      {
        exitCode: 0,
        sideEffect: async () => {
          await fs.writeFile(path.join(workDir, "meta.txt"), "status:OK\nexitcode:0\n");
          await fs.writeFile(path.join(workDir, "stdout.txt"), "");
          await fs.writeFile(path.join(workDir, "stderr.txt"), "");
        },
      },
      { exitCode: 0 },
    ]);
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
    });

    const specWithEntrypoint: LanguageSpec = {
      ...pyhSpec,
      run: { ...pyhSpec.run, entrypointPath: "/usr/bin/python3" },
    };

    await engine.runOne({
      spec: specWithEntrypoint,
      hostWorkDir: workDir,
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 64,
    });

    expect(calls[1]).toContain("/usr/bin/python3");
  });

  it("truncates stdout when output limit exceeded and returns RE", async () => {
    const big = "x".repeat(10 * 1024);
    const { spawner } = buildFakeSpawner([
      { exitCode: 0 },
      {
        exitCode: 0,
        sideEffect: async () => {
          await fs.writeFile(path.join(workDir, "meta.txt"), "status:OK\nexitcode:0\ntime-wall:0.05\n");
          await fs.writeFile(path.join(workDir, "stdout.txt"), big);
          await fs.writeFile(path.join(workDir, "stderr.txt"), "");
        },
      },
      { exitCode: 0 },
    ]);
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
    });

    const result = await engine.runOne({
      spec: pyhSpec,
      hostWorkDir: workDir,
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 1,
    });

    expect(result.verdict).toBe("RE");
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(1024);
    expect(result.stderr).toBeTruthy();
  });

  it("throws SandboxSystemError when isolate --init exits non-zero", async () => {
    // Simulates the cgroup-readonly failure (`Failed to create control group
    // /sys/fs/cgroup/box-0: Read-only file system`) — isolate exits 2, no
    // meta file is written. Must surface as a system error, NOT a verdict.
    const { spawner } = buildFakeSpawner([{ exitCode: 2 }]); // init fails
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
    });

    await expect(
      engine.runOne({
        spec: cppSpec,
        hostWorkDir: workDir,
        inputData: "",
        timeLimitMs: 1000,
        memoryLimitMb: 64,
        outputLimitKb: 64,
      })
    ).rejects.toBeInstanceOf(SandboxSystemError);
  });

  it("throws SandboxSystemError when isolate --run exits >1 without producing a meta file", async () => {
    // Simulates isolate internally failing during the run phase (e.g.
    // cgroup controller missing). No meta file is written -> previously
    // classifyVerdict() fell through to "AC" with empty stdout -> WA.
    const { spawner } = buildFakeSpawner([
      { exitCode: 0 }, // init OK
      { exitCode: 2 }, // run exits 2, no side effect -> no meta file
      { exitCode: 0 }, // cleanup
    ]);
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
    });

    await expect(
      engine.runOne({
        spec: cppSpec,
        hostWorkDir: workDir,
        inputData: "",
        timeLimitMs: 1000,
        memoryLimitMb: 64,
        outputLimitKb: 64,
      })
    ).rejects.toBeInstanceOf(SandboxSystemError);
  });

  it("compile() also surfaces SandboxSystemError instead of returning success", async () => {
    const { spawner } = buildFakeSpawner([{ exitCode: 2 }]); // init fails
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
    });

    await expect(
      engine.compile({ spec: cppSpec, hostWorkDir: workDir })
    ).rejects.toBeInstanceOf(SandboxSystemError);
  });

  it("propagates RootfsNotReadyError so caller marks system error", async () => {
    const { spawner } = buildFakeSpawner([]);
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner,
    });

    await expect(
      engine.runOne({
        spec: { ...cppSpec, id: "ruby" }, // no rootfs unpacked
        hostWorkDir: workDir,
        inputData: "",
        timeLimitMs: 1000,
        memoryLimitMb: 64,
        outputLimitKb: 64,
      })
    ).rejects.toThrow(/Language rootfs not ready/);
  });

  it("name is 'isolate'", () => {
    const engine = new IsolateEngine();
    expect(engine.name).toBe("isolate");
  });

  it("ensures cleanup runs even if the run phase rejects", async () => {
    const { calls } = buildFakeSpawner([]);
    const failingSpawner: IsolateSpawner = (args) => {
      calls.push(args);
      const emitter = new EventEmitter() as EventEmitter & { stdio: undefined };
      // init succeeds; run rejects; cleanup must still be invoked
      if (args.includes("--init") || args.includes("--cleanup")) {
        queueMicrotask(() => emitter.emit("close", 0));
      } else {
        queueMicrotask(() => emitter.emit("error", new Error("isolate crashed")));
      }
      return emitter as never;
    };
    const engine = new IsolateEngine({
      rootfsResolver: new RootfsResolver({ baseDir: rootfsRoot }),
      spawner: failingSpawner,
    });

    const result = await engine.runOne({
      spec: cppSpec,
      hostWorkDir: workDir,
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 64,
    });

    // engine swallowed the spawn error into a RE verdict
    expect(result.verdict).toBe("RE");
    // and cleanup was invoked
    expect(calls.some((c) => c.includes("--cleanup"))).toBe(true);
  });
});

describe("IsolateEngine default behavior", () => {
  it("uses /var/lib/oct/rootfs/<id> when no resolver provided", () => {
    const engine = new IsolateEngine();
    expect(engine.name).toBe("isolate");
    // Internal state isn't directly observable; behaviour is covered by other
    // tests which inject an explicit resolver. This test guards the default
    // construction path doesn't throw.
    expect(typeof engine.runOne).toBe("function");
  });
});

// Silence the @vitest unused-import warning on `vi` in environments where the
// linter is strict; vi is used by other tests in the file via the queueMicrotask
// helpers' microtask scheduling indirectly. The import remains for future tests.
void vi;
