import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = ["RABBITMQ_URL", "DATABASE_URL", "HOST_WORK_DIR", "ISOLATE_BIN_PATH"] as const;

type EnvKey = (typeof ENV_KEYS)[number];

const originalEnv: Partial<Record<EnvKey, string>> = {};

async function importConfig() {
  vi.resetModules();
  return import("../config");
}

describe("worker config", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env["RABBITMQ_URL"] = "amqp://localhost:5672";
    process.env["DATABASE_URL"] = "postgres://oct:secret@localhost:5432/oct";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.resetModules();
  });

  it("uses non-public-temp defaults for worker host paths and isolate binary path", async () => {
    // given: required connection env vars are set, optional path env vars are absent

    // when
    const { config } = await importConfig();

    // expect
    expect(config.hostWorkDir).toBe("/var/lib/oct/judge");
    expect(config.isolateBinPath).toBe("/usr/local/bin/isolate");
  });

  it("accepts explicit absolute HOST_WORK_DIR and ISOLATE_BIN_PATH values", async () => {
    // given
    process.env["HOST_WORK_DIR"] = "/srv/oct/judge";
    process.env["ISOLATE_BIN_PATH"] = "/opt/oct/bin/isolate";

    // when
    const { config } = await importConfig();

    // expect
    expect(config.hostWorkDir).toBe("/srv/oct/judge");
    expect(config.isolateBinPath).toBe("/opt/oct/bin/isolate");
  });

  it("treats whitespace-only optional paths as absent and keeps safe defaults", async () => {
    // given
    process.env["HOST_WORK_DIR"] = "   ";
    process.env["ISOLATE_BIN_PATH"] = "\t";

    // when
    const { config } = await importConfig();

    // expect
    expect(config.hostWorkDir).toBe("/var/lib/oct/judge");
    expect(config.isolateBinPath).toBe("/usr/local/bin/isolate");
  });

  it("rejects relative HOST_WORK_DIR values before the worker starts", async () => {
    // given
    process.env["HOST_WORK_DIR"] = "relative/judge";

    // when / expect
    await expect(importConfig()).rejects.toThrow("HOST_WORK_DIR must be an absolute path");
  });

  it("rejects relative ISOLATE_BIN_PATH values before the worker starts", async () => {
    // given
    process.env["ISOLATE_BIN_PATH"] = "isolate";

    // when / expect
    await expect(importConfig()).rejects.toThrow("ISOLATE_BIN_PATH must be an absolute path");
  });
});
