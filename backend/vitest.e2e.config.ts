import { defineConfig } from "vitest/config";

process.env["NODE_ENV"] = "test";
process.env["JWT_SECRET"] =
  process.env["JWT_SECRET"] ?? "test-secret-minimum-32-chars-for-jwt-signing";
process.env["DATABASE_URL"] =
  process.env["TEST_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgres://oct:oct_dev_password_change_me@localhost:5432/oct";
process.env["RABBITMQ_URL"] =
  process.env["RABBITMQ_URL"] ?? "amqp://oct:oct_dev_password@localhost:5672";
process.env["HOST_WORK_DIR"] = process.env["HOST_WORK_DIR"] ?? "/tmp/judge-e2e";
process.env["SANDBOX_RUNTIME"] = process.env["SANDBOX_RUNTIME"] ?? "runc";
process.env["LOG_LEVEL"] = process.env["LOG_LEVEL"] ?? "warn";

export default defineConfig({
  test: {
    globals: false,
    include: ["src/__e2e__/**/*.e2e.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 60000,
    testTimeout: 180000,
  },
});
