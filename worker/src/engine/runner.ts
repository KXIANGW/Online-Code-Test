import fs from "fs-extra";
import path from "path";
import type Docker from "dockerode";
import { docker as defaultDocker } from "../providers/docker";
import {
  parseDockerLogs,
  prepareSandboxWorkDir,
  sandboxHostConfig,
  SANDBOX_USER,
  startMemorySampler,
  truncateUtf8,
} from "./sandbox";
import type { LanguageSpec } from "./languages";

export interface RunOneOptions {
  spec: LanguageSpec;
  hostWorkDir: string;
  inputData: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  outputLimitKb: number;
  sandboxRuntime: string;
  dockerClient?: Docker;
}

export interface RunOneResult {
  verdict: "AC" | "TLE" | "MLE" | "RE";
  stdout: string;
  stderr: string;
  runtimeMs: number;
  memoryKb: number | null;
}

export async function runOneTestcase(options: RunOneOptions): Promise<RunOneResult> {
  const docker = options.dockerClient ?? defaultDocker;
  await prepareSandboxWorkDir(options.hostWorkDir);
  await fs.writeFile(path.join(options.hostWorkDir, "input.txt"), options.inputData);

  const shellCmd = `${options.spec.run.cmd.join(" ")} < /code/input.txt`;
  const envVars = options.spec.run.env
    ? Object.entries(options.spec.run.env).map(([k, v]) => `${k}=${v}`)
    : [];

  const container = await docker.createContainer({
    Image: options.spec.image,
    Cmd: ["sh", "-c", shellCmd],
    WorkingDir: "/code",
    User: SANDBOX_USER,
    Env: envVars,
    AttachStdout: true,
    AttachStderr: true,
    HostConfig: sandboxHostConfig({
      hostWorkDir: options.hostWorkDir,
      memoryLimitMb: options.memoryLimitMb,
      readonlyWork: true,
      sandboxRuntime: options.sandboxRuntime,
    }),
  });

  const startedAt = Date.now();
  let timedOut = false;
  let timeout: NodeJS.Timeout | undefined;
  let sampler: ReturnType<typeof startMemorySampler> | undefined;
  let memoryKb: number | null = null;

  async function stopSampler(): Promise<number | null> {
    if (!sampler) return memoryKb;
    const peak = await sampler.stop();
    sampler = undefined;
    if (peak !== null) memoryKb = peak;
    return memoryKb;
  }

  try {
    await container.start();
    sampler = startMemorySampler(container);

    const waitPromise = container.wait();
    const timeoutPromise = new Promise<{ StatusCode: number }>((resolve) => {
      timeout = setTimeout(() => {
        timedOut = true;
        container.kill().catch(() => undefined);
        resolve({ StatusCode: 137 });
      }, options.timeLimitMs);
    });

    const waitResult = await Promise.race([waitPromise, timeoutPromise]);
    const runtimeMs = Math.max(0, Date.now() - startedAt);
    memoryKb = await stopSampler();

    if (timedOut) {
      return { verdict: "TLE", stdout: "", stderr: "", runtimeMs: options.timeLimitMs, memoryKb };
    }

    const logs = await container.logs({ stdout: true, stderr: true });
    const { stdout, stderr } = parseDockerLogs(logs);
    const inspected = await container.inspect().catch(() => undefined);
    const oomKilled = inspected?.State?.OOMKilled === true;

    if (oomKilled || waitResult.StatusCode === 137) {
      // OOMKilled: cgroups peak likely equals limit, but if sampler missed it, fall back.
      const memoryLimitKb = options.memoryLimitMb * 1024;
      return {
        verdict: "MLE",
        stdout,
        stderr,
        runtimeMs,
        memoryKb: memoryKb ?? memoryLimitKb,
      };
    }

    if (waitResult.StatusCode !== 0) {
      return { verdict: "RE", stdout, stderr, runtimeMs, memoryKb };
    }

    const outputLimitBytes = options.outputLimitKb * 1024;
    if (Buffer.byteLength(stdout, "utf8") > outputLimitBytes) {
      return {
        verdict: "RE",
        stdout: truncateUtf8(stdout, outputLimitBytes),
        stderr: stderr || "Output limit exceeded",
        runtimeMs,
        memoryKb,
      };
    }

    return { verdict: "AC", stdout, stderr, runtimeMs, memoryKb };
  } catch (err) {
    const finalMemoryKb = await stopSampler();
    if (timedOut || (err instanceof Error && err.message === "TLE")) {
      return {
        verdict: "TLE",
        stdout: "",
        stderr: "",
        runtimeMs: options.timeLimitMs,
        memoryKb: finalMemoryKb,
      };
    }

    return {
      verdict: "RE",
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      runtimeMs: Math.max(0, Date.now() - startedAt),
      memoryKb: finalMemoryKb,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
    await stopSampler();
    await container.remove({ force: true }).catch(() => undefined);
  }
}
