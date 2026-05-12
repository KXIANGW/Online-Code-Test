import { defineConfig } from "vitest/config";

process.env["RABBITMQ_URL"] = process.env["RABBITMQ_URL"] ?? "amqp://oct:oct_dev_password@localhost:5672";
process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://oct:oct_dev_password_change_me@localhost:5432/oct";
process.env["HOST_WORK_DIR"] = process.env["HOST_WORK_DIR"] ?? "/tmp/judge-test";
process.env["SANDBOX_RUNTIME"] = process.env["SANDBOX_RUNTIME"] ?? "runc";

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 10000,
    include: ["src/__tests__/**/*.test.ts"],
  },
});
