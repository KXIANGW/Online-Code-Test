import { db } from "../db/client";
import {
  examSessionProblems,
  examSessions,
  languageDefaults,
  problems,
  problemTestcases,
  submissions,
  submissionTestcaseResults,
  users,
} from "../db/schema";
import { and, asc, eq } from "drizzle-orm";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import type { FastifyJWT } from "@fastify/jwt";
import { publishJudgeTask } from "../mq/publisher";

type CurrentUser = FastifyJWT["user"];
type SubmissionType = "simple" | "formal";

function canManageExam(user: CurrentUser): boolean {
  return user.isSuperuser || user.permissions.includes("exam:manage");
}

function canTakeExam(user: CurrentUser): boolean {
  return user.permissions.includes("exam:take");
}

function requireResultAccess(
  currentUser: CurrentUser,
  session: { candidateId: number; createdBy: number }
): void {
  if (currentUser.isSuperuser) return;

  if (currentUser.permissions.includes("exam:manage")) {
    if (session.createdBy !== currentUser.id) throw ForbiddenError();
    return;
  }

  if (canTakeExam(currentUser)) {
    if (session.candidateId !== currentUser.id) throw ForbiddenError();
    return;
  }

  throw ForbiddenError();
}

async function getSessionOrThrow(sessionId: number) {
  const [session] = await db
    .select()
    .from(examSessions)
    .where(eq(examSessions.id, sessionId));

  if (!session) throw NotFoundError("exam session");
  return session;
}

type ExamSession = Awaited<ReturnType<typeof getSessionOrThrow>>;

export async function assertSessionResultAccess(
  currentUser: CurrentUser,
  sessionId: number
): Promise<ExamSession> {
  const session = await expireIfNeeded(await getSessionOrThrow(sessionId));
  requireResultAccess(currentUser, session);
  return session;
}

async function expireIfNeeded(session: ExamSession): Promise<ExamSession> {
  if (session.status === "in_progress" && session.expiresAt && session.expiresAt <= new Date()) {
    const [updated] = await db
      .update(examSessions)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(examSessions.id, session.id))
      .returning();
    return updated!;
  }

  return session;
}

async function getSubmissionRowsForSession(sessionId: number) {
  return db
    .select({
      id: submissions.id,
      examSessionProblemId: submissions.examSessionProblemId,
      candidateId: submissions.candidateId,
      language: submissions.language,
      submissionType: submissions.submissionType,
      status: submissions.status,
      verdict: submissions.verdict,
      runtimeMs: submissions.runtimeMs,
      memoryKb: submissions.memoryKb,
      submittedAt: submissions.submittedAt,
      judgedAt: submissions.judgedAt,
      problemId: problems.id,
      title: problems.title,
      orderIndex: examSessionProblems.orderIndex,
      scoreWeight: examSessionProblems.scoreWeight,
      currentScore: examSessionProblems.score,
      finalSubmissionId: examSessionProblems.finalSubmissionId,
    })
    .from(submissions)
    .innerJoin(
      examSessionProblems,
      eq(submissions.examSessionProblemId, examSessionProblems.id)
    )
    .innerJoin(problems, eq(examSessionProblems.problemId, problems.id))
    .where(eq(examSessionProblems.examSessionId, sessionId))
    .orderBy(asc(submissions.submittedAt), asc(submissions.id));
}

function mapSubmissionSummary(row: Awaited<ReturnType<typeof getSubmissionRowsForSession>>[number]) {
  return {
    id: row.id,
    examSessionProblemId: row.examSessionProblemId,
    problemId: row.problemId,
    problemTitle: row.title,
    orderIndex: row.orderIndex,
    language: row.language,
    submissionType: row.submissionType,
    status: row.status,
    verdict: row.verdict,
    runtimeMs: row.runtimeMs,
    memoryKb: row.memoryKb,
    submittedAt: row.submittedAt,
    judgedAt: row.judgedAt,
    score: row.finalSubmissionId === row.id ? row.currentScore : 0,
    scoreWeight: row.scoreWeight,
    isFinalSubmission: row.finalSubmissionId === row.id,
  };
}

