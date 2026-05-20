/**
 * Sandbox integration tests — run real Docker containers.
 *
 * Prerequisites:
 *   make build-sandbox-images   (build oct-sandbox-python:3.11 and oct-sandbox-cpp:12)
 *
 * Run with:
 *   npm run test:integration
 */
import fs from "fs-extra";
import path from "path";
import { describe, it, expect } from "vitest";
import { compileInSandbox } from "../engine/compiler";
import { runOneTestcase } from "../engine/runner";
import { checkOutput } from "../engine/checker";
import { prepareSandboxWorkDir } from "../engine/sandbox";

const FIXTURES = path.resolve(__dirname, "fixtures");
const TESTCASES = path.join(FIXTURES, "testcases");

// ── shared language specs (mirrors languages.yaml without loading fs/yaml) ──

const pythonSpec = {
  id: "python3",
  image: "oct-sandbox-python:3.11",
  source: { filename: "solution.py" },
  run: {
    cmd: ["python3", "/code/solution.py"],
    env: { PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" },
  },
  enabled: true,
};

const cppSpec = {
  id: "cpp17",
  image: "oct-sandbox-cpp:12",
  source: { filename: "solution.cpp" },
  compile: { cmd: ["g++", "solution.cpp", "-O2", "-std=c++17", "-o", "solution", "-lm"] },
  run: { cmd: ["/code/solution"] },
  enabled: true,
};

// ── helpers ──────────────────────────────────────────────────────────────────

async function readFixture(rel: string): Promise<string> {
  return fs.readFile(path.join(FIXTURES, rel), "utf8");
}

async function loadTestcase(dir: string, idx: number) {
  return {
    index: idx,
    stdin: await fs.readFile(path.join(TESTCASES, dir, `${idx}.in`), "utf8"),
    expected: await fs.readFile(path.join(TESTCASES, dir, `${idx}.out`), "utf8"),
  };
}

async function setupWork(sourceFile: string, spec: typeof pythonSpec | typeof cppSpec): Promise<string> {
  const workDir = path.join("/tmp/sandbox-test", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.ensureDir(workDir);
  await prepareSandboxWorkDir(workDir);
  await fs.writeFile(path.join(workDir, spec.source.filename), await readFixture(sourceFile));
  return workDir;
}

async function judgeOne(
  spec: typeof pythonSpec | typeof cppSpec,
  sourceFile: string,
  testcaseDir: string,
  tcIdx: number,
  timeLimitMs = 3000,
  memoryLimitMb = 128,
) {
  const workDir = await setupWork(sourceFile, spec);
  try {
    const compile = await compileInSandbox({ spec: spec as never, hostWorkDir: workDir });
    if (!compile.success) return { verdict: "CE" as const, compileLog: compile.errorLog };

    const tc = await loadTestcase(testcaseDir, tcIdx);
    const run = await runOneTestcase({
      spec: spec as never,
      hostWorkDir: workDir,
      inputData: tc.stdin,
      timeLimitMs,
      memoryLimitMb,
      outputLimitKb: 256,
      sandboxRuntime: process.env["SANDBOX_RUNTIME"] ?? "runc",
    });

    const verdict = run.verdict === "AC"
      ? checkOutput(run.stdout, tc.expected).verdict
      : run.verdict;

    return { verdict, stdout: run.stdout, stderr: run.stderr };
  } finally {
    await fs.remove(workDir).catch(() => undefined);
  }
}

// ── Verdict correctness ───────────────────────────────────────────────────────

describe("Sandbox Verdict (Python)", () => {
  it("hello-ac → AC", async () => {
    const r = await judgeOne(pythonSpec, "python/hello-ac.py", "hello", 1);
    expect(r.verdict).toBe("AC");
  });

  it("wrong-output → WA", async () => {
    const r = await judgeOne(pythonSpec, "python/wrong-output.py", "hello", 1);
    expect(r.verdict).toBe("WA");
  });

  it("echo-ac → AC (multi-testcase stdin)", async () => {
    const workDir = await setupWork("python/echo-ac.py", pythonSpec);
    try {
      const compile = await compileInSandbox({ spec: pythonSpec as never, hostWorkDir: workDir });
      expect(compile.success).toBe(true);

      for (const idx of [1, 2]) {
        const tc = await loadTestcase("echo", idx);
        const run = await runOneTestcase({
          spec: pythonSpec as never, hostWorkDir: workDir,
          inputData: tc.stdin, timeLimitMs: 3000, memoryLimitMb: 128,
          outputLimitKb: 256, sandboxRuntime: process.env["SANDBOX_RUNTIME"] ?? "runc",
        });
        expect(checkOutput(run.stdout, tc.expected).verdict).toBe("AC");
      }
    } finally {
      await fs.remove(workDir).catch(() => undefined);
    }
  });

  it("infinite-loop → TLE", async () => {
    const r = await judgeOne(pythonSpec, "python/infinite-loop.py", "hello", 1, 1000);
    expect(r.verdict).toBe("TLE");
  });

  it("memory-bomb → MLE", async () => {
    const r = await judgeOne(pythonSpec, "python/memory-bomb.py", "hello", 1, 5000, 32);
    expect(r.verdict).toBe("MLE");
  });

  it("divide-zero → RE", async () => {
    const r = await judgeOne(pythonSpec, "python/divide-zero.py", "hello", 1);
    expect(r.verdict).toBe("RE");
  });
});

describe("Sandbox Verdict (C++)", () => {
  it("hello-ac → AC", async () => {
    const r = await judgeOne(cppSpec, "cpp/hello-ac.cpp", "hello", 1);
    expect(r.verdict).toBe("AC");
  });

  it("compile-error → CE", async () => {
    const r = await judgeOne(cppSpec, "cpp/compile-error.cpp", "hello", 1);
    expect(r.verdict).toBe("CE");
    expect(r.compileLog).toBeTruthy();
  });

  it("tle → TLE", async () => {
    const r = await judgeOne(cppSpec, "cpp/tle.cpp", "hello", 1, 1000);
    expect(r.verdict).toBe("TLE");
  });

  it("runtime-error → RE", async () => {
    const r = await judgeOne(cppSpec, "cpp/runtime-error.cpp", "hello", 1);
    expect(r.verdict).toBe("RE");
  });

  it("echo-ac → AC (stdin)", async () => {
    const r = await judgeOne(cppSpec, "cpp/echo-ac.cpp", "echo", 1);
    expect(r.verdict).toBe("AC");
  });
});

// ── Security isolation ────────────────────────────────────────────────────────

describe("Sandbox Security", () => {
  it("[PidsLimit] fork-bomb → contained (RE or MLE, never AC)", async () => {
    const r = await judgeOne(pythonSpec, "python/fork-bomb.py", "hello", 1, 3000);
    // PidsLimit stops new forks; existing processes may exhaust memory before dying.
    // Either RE (OSError unhandled) or MLE (OOM kill) confirms the sandbox contained it.
    expect(["RE", "MLE"]).toContain(r.verdict);
  });

  it("[NetworkMode=none] try-network → network blocked", async () => {
    const r = await judgeOne(pythonSpec, "python/try-network.py", "hello", 1, 5000);
    // Network unreachable → prints error message → WA (not AC, not "Connected!")
    expect(r.verdict).toBe("WA");
    expect(r.stdout).not.toContain("Connected!");
  });

  it("[rootfs isolation] read-passwd → reads container /etc/passwd, not host", async () => {
    const r = await judgeOne(pythonSpec, "python/read-passwd.py", "hello", 1);
    // Program reads /etc/passwd inside container — output is container's root entry,
    // which must NOT match any real host username (e.g. "kk" who runs this test).
    const hostUser = process.env["USER"] ?? process.env["LOGNAME"] ?? "kk";
    expect(r.stdout).not.toContain(hostUser);
    // And the container's /etc/passwd starts with "root" from the base image
    expect(r.stdout?.trim().startsWith("root") || r.stdout?.includes("nobody")).toBe(true);
  });

  it("[ReadonlyRootfs] write-to-rootfs → all writes outside /tmp blocked", async () => {
    const r = await judgeOne(pythonSpec, "python/write-to-rootfs.py", "hello", 1, 5000);
    // ReadonlyRootfs: true makes /etc /usr /bin read-only at the kernel level.
    // Every attempt to write there must fail with an OSError (no WRITE_SUCCEEDED line).
    expect(r.stdout).not.toContain("WRITE_SUCCEEDED");
    // The sandbox explicitly mounts /tmp as a writable tmpfs; that must still work.
    expect(r.stdout).toContain("tmp_write_ok");
  });

  it("[CapDrop ALL] privilege escalation → all capability-gated ops blocked", async () => {
    const r = await judgeOne(pythonSpec, "python/cap-check.py", "hello", 1, 5000);
    // CapDrop: ["ALL"] removes every Linux capability before the process runs.
    // sethostname (CAP_SYS_ADMIN) and raw sockets (CAP_NET_RAW) must both fail.
    expect(r.stdout).not.toContain("SUCCEEDED");
    expect(r.stdout).toContain("sethostname_blocked");
    expect(r.stdout).toContain("raw_socket_blocked");
  });

  it("[env isolation] worker secrets not leaked into sandbox container", async () => {
    const r = await judgeOne(pythonSpec, "python/env-leak.py", "hello", 1, 5000);
    // The sandbox container is created with no inherited environment from the worker
    // process — DATABASE_URL, RABBITMQ_URL, JWT_SECRET etc. must be absent.
    expect(r.stdout).not.toContain("LEAKED:");
    expect(r.stdout).toContain("safe:DATABASE_URL");
    expect(r.stdout).toContain("safe:JWT_SECRET");
  });

  it("[non-root] executed as uid=1000, not root", async () => {
    const r = await judgeOne(pythonSpec, "python/whoami.py", "hello", 1, 5000);
    // User: "1000:1000" is set in sandboxHostConfig; the process must never run as root.
    expect(r.stdout).toContain("uid=1000");
    expect(r.stdout).toContain("is_root=NO");
    expect(r.stdout).not.toContain("uid=0");
  });
});
