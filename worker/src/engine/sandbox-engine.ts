import type { LanguageSpec } from "./languages";
import { IsolateEngine } from "./engines/isolate-engine";
import { RootfsResolver } from "./rootfs-resolver";

// ── Engine-agnostic task / result types ─────────────────────────────────────
// These were originally co-located with the legacy DockerEngine in
// compiler.ts / runner.ts. After the DockerEngine drop they live here as the
// single source of truth that every SandboxEngine implementation honours.

export interface CompileTask {
  spec: LanguageSpec;
  hostWorkDir: string;
}

export interface CompileResult {
  success: boolean;
  errorLog?: string;
}

export interface RunTask {
  spec: LanguageSpec;
  hostWorkDir: string;
  inputData: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  outputLimitKb: number;
}

export type Verdict = "AC" | "TLE" | "MLE" | "RE";

export interface RunOneResult {
  verdict: Verdict;
  stdout: string;
  stderr: string;
  runtimeMs: number;
  memoryKb: number | null;
}

export interface SandboxEngine {
  readonly name: string;
  compile(task: CompileTask): Promise<CompileResult>;
  runOne(task: RunTask): Promise<RunOneResult>;
}

// ── Factory ─────────────────────────────────────────────────────────────────
// Phase 4 standardised on sio2project/isolate + oct-seccomp-wrapper as the
// only engine. The Strategy interface above is intentionally preserved so a
// future GVisorEngine / KataEngine can drop in without touching consumers.

export interface SandboxEngineConfig {
  // Host directory holding per-language rootfs subtrees that the
  // language-rootfs-puller DaemonSet (K8s) or `make build-isolate-rootfs`
  // (local) prepares. Default: /var/lib/oct/rootfs.
  rootfsBaseDir?: string;
  // Default box id. With consumer prefetch=1 each worker only ever runs one
  // task at a time, so a single fixed id is fine. The box-id pool becomes
  // relevant when (if) we enable Pod-internal concurrency.
  isolateBoxId?: number;
  // Host directory containing seccomp-wrapper + seccomp.policy. IsolateEngine
  // binds it into every sandbox and runs the candidate through the wrapper
  // to install a Docker-equivalent syscall blacklist before execve(). Unset
  // = no seccomp wrapper (not recommended outside trusted dev).
  seccompBundleDir?: string;
}

export function createSandboxEngine(config: SandboxEngineConfig = {}): SandboxEngine {
  return new IsolateEngine({
    rootfsResolver: new RootfsResolver({ baseDir: config.rootfsBaseDir }),
    boxId: config.isolateBoxId,
    seccomp: config.seccompBundleDir ? { bundleDir: config.seccompBundleDir } : undefined,
  });
}