export async function createSubmission(
  currentUser: CurrentUser,
  sessionId: number,
  data: {
    examSessionProblemId: number;
    language: string;
    sourceCode: string;
    type: SubmissionType;
  }
) {
  if (currentUser.isSuperuser || !canTakeExam(currentUser) || canManageExam(currentUser)) {
    throw ForbiddenError();
  }

  const session = await expireIfNeeded(await getSessionOrThrow(sessionId));

  if (session.candidateId !== currentUser.id) throw ForbiddenError();
  if (session.status !== "in_progress") {
    throw ConflictError(`Cannot submit: exam session status is '${session.status}'`);
  }

  const [sessionProblem] = await db
    .select({ id: examSessionProblems.id })
    .from(examSessionProblems)
    .where(
      and(
        eq(examSessionProblems.id, data.examSessionProblemId),
        eq(examSessionProblems.examSessionId, sessionId)
      )
    );

  if (!sessionProblem) throw NotFoundError("exam session problem");

  const [language] = await db
    .select({ language: languageDefaults.language })
    .from(languageDefaults)
    .where(
      and(
        eq(languageDefaults.language, data.language),
        eq(languageDefaults.isEnabled, true)
      )
    );

  if (!language) throw BadRequestError("Unsupported language");

  const [submission] = await db
    .insert(submissions)
    .values({
      examSessionProblemId: data.examSessionProblemId,
      candidateId: currentUser.id,
      language: data.language,
      sourceCode: data.sourceCode,
      submissionType: data.type,
      status: "pending",
    })
    .returning();

  await publishJudgeTask({ submissionId: submission!.id, type: data.type });

  return {
    id: submission!.id,
    examSessionProblemId: submission!.examSessionProblemId,
    language: submission!.language,
    submissionType: submission!.submissionType,
    status: submission!.status,
    verdict: submission!.verdict,
    runtimeMs: submission!.runtimeMs,
    memoryKb: submission!.memoryKb,
    submittedAt: submission!.submittedAt,
    judgedAt: submission!.judgedAt,
  };
}

export async function listSessionSubmissions(currentUser: CurrentUser, sessionId: number) {
  await assertSessionResultAccess(currentUser, sessionId);
  const rows = await getSubmissionRowsForSession(sessionId);
  return rows.map(mapSubmissionSummary);
}

