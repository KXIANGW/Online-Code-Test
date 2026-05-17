import fs from "fs-extra";
import type Docker from "dockerode";

export const SANDBOX_USER = "1000:1000";

interface SandboxHostConfigOptions {
  hostWorkDir: string;
  memoryLimitMb: number;
  readonlyWork: boolean;
  pidsLimit?: number;
  sandboxRuntime?: string;
  // NanoCpus is the Docker representation of CPU quota; 1e9 = 1 core.
  // Default: 1 core for testcase execution (PLAN.md §3.3); compiler raises to 2.
  cpuNanos?: number;
}

// 1 core in Docker NanoCpus units.
export const ONE_CPU_NANOS = 1_000_000_000;

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
    NanoCpus: options.cpuNanos ?? ONE_CPU_NANOS,
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

interface MemorySnapshot {
  memory_stats?: {
    usage?: number;
    max_usage?: number;
  };
}

export interface MemorySampler {
  stop(): Promise<number | null>;
}

// Polls container.stats() until stopped, tracking peak memory usage in bytes.
// Used by runner.ts to populate memoryKb on every verdict path (including OOMKilled).
// On gVisor / runc differences in stats availability, falls back to inspect().State.OOMKilled
// caller-side (MLE branch) — sampler only reports what cgroups exposes.
export function startMemorySampler(
  container: { stats(opts: { stream: false }): Promise<MemorySnapshot> },
  intervalMs = 100
): MemorySampler {
  let peakBytes = 0;
  let stopped = false;

  async function tick(): Promise<void> {
    while (!stopped) {
      try {
        const snap = await container.stats({ stream: false });
        const usage = snap.memory_stats?.max_usage ?? snap.memory_stats?.usage ?? 0;
        if (usage > peakBytes) peakBytes = usage;
      } catch {
        // Container may have exited; stats() will throw — stop quietly
        break;
      }
      if (stopped) break;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  const pump = tick();

  return {
    async stop() {
      stopped = true;
      await pump.catch(() => undefined);
      return peakBytes > 0 ? Math.round(peakBytes / 1024) : null;
    },
  };
}
