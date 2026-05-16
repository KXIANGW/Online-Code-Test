import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import amqp, { type Channel, type ChannelModel } from "amqplib";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";
import { buildApp } from "../server";
import { assertJudgeTopology, closeMq, JUDGE_DLQ, JUDGE_RESULTS_BACKEND_QUEUE, JUDGE_TASKS_QUEUE } from "../mq/client";
import { startJudgeResultConsumer } from "../mq/consumer";
import { pool as backendPool } from "../db/client";
import { loginAs, seedUser, truncateTestTables } from "../__tests__/helpers/db";
import { startJudgeConsumer } from "../../../worker/src/consumers/judge.consumer";
import { pool as workerPool } from "../../../worker/src/db/client";

type Actor = {
  id: number;
  username: string;
  password: string;
  token: string;
};

type ProblemSpec = {
  key: "sum" | "product" | "reverse";
  title: string;
  scoreWeight: number;
  correctSource: string;
  wrongSource: string;
  payload: ProblemPayload;
};

type ProblemPayload = {
  title: string;
  descriptionMd: string;
  difficulty: "easy" | "medium" | "hard";
  timeLimitMs: number;
  memoryLimitMb: number;
  outputLimitKb: number;
  testcases: {
    orderIndex: number;
    isPublic: boolean;
    inputData: string;
    expectedOutput: string;
  }[];
  languageLimits?: {
    language: "python3" | "cpp17";
    timeMultiplier: number;
    memoryMultiplier: number;
  }[];
};

type SubmissionType = "simple" | "formal";
type SubmissionLanguage = "python3" | "cpp17";

type SessionProblem = {
  id: number;
  problemId: number;
  orderIndex: number;
  scoreWeight: number;
};

type SubmissionSummary = {
  id: number;
  status: "pending" | "judging" | "done" | "system_error";
  verdict: "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | null;
  judgedAt: string | null;
};

type SessionResult = {
  id: number;
  status: string;
  totalScore: number;
  maxScore: number;
  problems: {
    examSessionProblemId: number;
    score: number;
    latestStatus: string;
    latestSubmissionId: number | null;
    finalSubmissionId: number | null;
  }[];
};

type SubmissionDetail = SubmissionSummary & {
  score: number;
  isFinalSubmission: boolean;
  testcaseResults: {
    isPublic: boolean;
    verdict: string;
    actualOutput?: string | null;
  }[];
};

const PASSWORD = "E2e@1234";
const E2E_TEST_TIMEOUT_MS = 180000;
const E2E_HOOK_TIMEOUT_MS = 60000;

const problemSpecs: ProblemSpec[] = [
  {
    key: "sum",
    title: "E2E Sum Pair",
    scoreWeight: 30,
    correctSource: "print(sum(map(int, input().split())))\n",
    wrongSource: "print('wrong')\n",
    payload: {
      title: "E2E Sum Pair",
      descriptionMd: "Print the sum of two integers.",
      difficulty: "easy",
      timeLimitMs: 4000,
      memoryLimitMb: 128,
      outputLimitKb: 64,
      testcases: [
        { orderIndex: 1, isPublic: true, inputData: "1 2\n", expectedOutput: "3" },
        { orderIndex: 2, isPublic: false, inputData: "40 2\n", expectedOutput: "42" },
      ],
    },
  },
  {
    key: "product",
    title: "E2E Product Pair",
    scoreWeight: 30,
    correctSource: "a, b = map(int, input().split())\nprint(a * b)\n",
    wrongSource: "print('wrong')\n",
    payload: {
      title: "E2E Product Pair",
      descriptionMd: "Print the product of two integers.",
      difficulty: "medium",
      timeLimitMs: 4000,
      memoryLimitMb: 128,
      outputLimitKb: 64,
      testcases: [
        { orderIndex: 1, isPublic: true, inputData: "3 4\n", expectedOutput: "12" },
        { orderIndex: 2, isPublic: false, inputData: "6 7\n", expectedOutput: "42" },
      ],
    },
  },
  {
    key: "reverse",
    title: "E2E Reverse Word",
    scoreWeight: 40,
    correctSource: "print(input().strip()[::-1])\n",
    wrongSource: "print('wrong')\n",
    payload: {
      title: "E2E Reverse Word",
      descriptionMd: "Print the reversed word.",
      difficulty: "hard",
      timeLimitMs: 4000,
      memoryLimitMb: 128,
      outputLimitKb: 64,
      testcases: [
        { orderIndex: 1, isPublic: true, inputData: "abc\n", expectedOutput: "cba" },
        { orderIndex: 2, isPublic: false, inputData: "cloud\n", expectedOutput: "duolc" },
      ],
    },
  },
];

