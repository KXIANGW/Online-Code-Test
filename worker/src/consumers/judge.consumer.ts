import type { Channel, ConsumeMessage } from "amqplib";
import fs from "fs-extra";
import path from "path";
import { config } from "../config";
import { checkOutput } from "../engine/checker";
import { findLanguage, type LanguageSpec } from "../engine/languages";
import type { SandboxEngine } from "../engine/sandbox-engine";
import {
  judgeCompileDurationSeconds,
  judgeDurationSeconds,
  judgeErrorsTotal,
  judgeInFlight,
  judgeMemoryMaxBytes,
  judgeVerdictsTotal,
} from "../metrics";
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

export async function startJudgeConsumer(
  channel: Channel,
  languages: LanguageSpec[],
  engine: SandboxEngine
): Promise<void> {
  await channel.prefetch(1);
  await channel.consume(
    JUDGE_TASKS_QUEUE,
    (message) => {
      if (!message) return;
      handleJudgeMessage(channel, message, languages, engine).catch((err) => {
        console.error("[worker] unhandled judge message error", err);
        channel.ack(message);
      });
    },
    { noAck: false }
  );
}

export async function handleJudgeMessage(
  channel: Pick<Channel, "ack" | "publish">,
  message: ConsumeMessage,
  languages: LanguageSpec[],
  engine: SandboxEngine
): Promise<void> {
  const task = parseTask(message);
  if (!task) {
    channel.ack(message);
    return;
  }

  try {
    await judgeSubmission(task, channel, languages, engine);
  } catch (err) {
    console.error("[worker] system error", err);
    judgeErrorsTotal.labels("system_error").inc();
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
  channel: Pick<Channel, "publish">,
  languages: LanguageSpec[],
  engine: SandboxEngine
): Promise<void> {
  const submission = await getSubmissionById(task.submissionId);
  if (!submission) throw new Error(`Submission not found: ${task.submissionId}`);

  const spec = findLanguage(languages, submission.language);
  const language = spec.id;

  judgeInFlight.inc();
  const judgeTimer = judgeDurationSeconds.startTimer({ language });

  await updateSubmissionJudging(submission.id);
  await publishResult(channel, {
    submissionId: submission.id,
    eventType: "status",
    status: "judging",
  });

  const hostWorkDir = path.join(config.hostWorkDir, String(submission.id));
  await fs.emptyDir(hostWorkDir);

  try {
    await fs.writeFile(
      path.join(hostWorkDir, spec.source.filename),
      submission.sourceCode
    );

    const compileTimer = judgeCompileDurationSeconds.startTimer({ language });
    const compileResult = await engine.compile({ spec, hostWorkDir });
    compileTimer();
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
      judgeVerdictsTotal.labels(language, "CE").inc();
      judgeTimer({ verdict: "CE" });
      return;
    }

    const judged = await judgeTestcases(submission, spec, testcases, engine);
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

    judgeVerdictsTotal.labels(language, judged.verdict).inc();
    if (judged.memoryKb !== null) {
      judgeMemoryMaxBytes.labels(language).observe(judged.memoryKb * 1024);
    }
    judgeTimer({ verdict: judged.verdict });
  } finally {
    judgeInFlight.dec();
    await fs.remove(hostWorkDir).catch(() => undefined);
  }
}

async function judgeTestcases(
  submission: SubmissionForJudge,
  spec: LanguageSpec,
  testcases: TestcaseForJudge[],
  engine: SandboxEngine
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

    const run = await engine.runOne({
      spec,
      hostWorkDir: path.join(config.hostWorkDir, String(submission.id)),
      inputData: testcase.inputData,
      timeLimitMs: submission.timeLimitMs,
      memoryLimitMb: submission.memoryLimitMb,
      outputLimitKb: submission.outputLimitKb,
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
