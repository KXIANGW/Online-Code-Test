import { Pool } from "pg";

export async function setup() {
  const url =
    process.env["TEST_DATABASE_URL"] ??
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
