import { db } from "../db/client";
import { examSessions, examSessionProblems, problems, problemLanguageLimits, users } from "../db/schema";
import { and, eq, sql, inArray, isNull } from "drizzle-orm";
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from "../errors";
import type { FastifyJWT } from "@fastify/jwt";

type CurrentUser = FastifyJWT["user"];
type Difficulty = "easy" | "medium" | "hard";

function canManageExam(user: CurrentUser): boolean {
  return user.isSuperuser || user.permissions.includes("exam:manage");
}

function canTakeExam(user: CurrentUser): boolean {
  return user.isSuperuser || user.permissions.includes("exam:take");
}

// Manual problem assignment
export async function createExamSession(
  currentUser: CurrentUser,
  data: {
    candidateId: number;
    durationMinutes: number;
    problems: { problemId: number; scoreWeight: number; orderIndex: number }[];
  }
) {
  if (!canManageExam(currentUser)) throw ForbiddenError();
  assertNoDuplicates(data.problems.map((p) => p.problemId), "Duplicate problem assignment");
  assertNoDuplicates(data.problems.map((p) => p.orderIndex), "Duplicate problem orderIndex");

  const { createdBy: candidateCreatedBy } = await assertCandidateExists(data.candidateId);
  if (!currentUser.isSuperuser && candidateCreatedBy !== currentUser.id) throw ForbiddenError();
  await assertProblemsAreActive(data.problems.map((p) => p.problemId));

  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(examSessions)
      .values({
        candidateId: data.candidateId,
        createdBy: currentUser.id,
        durationMinutes: data.durationMinutes,
        maxScore: data.problems.reduce((sum, p) => sum + p.scoreWeight, 0),
      })
      .returning();

    const session = rows[0]!;

    await tx.insert(examSessionProblems).values(
      data.problems.map((p) => ({
        examSessionId: session.id,
        problemId: p.problemId,
        orderIndex: p.orderIndex,
        scoreWeight: p.scoreWeight,
      }))
    );

    return session;
  });
}

// Random problem assignment using §10.3 CTE
export async function createExamSessionRandom(
  currentUser: CurrentUser,
  data: {
    candidateId: number;
    durationMinutes: number;
    distribution: { easy?: number; medium?: number; hard?: number };
    scoreWeight: number;
  }
) {
  if (!canManageExam(currentUser)) throw ForbiddenError();
  const { createdBy: candidateCreatedBy } = await assertCandidateExists(data.candidateId);
  if (!currentUser.isSuperuser && candidateCreatedBy !== currentUser.id) throw ForbiddenError();

  const difficulties: { level: Difficulty; count: number }[] = (
    [
      { level: "easy" as Difficulty, count: data.distribution.easy ?? 0 },
      { level: "medium" as Difficulty, count: data.distribution.medium ?? 0 },
      { level: "hard" as Difficulty, count: data.distribution.hard ?? 0 },
    ] as { level: Difficulty; count: number }[]
  ).filter((d) => d.count > 0);

  if (difficulties.length === 0) {
    throw BadRequestError("distribution must request at least one problem");
  }

  const pickedIds: number[] = [];

  for (const { level, count } of difficulties) {
    for (let i = 0; i < count; i++) {
      const rows = await db.execute<{ id: number }>(sql`
        WITH used AS (
          SELECT DISTINCT esp.problem_id
          FROM exam_session_problems esp
          JOIN exam_sessions es ON es.id = esp.exam_session_id
          WHERE es.candidate_id = ${data.candidateId}
        )
        SELECT p.id FROM problems p
        WHERE p.difficulty = ${level}::difficulty_level
          AND p.deleted_at IS NULL
          AND p.id NOT IN (SELECT problem_id FROM used)
          ${pickedIds.length > 0 ? sql`AND p.id NOT IN (${sql.join(pickedIds.map((id) => sql`${id}`), sql`, `)})` : sql``}
        ORDER BY RANDOM()
        LIMIT 1
      `);

      if (rows.rows.length === 0) {
        throw ConflictError(
          `Not enough ${level} problems available for this candidate. Please add more problems.`
        );
      }
      pickedIds.push(rows.rows[0]!.id);
    }
  }

  const maxScore = pickedIds.length * data.scoreWeight;

  return db.transaction(async (tx) => {
    const sessionRows = await tx
      .insert(examSessions)
      .values({
        candidateId: data.candidateId,
        createdBy: currentUser.id,
        durationMinutes: data.durationMinutes,
        maxScore,
      })
      .returning();

    const session = sessionRows[0]!;

    await tx.insert(examSessionProblems).values(
      pickedIds.map((problemId, idx) => ({
        examSessionId: session.id,
        problemId,
        orderIndex: idx + 1,
        scoreWeight: data.scoreWeight,
      }))
    );

    return session;
  });
}

export async function listExamSessions(currentUser: CurrentUser) {
  if (!canManageExam(currentUser) && !canTakeExam(currentUser)) throw ForbiddenError();

  if (currentUser.isSuperuser) {
    return db.select().from(examSessions);
  }

  if (canManageExam(currentUser)) {
    return db
      .select()
      .from(examSessions)
      .where(eq(examSessions.createdBy, currentUser.id));
  }

  return db
    .select()
    .from(examSessions)
    .where(eq(examSessions.candidateId, currentUser.id));
}

