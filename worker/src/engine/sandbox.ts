import fs from "fs-extra";
import type Docker from "dockerode";

export const SANDBOX_USER = "1000:1000";

interface SandboxHostConfigOptions {
  hostWorkDir: string;
  memoryLimitMb: number;
  readonlyWork: boolean;
  pidsLimit?: number;
  sandboxRuntime?: string;
}

export async function prepareSandboxWorkDir(hostWorkDir: string): Promise<void> {
  await fs.chmod(hostWorkDir, 0o777).catch(() => undefined);
}

export function sandboxHostConfig(options: SandboxHostConfigOptions): Docker.HostConfig {
  const memoryBytes = options.memoryLimitMb * 1024 * 1024;
  const hostConfig: Docker.HostConfig = {
    Binds: [`${options.hostWorkDir}:/code:${options.readonlyWork ? "ro" : "rw"}`],
    Memory: memoryBytes,
    MemorySwap: memoryBytes,
    MemorySwappiness: 0,
    PidsLimit: options.pidsLimit ?? 128,
    NetworkMode: "none",
    ReadonlyRootfs: true,
    Tmpfs: { "/tmp": "rw,nosuid,nodev,size=64m" },
    CapDrop: ["ALL"],
    SecurityOpt: ["no-new-privileges"],
  };

  if (options.sandboxRuntime) {
    hostConfig.Runtime = options.sandboxRuntime;
  }

  return hostConfig;
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

export function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return value;
  return buffer.subarray(0, maxBytes).toString("utf8");
}
