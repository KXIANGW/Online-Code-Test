import { describe, expect, it, vi } from "vitest";
import { compileInSandbox } from "../../engine/compiler";

const cppSpec = {
  id: "cpp17",
  image: "oct-sandbox-cpp:12",
  source: { filename: "solution.cpp" },
  compile: { cmd: ["g++", "solution.cpp", "-O2", "-std=c++17", "-o", "solution", "-lm"] },
  run: { cmd: ["/code/solution"] },
  enabled: true,
};

const pythonSpec = {
  id: "python3",
  image: "oct-sandbox-python:3.11",
  source: { filename: "solution.py" },
  run: { cmd: ["python3", "/code/solution.py"] },
  enabled: true,
};

describe("compileInSandbox", () => {
  it("returns CE logs for failed C++ compilation", async () => {
    const container = {
      start: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue({ StatusCode: 1 }),
      logs: vi.fn().mockResolvedValue(dockerLog(2, "syntax error\n")),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const docker = { createContainer: vi.fn().mockResolvedValue(container) };

    const result = await compileInSandbox({
      spec: cppSpec,
      hostWorkDir: "/tmp/work",
      dockerClient: docker as never,
    });

    expect(result).toEqual({ success: false, errorLog: "syntax error\n" });
    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        User: "1000:1000",
        HostConfig: expect.objectContaining({
          CapDrop: ["ALL"],
          MemorySwap: 512 * 1024 * 1024,
          NetworkMode: "none",
          PidsLimit: 256,
          ReadonlyRootfs: true,
          SecurityOpt: ["no-new-privileges"],
          Tmpfs: { "/tmp": "rw,nosuid,nodev,size=64m" },
        }),
      })
    );
    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.not.objectContaining({ Runtime: expect.anything() }),
      })
    );
  });

  it("skips compilation for Python (no compile spec)", async () => {
    await expect(
      compileInSandbox({ spec: pythonSpec, hostWorkDir: "/tmp/work" })
    ).resolves.toEqual({ success: true });
  });
});

function dockerLog(streamType: 1 | 2, content: string): Buffer {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt8(streamType, 0);
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}
