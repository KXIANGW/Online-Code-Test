import type { Channel, ConsumeMessage } from "amqplib";
import fs from "fs-extra";
import path from "path";
import { config } from "../config";
import { checkOutput } from "../engine/checker";
import { compileInSandbox } from "../engine/compiler";
import { runOneTestcase } from "../engine/runner";
import {
  getSubmissionById,
  getTestcases,
  markSubmissionSystemError,
  updateSubmissionJudging,
  writeJudgeResults,
  type SubmissionForJudge,
  type SubmissionType,
  type TestcaseForJudge,
  type TestcaseResultForWrite,
  type Verdict,
} from "../db/queries";

export const JUDGE_TASKS_QUEUE = "judge.tasks";
export const JUDGE_RESULTS_EXCHANGE = "judge.results";

export interface JudgeTask {
  submissionId: number;
  type: SubmissionType;
}

function parseTask(message: ConsumeMessage): JudgeTask | null {
  try {
    const parsed = JSON.parse(message.content.toString("utf8"));
    if (
      typeof parsed?.submissionId === "number" &&
      (parsed.type === "simple" || parsed.type === "formal")
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function startJudgeConsumer(channel: Channel): Promise<void> {
  await channel.prefetch(1);
  await channel.consume(
    JUDGE_TASKS_QUEUE,
    (message) => {
      if (!message) return;
      handleJudgeMessage(channel, message).catch((err) => {
        console.error("[worker] unhandled judge message error", err);
        channel.ack(message);
      });
    },
    { noAck: false }
  );
}

export async function handleJudgeMessage(
  channel: Pick<Channel, "ack" | "publish">,
  message: ConsumeMessage
): Promise<void> {
  const task = parseTask(message);
  if (!task) {
    channel.ack(message);
    return;
  }

  try {
    await judgeSubmission(task, channel);
  } catch (err) {
    console.error("[worker] system error", err);
    await markSubmissionSystemError(task.submissionId).catch(() => undefined);
    await publishResult(channel, {
      submissionId: task.submissionId,
      type: task.type,
      verdict: "system_error",
      runtimeMs: null,
      memoryKb: null,
    });
  } finally {
    channel.ack(message);
  }
}

async function judgeSubmission(
  task: JudgeTask,
  channel: Pick<Channel, "publish">
): Promise<void> {
  const submission = await getSubmissionById(task.submissionId);
  if (!submission) throw new Error(`Submission not found: ${task.submissionId}`);

  await updateSubmissionJudging(submission.id);

  const hostWorkDir = path.join(config.hostWorkDir, String(submission.id));
  await fs.emptyDir(hostWorkDir);

  try {
    await writeSourceFile(hostWorkDir, submission);

    const compileResult = await compileInSandbox({
      language: submission.language,
      hostWorkDir,
    });

    const testcases = await getTestcases(submission.problemId, task.type === "simple");

    if (!compileResult.success) {
      await writeJudgeResults({
        submissionId: submission.id,
        examSessionProblemId: submission.examSessionProblemId,
        examSessionId: submission.examSessionId,
        type: task.type,
        verdict: "CE",
        runtimeMs: 0,
        memoryKb: null,
        testcaseResults: [],
      });

      await publishResult(channel, {
        submissionId: submission.id,
        sessionId: submission.examSessionId,
        examSessionProblemId: submission.examSessionProblemId,
        type: task.type,
        verdict: "CE",
        runtimeMs: 0,
        memoryKb: null,
      });
      return;
    }

    const judged = await judgeTestcases(submission, testcases);
    await writeJudgeResults({
      submissionId: submission.id,
      examSessionProblemId: submission.examSessionProblemId,
      examSessionId: submission.examSessionId,
      type: task.type,
      verdict: judged.verdict,
      runtimeMs: judged.runtimeMs,
      memoryKb: judged.memoryKb,
      testcaseResults: judged.testcaseResults,
    });

    await publishResult(channel, {
      submissionId: submission.id,
      sessionId: submission.examSessionId,
      examSessionProblemId: submission.examSessionProblemId,
      type: task.type,
      verdict: judged.verdict,
      runtimeMs: judged.runtimeMs,
      memoryKb: judged.memoryKb,
    });
  } finally {
    await fs.remove(hostWorkDir).catch(() => undefined);
  }
}

async function writeSourceFile(
  hostWorkDir: string,
  submission: SubmissionForJudge
): Promise<void> {
  const fileName = submission.language === "cpp17" ? "solution.cpp" : "solution.py";
  await fs.writeFile(path.join(hostWorkDir, fileName), submission.sourceCode);
}

async function judgeTestcases(
  submission: SubmissionForJudge,
  testcases: TestcaseForJudge[]
): Promise<{
  verdict: Verdict;
  runtimeMs: number | null;
  memoryKb: number | null;
  testcaseResults: TestcaseResultForWrite[];
}> {
  const testcaseResults: TestcaseResultForWrite[] = [];
  let overallVerdict: Verdict = "AC";
  let totalRuntime = 0;
  let maxMemoryKb: number | null = null;
  let shouldSkip = false;

  for (const testcase of testcases) {
    if (shouldSkip) {
      testcaseResults.push({
        testcaseId: testcase.id,
        verdict: "skipped",
        runtimeMs: null,
        memoryKb: null,
        actualOutput: null,
      });
      continue;
    }

    const run = await runOneTestcase({
      language: submission.language,
      hostWorkDir: path.join(config.hostWorkDir, String(submission.id)),
      inputData: testcase.inputData,
      timeLimitMs: submission.timeLimitMs,
      memoryLimitMb: submission.memoryLimitMb,
      sandboxRuntime: config.sandboxRuntime,
    });

    const verdict =
      run.verdict === "AC"
        ? checkOutput(run.stdout, testcase.expectedOutput).verdict
        : run.verdict;

    testcaseResults.push({
      testcaseId: testcase.id,
      verdict,
      runtimeMs: run.runtimeMs,
      memoryKb: run.memoryKb,
      actualOutput: testcase.isPublic ? run.stdout : null,
    });

    totalRuntime += run.runtimeMs;
    if (run.memoryKb !== null) {
      maxMemoryKb = Math.max(maxMemoryKb ?? 0, run.memoryKb);
    }

    if (verdict !== "AC") {
      overallVerdict = verdict;
      shouldSkip = true;
    }
  }

  return {
    verdict: overallVerdict,
    runtimeMs: testcaseResults.length > 0 ? totalRuntime : 0,
    memoryKb: maxMemoryKb,
    testcaseResults,
  };
}

async function publishResult(
  channel: Pick<Channel, "publish">,
  payload: Record<string, unknown>
): Promise<void> {
  const ok = channel.publish(
    JUDGE_RESULTS_EXCHANGE,
    "",
    Buffer.from(JSON.stringify(payload)),
    {
      contentType: "application/json",
      persistent: true,
    }
  );

  const drainable = channel as { once?: (event: "drain", cb: () => void) => void };
  if (!ok && typeof drainable.once === "function") {
    await new Promise<void>((resolve) => drainable.once!("drain", resolve));
  }
}
