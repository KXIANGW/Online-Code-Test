import { describe, expect, it } from "vitest";
import { createSandboxEngine, parseEngineKind } from "../../engine/sandbox-engine";

describe("parseEngineKind", () => {
  it("defaults to docker when env is undefined", () => {
    expect(parseEngineKind(undefined)).toBe("docker");
  });

  it("normalises case", () => {
    expect(parseEngineKind("DOCKER")).toBe("docker");
    expect(parseEngineKind("Isolate")).toBe("isolate");
  });

  it("throws on unknown values", () => {
    expect(() => parseEngineKind("nsjail")).toThrow(/Unknown SANDBOX_ENGINE/);
  });
});

describe("createSandboxEngine", () => {
  it("returns a DockerSandboxEngine when kind=docker", async () => {
    const engine = await createSandboxEngine({ kind: "docker", sandboxRuntime: "runc" });
    expect(engine.name).toBe("docker");
    expect(typeof engine.compile).toBe("function");
    expect(typeof engine.runOne).toBe("function");
  });

  it("throws for isolate kind until Phase 2 implements it", async () => {
    await expect(
      createSandboxEngine({ kind: "isolate", sandboxRuntime: "runc" })
    ).rejects.toThrow(/Isolate engine not yet implemented/);
  });
});
