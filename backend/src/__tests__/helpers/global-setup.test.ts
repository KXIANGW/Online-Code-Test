import { describe, expect, it, vi } from "vitest";
import { ensureDatabaseExists } from "./global-setup";

describe("ensureDatabaseExists", () => {
  it("creates the target database from the default template when it is missing", async () => {
    const adminPool = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }),
      end: vi.fn().mockResolvedValue(undefined),
    };
    const createPool = vi.fn(() => adminPool);

    await ensureDatabaseExists("postgres://oct:secret@localhost:5432/oct_test", createPool);

    expect(createPool).toHaveBeenCalledWith({
      connectionString: "postgres://oct:secret@localhost:5432/postgres",
    });
    expect(adminPool.query).toHaveBeenNthCalledWith(
      1,
      "SELECT 1 FROM pg_database WHERE datname = $1",
      ["oct_test"],
    );
    expect(adminPool.query).toHaveBeenNthCalledWith(
      2,
      'CREATE DATABASE "oct_test" WITH TEMPLATE "oct" OWNER "oct"',
    );
    expect(adminPool.end).toHaveBeenCalledTimes(1);
  });
});
