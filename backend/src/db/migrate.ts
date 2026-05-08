import { Pool } from "pg";
import { env } from "../env";

// M1 keeps migrations as one idempotent bootstrap so a fresh Postgres volume
// boots cleanly with `docker compose up`. M2 will switch to drizzle-kit
// generated SQL files under ./drizzle once the schema starts changing.
const BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('root','interview_manager','problem_setter','interviewee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE difficulty AS ENUM ('easy','medium','hard');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(100),
  role user_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  statement_md TEXT NOT NULL,
  difficulty difficulty NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    console.log("[migrate] applying bootstrap schema...");
    await pool.query(BOOTSTRAP_SQL);
    console.log("[migrate] done.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
