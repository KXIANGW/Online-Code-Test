import { Pool } from "pg";
import { Redis } from "ioredis";

// HOST_POSTGRES_PORT defaults to 5433 (matches docker-compose.yml port mapping 5433->5432)
const PG_PORT = process.env["HOST_POSTGRES_PORT"] ?? "5433";
const DB_URL =
  process.env["E2E_DATABASE_URL"] ??
  `postgres://oct:oct_dev_password_change_me@localhost:${PG_PORT}/oct`;
// BASE_URL is reserved by Vite (defaults to "/"); use E2E_API_URL instead
const BACKEND_URL = process.env["E2E_API_URL"] ?? "http://localhost:3000";

async function pollUntilReady(url: string, timeoutMs = 120000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${url}`);
}

export async function setup(): Promise<void> {
  console.log("[e2e] Waiting for Docker services...");
  // Worker port 8080 is not exposed on the host — backend health is sufficient
  await pollUntilReady(`${BACKEND_URL}/api/health`);
  console.log("[e2e] Services ready. Resetting database...");

  const pool = new Pool({ connectionString: DB_URL, max: 2 });
  try {
    await pool.query(`
      TRUNCATE
        exam_violations,
        submission_testcase_results,
        submissions,
        exam_session_problems,
        exam_sessions,
        exam_problems,
        exams,
        problem_testcases,
        problems,
        problem_language_limits,
        user_roles,
        users,
        role_permissions,
        roles,
        permissions,
        language_defaults
      RESTART IDENTITY CASCADE
    `);

    await pool.query(`
      INSERT INTO roles (id, name) VALUES
        (1, 'superuser'),
        (2, 'interviewer'),
        (3, 'candidate'),
        (4, 'problem_setter')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

      INSERT INTO permissions (id, code) VALUES
        (1, 'exam:manage'),
        (2, 'exam:take'),
        (3, 'problem:manage')
      ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code;

      INSERT INTO role_permissions (role_id, permission_id) VALUES
        (2, 1),
        (3, 2),
        (4, 3)
      ON CONFLICT DO NOTHING;

      INSERT INTO language_defaults (language, display_name, time_multiplier, memory_multiplier, is_enabled) VALUES
        ('cpp17',   'C++ 17',   '1.0', '1.0', true),
        ('python3', 'Python 3', '1.0', '1.0', true)
      ON CONFLICT (language) DO NOTHING;

      INSERT INTO users (username, password_hash, display_name, is_superuser)
      VALUES ('root', crypt('Root@1234', gen_salt('bf', 10)), 'E2E Root', TRUE);

      INSERT INTO users (username, password_hash, display_name, created_by)
      VALUES (
        'alice',
        crypt('Test@1234', gen_salt('bf', 10)),
        'E2E Alice',
        (SELECT id FROM users WHERE username = 'root')
      );

      INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, r.id FROM users u, roles r
      WHERE u.username = 'alice' AND r.name = 'interviewer';

      INSERT INTO users (username, password_hash, display_name, created_by)
      VALUES (
        'bob',
        crypt('Test@1234', gen_salt('bf', 10)),
        'E2E Bob',
        (SELECT id FROM users WHERE username = 'root')
      );

      INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, r.id FROM users u, roles r
      WHERE u.username = 'bob' AND r.name = 'problem_setter';
    `);
  } finally {
    await pool.end();
  }

  const redis = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379", {
    lazyConnect: true,
  });
  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    await redis.quit().catch(() => {});
  }

  console.log("[e2e] Database reset and Redis flushed. Running tests...");
}

export async function teardown(): Promise<void> {}
