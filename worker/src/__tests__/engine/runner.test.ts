import { mkdtemp, remove } from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runOneTestcase } from "../../engine/runner";

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

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((dir) => remove(dir)));
  dirs = [];
});

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runner-test-"));
  dirs.push(dir);
  return dir;
}

function dockerWithStatus(statusCode: number, logs = dockerLog(1, "ok\n"), statsBytes?: number) {
  const container = {
    start: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue({ StatusCode: statusCode }),
    logs: vi.fn().mockResolvedValue(logs),
    inspect: vi.fn().mockResolvedValue({ State: { OOMKilled: false } }),
    stats: vi.fn().mockImplementation(() =>
      statsBytes !== undefined
        ? Promise.resolve({ memory_stats: { max_usage: statsBytes, usage: statsBytes } })
        : Promise.reject(new Error("stats unavailable"))
    ),
    remove: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  };

  return {
    container,
    docker: {
      createContainer: vi.fn().mockResolvedValue(container),
    },
  };
}

describe("runOneTestcase", () => {
  it("maps exit code 137 to MLE", async () => {
    const { docker } = dockerWithStatus(137);

    const result = await runOneTestcase({
      spec: pythonSpec,
      hostWorkDir: await tempDir(),
      inputData: "1\n",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 64,
      sandboxRuntime: "runc",
      dockerClient: docker as never,
    });

    expect(result.verdict).toBe("MLE");
  });

  it("applies hardened sandbox host config while keeping the selected runtime", async () => {
    const { docker } = dockerWithStatus(0);

    await runOneTestcase({
      spec: pythonSpec,
      hostWorkDir: await tempDir(),
      inputData: "1\n",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 64,
      sandboxRuntime: "runsc",
      dockerClient: docker as never,
    });

    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        User: "1000:1000",
        Env: expect.arrayContaining(["PYTHONDONTWRITEBYTECODE=1", "PYTHONUNBUFFERED=1"]),
        HostConfig: expect.objectContaining({
          Binds: [expect.stringMatching(/:\/code:ro$/)],
          CapDrop: ["ALL"],
          Memory: 64 * 1024 * 1024,
          MemorySwap: 64 * 1024 * 1024,
          NanoCpus: 1_000_000_000,
          NetworkMode: "none",
          PidsLimit: 128,
          ReadonlyRootfs: true,
          Runtime: "runsc",
          SecurityOpt: ["no-new-privileges"],
          Tmpfs: { "/tmp": "rw,nosuid,nodev,size=64m" },
        }),
      })
    );
  });

  it("maps nonzero exit to RE and captures stderr", async () => {
    const { docker } = dockerWithStatus(2, Buffer.concat([
      dockerLog(1, ""),
      dockerLog(2, "boom\n"),
    ]));

    const result = await runOneTestcase({
      spec: cppSpec,
      hostWorkDir: await tempDir(),
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 64,
      sandboxRuntime: "runc",
      dockerClient: docker as never,
    });

    expect(result).toMatchObject({ verdict: "RE", stderr: "boom\n" });
  });

  it("uses Docker OOMKilled inspection for MLE detection", async () => {
    const { docker, container } = dockerWithStatus(1);
    container.inspect.mockResolvedValue({ State: { OOMKilled: true } });

    const result = await runOneTestcase({
      spec: pythonSpec,
      hostWorkDir: await tempDir(),
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 64,
      sandboxRuntime: "runc",
      dockerClient: docker as never,
    });

    expect(result.verdict).toBe("MLE");
  });

  it("kills the container on timeout and returns TLE", async () => {
    const container = {
      start: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn(() => new Promise(() => undefined)),
      logs: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
    };
    const docker = { createContainer: vi.fn().mockResolvedValue(container) };

    const result = await runOneTestcase({
      spec: pythonSpec,
      hostWorkDir: await tempDir(),
      inputData: "",
      timeLimitMs: 1,
      memoryLimitMb: 64,
      outputLimitKb: 64,
      sandboxRuntime: "runc",
      dockerClient: docker as never,
    });

    expect(result.verdict).toBe("TLE");
    expect(container.kill).toHaveBeenCalledTimes(1);
  });

  it("captures peak memory from sampler when stats are available", async () => {
    const { docker } = dockerWithStatus(0, dockerLog(1, "ok\n"), 20 * 1024 * 1024);

    const result = await runOneTestcase({
      spec: pythonSpec,
      hostWorkDir: await tempDir(),
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 64,
      sandboxRuntime: "runc",
      dockerClient: docker as never,
    });

    expect(result.verdict).toBe("AC");
    expect(result.memoryKb).toBe(20 * 1024);
  });

  it("falls back to memory limit when OOMKilled but sampler missed peak", async () => {
    const { docker, container } = dockerWithStatus(1);
    container.inspect.mockResolvedValue({ State: { OOMKilled: true } });

    const result = await runOneTestcase({
      spec: pythonSpec,
      hostWorkDir: await tempDir(),
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 64,
      sandboxRuntime: "runc",
      dockerClient: docker as never,
    });

    expect(result.verdict).toBe("MLE");
    expect(result.memoryKb).toBe(64 * 1024);
  });

  it("maps excessive stdout to RE", async () => {
    const { docker } = dockerWithStatus(0, dockerLog(1, "x".repeat(2049)));

    const result = await runOneTestcase({
      spec: pythonSpec,
      hostWorkDir: await tempDir(),
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 2,
      sandboxRuntime: "runc",
      dockerClient: docker as never,
    });

    expect(result).toMatchObject({
      verdict: "RE",
      stderr: "Output limit exceeded",
    });
  });
});

function dockerLog(streamType: 1 | 2, content: string): Buffer {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt8(streamType, 0);
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}
