import { defineConfig } from "vitest/config";

// Set required env vars for test process before any modules load
process.env["JWT_SECRET"] = process.env["JWT_SECRET"] ?? "test-secret-minimum-32-chars-for-jwt-signing";
process.env["DATABASE_URL"] =
  process.env["TEST_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgres://oct:oct_dev_password_change_me@localhost:5432/oct";
process.env["RABBITMQ_URL"] =
  process.env["RABBITMQ_URL"] ?? "amqp://oct:oct_dev_password@localhost:5672";

export default defineConfig({
  test: {
    globals: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
  },
});
