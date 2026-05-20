import { db } from "../db/client";
import { 
  exams, 
  examProblems, 
  examSessions, 
  examSessionProblems, 
  problems, 
  problemLanguageLimits, 
  problemTestcases, 
  users 
} from "../db/schema";
import { and, eq, sql, inArray, isNull } from "drizzle-orm";
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from "../errors";
import type { FastifyJWT } from "@fastify/jwt";
import { clearSessionDrafts } from "./draft.service";
import {
  expireIfNeeded,
  getFreshSessionOrThrow,
  getSessionOrThrow,
} from "./session-lifecycle.service";

type CurrentUser = FastifyJWT["user"];
type Difficulty = "easy" | "medium" | "hard";


function canManageExam(user: CurrentUser): boolean {
  return user.isSuperuser || user.permissions.includes("exam:manage");
}

function canTakeExam(user: CurrentUser): boolean {
  return user.isSuperuser || user.permissions.includes("exam:take");
}

// ──────────────────────────────────────────────────────────────────────────────
// 部分 1：建立與管理考試模板 (Exam Templates)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 做法 1：手動建立考試模板（主管自己挑題）
 */
export async function createExamTemplate(
  currentUser: CurrentUser,
  data: {
    title: string;
    durationMinutes: number;
    problems: { problemId: number; scoreWeight: number; orderIndex: number }[];
  }
) {
  if (!canManageExam(currentUser)) throw ForbiddenError();
  assertNoDuplicates(data.problems.map((p) => p.problemId), "Duplicate problem assignment");
  assertNoDuplicates(data.problems.map((p) => p.orderIndex), "Duplicate problem orderIndex");
  await assertProblemsAreActive(data.problems.map((p) => p.problemId));

  return db.transaction(async (tx) => {
    const examRows = await tx
      .insert(exams)
      .values({
        title: data.title,
        durationMinutes: data.durationMinutes,
        createdBy: currentUser.id,
      })
      .returning();

    const newExam = examRows[0]!;

    await tx.insert(examProblems).values(
      data.problems.map((p) => ({
        examId: newExam.id,
        problemId: p.problemId,
        orderIndex: p.orderIndex,
        scoreWeight: p.scoreWeight,
      }))
    );

    return newExam;
  });
}

/**
 * 做法 2：隨機建立考試模板（方案 A：系統依難度拉題，組裝成標準考卷）
 * 使用原本高效的 §10.3 CTE 隨機選題 SQL 語法
 */
export async function createExamTemplateRandom(
  currentUser: CurrentUser,
  data: {
    title: string;
    durationMinutes: number;
    distribution: { easy?: number; medium?: number; hard?: number };
    scoreWeight: number; // 隨機抽出的題目，每題的固定配分
  }
) {
  if (!canManageExam(currentUser)) throw ForbiddenError();

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

  // 利用原本的隨機拉題邏輯，從未刪除的題庫中盲抽，並防止同一次建卷抽到重複題目
  for (const { level, count } of difficulties) {
    for (let i = 0; i < count; i++) {
      const rows = await db.execute<{ id: number }>(sql`
        SELECT p.id FROM problems p
        WHERE p.difficulty = ${level}::difficulty_level
          AND p.deleted_at IS NULL
          ${pickedIds.length > 0 ? sql`AND p.id NOT IN (${sql.join(pickedIds.map((id) => sql`${id}`), sql`, `)})` : sql``}
        ORDER BY RANDOM()
        LIMIT 1
      `);

      if (rows.rows.length === 0) {
        throw ConflictError(
          `Not enough ${level} problems available in full pool. Please add more problems to database.`
        );
      }
      pickedIds.push(rows.rows[0]!.id);
    }
  }

  // 封裝成考卷模板儲存
  return db.transaction(async (tx) => {
    // 1. 建立 Exam 模板
    const examRows = await tx
      .insert(exams)
      .values({
        title: data.title,
        durationMinutes: data.durationMinutes,
        createdBy: currentUser.id,
      })
      .returning();

    const newExam = examRows[0]!

    // 2. 批次將隨機抽到的題目寫入模板關聯
    await tx.insert(examProblems).values(
      pickedIds.map((problemId, idx) => ({
        examId: newExam.id,
        problemId,
        orderIndex: idx + 1,
        scoreWeight: data.scoreWeight,
      }))
    );

    return newExam;
  });
}

