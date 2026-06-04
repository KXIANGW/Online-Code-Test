import bcrypt from "bcrypt";
import { pool, db } from "../../db/client";
import { redis } from "../../db/redis";
import { users, userRoles, roles } from "../../db/schema";
import { inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

/**
 * 確保測試環境的資料庫結構正確。
 * 因為我們已經正式重構了 db/schema.ts，原先臨時 ALTER TABLE 的邏輯可以移除或更新。
 * 這裡保留基礎延伸套件確保（例如 pgcrypto），其餘交由 migrate.ts 處理。
 */
export async function setupSchema(): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  `);
}

/**
 * 在每個測試檔案/區塊執行前，清空所有測試資料。
 * 這裡必須嚴格依照外鍵相依性或使用 CASCADE，並將新加入的 exams, exam_problems 納入清空範疇。
 */
// export async function truncateTestTables(): Promise<void> {
//   await pool.query(`
//     TRUNCATE submission_testcase_results, submissions,
//              exam_session_problems, exam_sessions,
//              problem_testcases, problems,
//              user_roles, users
//     RESTART IDENTITY CASCADE
//   `);
//   // Flush Redis so stale cache entries from previous test files don't pollute
//   // tests that reseed users with the same auto-incremented IDs.
//   // Only flush when connected: with lazyConnect, calling flushdb() before
//   // connect() queues the command in ioredis's offline queue and hangs forever.
//   if (redis.status === "ready") {
//     await redis.flushdb().catch(() => {});
//   }
// }

export async function truncateTestTables(): Promise<void> {
  // 1. 執行清空（包含新重構的 exams 與 exam_problems）
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

  // 2. 🔥 建立真正與代碼完全對接的權限資料鏈
  await pool.query(`
    -- A. 建立基礎角色
    INSERT INTO roles (id, name) VALUES
      (1, 'superuser'),
      (2, 'interviewer'),
      (3, 'candidate'),
      (4, 'problem_setter')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

    -- B. 初始化所有權限代號（務必包含代碼卡關的 exam:take）
    INSERT INTO permissions (id, code) VALUES
      (1, 'exam:manage'),
      (2, 'exam:take'),
      (3, 'problem:manage')
    ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code;

    -- C. 分配權限給面試官 (role_id = 2)
    INSERT INTO role_permissions (role_id, permission_id) VALUES
      (2, 1)
    ON CONFLICT DO NOTHING;

    -- D. 分配權限給候選人 (role_id = 3)
    INSERT INTO role_permissions (role_id, permission_id) VALUES
      (3, 2)
    ON CONFLICT DO NOTHING;

    -- E. 分配權限給出題主管 (role_id = 4)
    INSERT INTO role_permissions (role_id, permission_id) VALUES
      (4, 3)
    ON CONFLICT DO NOTHING;

    INSERT INTO language_defaults (language, display_name, time_multiplier, memory_multiplier, is_enabled) VALUES
      ('cpp17', 'C++ 17', '1.0', '1.0', true),
      ('python3', 'Python 3', '1.0', '1.0', true)
    ON CONFLICT (language) DO NOTHING;
  `);

  // 3. 清空 Redis 快取
  if (redis.status === "ready") {
    await redis.flushdb().catch(() => {});
  }
}

interface SeedUser {
  username: string;
  password: string;
  displayName: string;
  isSuperuser?: boolean;
  roleNames?: string[];
  createdBy?: number;
}

export async function seedUser(data: SeedUser): Promise<number> {
  const passwordHash = await bcrypt.hash(data.password, 10);

  const userRows = await db
    .insert(users)
    .values({
      username: data.username,
      passwordHash,
      displayName: data.displayName,
      isSuperuser: data.isSuperuser ?? false,
      createdBy: data.createdBy,
    })
    .returning({ id: users.id });

  const userId = userRows[0]!.id;

  if (data.roleNames && data.roleNames.length > 0) {
    const roleRows = await db
      .select({ id: roles.id })
      .from(roles)
      .where(inArray(roles.name, data.roleNames));

    if (roleRows.length > 0) {
      await db.insert(userRoles).values(roleRows.map((r) => ({ userId, roleId: r.id })));
    }
  }

  return userId;
}

export async function loginAs(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  const body = res.json<{ token: string }>();
  return body.token;
}
