import type { CompileOptions, CompileResult } from "./compiler";
import type { RunOneOptions, RunOneResult } from "./runner";
import { DockerSandboxEngine } from "./engines/docker-engine";
import { IsolateEngine } from "./engines/isolate-engine";
import { RootfsResolver } from "./rootfs-resolver";

// Task = engine-agnostic input (Docker/Isolate specifics are encapsulated in the engine itself).
export type CompileTask = Omit<CompileOptions, "dockerClient">;
export type RunTask = Omit<RunOneOptions, "dockerClient" | "sandboxRuntime">;
export type { CompileResult, RunOneResult };

export interface SandboxEngine {
  readonly name: string;
  compile(task: CompileTask): Promise<CompileResult>;
  runOne(task: RunTask): Promise<RunOneResult>;
}

export type SandboxEngineKind = "docker" | "isolate";

export interface SandboxEngineConfig {
  kind: SandboxEngineKind;
  // Docker-engine specific
  sandboxRuntime: string;
  // Isolate-engine specific (all optional with sensible defaults)
  rootfsBaseDir?: string;
  isolateBoxId?: number;
  // Host directory containing seccomp-wrapper + seccomp.policy. When set,
  // IsolateEngine binds it into the sandbox and runs the candidate through
  // the wrapper for a Docker-equivalent seccomp-bpf syscall blacklist.
  seccompBundleDir?: string;
}

export function parseEngineKind(raw: string | undefined): SandboxEngineKind {
  const value = (raw ?? "docker").toLowerCase();
  if (value !== "docker" && value !== "isolate") {
    throw new Error(`Unknown SANDBOX_ENGINE="${value}" (expected "docker" or "isolate")`);
  }
  return value;
}

export async function createSandboxEngine(config: SandboxEngineConfig): Promise<SandboxEngine> {
  switch (config.kind) {
    case "docker":
      return new DockerSandboxEngine({ sandboxRuntime: config.sandboxRuntime });
    case "isolate":
      return new IsolateEngine({
        rootfsResolver: new RootfsResolver({ baseDir: config.rootfsBaseDir }),
        boxId: config.isolateBoxId,
        seccomp: config.seccompBundleDir ? { bundleDir: config.seccompBundleDir } : undefined,
      });
  }
}