let app: FastifyInstance;
let rabbitConnection: ChannelModel;
let controlChannel: Channel;
let workerChannel: Channel;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  rabbitConnection = await amqp.connect(process.env["RABBITMQ_URL"]!);
  controlChannel = await rabbitConnection.createChannel();
  await assertJudgeTopology(controlChannel);
  await purgeJudgeQueues();
  await expectJudgeConsumerCount(0, "before starting the in-process E2E worker");

  workerChannel = await rabbitConnection.createChannel();
  await startJudgeConsumer(workerChannel);
  await startJudgeResultConsumer();
}, E2E_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await workerChannel?.close().catch(() => undefined);
  await controlChannel?.close().catch(() => undefined);
  await rabbitConnection?.close().catch(() => undefined);
  await app?.close();
  await closeMq();
  await workerPool.end().catch(() => undefined);
  await backendPool.end().catch(() => undefined);
}, E2E_HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await purgeJudgeQueues();
  await truncateTestTables();
  await seedUser({
    username: "root",
    password: "Root@1234",
    displayName: "E2E Root",
    isSuperuser: true,
  });
}, E2E_HOOK_TIMEOUT_MS);

describe("Postgres + RabbitMQ + backend + worker end-to-end judging", () => {
  it("runs multiple full three-problem candidate sessions and lets the interviewer inspect results", async () => {
    const stack = await createStack();
    const plans = [
      {
        candidate: stack.candidates.perfect,
        expectedScore: 100,
        expectedLatest: ["AC", "AC", "AC"],
        attempts: problemSpecs.map((spec) => ({ key: spec.key, source: spec.correctSource })),
      },
      {
        candidate: stack.candidates.retryToPerfect,
        expectedScore: 100,
        expectedLatest: ["AC", "AC", "AC"],
        attempts: problemSpecs.flatMap((spec) => [
          { key: spec.key, source: spec.wrongSource },
          { key: spec.key, source: spec.correctSource },
        ]),
      },
      {
        candidate: stack.candidates.allWrong,
        expectedScore: 0,
        expectedLatest: ["WA", "WA", "WA"],
        attempts: problemSpecs.map((spec) => ({ key: spec.key, source: spec.wrongSource })),
      },
      {
        candidate: stack.candidates.oneCorrect,
        expectedScore: 30,
        expectedLatest: ["AC", "WA", "WA"],
        attempts: [
          { key: "sum" as const, source: problemSpecs[0]!.correctSource },
          { key: "product" as const, source: problemSpecs[1]!.wrongSource },
          { key: "reverse" as const, source: problemSpecs[2]!.wrongSource },
        ],
      },
    ];

    const submittedIds: number[] = [];
    const sessions: {
      candidate: Actor;
      sessionId: number;
      expectedScore: number;
      expectedLatest: string[];
    }[] = [];

    for (const plan of plans) {
      const session = await createSession(stack.interviewer.token, plan.candidate, stack.problemIds);
      await startSession(session.sessionId, plan.candidate.token);
      sessions.push({
        candidate: plan.candidate,
        sessionId: session.sessionId,
        expectedScore: plan.expectedScore,
        expectedLatest: plan.expectedLatest,
      });

      for (const attempt of plan.attempts) {
        const sessionProblem = session.problemsByKey[attempt.key];
        const submission = await submitCode(
          session.sessionId,
          sessionProblem.id,
          plan.candidate.token,
          attempt.source
        );
        submittedIds.push(submission.id);
      }
    }

    await waitForSubmissionsDone(submittedIds);

    for (const session of sessions) {
      const result = await api<SessionResult>(
        "GET",
        `/api/exam-sessions/${session.sessionId}/result`,
        stack.interviewer.token
      );

      expect(result.maxScore).toBe(100);
      expect(result.totalScore).toBe(session.expectedScore);
      expect(result.problems.map((problem) => problem.latestStatus)).toEqual(session.expectedLatest);
      expect(result.problems.every((problem) => problem.finalSubmissionId !== null)).toBe(true);

      for (const problem of result.problems) {
        const detail = await api<SubmissionDetail>(
          "GET",
          `/api/exam-sessions/${session.sessionId}/submissions/${problem.finalSubmissionId}`,
          stack.interviewer.token
        );
        expect(detail.status).toBe("done");
        expect(detail.verdict).toBe(problem.latestStatus);
        expect(detail.isFinalSubmission).toBe(true);
        expect(detail.testcaseResults).toHaveLength(2);
        expect(detail.testcaseResults.find((tc) => !tc.isPublic)).not.toHaveProperty("actualOutput");
      }

      const candidateView = await api<SessionResult>(
        "GET",
        `/api/exam-sessions/${session.sessionId}/result`,
        session.candidate.token
      );
      expect(candidateView.totalScore).toBe(session.expectedScore);
    }
  }, E2E_TEST_TIMEOUT_MS);

  it("keeps same-time candidate submissions pending behind the active job because the worker consumes one task at a time", async () => {
    const stack = await createStack();
    const firstSession = await createSession(stack.interviewer.token, stack.candidates.perfect, {
      sum: stack.problemIds.sum,
    });
    const secondSession = await createSession(stack.interviewer.token, stack.candidates.oneCorrect, {
      sum: stack.problemIds.sum,
    });

    await startSession(firstSession.sessionId, stack.candidates.perfect.token);
    await startSession(secondSession.sessionId, stack.candidates.oneCorrect.token);

    const slowSubmission = await submitCode(
      firstSession.sessionId,
      firstSession.problemsByKey.sum.id,
      stack.candidates.perfect.token,
      "import time\ntime.sleep(2.0)\nprint(sum(map(int, input().split())))\n"
    );
    const fastSubmission = await submitCode(
      secondSession.sessionId,
      secondSession.problemsByKey.sum.id,
      stack.candidates.oneCorrect.token,
      problemSpecs[0]!.correctSource
    );

    await waitForSubmissionStatus(
      firstSession.sessionId,
      slowSubmission.id,
      stack.candidates.perfect.token,
      "judging"
    );

    const queuedBehind = await api<SubmissionDetail>(
      "GET",
      `/api/exam-sessions/${secondSession.sessionId}/submissions/${fastSubmission.id}`,
      stack.candidates.oneCorrect.token
    );
    expect(queuedBehind.status).toBe("pending");

    await waitForSubmissionsDone([slowSubmission.id, fastSubmission.id]);

    const slowDone = await api<SubmissionDetail>(
      "GET",
      `/api/exam-sessions/${firstSession.sessionId}/submissions/${slowSubmission.id}`,
      stack.interviewer.token
    );
    const fastDone = await api<SubmissionDetail>(
      "GET",
      `/api/exam-sessions/${secondSession.sessionId}/submissions/${fastSubmission.id}`,
      stack.interviewer.token
    );

    expect(slowDone.verdict).toBe("AC");
    expect(fastDone.verdict).toBe("AC");
    expect(new Date(slowDone.judgedAt!).getTime()).toBeLessThanOrEqual(
      new Date(fastDone.judgedAt!).getTime()
    );
  }, E2E_TEST_TIMEOUT_MS);

  it("keeps simple submissions from changing formal score or final submission", async () => {
    const stack = await createStack();
    const session = await createSession(stack.interviewer.token, stack.candidates.perfect, {
      sum: stack.problemIds.sum,
    });
    await startSession(session.sessionId, stack.candidates.perfect.token);

    const simpleAc = await submitCode(
      session.sessionId,
      session.problemsByKey.sum.id,
      stack.candidates.perfect.token,
      problemSpecs[0]!.correctSource,
      { type: "simple" }
    );
    await waitForSubmissionsDone([simpleAc.id]);

    let result = await api<SessionResult>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/result`,
      stack.interviewer.token
    );
    expect(result.totalScore).toBe(0);
    expect(result.problems[0]!.finalSubmissionId).toBeNull();

    const formalAc = await submitCode(
      session.sessionId,
      session.problemsByKey.sum.id,
      stack.candidates.perfect.token,
      problemSpecs[0]!.correctSource
    );
    await waitForSubmissionsDone([formalAc.id]);

    const simpleWa = await submitCode(
      session.sessionId,
      session.problemsByKey.sum.id,
      stack.candidates.perfect.token,
      problemSpecs[0]!.wrongSource,
      { type: "simple" }
    );
    await waitForSubmissionsDone([simpleWa.id]);

    result = await api<SessionResult>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/result`,
      stack.interviewer.token
    );
    expect(result.totalScore).toBe(100);
    expect(result.problems[0]).toMatchObject({
      latestStatus: "WA",
      finalSubmissionId: formalAc.id,
    });

    const finalDetail = await api<SubmissionDetail>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/submissions/${formalAc.id}`,
      stack.interviewer.token
    );
    expect(finalDetail.isFinalSubmission).toBe(true);
    expect(finalDetail.score).toBe(100);
  }, E2E_TEST_TIMEOUT_MS);

  it("lets a later formal WA override a previous formal AC and reset the score", async () => {
    const stack = await createStack();
    const session = await createSession(stack.interviewer.token, stack.candidates.perfect, {
      sum: stack.problemIds.sum,
    });
    await startSession(session.sessionId, stack.candidates.perfect.token);

    const ac = await submitCode(
      session.sessionId,
      session.problemsByKey.sum.id,
      stack.candidates.perfect.token,
      problemSpecs[0]!.correctSource
    );
    await waitForSubmissionsDone([ac.id]);

    const wa = await submitCode(
      session.sessionId,
      session.problemsByKey.sum.id,
      stack.candidates.perfect.token,
      problemSpecs[0]!.wrongSource
    );
    await waitForSubmissionsDone([wa.id]);

    const result = await api<SessionResult>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/result`,
      stack.interviewer.token
    );
    expect(result.totalScore).toBe(0);
    expect(result.problems[0]).toMatchObject({
      latestStatus: "WA",
      finalSubmissionId: wa.id,
      score: 0,
    });

    const oldAc = await api<SubmissionDetail>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/submissions/${ac.id}`,
      stack.interviewer.token
    );
    expect(oldAc.isFinalSubmission).toBe(false);
    expect(oldAc.score).toBe(0);
  }, E2E_TEST_TIMEOUT_MS);

  it("rejects submissions after a session expires and marks the result expired", async () => {
    const stack = await createStack();
    const session = await createSession(stack.interviewer.token, stack.candidates.perfect, {
      sum: stack.problemIds.sum,
    });
    await startSession(session.sessionId, stack.candidates.perfect.token);
    await backendPool.query(
      "UPDATE exam_sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
      [session.sessionId]
    );

    await api(
      "POST",
      `/api/exam-sessions/${session.sessionId}/submissions`,
      stack.candidates.perfect.token,
      {
        examSessionProblemId: session.problemsByKey.sum.id,
        language: "python3",
        sourceCode: problemSpecs[0]!.correctSource,
        type: "formal",
      },
      409
    );

    const result = await api<SessionResult>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/result`,
      stack.interviewer.token
    );
    expect(result.status).toBe("expired");
    expect(result.totalScore).toBe(0);
  }, E2E_TEST_TIMEOUT_MS);

  it("prevents another interviewer from inspecting someone else's session result", async () => {
    const stack = await createStack();
    const otherInterviewer = await createUser(await loginAs(app, "root", "Root@1234"), "e2e_interviewer_other", [
      "interviewer",
    ]);
    const session = await createSession(stack.interviewer.token, stack.candidates.perfect, {
      sum: stack.problemIds.sum,
    });
    await startSession(session.sessionId, stack.candidates.perfect.token);

    await api(
      "GET",
      `/api/exam-sessions/${session.sessionId}/result`,
      otherInterviewer.token,
      undefined,
      403
    );

    const ownerView = await api<SessionResult>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/result`,
      stack.interviewer.token
    );
    expect(ownerView.id).toBe(session.sessionId);
  }, E2E_TEST_TIMEOUT_MS);

  it("records TLE when sandbox execution exceeds the time limit", async () => {
    const stack = await createStack();
    const tleProblemId = await createProblem(stack.problemSetter.token, {
      title: "E2E TLE Probe",
      descriptionMd: "Intentionally tiny time limit.",
      difficulty: "easy",
      timeLimitMs: 300,
      memoryLimitMb: 128,
      outputLimitKb: 64,
      testcases: [
        { orderIndex: 1, isPublic: true, inputData: "1\n", expectedOutput: "1" },
        { orderIndex: 2, isPublic: false, inputData: "2\n", expectedOutput: "2" },
      ],
      languageLimits: [{ language: "python3", timeMultiplier: 1, memoryMultiplier: 1 }],
    });
    const session = await createManualSession(
      stack.interviewer.token,
      stack.candidates.perfect,
      [{ problemId: tleProblemId, scoreWeight: 100, orderIndex: 1 }]
    );
    await startSession(session.sessionId, stack.candidates.perfect.token);

    const submission = await submitCode(
      session.sessionId,
      session.problemIds[tleProblemId]!.id,
      stack.candidates.perfect.token,
      "while True:\n    pass\n"
    );
    await waitForSubmissionsDone([submission.id]);

    const detail = await api<SubmissionDetail>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/submissions/${submission.id}`,
      stack.interviewer.token
    );
    expect(detail.verdict).toBe("TLE");
    expect(detail.testcaseResults[0]).toMatchObject({ isPublic: true, verdict: "TLE" });
    expect(detail.testcaseResults[1]).toMatchObject({ isPublic: false, verdict: "skipped" });
  }, E2E_TEST_TIMEOUT_MS);

  it("records RE when submitted code raises at runtime", async () => {
    const stack = await createStack();
    const session = await createSession(stack.interviewer.token, stack.candidates.perfect, {
      sum: stack.problemIds.sum,
    });
    await startSession(session.sessionId, stack.candidates.perfect.token);

    const submission = await submitCode(
      session.sessionId,
      session.problemsByKey.sum.id,
      stack.candidates.perfect.token,
      "raise RuntimeError('boom')\n"
    );
    await waitForSubmissionsDone([submission.id]);

    const detail = await api<SubmissionDetail>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/submissions/${submission.id}`,
      stack.interviewer.token
    );
    expect(detail.verdict).toBe("RE");
    expect(detail.testcaseResults[0]).toMatchObject({ isPublic: true, verdict: "RE" });
    expect(detail.testcaseResults[1]).toMatchObject({ isPublic: false, verdict: "skipped" });
  }, E2E_TEST_TIMEOUT_MS);

  it("records CE for invalid C++ submissions without testcase rows", async () => {
    const stack = await createStack();
    const session = await createSession(stack.interviewer.token, stack.candidates.perfect, {
      sum: stack.problemIds.sum,
    });
    await startSession(session.sessionId, stack.candidates.perfect.token);

    const submission = await submitCode(
      session.sessionId,
      session.problemsByKey.sum.id,
      stack.candidates.perfect.token,
      "int main(\n",
      { language: "cpp17" }
    );
    await waitForSubmissionsDone([submission.id]);

    const detail = await api<SubmissionDetail>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/submissions/${submission.id}`,
      stack.interviewer.token
    );
    expect(detail.verdict).toBe("CE");
    expect(detail.testcaseResults).toHaveLength(0);
    expect(detail.score).toBe(0);
  }, E2E_TEST_TIMEOUT_MS);

  it("accepts valid C++ submissions end-to-end", async () => {
    const stack = await createStack();
    const session = await createSession(stack.interviewer.token, stack.candidates.perfect, {
      sum: stack.problemIds.sum,
    });
    await startSession(session.sessionId, stack.candidates.perfect.token);

    const submission = await submitCode(
      session.sessionId,
      session.problemsByKey.sum.id,
      stack.candidates.perfect.token,
      [
        "#include <iostream>",
        "int main() {",
        "  long long a, b;",
        "  std::cin >> a >> b;",
        "  std::cout << (a + b) << '\\n';",
        "  return 0;",
        "}",
        "",
      ].join("\n"),
      { language: "cpp17" }
    );
    await waitForSubmissionsDone([submission.id]);

    const detail = await api<SubmissionDetail>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/submissions/${submission.id}`,
      stack.interviewer.token
    );
    expect(detail.verdict).toBe("AC");
    expect(detail.score).toBe(30);
  }, E2E_TEST_TIMEOUT_MS);

  it("keeps tasks durable while no worker is consuming and processes them after worker restart", async () => {
    await workerChannel.close();
    await waitForJudgeConsumerCount(0, 5000);

    const stack = await createStack();
    const session = await createSession(stack.interviewer.token, stack.candidates.perfect, {
      sum: stack.problemIds.sum,
    });
    await startSession(session.sessionId, stack.candidates.perfect.token);

    const submission = await submitCode(
      session.sessionId,
      session.problemsByKey.sum.id,
      stack.candidates.perfect.token,
      problemSpecs[0]!.correctSource
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    const pending = await api<SubmissionDetail>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/submissions/${submission.id}`,
      stack.candidates.perfect.token
    );
    expect(pending.status).toBe("pending");

    workerChannel = await rabbitConnection.createChannel();
    await startJudgeConsumer(workerChannel);
    await waitForSubmissionsDone([submission.id]);

    const detail = await api<SubmissionDetail>(
      "GET",
      `/api/exam-sessions/${session.sessionId}/submissions/${submission.id}`,
      stack.interviewer.token
    );
    expect(detail.verdict).toBe("AC");
    expect(detail.isFinalSubmission).toBe(true);
  }, E2E_TEST_TIMEOUT_MS);
});

