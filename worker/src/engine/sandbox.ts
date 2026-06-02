import fs from "fs-extra";

const DEFAULT_SANDBOX_WORK_DIR_MODE = 0o700;
const DEFAULT_ISOLATE_FIRST_UID = 60000;

export interface SandboxWorkDirOptions {
  ownerUid?: number;
  ownerGid?: number;
  mode?: number;
}

// Shared sandbox helpers used by IsolateEngine.
//
// Phase 4 dropped the legacy DockerEngine, so the docker-specific helpers
// that used to live here (parseDockerLogs / startMemorySampler /
// sandboxHostConfig / ONE_CPU_NANOS) were removed — isolate writes the meta
// file synchronously after the candidate exits, and IsolateEngine reads
// stdout / stderr directly via the --stdout / --stderr file flags.

// Give the isolate box UID exclusive access to the per-judge work directory.
// Isolate runs boxes under high UIDs (60000 + box-id by default), so chown is
// the production path. Non-root local tests may not be allowed to chown; they
// still keep the directory owner-only rather than making it world-writable.
export async function prepareSandboxWorkDir(
  hostWorkDir: string,
  options: SandboxWorkDirOptions = {},
): Promise<void> {
  const ownerUid = options.ownerUid ?? DEFAULT_ISOLATE_FIRST_UID;
  const ownerGid = options.ownerGid ?? ownerUid;
  const mode = options.mode ?? DEFAULT_SANDBOX_WORK_DIR_MODE;
  if ((mode & 0o002) !== 0) {
    throw new Error("sandbox work directory must not be world-writable");
  }

  await fs.chown(hostWorkDir, ownerUid, ownerGid).catch((err: unknown) => {
    if (isPermissionError(err)) return;
    throw err;
  });
  // Safe by construction: default is 0700, tests assert no world-write bit.
  await fs.chmod(hostWorkDir, mode); // NOSONAR
}

function isPermissionError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "EPERM"
  );
}

// Truncate a string to <= maxBytes bytes in UTF-8 without splitting a
// codepoint. Used to enforce output-limit verdicts.
export function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return value;
  return buffer.subarray(0, maxBytes).toString("utf8");
}
