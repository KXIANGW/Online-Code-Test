import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../engine/compiler", () => ({
  compileInSandbox: vi.fn(),
}));

vi.mock("../../engine/runner", () => ({
  runOneTestcase: vi.fn(),
}));

import { compileInSandbox } from "../../engine/compiler";
import { runOneTestcase } from "../../engine/runner";
import { DockerSandboxEngine } from "../../engine/engines/docker-engine";

const spec = {
  id: "python3",
  image: "oct-sandbox-python:3.11",
  source: { filename: "solution.py" },
  run: { cmd: ["python3", "/code/solution.py"] },
  enabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DockerSandboxEngine", () => {
  it("delegates compile() to compileInSandbox without leaking docker-specific fields to caller", async () => {
    vi.mocked(compileInSandbox).mockResolvedValue({ success: true });
    const engine = new DockerSandboxEngine({ sandboxRuntime: "runc" });

    const result = await engine.compile({ spec: spec as never, hostWorkDir: "/tmp/work" });

    expect(result).toEqual({ success: true });
    expect(compileInSandbox).toHaveBeenCalledWith({
      spec,
      hostWorkDir: "/tmp/work",
      dockerClient: undefined,
    });
  });

  it("delegates runOne() to runOneTestcase and injects sandboxRuntime from the engine config", async () => {
    vi.mocked(runOneTestcase).mockResolvedValue({
      verdict: "AC",
      stdout: "ok\n",
      stderr: "",
      runtimeMs: 5,
      memoryKb: 1024,
    });
    const engine = new DockerSandboxEngine({ sandboxRuntime: "runsc" });

    const result = await engine.runOne({
      spec: spec as never,
      hostWorkDir: "/tmp/work",
      inputData: "",
      timeLimitMs: 1000,
      memoryLimitMb: 64,
      outputLimitKb: 32,
    });

    expect(result.verdict).toBe("AC");
    expect(runOneTestcase).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxRuntime: "runsc", spec, hostWorkDir: "/tmp/work" })
    );
  });

  it("exposes name=docker", () => {
    const engine = new DockerSandboxEngine({ sandboxRuntime: "runc" });
    expect(engine.name).toBe("docker");
  });
});
