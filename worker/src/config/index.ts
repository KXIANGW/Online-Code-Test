import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  rabbitmqUrl: requireEnv("RABBITMQ_URL"),
  databaseUrl: requireEnv("DATABASE_URL"),
  hostWorkDir: process.env["HOST_WORK_DIR"] ?? "/tmp/judge",
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
