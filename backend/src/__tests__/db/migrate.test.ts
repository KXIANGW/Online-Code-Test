import { describe, expect, it, vi } from "vitest";
import { runMigrations } from "../../db/migrate";

describe("runMigrations", () => {
  it("ensures the violations schema exists for databases created before anticheat tables", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    await runMigrations(pool);

    const migrationSql = pool.query.mock.calls.map(([sql]) => String(sql)).join("\n");
    expect(migrationSql).toContain("CREATE TYPE violation_type AS ENUM");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS exam_violations");
    expect(migrationSql).toContain("idx_exam_violations_session_id");
  });
});
