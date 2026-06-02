import "dotenv/config";

const DEFAULT_HOST_WORK_DIR = "/var/lib/oct/judge";
const DEFAULT_ISOLATE_BIN_PATH = "/usr/local/bin/isolate";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optionalAbsolutePathEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value.startsWith("/")) {
    throw new Error(`${name} must be an absolute path`);
  }
  return value;
}

export const config = {
  rabbitmqUrl: requireEnv("RABBITMQ_URL"),
  databaseUrl: requireEnv("DATABASE_URL"),
  hostWorkDir: optionalAbsolutePathEnv("HOST_WORK_DIR", DEFAULT_HOST_WORK_DIR),
  isolateBinPath: optionalAbsolutePathEnv("ISOLATE_BIN_PATH", DEFAULT_ISOLATE_BIN_PATH),
  // IsolateEngine config. The legacy DockerEngine + SANDBOX_ENGINE knob were
  // dropped in Step B; the only engine now is isolate.
  rootfsBaseDir: process.env["ROOTFS_BASE_DIR"],
  isolateBoxId: process.env["ISOLATE_BOX_ID"]
    ? Number(process.env["ISOLATE_BOX_ID"])
    : undefined,
  // Directory containing the seccomp wrapper + policy. Defaults to the path
  // baked into the worker image; set to empty string to disable seccomp
  // (only safe in trusted local dev).
  seccompBundleDir: process.env["SECCOMP_BUNDLE_DIR"] ?? "/etc/oct",
};
