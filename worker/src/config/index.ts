import "dotenv/config";
import { parseEngineKind } from "../engine/sandbox-engine";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  rabbitmqUrl: requireEnv("RABBITMQ_URL"),
  databaseUrl: requireEnv("DATABASE_URL"),
  hostWorkDir: process.env["HOST_WORK_DIR"] ?? "/tmp/judge",
  sandboxRuntime: process.env["SANDBOX_RUNTIME"] ?? "runsc",
  sandboxEngine: parseEngineKind(process.env["SANDBOX_ENGINE"]),
  // Isolate-engine config (only consulted when sandboxEngine="isolate")
  rootfsBaseDir: process.env["ROOTFS_BASE_DIR"],
  isolateBoxId: process.env["ISOLATE_BOX_ID"]
    ? Number(process.env["ISOLATE_BOX_ID"])
    : undefined,
  seccompPolicyPath: process.env["SECCOMP_POLICY_PATH"],
};
