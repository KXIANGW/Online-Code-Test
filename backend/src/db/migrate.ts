import { Pool } from "pg";
import { env } from "../env";

// Schema is managed by /infra/postgres/*.sql init scripts (mounted at
// /docker-entrypoint-initdb.d/). This file only ensures pgcrypto is present
// as a safety net for environments where init scripts may not have run.
async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    console.log("[migrate] ensuring pgcrypto extension...");
    await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_type') THEN
          CREATE TYPE submission_type AS ENUM ('simple', 'formal');
        END IF;
      END $$;
    `);
    await pool.query(`
      DO $$
      BEGIN
        IF to_regclass('public.submissions') IS NOT NULL THEN
          ALTER TABLE submissions
            ADD COLUMN IF NOT EXISTS submission_type submission_type NOT NULL DEFAULT 'formal';
        END IF;
      END $$;
    `);
    console.log("[migrate] done.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
