import type { Channel, ConsumeMessage } from "amqplib";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  examSessionProblems,
  problemTestcases,
  submissions,
  submissionTestcaseResults,
} from "../db/schema";
import {
  JUDGE_RESULTS_BACKEND_QUEUE,
  getChannel,
} from "./client";
import { publishToSession } from "../ws/hub";

type ResultMessage = {
  submissionId: number;
  sessionId?: number;
  examSessionProblemId?: number;
  type?: "simple" | "formal";
  verdict?: string | null;
  runtimeMs?: number | null;
  memoryKb?: number | null;
};

function parseResultMessage(message: ConsumeMessage): ResultMessage | null {
  try {
    const parsed = JSON.parse(message.content.toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.submissionId !== "number"
    ) {
      return null;
    }
    return parsed as ResultMessage;
  } catch {
    return null;
  }
}

export async function buildJudgeResultPayload(submissionId: number) {
  const [submission] = await db
    .select({
      id: submissions.id,
      examSessionProblemId: submissions.examSessionProblemId,
      submissionType: submissions.submissionType,
      status: submissions.status,
      verdict: submissions.verdict,
      runtimeMs: submissions.runtimeMs,
      memoryKb: submissions.memoryKb,
      judgedAt: submissions.judgedAt,
      sessionId: examSessionProblems.examSessionId,
      score: examSessionProblems.score,
      finalSubmissionId: examSessionProblems.finalSubmissionId,
    })
    .from(submissions)
    .innerJoin(
      examSessionProblems,
      eq(submissions.examSessionProblemId, examSessionProblems.id)
    )
    .where(eq(submissions.id, submissionId));

  if (!submission) return null;

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

  return {
    type: "judge_result",
    submissionId: submission.id,
    examSessionProblemId: submission.examSessionProblemId,
    sessionId: submission.sessionId,
    status: submission.status,
    verdict: submission.verdict,
    runtimeMs: submission.runtimeMs,
    memoryKb: submission.memoryKb,
    judgedAt: submission.judgedAt,
    submissionType: submission.submissionType,
    score: submission.finalSubmissionId === submission.id ? submission.score : 0,
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
}

export async function handleJudgeResultMessage(
  channel: Pick<Channel, "ack">,
  message: ConsumeMessage
): Promise<void> {
  const parsed = parseResultMessage(message);
  if (!parsed) {
    channel.ack(message);
    return;
  }

  const payload = await buildJudgeResultPayload(parsed.submissionId);
  if (payload) publishToSession(payload.sessionId, payload);
  channel.ack(message);
}

export async function startJudgeResultConsumer(): Promise<void> {
  const channel = await getChannel();
  await channel.consume(
    JUDGE_RESULTS_BACKEND_QUEUE,
    (message) => {
      if (!message) return;
      handleJudgeResultMessage(channel, message).catch((err) => {
        channel.ack(message);
        console.error("[mq] failed to handle judge result", err);
      });
    },
    { noAck: false }
  );
}
