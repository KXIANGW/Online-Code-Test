import { describe, expect, it, vi } from "vitest";
import { compileInSandbox } from "./compiler";

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
      language: "cpp17",
      hostWorkDir: "/tmp/work",
      dockerClient: docker as never,
    });

    expect(result).toEqual({ success: false, errorLog: "syntax error\n" });
    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.not.objectContaining({ Runtime: expect.anything() }),
      })
    );
  });

  it("skips compilation for Python", async () => {
    await expect(
      compileInSandbox({ language: "python3", hostWorkDir: "/tmp/work" })
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