export async function getExamSession(currentUser: CurrentUser, id: number) {
  const rows = await db
    .select()
    .from(examSessions)
    .where(eq(examSessions.id, id));

  const session = rows[0];
  if (!session) throw NotFoundError("exam session");

  if (currentUser.isSuperuser) return session;

  if (canManageExam(currentUser)) {
    if (session.createdBy !== currentUser.id) throw ForbiddenError();
    return session;
  }

  if (session.candidateId !== currentUser.id) throw ForbiddenError();
  return session;
}

export async function startExamSession(currentUser: CurrentUser, id: number) {
  if (!canTakeExam(currentUser)) throw ForbiddenError();

  const result = await db.execute<{ id: number }>(sql`
    UPDATE exam_sessions
    SET status = 'in_progress',
        actual_start_at = NOW(),
        expires_at = NOW() + (duration_minutes || ' minutes')::INTERVAL,
        updated_at = NOW()
    WHERE id = ${id}
      AND candidate_id = ${currentUser.id}
      AND status = 'not_started'
    RETURNING id
  `);

  if (result.rows.length === 0) {
    const rows = await db
      .select({ status: examSessions.status, candidateId: examSessions.candidateId })
      .from(examSessions)
      .where(eq(examSessions.id, id));

    const session = rows[0];
    if (!session || session.candidateId !== currentUser.id) throw NotFoundError("exam session");
    throw ConflictError(`Cannot start exam session: current status is '${session.status}'`);
  }

  const updated = await db
    .select()
    .from(examSessions)
    .where(eq(examSessions.id, id));

  return updated[0]!;
}

export async function cancelExamSession(currentUser: CurrentUser, id: number) {
  if (!canManageExam(currentUser)) throw ForbiddenError();

  const rows = await db
    .select()
    .from(examSessions)
    .where(eq(examSessions.id, id));

  const session = rows[0];
  if (!session) throw NotFoundError("exam session");

  if (!currentUser.isSuperuser && session.createdBy !== currentUser.id) {
    throw ForbiddenError();
  }

  if (session.status === "cancelled") {
    throw ConflictError("Exam session is already cancelled");
  }

  const updated = await db
    .update(examSessions)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(examSessions.id, id))
    .returning();

  return updated[0]!;
}

export async function getExamSessionProblems(currentUser: CurrentUser, sessionId: number) {
  const sessionRows = await db
    .select({ id: examSessions.id, candidateId: examSessions.candidateId, createdBy: examSessions.createdBy })
    .from(examSessions)
    .where(eq(examSessions.id, sessionId));

  const session = sessionRows[0];
  if (!session) throw NotFoundError("exam session");

  if (!currentUser.isSuperuser) {
    if (canManageExam(currentUser)) {
      if (session.createdBy !== currentUser.id) throw ForbiddenError();
    } else if (session.candidateId !== currentUser.id) {
      throw ForbiddenError();
    }
  }

  const sessionProblems = await db
    .select({
      id: examSessionProblems.id,
      orderIndex: examSessionProblems.orderIndex,
      scoreWeight: examSessionProblems.scoreWeight,
      score: examSessionProblems.score,
      problemId: problems.id,
      title: problems.title,
      descriptionMd: problems.descriptionMd,
      difficulty: problems.difficulty,
      timeLimitMs: problems.timeLimitMs,
      memoryLimitMb: problems.memoryLimitMb,
      outputLimitKb: problems.outputLimitKb,
    })
    .from(examSessionProblems)
    .innerJoin(problems, eq(examSessionProblems.problemId, problems.id))
    .where(eq(examSessionProblems.examSessionId, sessionId));

  if (sessionProblems.length === 0) return [];

  const problemIds = sessionProblems.map((p) => p.problemId);
  const allLangLimits = await db
    .select({
      problemId: problemLanguageLimits.problemId,
      language: problemLanguageLimits.language,
      timeMultiplier: problemLanguageLimits.timeMultiplier,
      memoryMultiplier: problemLanguageLimits.memoryMultiplier,
    })
    .from(problemLanguageLimits)
    .where(inArray(problemLanguageLimits.problemId, problemIds));

  return sessionProblems.map((p) => ({
    ...p,
    languageLimits: allLangLimits
      .filter((l) => l.problemId === p.problemId)
    .map(({ language, timeMultiplier, memoryMultiplier }) => ({ language, timeMultiplier, memoryMultiplier })),
  }));
}

function assertNoDuplicates<T>(values: T[], message: string): void {
  if (new Set(values).size !== values.length) {
    throw ConflictError(message);
  }
}

async function assertCandidateExists(candidateId: number): Promise<{ createdBy: number | null }> {
  const [candidate] = await db
    .select({ id: users.id, deletedAt: users.deletedAt, createdBy: users.createdBy })
    .from(users)
    .where(eq(users.id, candidateId));

  if (!candidate || candidate.deletedAt !== null) {
    throw NotFoundError("candidate");
  }
  return { createdBy: candidate.createdBy };
}

async function assertProblemsAreActive(problemIds: number[]): Promise<void> {
  const uniqueIds = [...new Set(problemIds)];
  const activeProblems = await db
    .select({ id: problems.id })
    .from(problems)
    .where(and(inArray(problems.id, uniqueIds), isNull(problems.deletedAt)));

  if (activeProblems.length !== uniqueIds.length) {
    throw NotFoundError("problem");
  }
}
