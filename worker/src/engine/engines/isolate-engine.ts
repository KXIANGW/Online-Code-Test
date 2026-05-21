import { spawn, type ChildProcess } from "child_process";
import fs from "fs-extra";
import path from "path";
import { prepareSandboxWorkDir, truncateUtf8 } from "../sandbox";
import { classifyVerdict, parseIsolateMeta, type Verdict } from "../meta-parser";
import { RootfsResolver, RootfsNotReadyError } from "../rootfs-resolver";

// Isolate itself failed to set up / tear down the sandbox (vs. candidate
// failure). Judge consumer routes these to system_error rather than a
// verdict so a broken sandbox doesn't silently grade every submission WA.
export class SandboxSystemError extends Error {
  constructor(message: string, public readonly stderr?: string) {
    super(message);
    this.name = "SandboxSystemError";
  }
}
import type {
  CompileResult,
  CompileTask,
  RunOneResult,
  RunTask,
  SandboxEngine,
} from "../sandbox-engine";
import type { LanguageSpec } from "../languages";

const INSIDE_CODE_DIR = "/code";
const STDIN_FILE = "input.txt";
const STDOUT_FILE = "stdout.txt";
const STDERR_FILE = "stderr.txt";
const META_FILE = "meta.txt";

// Compile-time defaults match the Docker engine's CompileSandbox config
// (worker/src/engine/sandbox.ts: 512MB / 2 CPUs / pids=256 / 30s wall).
const COMPILE_MEM_MB = 512;
const COMPILE_PIDS = 256;
const COMPILE_TIME_SEC = 30;

// Isolate doesn't inherit the host PATH after chroot, so bare command names
// like "g++" or "python3" won't resolve. Apply a Debian-/Alpine-friendly
// default; languages can still override via spec.run.env.PATH.
const DEFAULT_CHROOT_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

// Process abstraction so unit tests can inject a fake spawn(). The default
// implementation calls child_process.spawn on the host "isolate" binary.
export type IsolateSpawner = (args: string[]) => ChildProcess;

const defaultSpawner: IsolateSpawner = (args) =>
  spawn("isolate", args, { stdio: ["ignore", "pipe", "pipe"] });

export interface IsolateSeccompPolicy {
  // Host directory containing two files:
  //   - seccomp-wrapper : binary that installs the seccomp-bpf filter then
  //     execve()'s the real candidate command
  //   - seccomp.policy  : the policy file consumed by the wrapper
  //
  // When configured, IsolateEngine binds this dir at /oct (readonly) inside
  // the sandbox and prepends `/oct/seccomp-wrapper /oct/seccomp.policy --`
  // before the candidate's argv. Upstream isolate v2.0 has no
  // --seccomp-policy of its own; the wrapper is what closes the syscall gap.
  bundleDir: string;
}

export interface IsolateEngineOptions {
  rootfsResolver?: RootfsResolver;
  // Default box id. With prefetch=1 each Worker only ever runs one task at a
  // time, so a single fixed id is fine. The box-id pool comes later when (if)
  // we enable Pod-internal concurrency.
  boxId?: number;
  spawner?: IsolateSpawner;
  seccomp?: IsolateSeccompPolicy;
}

interface RunIsolateArgs {
  spec: LanguageSpec;
  hostWorkDir: string;
  cmd: string[];
  memoryLimitMb: number;
  timeLimitMs: number;
  wallTimeLimitMs?: number;
  pidsLimit: number;
  // /code is always rw — isolate has to write stdout/stderr files there.
  // This flag toggles whether stdin is wired (runOne yes, compile no).
  withStdin: boolean;
}

interface RunIsolateResult {
  exitCode: number;
  meta: ReturnType<typeof parseIsolateMeta>;
  stdout: string;
  stderr: string;
}

export class IsolateEngine implements SandboxEngine {
  readonly name = "isolate";
  private readonly resolver: RootfsResolver;
  private readonly boxId: number;
  private readonly spawner: IsolateSpawner;
  private readonly seccomp?: IsolateSeccompPolicy;

  constructor(options: IsolateEngineOptions = {}) {
    this.resolver = options.rootfsResolver ?? new RootfsResolver();
    this.boxId = options.boxId ?? 0;
    this.spawner = options.spawner ?? defaultSpawner;
    this.seccomp = options.seccomp;
  }

