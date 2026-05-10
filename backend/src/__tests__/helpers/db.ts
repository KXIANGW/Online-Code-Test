import bcrypt from "bcrypt";
import { pool } from "../../db/client";
import { db } from "../../db/client";
import { users, userRoles, roles } from "../../db/schema";
import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export async function truncateTestTables(): Promise<void> {
  await pool.query(`
    TRUNCATE submission_testcase_results, submissions,
             exam_session_problems, exam_sessions,
             problem_testcases, problems,
             user_roles, users
    RESTART IDENTITY CASCADE
  `);
}

interface SeedUser {
  username: string;
  password: string;
  displayName: string;
  isSuperuser?: boolean;
  roleNames?: string[];
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
    })
    .returning({ id: users.id });

  const userId = userRows[0]!.id;

  if (data.roleNames && data.roleNames.length > 0) {
    const roleRows = await db
      .select({ id: roles.id })
      .from(roles)
      .where(inArray(roles.name, data.roleNames));

    if (roleRows.length > 0) {
      await db.insert(userRoles).values(
        roleRows.map((r) => ({ userId, roleId: r.id }))
      );
    }
  }

  return userId;
}

export async function loginAs(
  app: FastifyInstance,
  username: string,
  password: string
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  const body = res.json<{ token: string }>();
  return body.token;
}
