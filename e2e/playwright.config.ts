import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "browser-tests",
  timeout: 120000,
  // CI judge pipeline (isolate sandbox cold start) is occasionally slow enough
  // to time out the verdict wait; retry flaky specs on CI instead of failing the run.
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env["FRONTEND_URL"] ?? "http://localhost:5173",
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  globalSetup: "./playwright-global-setup.ts",
});
