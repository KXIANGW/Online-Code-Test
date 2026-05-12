import type Docker from "dockerode";
import { docker as defaultDocker } from "../providers/docker";
import {
  parseDockerLogs,
  prepareSandboxWorkDir,
  sandboxHostConfig,
  SANDBOX_USER,
} from "./sandbox";
import type { LanguageSpec } from "./languages";

export interface CompileOptions {
  spec: LanguageSpec;
  hostWorkDir: string;
  dockerClient?: Docker;
}

export interface CompileResult {
  success: boolean;
  errorLog?: string;
}

export async function compileInSandbox(options: CompileOptions): Promise<CompileResult> {
  const docker = options.dockerClient ?? defaultDocker;

  // Interpreted languages have no compile step
  if (!options.spec.compile) return { success: true };

  await prepareSandboxWorkDir(options.hostWorkDir);

  const container = await docker.createContainer({
    Image: options.spec.image,
    Cmd: options.spec.compile.cmd,
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
