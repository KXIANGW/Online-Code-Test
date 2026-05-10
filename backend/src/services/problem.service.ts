import { db } from "../db/client";
import { problems, problemTestcases, examSessionProblems, problemLanguageLimits } from "../db/schema";
import { eq, isNull, sql } from "drizzle-orm";
import { ForbiddenError, NotFoundError, ConflictError } from "../errors";
import type { FastifyJWT } from "@fastify/jwt";

type CurrentUser = FastifyJWT["user"];

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

export async function listProblems(currentUser: CurrentUser) {
  requireProblemAccess(currentUser);
  return db
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
    testcases?: { orderIndex: number; isPublic: boolean; inputData: string; expectedOutput: string }[];
    languageLimits?: { language: string; timeMultiplier: number; memoryMultiplier: number }[];
  }
) {
  requireProblemManage(currentUser);

  return db.transaction(async (tx) => {
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

    const problem = problemRows[0]!;

    if (data.testcases && data.testcases.length > 0) {
      await tx.insert(problemTestcases).values(
        data.testcases.map((tc) => ({ ...tc, problemId: problem.id }))
      );
    }

    if (data.languageLimits && data.languageLimits.length > 0) {
      await tx.insert(problemLanguageLimits).values(
        data.languageLimits.map((ll) => ({
          problemId: problem.id,
          language: ll.language,
          timeMultiplier: String(ll.timeMultiplier),
          memoryMultiplier: String(ll.memoryMultiplier),
        }))
      );
    }

    return problem;
  });
}

export async function getProblem(currentUser: CurrentUser, id: number) {
  requireProblemAccess(currentUser);

  const [problem] = await db
    .select()
    .from(problems)
    .where(eq(problems.id, id));

  if (!problem || problem.deletedAt !== null) throw NotFoundError("problem");

  const testcases = await db
    .select()
    .from(problemTestcases)
    .where(eq(problemTestcases.problemId, id));

  const canSeeHidden =
    currentUser.isSuperuser || currentUser.permissions.includes("problem:manage");

  const sanitizedTestcases = testcases.map((tc) => ({
    id: tc.id,
    orderIndex: tc.orderIndex,
    isPublic: tc.isPublic,
    ...(canSeeHidden || tc.isPublic
      ? { inputData: tc.inputData, expectedOutput: tc.expectedOutput }
      : {}),
  }));

  const languageLimits = await db
    .select({
      language: problemLanguageLimits.language,
      timeMultiplier: problemLanguageLimits.timeMultiplier,
      memoryMultiplier: problemLanguageLimits.memoryMultiplier,
    })
    .from(problemLanguageLimits)
    .where(eq(problemLanguageLimits.problemId, id));

  return { ...problem, testcases: sanitizedTestcases, languageLimits };
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
  }>
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

  await db
    .update(problems)
    .set({ deletedAt: new Date() })
    .where(eq(problems.id, id));
}

export async function addTestcase(
  currentUser: CurrentUser,
  problemId: number,
  data: { orderIndex: number; isPublic: boolean; inputData: string; expectedOutput: string }
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
    .returning();

  return tc;
}

export async function updateTestcase(
  currentUser: CurrentUser,
  problemId: number,
  tcId: number,
  data: Partial<{ orderIndex: number; isPublic: boolean; inputData: string; expectedOutput: string }>
) {
  requireProblemManage(currentUser);

  const [tc] = await db
    .select()
    .from(problemTestcases)
    .where(eq(problemTestcases.id, tcId));

  if (!tc || tc.problemId !== problemId) throw NotFoundError("testcase");

  const [updated] = await db
    .update(problemTestcases)
    .set(data)
    .where(eq(problemTestcases.id, tcId))
    .returning();

  return updated;
}

export async function deleteTestcase(
  currentUser: CurrentUser,
  problemId: number,
  tcId: number
) {
  requireProblemManage(currentUser);

  const [tc] = await db
    .select()
    .from(problemTestcases)
    .where(eq(problemTestcases.id, tcId));

  if (!tc || tc.problemId !== problemId) throw NotFoundError("testcase");

  await db.delete(problemTestcases).where(eq(problemTestcases.id, tcId));
}

export async function setProblemLanguageLimits(
  currentUser: CurrentUser,
  problemId: number,
  limits: { language: string; timeMultiplier: number; memoryMultiplier: number }[]
) {
  requireProblemManage(currentUser);

  const [existing] = await db
    .select({ id: problems.id, deletedAt: problems.deletedAt })
    .from(problems)
    .where(eq(problems.id, problemId));

  if (!existing || existing.deletedAt !== null) throw NotFoundError("problem");

  await db.delete(problemLanguageLimits).where(eq(problemLanguageLimits.problemId, problemId));

  if (limits.length > 0) {
    await db.insert(problemLanguageLimits).values(
      limits.map((ll) => ({
        problemId,
        language: ll.language,
        timeMultiplier: String(ll.timeMultiplier),
        memoryMultiplier: String(ll.memoryMultiplier),
      }))
    );
  }

  return db
    .select({
      language: problemLanguageLimits.language,
      timeMultiplier: problemLanguageLimits.timeMultiplier,
      memoryMultiplier: problemLanguageLimits.memoryMultiplier,
    })
    .from(problemLanguageLimits)
    .where(eq(problemLanguageLimits.problemId, problemId));
}
