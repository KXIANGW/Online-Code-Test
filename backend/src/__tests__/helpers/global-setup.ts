import { Pool } from "pg";

interface QueryPool {
  query: Pool["query"];
  end: Pool["end"];
}

type CreatePool = (config: { connectionString: string }) => QueryPool;

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function getDatabaseName(connectionString: string): string {
  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!databaseName) {
    throw new Error("DATABASE_URL must include a database name for tests");
  }
  return databaseName;
}

function getMaintenanceConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  return url.toString();
}

export async function ensureDatabaseExists(
  connectionString: string,
  createPool: CreatePool = (config) => new Pool(config),
): Promise<void> {
  const databaseName = getDatabaseName(connectionString);
  const url = new URL(connectionString);
  const owner = decodeURIComponent(url.username);
  const templateName = process.env["TEST_DATABASE_TEMPLATE"] ?? "oct";
  const adminPool = createPool({
    connectionString: getMaintenanceConnectionString(connectionString),
  });

  try {
    const result = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      databaseName,
    ]);
    if (result.rows.length > 0) return;

    const ownerClause = owner ? ` OWNER ${quoteIdentifier(owner)}` : "";
    await adminPool.query(
      `CREATE DATABASE ${quoteIdentifier(databaseName)} WITH TEMPLATE ${quoteIdentifier(
        templateName,
      )}${ownerClause}`,
    );
  } finally {
    await adminPool.end();
  }
}

export async function setup() {
  if (process.env["SKIP_DB_GLOBAL_SETUP"] === "1") return;

  // vitest.config.ts already normalises DATABASE_URL to a localhost URL before this runs,
  // so reading DATABASE_URL here is safe even when the original .env used the Docker hostname.
  const url =
    process.env["DATABASE_URL"] ??
    "postgres://oct:oct_dev_password_change_me@localhost:5432/oct_test";

  await ensureDatabaseExists(url);

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
    `);
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS encrypted_password TEXT;
    `);
    await pool.query(`
      ALTER TABLE exam_sessions
        ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
    `);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'violation_type') THEN
          CREATE TYPE violation_type AS ENUM (
            'fullscreen_exit',
            'tab_switch',
            'window_blur',
            'paste',
            'copy'
          );
        END IF;
      END $$;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS exam_violations (
        id          BIGSERIAL PRIMARY KEY,
        session_id  BIGINT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
        type        violation_type NOT NULL,
        detail      TEXT,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_exam_violations_session_id
        ON exam_violations(session_id, occurred_at);
    `);
  } finally {
    await pool.end();
  }
}
