import { spawn, type ChildProcess } from "child_process";
import fs from "fs-extra";
import path from "path";
import { truncateUtf8 } from "../sandbox";
import { classifyVerdict, parseIsolateMeta, type Verdict } from "../meta-parser";
import { RootfsResolver, RootfsNotReadyError } from "../rootfs-resolver";
import type { CompileResult } from "../compiler";
import type { RunOneResult } from "../runner";
import type { CompileTask, RunTask, SandboxEngine } from "../sandbox-engine";
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

// Process abstraction so unit tests can inject a fake spawn(). The default
// implementation calls child_process.spawn on the host "isolate" binary.
export type IsolateSpawner = (args: string[]) => ChildProcess;

const defaultSpawner: IsolateSpawner = (args) => spawn("isolate", args, { stdio: "ignore" });

export interface IsolateSeccompPolicy {
  // Absolute path of the seccomp policy file, passed as
  // `--seccomp-policy=<path>`. Optional — Phase 2-B will add the policy file
  // and reference it from config.
  policyPath?: string;
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
  writable: boolean;
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
      const result = await this.runInIsolate({
        spec: task.spec,
        hostWorkDir: task.hostWorkDir,
        cmd: task.spec.compile.cmd,
        memoryLimitMb: COMPILE_MEM_MB,
        timeLimitMs: COMPILE_TIME_SEC * 1000,
        pidsLimit: COMPILE_PIDS,
        writable: true,
      });

      if (result.meta.status === "OK" && result.exitCode === 0) {
        return { success: true };
      }
      return {
        success: false,
        errorLog: result.stderr || result.stdout || "Compilation failed",
      };
    } catch (err) {
      if (err instanceof RootfsNotReadyError) throw err; // surface as system error
      return {
        success: false,
        errorLog: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async runOne(task: RunTask): Promise<RunOneResult> {
    try {
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
        writable: false,
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

    // Phase 1: init box
    await this.runIsolate(["--box-id", String(this.boxId), "--cg", "--init"]);

    try {
      const isolateArgs = this.buildRunArgs(args, chroot, metaPath);
      const exitCode = await this.runIsolate(isolateArgs);
      const meta = await this.readMeta(metaPath);
      const stdout = await this.readOutput(args.hostWorkDir, STDOUT_FILE);
      const stderr = await this.readOutput(args.hostWorkDir, STDERR_FILE);
      return { exitCode, meta, stdout, stderr };
    } finally {
      await this.runIsolate(["--box-id", String(this.boxId), "--cg", "--cleanup"]).catch(
        () => undefined
      );
    }
  }

  private buildRunArgs(
    args: RunIsolateArgs,
    chroot: string,
    metaPath: string
  ): string[] {
    const memKb = args.memoryLimitMb * 1024;
    const timeSec = (args.timeLimitMs / 1000).toFixed(3);
    const wallSec = (((args.wallTimeLimitMs ?? args.timeLimitMs * 2) / 1000)).toFixed(3);

    const env = args.spec.run.env ?? {};
    const envArgs: string[] = [];
    for (const [k, v] of Object.entries(env)) envArgs.push("--env", `${k}=${v}`);

    const flags = [
      "--box-id",
      String(this.boxId),
      "--cg",
      "--chroot",
      chroot,
      `--dir=${INSIDE_CODE_DIR}=${args.hostWorkDir}${args.writable ? ":rw" : ""}`,
      "--processes",
      String(args.pidsLimit),
      "--mem",
      String(memKb),
      "--time",
      timeSec,
      "--wall-time",
      wallSec,
      "--stack",
      "65536",
      "--cwd",
      INSIDE_CODE_DIR,
      "--stdin",
      `${INSIDE_CODE_DIR}/${STDIN_FILE}`,
      "--stdout",
      `${INSIDE_CODE_DIR}/${STDOUT_FILE}`,
      "--stderr",
      `${INSIDE_CODE_DIR}/${STDERR_FILE}`,
      "--meta",
      metaPath,
      ...envArgs,
    ];

    if (this.seccomp?.policyPath) {
      flags.push("--seccomp-policy", this.seccomp.policyPath);
    }

    flags.push("--run", "--", ...args.cmd);
    return flags;
  }

  private runIsolate(args: string[]): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const child = this.spawner(args);
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? -1));
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
