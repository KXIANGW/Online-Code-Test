import { Pool } from "pg";

export async function setup() {
  if (process.env["SKIP_DB_GLOBAL_SETUP"] === "1") return;

  // vitest.config.ts already normalises DATABASE_URL to a localhost URL before this runs,
  // so reading DATABASE_URL here is safe even when the original .env used the Docker hostname.
  const url =
    process.env["DATABASE_URL"] ?? "postgres://oct:oct_dev_password_change_me@localhost:5432/oct_test";

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
    `);
    await pool.query(`
      ALTER TABLE exam_sessions
        ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
    `);
  } finally {
    await pool.end();
  }
}
