import { Pool } from "pg";

export async function setup() {
  // vitest.config.ts already normalises DATABASE_URL to a localhost URL before this runs,
  // so reading DATABASE_URL here is safe even when the original .env used the Docker hostname.
  const url =
    process.env["DATABASE_URL"] ??
    "postgres://oct:oct_dev_password_change_me@localhost:5432/oct";

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
    `);
  } finally {
    await pool.end();
  }
}
