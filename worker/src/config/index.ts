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
  sandboxRuntime: process.env["SANDBOX_RUNTIME"] ?? "runsc",
};
