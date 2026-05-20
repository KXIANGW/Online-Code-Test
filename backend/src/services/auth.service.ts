import bcrypt from "bcrypt";
import type { FastifyInstance } from "fastify";
import { db } from "../db/client";
import { users, userRoles, rolePermissions, permissions } from "../db/schema";
import { eq, isNull, inArray } from "drizzle-orm";
import { UnauthorizedError } from "../errors";

export async function login(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.username, username));

  if (!user || user.deletedAt !== null) throw UnauthorizedError();

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw UnauthorizedError();

  const roleRows = await db
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));

  const roleIds = roleRows.map((r) => r.roleId);

  let permCodes: string[] = [];
  if (roleIds.length > 0) {
    const rpRows = await db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, roleIds));

    const permIds = rpRows.map((r) => r.permissionId);

    if (permIds.length > 0) {
      const permRows = await db
        .select({ code: permissions.code })
        .from(permissions)
        .where(inArray(permissions.id, permIds));
      permCodes = permRows.map((p) => p.code);
    }
  }

  const token = app.jwt.sign({
    sub: user.id,
    isSuperuser: user.isSuperuser,
    permissions: permCodes,
  });

  return token;
}