async function createStack() {
  const rootToken = await loginAs(app, "root", "Root@1234");
  const interviewer = await createUser(rootToken, "e2e_interviewer", ["interviewer"]);
  const problemSetter = await createUser(rootToken, "e2e_problem_setter", ["problem_setter"]);
  const candidates = {
    perfect: await createUser(rootToken, "e2e_candidate_perfect", ["candidate"]),
    retryToPerfect: await createUser(rootToken, "e2e_candidate_retry", ["candidate"]),
    allWrong: await createUser(rootToken, "e2e_candidate_wrong", ["candidate"]),
    oneCorrect: await createUser(rootToken, "e2e_candidate_one", ["candidate"]),
  };

  const problemIds = {} as Record<ProblemSpec["key"], number>;
  for (const spec of problemSpecs) {
    problemIds[spec.key] = await createProblem(problemSetter.token, spec.payload);
  }

  return { interviewer, problemSetter, candidates, problemIds };
}

async function createProblem(problemSetterToken: string, payload: ProblemPayload): Promise<number> {
  const created = await api<{ id: number }>("POST", "/api/problems", problemSetterToken, payload, 201);
  return created.id;
}

async function createUser(rootToken: string, username: string, roleNames: string[]): Promise<Actor> {
  const created = await api<{ id: number; username: string }>(
    "POST",
    "/api/users",
    rootToken,
    {
      username,
      password: PASSWORD,
      displayName: username,
      roleNames,
    },
    201
  );
  const token = await loginAs(app, username, PASSWORD);
  return { id: created.id, username: created.username, password: PASSWORD, token };
}

