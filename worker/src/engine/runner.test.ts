import { mkdtemp, remove } from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runOneTestcase } from "./runner";

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

function dockerWithStatus(statusCode: number, logs = dockerLog(1, "ok\n")) {
  const container = {
    start: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue({ StatusCode: statusCode }),
    logs: vi.fn().mockResolvedValue(logs),
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
      language: "python3",
      hostWorkDir: await tempDir(),
      inputData: "1\n",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      sandboxRuntime: "runc",
      dockerClient: docker as never,
    });

    expect(result.verdict).toBe("MLE");
  });

  it("maps nonzero exit to RE and captures stderr", async () => {
    const { docker } = dockerWithStatus(2, Buffer.concat([
      dockerLog(1, ""),
      dockerLog(2, "boom\n"),
    ]));

    const result = await runOneTestcase({
      language: "cpp17",
      hostWorkDir: await tempDir(),
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      sandboxRuntime: "runc",
      dockerClient: docker as never,
    });

    expect(result).toMatchObject({ verdict: "RE", stderr: "boom\n" });
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
      language: "python3",
      hostWorkDir: await tempDir(),
      inputData: "",
      timeLimitMs: 1,
      memoryLimitMb: 64,
      sandboxRuntime: "runc",
      dockerClient: docker as never,
    });

    expect(result.verdict).toBe("TLE");
    expect(container.kill).toHaveBeenCalledTimes(1);
  });
});

function dockerLog(streamType: 1 | 2, content: string): Buffer {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt8(streamType, 0);
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}
