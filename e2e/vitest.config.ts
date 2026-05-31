import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    hookTimeout: 90000,
    testTimeout: 120000,
    globalSetup: ["global-setup.ts"],
  },
});