async function createSession(
  interviewerToken: string,
  candidate: Actor,
  problemIds: Partial<Record<ProblemSpec["key"], number>>
): Promise<{
  sessionId: number;
  problemsByKey: Record<ProblemSpec["key"], SessionProblem>;
}> {
  const assignedSpecs = problemSpecs.filter((spec) => problemIds[spec.key] !== undefined);
  const session = await api<{ id: number }>(
    "POST",
    "/api/exam-sessions",
    interviewerToken,
    {
      candidateId: candidate.id,
      durationMinutes: 3,
      problems: assignedSpecs.map((spec, index) => ({
        problemId: problemIds[spec.key],
        scoreWeight: assignedSpecs.length === 1 ? 100 : spec.scoreWeight,
        orderIndex: index + 1,
      })),
    },
    201
  );

  const sessionProblems = await api<SessionProblem[]>(
    "GET",
    `/api/exam-sessions/${session.id}/problems`,
    interviewerToken
  );

  const problemsByKey = {} as Record<ProblemSpec["key"], SessionProblem>;
  for (const spec of assignedSpecs) {
    const row = sessionProblems.find((problem) => problem.problemId === problemIds[spec.key]);
    expect(row).toBeDefined();
    problemsByKey[spec.key] = row!;
  }

  return { sessionId: session.id, problemsByKey };
}

