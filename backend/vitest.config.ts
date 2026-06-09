import { defineConfig } from "vitest/config";

// Set required env vars for test process before any modules load.
// DATABASE_URL from .env uses the Docker service hostname (e.g. @postgres:5432) which is
// unreachable from the host. Always override with TEST_DATABASE_URL or a localhost fallback
// so tests can connect when running outside Docker.
process.env["JWT_SECRET"] = process.env["JWT_SECRET"] ?? "test-secret-minimum-32-chars-for-jwt-signing";
process.env["DATABASE_URL"] =
  process.env["TEST_DATABASE_URL"] ??
  "postgres://oct:oct_dev_password_change_me@localhost:5432/oct_test";
process.env["RABBITMQ_URL"] =
  process.env["TEST_RABBITMQ_URL"] ?? "amqp://oct:oct_dev_password@localhost:5672";

export default defineConfig({
  test: {
    globals: false,
    exclude: ["node_modules/**", "dist/**", "src/__e2e__/**"],
    globalSetup: ["src/__tests__/helpers/global-setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/__e2e__/**",
        "src/types.d.ts",
        "src/db/migrate.ts",
        "src/env.ts",
        "src/server.ts",
        "node_modules/**",
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
