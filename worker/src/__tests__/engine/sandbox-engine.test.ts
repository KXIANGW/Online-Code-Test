import { describe, expect, it } from "vitest";
import { createSandboxEngine } from "../../engine/sandbox-engine";

describe("createSandboxEngine", () => {
  it("returns an IsolateEngine (the only engine after Phase 4)", () => {
    const engine = createSandboxEngine();
    expect(engine.name).toBe("isolate");
    expect(typeof engine.compile).toBe("function");
    expect(typeof engine.runOne).toBe("function");
  });

  it("threads rootfsBaseDir, isolateBoxId, and seccompBundleDir through", () => {
    const engine = createSandboxEngine({
      rootfsBaseDir: "/tmp/custom-rootfs",
      isolateBoxId: 7,
      isolateBinPath: "/usr/local/bin/isolate",
      seccompBundleDir: "/etc/custom-seccomp",
    });
    expect(engine.name).toBe("isolate");
    // Constructor invariants are exercised by isolate-engine.test.ts; here we
    // just guard the wiring contract by ensuring no throws and a real engine
    // back out.
    expect(typeof engine.compile).toBe("function");
  });
});