async function createManualSession(
  interviewerToken: string,
  candidate: Actor,
  problems: { problemId: number; scoreWeight: number; orderIndex: number }[]
): Promise<{
  sessionId: number;
  problemIds: Record<number, SessionProblem>;
}> {
  const session = await api<{ id: number }>(
    "POST",
    "/api/exam-sessions",
    interviewerToken,
    {
      candidateId: candidate.id,
      durationMinutes: 3,
      problems,
    },
    201
  );

  const sessionProblems = await api<SessionProblem[]>(
    "GET",
    `/api/exam-sessions/${session.id}/problems`,
    interviewerToken
  );

  const byProblemId: Record<number, SessionProblem> = {};
  for (const problem of sessionProblems) {
    byProblemId[problem.problemId] = problem;
  }

  return { sessionId: session.id, problemIds: byProblemId };
}

async function startSession(sessionId: number, candidateToken: string): Promise<void> {
  await api("POST", `/api/exam-sessions/${sessionId}/start`, candidateToken);
}

async function submitCode(
  sessionId: number,
  examSessionProblemId: number,
  candidateToken: string,
  sourceCode: string,
  options: { type?: SubmissionType; language?: SubmissionLanguage } = {}
): Promise<{ id: number }> {
  return api<{ id: number }>(
    "POST",
    `/api/exam-sessions/${sessionId}/submissions`,
    candidateToken,
    {
      examSessionProblemId,
      language: options.language ?? "python3",
      sourceCode,
      type: options.type ?? "formal",
    },
    202
  );
}

