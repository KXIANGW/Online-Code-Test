import { Pool } from "pg";
import { env } from "../env";

interface MigrationPool {
  query(sql: string): Promise<unknown>;
}

// Schema is managed by /infra/postgres/*.sql init scripts (mounted at
// /docker-entrypoint-initdb.d/). This file only ensures pgcrypto is present
// as a safety net for environments where init scripts may not have run.
export async function runMigrations(pool: MigrationPool): Promise<void> {
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
  await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
    `);
  await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS encrypted_password TEXT;
    `);
  await pool.query(`
      CREATE TABLE IF NOT EXISTS exams (
        id               BIGSERIAL   PRIMARY KEY,
        title            VARCHAR(255) NOT NULL,
        duration_minutes INT         NOT NULL CHECK (duration_minutes > 0),
        created_by       BIGINT      NOT NULL REFERENCES users(id),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ
      );
    `);
  await pool.query(`
      CREATE TABLE IF NOT EXISTS exam_problems (
        id           BIGSERIAL   PRIMARY KEY,
        exam_id      BIGINT      NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        problem_id   BIGINT      NOT NULL REFERENCES problems(id),
        order_index  INT         NOT NULL,
        score_weight INT         NOT NULL DEFAULT 100 CHECK (score_weight >= 0),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (exam_id, order_index),
        UNIQUE (exam_id, problem_id)
      );
    `);
  await pool.query(`
      ALTER TABLE exam_sessions
        ADD COLUMN IF NOT EXISTS exam_id BIGINT REFERENCES exams(id);
    `);
  await pool.query(`
      DO $$
      DECLARE
        r RECORD;
        v_exam_id BIGINT;
        has_duration BOOLEAN;
      BEGIN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'exam_sessions'
            AND column_name = 'duration_minutes'
        ) INTO has_duration;

        IF has_duration THEN
          FOR r IN EXECUTE '
            SELECT id, created_by, duration_minutes
            FROM exam_sessions
            WHERE exam_id IS NULL
          ' LOOP
            INSERT INTO exams (title, duration_minutes, created_by)
            VALUES (
              'Migrated exam #' || r.id,
              GREATEST(COALESCE(r.duration_minutes, 60), 1),
              r.created_by
            )
            RETURNING id INTO v_exam_id;

            INSERT INTO exam_problems (exam_id, problem_id, order_index, score_weight)
            SELECT v_exam_id, problem_id, order_index, score_weight
            FROM exam_session_problems
            WHERE exam_session_id = r.id
            ON CONFLICT DO NOTHING;

            UPDATE exam_sessions SET exam_id = v_exam_id WHERE id = r.id;
          END LOOP;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM exam_sessions WHERE exam_id IS NULL) THEN
          ALTER TABLE exam_sessions ALTER COLUMN exam_id SET NOT NULL;
        END IF;
      END $$;
    `);
  await pool.query(`
      ALTER TABLE exam_sessions
        ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
    `);
  await pool.query(`
      ALTER TABLE exam_sessions
        DROP COLUMN IF EXISTS duration_minutes;
    `);
  console.log("[migrate] done.");
}

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[migrate] failed:", err);
    process.exit(1);
  });
}