export async function getSubmissionDetail(
  currentUser: CurrentUser,
  sessionId: number,
  submissionId: number
) {
  await assertSessionResultAccess(currentUser, sessionId);

  const [submission] = await db
    .select({
      id: submissions.id,
      examSessionProblemId: submissions.examSessionProblemId,
      candidateId: submissions.candidateId,
      language: submissions.language,
      sourceCode: submissions.sourceCode,
      submissionType: submissions.submissionType,
      status: submissions.status,
      verdict: submissions.verdict,
      runtimeMs: submissions.runtimeMs,
      memoryKb: submissions.memoryKb,
      submittedAt: submissions.submittedAt,
      judgedAt: submissions.judgedAt,
      problemId: problems.id,
      problemTitle: problems.title,
      orderIndex: examSessionProblems.orderIndex,
      scoreWeight: examSessionProblems.scoreWeight,
      currentScore: examSessionProblems.score,
      finalSubmissionId: examSessionProblems.finalSubmissionId,
    })
    .from(submissions)
    .innerJoin(
      examSessionProblems,
      eq(submissions.examSessionProblemId, examSessionProblems.id)
    )
    .innerJoin(problems, eq(examSessionProblems.problemId, problems.id))
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(examSessionProblems.examSessionId, sessionId)
      )
    );

  if (!submission) throw NotFoundError("submission");

  const testcaseResults = await db
    .select({
      id: submissionTestcaseResults.id,
      testcaseId: submissionTestcaseResults.testcaseId,
      verdict: submissionTestcaseResults.verdict,
      runtimeMs: submissionTestcaseResults.runtimeMs,
      memoryKb: submissionTestcaseResults.memoryKb,
      actualOutput: submissionTestcaseResults.actualOutput,
      isPublic: problemTestcases.isPublic,
      orderIndex: problemTestcases.orderIndex,
    })
    .from(submissionTestcaseResults)
    .innerJoin(problemTestcases, eq(submissionTestcaseResults.testcaseId, problemTestcases.id))
    .where(eq(submissionTestcaseResults.submissionId, submissionId))
    .orderBy(asc(problemTestcases.orderIndex));

  const response = {
    id: submission.id,
    examSessionProblemId: submission.examSessionProblemId,
    problemId: submission.problemId,
    problemTitle: submission.problemTitle,
    orderIndex: submission.orderIndex,
    language: submission.language,
    submissionType: submission.submissionType,
    sourceCode: submission.sourceCode,
    status: submission.status,
    verdict: submission.verdict,
    runtimeMs: submission.runtimeMs,
    memoryKb: submission.memoryKb,
    submittedAt: submission.submittedAt,
    judgedAt: submission.judgedAt,
    score: submission.finalSubmissionId === submission.id ? submission.currentScore : 0,
    scoreWeight: submission.scoreWeight,
    isFinalSubmission: submission.finalSubmissionId === submission.id,
    testcaseResults: testcaseResults.map((result) => ({
      id: result.id,
      testcaseId: result.testcaseId,
      orderIndex: result.orderIndex,
      isPublic: result.isPublic,
      verdict: result.verdict,
      runtimeMs: result.runtimeMs,
      memoryKb: result.memoryKb,
      ...(result.isPublic ? { actualOutput: result.actualOutput } : {}),
    })),
  };

  return response;
}

export async function getSessionResult(currentUser: CurrentUser, sessionId: number) {
  const session = await assertSessionResultAccess(currentUser, sessionId);

  const sessionProblems = await db
    .select({
      examSessionProblemId: examSessionProblems.id,
      problemId: problems.id,
      problemTitle: problems.title,
      orderIndex: examSessionProblems.orderIndex,
      scoreWeight: examSessionProblems.scoreWeight,
      score: examSessionProblems.score,
      finalSubmissionId: examSessionProblems.finalSubmissionId,
    })
    .from(examSessionProblems)
    .innerJoin(problems, eq(examSessionProblems.problemId, problems.id))
    .where(eq(examSessionProblems.examSessionId, sessionId))
    .orderBy(asc(examSessionProblems.orderIndex));

  const allSubmissions = await getSubmissionRowsForSession(sessionId);
  const latestByProblem = new Map<number, (typeof allSubmissions)[number]>();

  for (const submission of allSubmissions) {
    latestByProblem.set(submission.examSessionProblemId, submission);
  }

  const [candidate] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.id, session.candidateId));

  const response = {
    id: session.id,
    candidate,
    status: session.status,
    actualStartAt: session.actualStartAt,
    expiresAt: session.expiresAt,
    totalScore: session.totalScore,
    maxScore: session.maxScore,
    problems: sessionProblems.map((sessionProblem) => {
      const latest = latestByProblem.get(sessionProblem.examSessionProblemId);
      const latestStatus =
        latest?.status === "done"
          ? latest.verdict
          : latest?.status ?? "no_submission";

      return {
        examSessionProblemId: sessionProblem.examSessionProblemId,
        problemId: sessionProblem.problemId,
        problemTitle: sessionProblem.problemTitle,
        orderIndex: sessionProblem.orderIndex,
        scoreWeight: sessionProblem.scoreWeight,
        score: sessionProblem.score,
        latestStatus,
        latestSubmissionId: latest?.id ?? null,
        finalSubmissionId: sessionProblem.finalSubmissionId,
        language: latest?.language ?? null,
        runtimeMs: latest?.runtimeMs ?? null,
        memoryKb: latest?.memoryKb ?? null,
        submittedAt: latest?.submittedAt ?? null,
        judgedAt: latest?.judgedAt ?? null,
      };
    }),
  };

  return response;
}
