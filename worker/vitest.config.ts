import { defineConfig } from "vitest/config";

process.env["RABBITMQ_URL"] = process.env["RABBITMQ_URL"] ?? "amqp://oct:oct_dev_password@localhost:5672";
process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://oct:oct_dev_password_change_me@localhost:5432/oct";
process.env["HOST_WORK_DIR"] = process.env["HOST_WORK_DIR"] ?? "/tmp/judge-test";
process.env["SANDBOX_RUNTIME"] = process.env["SANDBOX_RUNTIME"] ?? "runc";

const isIntegration = process.env["TEST_MODE"] === "integration";

export default defineConfig({
  test: {
    globals: false,
    testTimeout: isIntegration ? 60_000 : 10_000,
    // npm test               → unit tests only   (no Docker / DB required)
    // npm run test:integration → *.integration.test.ts only (requires Docker + runner images)
    include: isIntegration
      ? ["src/__tests__/**/*.integration.test.ts"]
      : ["src/__tests__/**/*.test.ts", "!src/__tests__/**/*.integration.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/index.ts",
        "src/healthcheck.ts",
        "src/db/client.ts",
        "node_modules/**",
        "dist/**",
      ],
      reporter: ["text", "lcov", "json-summary"],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
});
