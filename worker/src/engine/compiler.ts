import type Docker from "dockerode";
import { docker as defaultDocker } from "../providers/docker";

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

  const container = await docker.createContainer({
    Image: "oj-sandbox-cpp",
    Cmd: ["g++", "solution.cpp", "-O2", "-std=c++17", "-o", "solution", "-lm"],
    WorkingDir: "/code",
    HostConfig: {
      Binds: [`${options.hostWorkDir}:/code`],
      Memory: 512 * 1024 * 1024,
      NetworkMode: "none",
    },
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

export function parseDockerLogs(buffer: Buffer): { stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const streamType = buffer.readUInt8(offset);
    const size = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) break;

    const chunk = buffer.toString("utf8", start, end);
    if (streamType === 1) stdout += chunk;
    if (streamType === 2) stderr += chunk;
    offset = end;
  }

  if (offset === 0 && buffer.length > 0) stdout = buffer.toString("utf8");
  return { stdout, stderr };
}
