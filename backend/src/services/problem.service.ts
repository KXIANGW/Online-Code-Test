import { db } from "../db/client";
import {
  problems,
  problemTestcases,
  examSessionProblems,
  problemLanguageLimits,
} from "../db/schema";
import { eq, isNull, sql } from "drizzle-orm";
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from "../errors";
import type { FastifyJWT } from "@fastify/jwt";
import { cacheGet, cacheSet, cacheDel } from "../db/redis";

type CurrentUser = FastifyJWT["user"];

// ── Types for raw cache payload ───────────────────────────────────────────────

type RawProblem = {
  id: number;
  title: string;
  descriptionMd: string;
  difficulty: "easy" | "medium" | "hard";
  timeLimitMs: number;
  memoryLimitMb: number;
  outputLimitKb: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type RawTestcase = {
  id: number;
  problemId: number;
  orderIndex: number;
  isPublic: boolean;
  inputData: string;
  expectedOutput: string;
  createdAt: string;
};

type RawLanguageLimit = {
  language: string;
  timeMultiplier: string;
  memoryMultiplier: string;
};

type RawProblemCache = {
  problem: RawProblem;
  testcases: RawTestcase[];
  languageLimits: RawLanguageLimit[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireProblemAccess(user: CurrentUser): void {
  if (
    !user.isSuperuser &&
    !user.permissions.includes("problem:manage") &&
    !user.permissions.includes("exam:manage")
  ) {
    throw ForbiddenError();
  }
}

function requireProblemManage(user: CurrentUser): void {
  if (!user.isSuperuser && !user.permissions.includes("problem:manage")) {
    throw ForbiddenError();
  }
}

function sanitizeProblemCache(raw: RawProblemCache, currentUser: CurrentUser) {
  const canSeeHidden =
    currentUser.isSuperuser || currentUser.permissions.includes("problem:manage");

  const sanitizedTestcases = raw.testcases.map((tc) => ({
    id: tc.id,
    orderIndex: tc.orderIndex,
    isPublic: tc.isPublic,
    ...(canSeeHidden || tc.isPublic
      ? { inputData: tc.inputData, expectedOutput: tc.expectedOutput }
      : {}),
  }));

  return { ...raw.problem, testcases: sanitizedTestcases, languageLimits: raw.languageLimits };
}

// ── Service functions ─────────────────────────────────────────────────────────

export async function listProblems(currentUser: CurrentUser) {
  requireProblemAccess(currentUser);

  const cached = await cacheGet<
    {
      id: number;
      title: string;
      difficulty: "easy" | "medium" | "hard";
      timeLimitMs: number;
      memoryLimitMb: number;
      createdAt: string;
    }[]
  >("problems:list").catch(() => null);
  if (cached) return cached;

  const result = await db
    .select({
      id: problems.id,
      title: problems.title,
      difficulty: problems.difficulty,
      timeLimitMs: problems.timeLimitMs,
      memoryLimitMb: problems.memoryLimitMb,
      createdAt: problems.createdAt,
    })
    .from(problems)
    .where(isNull(problems.deletedAt));

  cacheSet("problems:list", result, 300).catch(() => {});
  return result;
}

export async function createProblem(
  currentUser: CurrentUser,
  data: {
    title: string;
    descriptionMd: string;
    difficulty: "easy" | "medium" | "hard";
    timeLimitMs: number;
    memoryLimitMb: number;
    outputLimitKb?: number;
    testcases?: {
      orderIndex: number;
      isPublic: boolean;
      inputData: string;
      expectedOutput: string;
    }[];
    languageLimits?: { language: string; timeMultiplier: number; memoryMultiplier: number }[];
  },
) {
  requireProblemManage(currentUser);

  assertUniqueValues(
    data.testcases?.map((tc) => tc.orderIndex) ?? [],
    "Duplicate testcase orderIndex",
  );
  assertUniqueValues(
    data.languageLimits?.map((ll) => ll.language) ?? [],
    "Duplicate language limit",
  );

  const problem = await db
    .transaction(async (tx) => {
      const problemRows = await tx
        .insert(problems)
        .values({
          title: data.title,
          descriptionMd: data.descriptionMd,
          difficulty: data.difficulty,
          timeLimitMs: data.timeLimitMs,
          memoryLimitMb: data.memoryLimitMb,
          outputLimitKb: data.outputLimitKb ?? 64,
          createdBy: currentUser.id,
        })
        .returning();

      const created = problemRows[0]!;

      if (data.testcases && data.testcases.length > 0) {
        await tx
          .insert(problemTestcases)
          .values(data.testcases.map((tc) => ({ ...tc, problemId: created.id })));
      }

      if (data.languageLimits && data.languageLimits.length > 0) {
        await tx.insert(problemLanguageLimits).values(
          data.languageLimits.map((ll) => ({
            problemId: created.id,
            language: ll.language,
            timeMultiplier: String(ll.timeMultiplier),
            memoryMultiplier: String(ll.memoryMultiplier),
          })),
        );
      }

      return created;
    })
    .catch((err: unknown) => {
      if (isPgErrorCode(err, "23503")) throw BadRequestError("Unknown language or user");
      if (isPgErrorCode(err, "23505")) throw ConflictError("Duplicate problem data");
      throw err;
    });

  cacheDel("problems:list").catch(() => {});
  return problem;
}

export async function getProblem(currentUser: CurrentUser, id: number) {
  requireProblemAccess(currentUser);

  const cacheKey = `problem:${id}:raw`;
  const cached = await cacheGet<RawProblemCache>(cacheKey).catch(() => null);

  if (cached) {
    if (!cached.problem || cached.problem.deletedAt !== null) throw NotFoundError("problem");
    return sanitizeProblemCache(cached, currentUser);
  }

  const [problem] = await db.select().from(problems).where(eq(problems.id, id));

  if (!problem || problem.deletedAt !== null) throw NotFoundError("problem");

  const testcases = await db
    .select()
    .from(problemTestcases)
    .where(eq(problemTestcases.problemId, id));

  const languageLimits = await db
    .select({
      language: problemLanguageLimits.language,
      timeMultiplier: problemLanguageLimits.timeMultiplier,
      memoryMultiplier: problemLanguageLimits.memoryMultiplier,
    })
    .from(problemLanguageLimits)
    .where(eq(problemLanguageLimits.problemId, id));

  const rawPayload: RawProblemCache = {
    problem: {
      ...problem,
      createdAt: problem.createdAt.toISOString(),
      updatedAt: problem.updatedAt.toISOString(),
      deletedAt: (problem.deletedAt as Date | null)?.toISOString() ?? null,
    },
    testcases: testcases.map((tc) => ({
      ...tc,
      createdAt: tc.createdAt.toISOString(),
    })),
    languageLimits,
  };
  cacheSet(cacheKey, rawPayload, 86400).catch(() => {});

  return sanitizeProblemCache(rawPayload, currentUser);
}

export async function updateProblem(
  currentUser: CurrentUser,
  id: number,
  data: Partial<{
    title: string;
    descriptionMd: string;
    difficulty: "easy" | "medium" | "hard";
    timeLimitMs: number;
    memoryLimitMb: number;
    outputLimitKb: number;
  }>,
) {
  requireProblemManage(currentUser);

  const [existing] = await db
    .select({ id: problems.id, deletedAt: problems.deletedAt })
    .from(problems)
    .where(eq(problems.id, id));

  if (!existing || existing.deletedAt !== null) throw NotFoundError("problem");

  const [updated] = await db
    .update(problems)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(problems.id, id))
    .returning();

  cacheDel("problems:list", `problem:${id}:raw`).catch(() => {});
  return updated;
}

export async function deleteProblem(currentUser: CurrentUser, id: number) {
  requireProblemManage(currentUser);

  const [existing] = await db
    .select({ id: problems.id, deletedAt: problems.deletedAt })
    .from(problems)
    .where(eq(problems.id, id));

  if (!existing || existing.deletedAt !== null) throw NotFoundError("problem");

  const refs = await db
    .select({ id: examSessionProblems.id })
    .from(examSessionProblems)
    .where(eq(examSessionProblems.problemId, id));

  if (refs.length > 0) {
    throw ConflictError("Cannot delete problem: it is referenced by exam sessions");
  }

  await db.update(problems).set({ deletedAt: new Date() }).where(eq(problems.id, id));

  cacheDel("problems:list", `problem:${id}:raw`).catch(() => {});
}

export async function addTestcase(
  currentUser: CurrentUser,
  problemId: number,
  data: { orderIndex: number; isPublic: boolean; inputData: string; expectedOutput: string },
) {
  requireProblemManage(currentUser);

  const [problem] = await db
    .select({ id: problems.id, deletedAt: problems.deletedAt })
    .from(problems)
    .where(eq(problems.id, problemId));

  if (!problem || problem.deletedAt !== null) throw NotFoundError("problem");

  const [tc] = await db
    .insert(problemTestcases)
    .values({ ...data, problemId })
    .returning()
    .catch((err: unknown) => {
      if (isPgErrorCode(err, "23505")) throw ConflictError("Duplicate testcase orderIndex");
      throw err;
    });

  cacheDel(`problem:${problemId}:raw`).catch(() => {});
  return tc;
}

export async function updateTestcase(
  currentUser: CurrentUser,
  problemId: number,
  tcId: number,
  data: Partial<{
    orderIndex: number;
    isPublic: boolean;
    inputData: string;
    expectedOutput: string;
  }>,
) {
  requireProblemManage(currentUser);

  const [tc] = await db.select().from(problemTestcases).where(eq(problemTestcases.id, tcId));

  if (!tc || tc.problemId !== problemId) throw NotFoundError("testcase");

  const [updated] = await db
    .update(problemTestcases)
    .set(data)
    .where(eq(problemTestcases.id, tcId))
    .returning()
    .catch((err: unknown) => {
      if (isPgErrorCode(err, "23505")) throw ConflictError("Duplicate testcase orderIndex");
      throw err;
    });

  cacheDel(`problem:${tc.problemId}:raw`).catch(() => {});
  return updated;
}

export async function deleteTestcase(currentUser: CurrentUser, problemId: number, tcId: number) {
  requireProblemManage(currentUser);

  const [tc] = await db.select().from(problemTestcases).where(eq(problemTestcases.id, tcId));

  if (!tc || tc.problemId !== problemId) throw NotFoundError("testcase");

  await db.delete(problemTestcases).where(eq(problemTestcases.id, tcId));
  cacheDel(`problem:${tc.problemId}:raw`).catch(() => {});
}

export async function setProblemLanguageLimits(
  currentUser: CurrentUser,
  problemId: number,
  limits: { language: string; timeMultiplier: number; memoryMultiplier: number }[],
) {
  requireProblemManage(currentUser);

  const [existing] = await db
    .select({ id: problems.id, deletedAt: problems.deletedAt })
    .from(problems)
    .where(eq(problems.id, problemId));

  if (!existing || existing.deletedAt !== null) throw NotFoundError("problem");

  await db.delete(problemLanguageLimits).where(eq(problemLanguageLimits.problemId, problemId));

  if (limits.length > 0) {
    assertUniqueValues(
      limits.map((ll) => ll.language),
      "Duplicate language limit",
    );
    await db
      .insert(problemLanguageLimits)
      .values(
        limits.map((ll) => ({
          problemId,
          language: ll.language,
          timeMultiplier: String(ll.timeMultiplier),
          memoryMultiplier: String(ll.memoryMultiplier),
        })),
      )
      .catch((err: unknown) => {
        if (isPgErrorCode(err, "23503")) throw BadRequestError("Unknown language");
        throw err;
      });
  }

  cacheDel(`problem:${problemId}:raw`).catch(() => {});

  return db
    .select({
      language: problemLanguageLimits.language,
      timeMultiplier: problemLanguageLimits.timeMultiplier,
      memoryMultiplier: problemLanguageLimits.memoryMultiplier,
    })
    .from(problemLanguageLimits)
    .where(eq(problemLanguageLimits.problemId, problemId));
}

function assertUniqueValues<T>(values: T[], message: string): void {
  if (new Set(values).size !== values.length) {
    throw ConflictError(message);
  }
}

function isPgErrorCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === code;
}
