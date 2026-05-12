import type Docker from "dockerode";
import { docker as defaultDocker } from "../providers/docker";
import {
  parseDockerLogs,
  prepareSandboxWorkDir,
  sandboxHostConfig,
  SANDBOX_USER,
} from "./sandbox";

export interface CompileOptions {
  language: "python3" | "cpp17";
  hostWorkDir: string;
  dockerClient?: Docker;
}

export interface CompileResult {
  success: boolean;
  errorLog?: string;
}

export async function compileInSandbox(options: CompileOptions): Promise<CompileResult> {
  const docker = options.dockerClient ?? defaultDocker;
  if (options.language === "python3") return { success: true };

  await prepareSandboxWorkDir(options.hostWorkDir);

  const container = await docker.createContainer({
    Image: "oj-sandbox-cpp",
    Cmd: ["g++", "solution.cpp", "-O2", "-std=c++17", "-o", "solution", "-lm"],
    WorkingDir: "/code",
    User: SANDBOX_USER,
    AttachStdout: true,
    AttachStderr: true,
    HostConfig: sandboxHostConfig({
      hostWorkDir: options.hostWorkDir,
      memoryLimitMb: 512,
      readonlyWork: false,
      pidsLimit: 256,
    }),
  });

  try {
    await container.start();
    const waitResult = await container.wait();
    const logs = await container.logs({ stdout: true, stderr: true });
    const { stderr, stdout } = parseDockerLogs(logs);

    if (waitResult.StatusCode !== 0) {
      return { success: false, errorLog: stderr || stdout || "Compilation failed" };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      errorLog: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await container.remove({ force: true }).catch(() => undefined);
  }
}