/**
 * 查詢現有的考卷模板列表
 */
export async function listExamTemplates(currentUser: CurrentUser) {
  if (!canManageExam(currentUser)) throw ForbiddenError();
  
  if (currentUser.isSuperuser) {
    return db.select().from(exams).where(isNull(exams.deletedAt));
  }
  return db.select().from(exams).where(and(eq(exams.createdBy, currentUser.id), isNull(exams.deletedAt)));
}

// ──────────────────────────────────────────────────────────────────────────────
// 部分 3：分配考試給多位面試者 (Batch Assignment)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 核心重構：把指定考卷批次分派給多個面試者帳號（Junction 批次寫入）
 */
export async function assignExamToCandidates(
  currentUser: CurrentUser,
  examId: number,
  data: { candidateIds: number[] }
) {
  if (!canManageExam(currentUser)) throw ForbiddenError();
  if (!data.candidateIds || data.candidateIds.length === 0) {
    throw BadRequestError("candidateIds list cannot be empty");
  }

  // 1. 校驗考卷模板是否存在
  const [examTemplate] = await db.select().from(exams).where(eq(exams.id, examId));
  if (!examTemplate || examTemplate.deletedAt !== null) throw NotFoundError("exam template");
  if (!currentUser.isSuperuser && examTemplate.createdBy !== currentUser.id) throw ForbiddenError();

  // 2. 撈取該考卷的所有題目配分快照
  const templateProblems = await db.select().from(examProblems).where(eq(examProblems.examId, examId));
  const maxScore = templateProblems.reduce((sum, p) => sum + p.scoreWeight, 0);

  // 3. 校驗所有面試者帳號狀態
  for (const candidateId of data.candidateIds) {
    const { createdBy: candidateCreatedBy } = await assertCandidateExists(candidateId);
    if (!currentUser.isSuperuser && candidateCreatedBy !== currentUser.id) throw ForbiddenError();
  }

  // 4. 利用 Transaction 執行全成功或全失敗的批次指派
  return db.transaction(async (tx) => {
    const createdSessions = [];

    for (const candidateId of data.candidateIds) {
      // 插入 Exam Session
      const sessionRows = await tx
        .insert(examSessions)
        .values({
          examId: examTemplate.id,
          candidateId: candidateId,
          createdBy: currentUser.id,
          maxScore,
          totalScore: 0,
        })
        .returning();

      const session = sessionRows[0]!

      // 將考卷題目快照實體化到該面試者的 session problems 中
      await tx.insert(examSessionProblems).values(
        templateProblems.map((p) => ({
          examSessionId: session.id,
          problemId: p.problemId,
          orderIndex: p.orderIndex,
          scoreWeight: p.scoreWeight,
          score: 0,
        }))
      );

      createdSessions.push(session);
    }

    return createdSessions;
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// 既有功能調整：場次管理與面試者生命週期
// ──────────────────────────────────────────────────────────────────────────────

// export async function listExamSessions(currentUser: CurrentUser) {
//   if (!canManageExam(currentUser) && !canTakeExam(currentUser)) throw ForbiddenError();

//   let sessions;
//   if (currentUser.isSuperuser) {
//     sessions = await db.select().from(examSessions);
//   } else if (canManageExam(currentUser)) {
//     sessions = await db
//       .select()
//       .from(examSessions)
//       .where(eq(examSessions.createdBy, currentUser.id));
//   } else {
//     sessions = await db
//       .select()
//       .from(examSessions)
//       .where(eq(examSessions.candidateId, currentUser.id));
//   }

//   return Promise.all(sessions.map(expireIfNeeded));
// }


export async function listExamSessions(currentUser: CurrentUser) {
  const isManager = canManageExam(currentUser);
  const isCandidate = canTakeExam(currentUser);

  // 💡 這裡會直接告訴我們，當下這個 candToken 進來時，這兩個核心權限到底是 true 還是 false
  console.log("🔍 [Debug Service listExamSessions] Privilege Check:", {
    userId: currentUser.id,
    isSuperuser: currentUser.isSuperuser,
    permissions: currentUser.permissions,
    canManageExam: isManager,
    canTakeExam: isCandidate,
  });

  if (!isManager && !isCandidate) {
    console.warn("⚠️ [Debug Service] Throwing ForbiddenError from top guard!");
    throw ForbiddenError();
  }

  let sessions;
  try {
    if (currentUser.isSuperuser) {
      sessions = await db.select().from(examSessions);
    } else if (isManager) {
      sessions = await db
        .select()
        .from(examSessions)
        .where(eq(examSessions.createdBy, currentUser.id));
    } else {
      sessions = await db
        .select()
        .from(examSessions)
        .where(eq(examSessions.candidateId, currentUser.id));
    }
    
    console.log(`📊 [Debug Service] Successfully fetched ${sessions.length} sessions from DB`);
    return Promise.all(sessions.map(expireIfNeeded));

  } catch (dbError: any) {
    // 💡 如果問題是出在 Drizzle 查詢（例如欄位對不上），這裡會抓到
    console.error("❌ [Debug Service] DB Query exploded:", dbError);
    throw dbError;
  }
}

export async function getExamSession(currentUser: CurrentUser, id: number) {
  const session = await getFreshSessionOrThrow(id);

  if (currentUser.isSuperuser) return session;
  if (canManageExam(currentUser)) {
    if (session.createdBy !== currentUser.id) throw ForbiddenError();
    return session;
  }

  if (session.candidateId !== currentUser.id) throw ForbiddenError();
  return session;
}

/**
 * 調整：面試者領題自由進場，改由 JOIN exams 撈取時長並動態計算寫入死線 (INTERVAL)
 */
export async function startExamSession(currentUser: CurrentUser, id: number) {
  if (!canTakeExam(currentUser)) throw ForbiddenError();

  // 透過原生 SQL 聯表 JOIN exams 表來動態獲取考卷的 duration_minutes
  const result = await db.execute<{ id: number }>(sql`
    UPDATE exam_sessions es
    SET status = 'in_progress',
        actual_start_at = NOW(),
        expires_at = NOW() + (e.duration_minutes || ' minutes')::INTERVAL,
        updated_at = NOW()
    FROM exams e
    WHERE es.id = ${id}
      AND es.exam_id = e.id
      AND es.candidate_id = ${currentUser.id}
      AND es.status = 'not_started'
    RETURNING es.id
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

export async function submitExamSession(currentUser: CurrentUser, id: number) {
  if (!canTakeExam(currentUser)) throw ForbiddenError();

  const session = await getFreshSessionOrThrow(id);
  if (session.candidateId !== currentUser.id) throw NotFoundError("exam session");
  if (session.status !== "in_progress") {
    throw ConflictError(`Cannot submit exam session: current status is '${session.status}'`);
  }

  const [updated] = await db
    .update(examSessions)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(examSessions.id, id))
    .returning();

  return updated!;
}

export async function cancelExamSession(currentUser: CurrentUser, id: number) {
  if (!canManageExam(currentUser)) throw ForbiddenError();

  const session = await getSessionOrThrow(id);

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

  db.select({ problemId: examSessionProblems.problemId })
    .from(examSessionProblems)
    .where(eq(examSessionProblems.examSessionId, id))
    .then((esps) => clearSessionDrafts(id, esps.map((e) => e.problemId)))
    .catch(() => {});

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

export async function getPublicTestcases(currentUser: CurrentUser, sessionId: number, espId: number) {
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

  const espRows = await db
    .select({ problemId: examSessionProblems.problemId })
    .from(examSessionProblems)
    .where(and(
      eq(examSessionProblems.id, espId),
      eq(examSessionProblems.examSessionId, sessionId),
    ));

  const esp = espRows[0];
  if (!esp) throw NotFoundError("exam session problem");

  return db
    .select({
      id: problemTestcases.id,
      orderIndex: problemTestcases.orderIndex,
      inputData: problemTestcases.inputData,
      expectedOutput: problemTestcases.expectedOutput,
    })
    .from(problemTestcases)
    .where(and(
      eq(problemTestcases.problemId, esp.problemId),
      eq(problemTestcases.isPublic, true),
    ));
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