async function api<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  token: string,
  payload?: object,
  expectedStatus = 200
): Promise<T> {
  const options: InjectOptions = {
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
  };

  if (payload !== undefined) {
    options.payload = payload;
  }

  const response = await app.inject(options);

  expect(response.statusCode, response.body).toBe(expectedStatus);
  return response.statusCode === 204 ? (undefined as T) : response.json<T>();
}

async function waitForSubmissionsDone(submissionIds: number[]): Promise<void> {
  await waitFor(async () => {
    const result = await backendPool.query<SubmissionSummary>(
      `
        SELECT id, status, verdict, judged_at AS "judgedAt"
        FROM submissions
        WHERE id = ANY($1::bigint[])
      `,
      [submissionIds]
    );
    return (
      result.rows.length === submissionIds.length &&
      result.rows.every((row) => row.status === "done")
    );
  }, 120000);
}

async function waitForSubmissionStatus(
  sessionId: number,
  submissionId: number,
  token: string,
  status: SubmissionSummary["status"]
): Promise<void> {
  await waitFor(async () => {
    const detail = await api<SubmissionDetail>(
      "GET",
      `/api/exam-sessions/${sessionId}/submissions/${submissionId}`,
      token
    );
    return detail.status === status;
  }, 15000);
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function purgeJudgeQueues(): Promise<void> {
  await controlChannel.purgeQueue(JUDGE_TASKS_QUEUE);
  await controlChannel.purgeQueue(JUDGE_RESULTS_BACKEND_QUEUE);
  await controlChannel.purgeQueue(JUDGE_DLQ);
}

async function expectJudgeConsumerCount(expected: number, context: string): Promise<void> {
  const { consumerCount } = await controlChannel.checkQueue(JUDGE_TASKS_QUEUE);
  if (consumerCount !== expected) {
    throw new Error(
      `Expected ${expected} judge.tasks consumer(s) ${context}, but found ${consumerCount}. ` +
        "Stop any external worker first, for example: docker compose stop worker"
    );
  }
}

async function waitForJudgeConsumerCount(expected: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let lastCount = -1;

  while (Date.now() - startedAt < timeoutMs) {
    const { consumerCount } = await controlChannel.checkQueue(JUDGE_TASKS_QUEUE);
    lastCount = consumerCount;
    if (consumerCount === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for judge.tasks consumer count to become ${expected}; last count was ${lastCount}. ` +
      "Stop any external worker first, for example: docker compose stop worker"
  );
}