  async compile(task: CompileTask): Promise<CompileResult> {
    if (!task.spec.compile) return { success: true };
    try {
      // isolate runs each box under a private high UID (>=60000); the host
      // work directory must be world-writable so the candidate can produce
      // the compiled binary / stdout / stderr files.
      await prepareSandboxWorkDir(task.hostWorkDir);
      const result = await this.runInIsolate({
        spec: task.spec,
        hostWorkDir: task.hostWorkDir,
        cmd: task.spec.compile.cmd,
        memoryLimitMb: COMPILE_MEM_MB,
        timeLimitMs: COMPILE_TIME_SEC * 1000,
        pidsLimit: COMPILE_PIDS,
        withStdin: false,
      });

      // Isolate omits "status:" from the meta file when the process exits 0;
      // any non-OK status is explicitly written. Treat null-or-OK + exitcode 0
      // as compile success and surface everything else as a CE.
      const okStatus = result.meta.status === null || result.meta.status === "OK";
      const okExit = result.meta.exitcode === null || result.meta.exitcode === 0;
      if (okStatus && okExit) {
        return { success: true };
      }
      return {
        success: false,
        errorLog: result.stderr || result.stdout || "Compilation failed",
      };
    } catch (err) {
      if (err instanceof RootfsNotReadyError) throw err; // surface as system error
      if (err instanceof SandboxSystemError) throw err;  // surface as system error
      return {
        success: false,
        errorLog: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async runOne(task: RunTask): Promise<RunOneResult> {
    try {
      await prepareSandboxWorkDir(task.hostWorkDir);
      await fs.writeFile(path.join(task.hostWorkDir, STDIN_FILE), task.inputData);

      const cmd = task.spec.run.entrypointPath
        ? [task.spec.run.entrypointPath, ...task.spec.run.cmd.slice(1)]
        : task.spec.run.cmd;

      const result = await this.runInIsolate({
        spec: task.spec,
        hostWorkDir: task.hostWorkDir,
        cmd,
        memoryLimitMb: task.memoryLimitMb,
        timeLimitMs: task.timeLimitMs,
        wallTimeLimitMs: task.timeLimitMs * 2,
        pidsLimit: 64,
        withStdin: true,
      });

      const classification = classifyVerdict({
        meta: result.meta,
        timeLimitMs: task.timeLimitMs,
        memoryLimitMb: task.memoryLimitMb,
      });

      let { verdict } = classification;
      let { stdout } = result;
      let { stderr } = result;
      const outputLimitBytes = task.outputLimitKb * 1024;
      if (Buffer.byteLength(stdout, "utf8") > outputLimitBytes) {
        stdout = truncateUtf8(stdout, outputLimitBytes);
        stderr = stderr || "Output limit exceeded";
        verdict = "RE";
      }

      return {
        verdict: verdict as Verdict,
        stdout,
        stderr,
        runtimeMs: classification.runtimeMs,
        memoryKb: classification.memoryKb,
      };
    } catch (err) {
      if (err instanceof RootfsNotReadyError) throw err;
      if (err instanceof SandboxSystemError) throw err;
      return {
        verdict: "RE",
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        runtimeMs: 0,
        memoryKb: null,
      };
    }
  }

  private async runInIsolate(args: RunIsolateArgs): Promise<RunIsolateResult> {
    const chroot = await this.resolver.resolve(args.spec);
    const metaPath = path.join(args.hostWorkDir, META_FILE);
    await fs.remove(metaPath).catch(() => undefined);

    const initResult = await this.runIsolateCapturingStderr([
      `--box-id=${this.boxId}`,
      "--cg",
      "--init",
    ]);
    if (initResult.exitCode !== 0) {
      throw new SandboxSystemError(
        `isolate --init failed (exit=${initResult.exitCode}): ${initResult.stderr.trim()}`,
        initResult.stderr
      );
    }

    try {
      const isolateArgs = this.buildRunArgs(args, chroot, metaPath);
      const runResult = await this.runIsolateCapturingStderr(isolateArgs);
      const meta = await this.readMeta(metaPath);
      const stdout = await this.readOutput(args.hostWorkDir, STDOUT_FILE);
      const stderr = await this.readOutput(args.hostWorkDir, STDERR_FILE);

      // Isolate exits 0/1 with a meta file for any valid verdict; >1 without
      // a meta file means isolate itself crashed.
      const metaIsEmpty = meta.status === null && meta.exitcode === null;
      if (runResult.exitCode > 1 && metaIsEmpty) {
        throw new SandboxSystemError(
          `isolate --run failed (exit=${runResult.exitCode}): ${runResult.stderr.trim()}`,
          runResult.stderr
        );
      }

      return { exitCode: runResult.exitCode, meta, stdout, stderr };
    } finally {
      await this.runIsolate([`--box-id=${this.boxId}`, "--cg", "--cleanup"]).catch(
        () => undefined
      );
    }
  }

  private buildRunArgs(
    args: RunIsolateArgs,
    rootfs: string,
    metaPath: string
  ): string[] {
    const memKb = args.memoryLimitMb * 1024;
    const timeSec = (args.timeLimitMs / 1000).toFixed(3);
    const wallSec = (((args.wallTimeLimitMs ?? args.timeLimitMs * 2) / 1000)).toFixed(3);

    const env: Record<string, string> = { PATH: DEFAULT_CHROOT_PATH, ...(args.spec.run.env ?? {}) };
    const envArgs: string[] = [];
    for (const [k, v] of Object.entries(env)) envArgs.push(`--env=${k}=${v}`);

    // Seccomp bundle: bind the worker's wrapper + policy into the sandbox so
    // the wrapper can be exec'd before the candidate. Doing this here keeps
    // the rootfs binds below unchanged regardless of seccomp config.
    const SECCOMP_INSIDE = "/oct-seccomp";
    const seccompDirs: string[] = [];
    let candidateCmd = args.cmd;
    if (this.seccomp) {
      seccompDirs.push(`--dir=${SECCOMP_INSIDE}=${this.seccomp.bundleDir}`);
      candidateCmd = [
        `${SECCOMP_INSIDE}/seccomp-wrapper`,
        `${SECCOMP_INSIDE}/seccomp.policy`,
        "--",
        ...args.cmd,
      ];
    }

    // Isolate v2.0 doesn't have --chroot. Instead, we keep its default
    // sandbox skeleton (which provides /box, /dev, /tmp, /proc) and
    // OVERRIDE the system-library paths to point at the per-language
    // rootfs the DaemonSet unpacked under hostPath. Later rules supersede
    // earlier ones with the same <in> path. ":maybe" tolerates rootfs that
    // don't ship a particular top-level (e.g. alpine has no /lib64).
    //
    // Why not --no-default-dirs: isolate hard-codes its working directory
    // (/box) to be created from the defaults. Disabling them makes the
    // default --chdir fail before our rules apply.
    const rootfsDirs = [
      `/usr=${rootfs}/usr`,
      `/lib=${rootfs}/lib`,
      `/lib64=${rootfs}/lib64:maybe`,
      `/bin=${rootfs}/bin`,
      `/sbin=${rootfs}/sbin:maybe`,
      `/etc=${rootfs}/etc:maybe`,
      `/opt=${rootfs}/opt:maybe`,
    ].map((rule) => `--dir=${rule}`);

    // isolate's long-form flags require `--flag=value` (single argv entry).
    // Passing `["--mem", "256"]` results in getopt treating "256" as the
    // positional command, which then becomes an `execve("256")` failure.
    const flags = [
      `--box-id=${this.boxId}`,
      "--cg",
      ...rootfsDirs,
      ...seccompDirs,
      // The candidate work directory — host hostWorkDir mounted at /code.
      // Always rw because isolate writes stdout.txt / stderr.txt here, and
      // compile writes the produced binary here.
      `--dir=${INSIDE_CODE_DIR}=${args.hostWorkDir}:rw`,
      `--processes=${args.pidsLimit}`,
      `--mem=${memKb}`,
      `--time=${timeSec}`,
      `--wall-time=${wallSec}`,
      "--stack=65536",
      `--chdir=${INSIDE_CODE_DIR}`,
      `--stdout=${INSIDE_CODE_DIR}/${STDOUT_FILE}`,
      `--stderr=${INSIDE_CODE_DIR}/${STDERR_FILE}`,
      `--meta=${metaPath}`,
      ...envArgs,
    ];

    if (args.withStdin) {
      flags.push(`--stdin=${INSIDE_CODE_DIR}/${STDIN_FILE}`);
    }

    flags.push("--run", "--", ...candidateCmd);
    return flags;
  }

  private runIsolate(args: string[]): Promise<number> {
    return this.runIsolateCapturingStderr(args).then((r) => r.exitCode);
  }

  private runIsolateCapturingStderr(
    args: string[]
  ): Promise<{ exitCode: number; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = this.spawner(args);
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.once("error", reject);
      child.once("close", (code) => {
        // Isolate writes setup errors (cgroup access, mount failures, etc.)
        // to its own stderr — surface non-zero exits with that text so the
        // caller can distinguish setup failures from candidate failures.
        if (code !== 0 && stderr.trim()) {
          console.error(`[isolate] exit=${code}: ${stderr.trim()}`);
        }
        resolve({ exitCode: code ?? -1, stderr });
      });
    });
  }

  private async readMeta(metaPath: string): Promise<ReturnType<typeof parseIsolateMeta>> {
    try {
      const content = await fs.readFile(metaPath, "utf8");
      return parseIsolateMeta(content);
    } catch {
      return parseIsolateMeta("");
    }
  }

  private async readOutput(hostWorkDir: string, file: string): Promise<string> {
    try {
      return await fs.readFile(path.join(hostWorkDir, file), "utf8");
    } catch {
      return "";
    }
  }
}
