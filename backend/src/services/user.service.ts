import bcrypt from "bcrypt";
import { db } from "../db/client";
import { users, userRoles, roles } from "../db/schema";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import type { FastifyJWT } from "@fastify/jwt";
import { cacheGet, cacheSet, cacheDel } from "../db/redis";

type CurrentUser = FastifyJWT["user"];

export function requireSuperuser(user: CurrentUser): void {
  if (!user.isSuperuser) throw ForbiddenError();
}

export function requirePermissionOrSuperuser(user: CurrentUser, perm: string): void {
  if (!user.isSuperuser && !user.permissions.includes(perm)) throw ForbiddenError();
}

export async function listUsers(currentUser: CurrentUser) {
  requirePermissionOrSuperuser(currentUser, "exam:manage");

  const cols = {
    id: users.id,
    username: users.username,
    displayName: users.displayName,
    isSuperuser: users.isSuperuser,
    createdAt: users.createdAt,
    roles: sql<string[]>`array_remove(array_agg(${roles.name}), NULL)`,
  };

  // superuser sees all users; exam:manage sees only candidates they personally created
  if (currentUser.isSuperuser) {
    return db
      .select(cols)
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(isNull(users.deletedAt))
      .groupBy(users.id, users.username, users.displayName, users.isSuperuser, users.createdAt);
  }
  return db
    .select(cols)
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        isNull(users.deletedAt),
        eq(users.isSuperuser, false),
        eq(users.createdBy, currentUser.id),
      ),
    )
    .groupBy(users.id, users.username, users.displayName, users.isSuperuser, users.createdAt);
}

export async function createUser(
  currentUser: CurrentUser,
  data: { username: string; password: string; displayName?: string; roleNames?: string[] },
) {
  const canCreate = currentUser.isSuperuser || currentUser.permissions.includes("exam:manage");
  if (!canCreate) throw ForbiddenError();

  // exam:manage (non-superuser) may only create candidate-role accounts
  if (!currentUser.isSuperuser) {
    const requested = data.roleNames ?? [];
    if (requested.some((r) => r !== "candidate")) throw ForbiddenError();
  }

  const effectiveRoles: string[] =
    data.roleNames && data.roleNames.length > 0 ? data.roleNames : ["candidate"];

  const passwordHash = await bcrypt.hash(data.password, 10);

  return db
    .transaction(async (tx) => {
      const roleRows = await tx
        .select({ id: roles.id, name: roles.name })
        .from(roles)
        .where(inArray(roles.name, effectiveRoles));

      if (roleRows.length !== new Set(effectiveRoles).size) {
        throw BadRequestError("Unknown role");
      }

      const userRows = await tx
        .insert(users)
        .values({
          username: data.username,
          passwordHash,
          displayName: data.displayName,
          isSuperuser: false,
          createdBy: currentUser.isSuperuser ? undefined : currentUser.id,
        })
        .returning();

      const user = userRows[0]!;

      await tx.insert(userRoles).values(roleRows.map((r) => ({ userId: user.id, roleId: r.id })));

      return { id: user.id, username: user.username, displayName: user.displayName };
    })
    .catch((err: unknown) => {
      if (isPgErrorCode(err, "23505")) throw ConflictError("Username already exists");
      throw err;
    });
}

export async function batchCreateCandidates(
  currentUser: CurrentUser,
  count: number,
): Promise<{ username: string; password: string }[]> {
  if (!currentUser.isSuperuser && !currentUser.permissions.includes("exam:manage")) {
    throw ForbiddenError();
  }

  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");

  const existing = await db
    .select({ username: users.username })
    .from(users)
    .where(sql`username LIKE ${"candidate_" + dateStr + "_%"}`);

  const existingNums = existing
    .map((u) => parseInt(u.username.split("_").pop() ?? "0"))
    .filter((n) => !isNaN(n));
  const startNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;

  const results: { username: string; password: string }[] = [];

  for (let i = 0; i < count; i++) {
    const num = String(startNum + i).padStart(3, "0");
    const username = `candidate_${dateStr}_${num}`;
    const password = generatePassword(12);
    const passwordHash = await bcrypt.hash(password, 10);

    const candidateRole = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, "candidate"));

    await db.transaction(async (tx) => {
      const insertedRows = await tx
        .insert(users)
        .values({
          username,
          passwordHash,
          displayName: username,
          isSuperuser: false,
          createdBy: currentUser.isSuperuser ? undefined : currentUser.id,
        })
        .returning({ id: users.id });

      const newUser = insertedRows[0]!;
      if (candidateRole.length > 0) {
        await tx.insert(userRoles).values({ userId: newUser.id, roleId: candidateRole[0]!.id });
      }
    });

    results.push({ username, password });
  }

  return results;
}

