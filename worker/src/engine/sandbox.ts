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
    // PLAN.md §3.3: pids.max=64 for testcase execution; compiler overrides to 256.
    PidsLimit: options.pidsLimit ?? 64,
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

interface StatsStream {
  on(event: "data", cb: (chunk: Buffer | string) => void): void;
  on(event: "end" | "close", cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  destroy?(): void;
}

export interface MemorySampler {
  stop(): Promise<number | null>;
}

// Streaming memory sampler.
//
// container.stats({ stream: true }) returns a ReadStream that fires a JSON
// line every ~1 s while the container is running (Docker decides the cadence).
// On cgroup v2 + recent Docker, memory_stats becomes an empty object once
// the container exits, so post-exit polling cannot recover the peak — we
// have to track it live. The stream ends naturally when the container exits.
//
// Returns peak memory in KB, or null if no sample arrived (e.g. container
// died before Docker emitted the first stats payload — common for trivial
// "exit 0" programs).
export function startMemorySampler(
  container: { stats(opts: { stream: true }): Promise<StatsStream> }
): MemorySampler {
  let peakBytes = 0;
  let resolveStream: (s: StatsStream | null) => void = () => undefined;
  const streamReady = new Promise<StatsStream | null>((r) => { resolveStream = r; });
  let buffer = "";

  function handleChunk(chunk: Buffer | string): void {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    // Each Docker stats frame is a single JSON object terminated by \n.
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const snap = JSON.parse(line) as MemorySnapshot;
        const usage = snap.memory_stats?.max_usage ?? snap.memory_stats?.usage ?? 0;
        if (usage > peakBytes) peakBytes = usage;
      } catch {
        // truncated frame; ignore
      }
    }
  }

  try {
    container.stats({ stream: true })
      .then((stream) => {
        resolveStream(stream);
        stream.on("data", handleChunk);
        stream.on("error", () => undefined);
      })
      .catch(() => resolveStream(null));
  } catch {
    // stats() not implemented (mocks may omit it); proceed without sampler.
    resolveStream(null);
  }

  return {
    async stop() {
      const stream = await streamReady.catch(() => null);
      stream?.destroy?.();
      return peakBytes > 0 ? Math.round(peakBytes / 1024) : null;
    },
  };
}
