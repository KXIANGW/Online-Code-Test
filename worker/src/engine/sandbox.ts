import fs from "fs-extra";

// Shared sandbox helpers used by IsolateEngine.
//
// Phase 4 dropped the legacy DockerEngine, so the docker-specific helpers
// that used to live here (parseDockerLogs / startMemorySampler /
// sandboxHostConfig / ONE_CPU_NANOS) were removed — isolate writes the meta
// file synchronously after the candidate exits, and IsolateEngine reads
// stdout / stderr directly via the --stdout / --stderr file flags.

// Make the per-judge work directory world-writable so isolate (which runs
// each box under its own UID in the 60000+ range) can write stdout.txt /
// stderr.txt / the compiled binary back to the host-mounted path.
export async function prepareSandboxWorkDir(hostWorkDir: string): Promise<void> {
  await fs.chmod(hostWorkDir, 0o777).catch(() => undefined);
}

// Truncate a string to <= maxBytes bytes in UTF-8 without splitting a
// codepoint. Used to enforce output-limit verdicts.
export function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return value;
  return buffer.subarray(0, maxBytes).toString("utf8");
}
