import fs from "fs-extra";
import path from "path";
import type Docker from "dockerode";
import { docker as defaultDocker } from "../providers/docker";
import { parseDockerLogs } from "./compiler";

export interface RunOneOptions {
  language: "cpp17" | "python3";
  hostWorkDir: string;
  inputData: string;
  timeLimitMs: number;
  memoryLimitMb: number;
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
  await fs.writeFile(path.join(options.hostWorkDir, "input.txt"), options.inputData);

  const command =
    options.language === "cpp17"
      ? "chmod +x /code/solution && /code/solution < /code/input.txt"
      : "python3 /code/solution.py < /code/input.txt";

  const container = await docker.createContainer({
    Image: options.language === "cpp17" ? "oj-sandbox-cpp" : "oj-sandbox-python",
    Cmd: ["sh", "-c", command],
    WorkingDir: "/code",
    HostConfig: {
      Binds: [`${options.hostWorkDir}:/code`],
      Memory: options.memoryLimitMb * 1024 * 1024,
      NetworkMode: "none",
      Runtime: options.sandboxRuntime,
    },
  });

  const startedAt = Date.now();
  let timedOut = false;
  let timeout: NodeJS.Timeout | undefined;

  try {
    await container.start();

    const waitPromise = container.wait();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(async () => {
        timedOut = true;
        await container.kill().catch(() => undefined);
        reject(new Error("TLE"));
      }, options.timeLimitMs);
    });

    const waitResult = await Promise.race([waitPromise, timeoutPromise]);
    const runtimeMs = Math.max(0, Date.now() - startedAt);
    const logs = await container.logs({ stdout: true, stderr: true });
    const { stdout, stderr } = parseDockerLogs(logs);

    if (waitResult.StatusCode === 137) {
      return { verdict: "MLE", stdout, stderr, runtimeMs, memoryKb: null };
    }

    if (waitResult.StatusCode !== 0) {
      return { verdict: "RE", stdout, stderr, runtimeMs, memoryKb: null };
    }

    return { verdict: "AC", stdout, stderr, runtimeMs, memoryKb: null };
  } catch (err) {
    if (timedOut || (err instanceof Error && err.message === "TLE")) {
      return {
        verdict: "TLE",
        stdout: "",
        stderr: "",
        runtimeMs: options.timeLimitMs,
        memoryKb: null,
      };
    }

    return {
      verdict: "RE",
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      runtimeMs: Math.max(0, Date.now() - startedAt),
      memoryKb: null,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
    await container.remove({ force: true }).catch(() => undefined);
  }
}