type UserProfileCache = {
  id: number;
  username: string;
  displayName: string | null;
  isSuperuser: boolean;
  createdAt: string;
};

export async function getUser(currentUser: CurrentUser, targetId: number) {
  if (!currentUser.isSuperuser && currentUser.id !== targetId) throw ForbiddenError();

  const cacheKey = `user:${targetId}`;
  const cached = await cacheGet<UserProfileCache>(cacheKey).catch(() => null);
  if (cached) return cached;

  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      isSuperuser: users.isSuperuser,
      createdAt: users.createdAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, targetId));

  if (!user || user.deletedAt !== null) throw NotFoundError("user");
  const { deletedAt: _deletedAt, ...response } = user;
  cacheSet(cacheKey, response, 300).catch(() => {});
  return response;
}

export async function updateUser(
  currentUser: CurrentUser,
  targetId: number,
  data: { displayName?: string; password?: string },
) {
  requirePermissionOrSuperuser(currentUser, "exam:manage");

  const [existing] = await db
    .select({
      id: users.id,
      deletedAt: users.deletedAt,
      isSuperuser: users.isSuperuser,
      createdBy: users.createdBy,
    })
    .from(users)
    .where(eq(users.id, targetId));

  if (!existing || existing.deletedAt !== null) throw NotFoundError("user");
  if (!currentUser.isSuperuser && existing.isSuperuser) throw ForbiddenError();
  if (!currentUser.isSuperuser && existing.createdBy !== currentUser.id) throw ForbiddenError();

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.displayName !== undefined) updates.displayName = data.displayName;
  if (data.password !== undefined) updates.passwordHash = await bcrypt.hash(data.password, 10);

  await db.update(users).set(updates).where(eq(users.id, targetId));
  cacheDel(`user:${targetId}`).catch(() => {});

  const [updated] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      isSuperuser: users.isSuperuser,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, targetId));

  return updated!;
}

export async function updateUserRoles(
  currentUser: CurrentUser,
  targetId: number,
  roleNames: string[],
) {
  requireSuperuser(currentUser);

  const allowed = new Set(["interviewer", "problem_setter"]);
  if (roleNames.some((r) => !allowed.has(r)))
    throw BadRequestError("Only interviewer and problem_setter roles are assignable");

  const [existing] = await db
    .select({ id: users.id, deletedAt: users.deletedAt, isSuperuser: users.isSuperuser })
    .from(users)
    .where(eq(users.id, targetId));

  if (!existing || existing.deletedAt !== null) throw NotFoundError("user");
  if (existing.isSuperuser) throw ForbiddenError();

  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(eq(userRoles.userId, targetId));
    if (roleNames.length > 0) {
      const roleRows = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(inArray(roles.name, roleNames));
      if (roleRows.length !== new Set(roleNames).size) throw BadRequestError("Unknown role");
      await tx.insert(userRoles).values(roleRows.map((r) => ({ userId: targetId, roleId: r.id })));
    }
  });

  return { id: targetId, roles: roleNames };
}

export async function deleteUser(currentUser: CurrentUser, targetId: number) {
  requirePermissionOrSuperuser(currentUser, "exam:manage");

  const [existing] = await db
    .select({
      id: users.id,
      deletedAt: users.deletedAt,
      isSuperuser: users.isSuperuser,
      createdBy: users.createdBy,
    })
    .from(users)
    .where(eq(users.id, targetId));

  if (!existing || existing.deletedAt !== null) throw NotFoundError("user");
  if (!currentUser.isSuperuser && existing.isSuperuser) throw ForbiddenError();
  if (!currentUser.isSuperuser && existing.createdBy !== currentUser.id) throw ForbiddenError();

  await db
    .update(users)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, targetId));

  cacheDel(`user:${targetId}`).catch(() => {});
}

function generatePassword(length: number): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function isPgErrorCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === code;
}
