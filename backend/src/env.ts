import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  JWT_SECRET: z.string().min(32),
  // 64 hex chars (32 bytes) used for AES-256-GCM password encryption.
  // Defaults to a dev-only key; MUST be overridden in production.
  ENCRYPTION_SECRET: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "ENCRYPTION_SECRET must be exactly 64 lowercase hex chars (32 bytes)")
    .default("000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f"),
  TEST_DATABASE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = (() => {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
})();
