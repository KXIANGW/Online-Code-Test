import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "./helpers/app";
import { truncateTestTables, seedUser, loginAs } from "./helpers/db";
import { db } from "../db/client";
import { examSessionProblems, examSessions, problems, problemTestcases } from "../db/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let aliceToken: string;
let bobToken: string;
let carolToken: string;
let candToken: string;
let eveToken: string;
let rootToken: string;
let carolId: number;
let davidId: number;
let eveId: number;
let easyProblemId: number;
let mediumProblemId: number;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateTestTables();

  await seedUser({ username: "root", password: "Root@1234", displayName: "Root", isSuperuser: true });
  carolId = await seedUser({ username: "carol", password: "Test@1234", displayName: "Carol", roleNames: ["problem_setter"] });
  await seedUser({ username: "alice", password: "Test@1234", displayName: "Alice", roleNames: ["interviewer"] });
  await seedUser({ username: "bob", password: "Bob@1234", displayName: "Bob", roleNames: ["interviewer"] });
  davidId = await seedUser({ username: "david", password: "Cand@1234", displayName: "David", roleNames: ["candidate"] });
  eveId = await seedUser({ username: "eve", password: "Eve@1234", displayName: "Eve", roleNames: ["candidate"] });

  aliceToken = await loginAs(app, "alice", "Test@1234");
  bobToken = await loginAs(app, "bob", "Bob@1234");
  carolToken = await loginAs(app, "carol", "Test@1234");
  candToken = await loginAs(app, "david", "Cand@1234");
  eveToken = await loginAs(app, "eve", "Eve@1234");
  rootToken = await loginAs(app, "root", "Root@1234");

  const problemRows = await db
    .insert(problems)
    .values([
      {
        title: "Two Sum",
        descriptionMd: "desc",
        difficulty: "easy",
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        outputLimitKb: 64,
        createdBy: carolId,
      },
      {
        title: "Binary Search",
        descriptionMd: "desc",
        difficulty: "medium",
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        outputLimitKb: 64,
        createdBy: carolId,
      },
    ])
    .returning({ id: problems.id, difficulty: problems.difficulty });

  easyProblemId = problemRows.find((p) => p.difficulty === "easy")!.id;
  mediumProblemId = problemRows.find((p) => p.difficulty === "medium")!.id;

  await db.insert(problemTestcases).values([
    {
      problemId: easyProblemId,
      orderIndex: 1,
      isPublic: true,
      inputData: "1 2",
      expectedOutput: "3",
    },
    {
      problemId: easyProblemId,
      orderIndex: 2,
      isPublic: false,
      inputData: "40 2",
      expectedOutput: "42",
    },
    {
      problemId: mediumProblemId,
      orderIndex: 1,
      isPublic: true,
      inputData: "5",
      expectedOutput: "2",
    },
    {
      problemId: mediumProblemId,
      orderIndex: 2,
      isPublic: false,
      inputData: "hidden",
      expectedOutput: "-1",
    },
  ]);
});

async function createSession(
  token: string,
  candidateId: number,
  problemIds: number[] = [easyProblemId]
): Promise<{ sessionId: number; espIds: number[] }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/exam-sessions",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      candidateId,
      durationMinutes: 60,
      problems: problemIds.map((problemId, index) => ({
        problemId,
        scoreWeight: index === 0 ? 30 : 70,
        orderIndex: index + 1,
      })),
    },
  });

  const sessionId = res.json<{ id: number }>().id;
  const esps = await db
    .select({ id: examSessionProblems.id })
    .from(examSessionProblems)
    .where(eq(examSessionProblems.examSessionId, sessionId));

  return { sessionId, espIds: esps.map((esp) => esp.id) };
}

async function startSession(sessionId: number, token = candToken) {
  const res = await app.inject({
    method: "POST",
    url: `/api/exam-sessions/${sessionId}/start`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
}

async function submitCode(
  sessionId: number,
  examSessionProblemId: number,
  sourceCode: string,
  token = candToken
): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: `/api/exam-sessions/${sessionId}/submissions`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      examSessionProblemId,
      language: "python3",
      sourceCode,
    },
  });

  expect(res.statusCode).toBe(202);
  const body = res.json<{ id: number; status: string; verdict: string | null }>();
  expect(body.status).toBe("pending");
  expect(body.verdict).toBeNull();
  return body.id;
}

async function getDetail(sessionId: number, submissionId: number, token = candToken) {
  const res = await app.inject({
    method: "GET",
    url: `/api/exam-sessions/${sessionId}/submissions/${submissionId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{
    id: number;
    sourceCode: string;
    status: string;
    verdict: string | null;
    score: number;
    testcaseResults: { isPublic: boolean; actualOutput?: string | null }[];
  }>();
}

async function settleSubmission(sessionId: number, submissionId: number, token = candToken) {
  const first = await getDetail(sessionId, submissionId, token);
  expect(first.status).toBe("pending");

  const second = await getDetail(sessionId, submissionId, token);
  expect(second.status).toBe("judging");

  const third = await getDetail(sessionId, submissionId, token);
  expect(third.status).toBe("done");
  return third;
}

describe("Submission API mock judge", () => {
  it("candidate submits the same problem three times and sees WA → TLE → AC", async () => {
    const { sessionId, espIds } = await createSession(aliceToken, davidId);
    await startSession(sessionId);

    const firstId = await submitCode(sessionId, espIds[0]!, "print('wrong')");
    const first = await settleSubmission(sessionId, firstId);
    expect(first.verdict).toBe("WA");
    expect(first.score).toBe(0);

    const secondId = await submitCode(sessionId, espIds[0]!, "while True: pass");
    const second = await settleSubmission(sessionId, secondId);
    expect(second.verdict).toBe("TLE");
    expect(second.score).toBe(0);

    const thirdId = await submitCode(sessionId, espIds[0]!, "print('accepted')");
    const third = await settleSubmission(sessionId, thirdId);
    expect(third.verdict).toBe("AC");
    expect(third.score).toBe(30);
    expect(third.testcaseResults).toHaveLength(2);
    expect(third.testcaseResults.find((tc) => tc.isPublic)).toHaveProperty("actualOutput", "3");
    expect(third.testcaseResults.find((tc) => !tc.isPublic)).not.toHaveProperty("actualOutput");

    const resultRes = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/result`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(resultRes.statusCode).toBe(200);
    const result = resultRes.json<{
      totalScore: number;
      maxScore: number;
      problems: { latestStatus: string; latestSubmissionId: number; finalSubmissionId: number; score: number }[];
    }>();
    expect(result.totalScore).toBe(30);
    expect(result.maxScore).toBe(30);
    expect(result.problems[0]).toMatchObject({
      latestStatus: "AC",
      latestSubmissionId: thirdId,
      finalSubmissionId: thirdId,
      score: 30,
    });
  });

  it("candidate sees interleaved submissions in timeline order and result uses each problem's latest submission", async () => {
    const { sessionId, espIds } = await createSession(aliceToken, davidId, [easyProblemId, mediumProblemId]);
    await startSession(sessionId);

    const firstEasy = await submitCode(sessionId, espIds[0]!, "easy v1");
    const firstMedium = await submitCode(sessionId, espIds[1]!, "medium v1");
    const secondEasy = await submitCode(sessionId, espIds[0]!, "easy v2");

    const list1 = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(list1.statusCode).toBe(200);
    const pending = list1.json<{ id: number; status: string; sourceCode?: string }[]>();
    expect(pending.map((s) => s.id)).toEqual([firstEasy, firstMedium, secondEasy]);
    expect(pending.map((s) => s.status)).toEqual(["pending", "pending", "pending"]);
    expect(pending[0]).not.toHaveProperty("sourceCode");

    const list2 = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(list2.json<{ status: string }[]>().map((s) => s.status)).toEqual([
      "judging",
      "judging",
      "judging",
    ]);

    const list3 = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    const done = list3.json<{ id: number; status: string; verdict: string }[]>();
    expect(done.map((s) => [s.id, s.status, s.verdict])).toEqual([
      [firstEasy, "done", "WA"],
      [firstMedium, "done", "WA"],
      [secondEasy, "done", "TLE"],
    ]);

    const resultRes = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/result`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    const result = resultRes.json<{
      problems: { examSessionProblemId: number; latestStatus: string; latestSubmissionId: number; score: number; sourceCode?: string }[];
    }>();
    expect(result.problems).toEqual([
      expect.objectContaining({
        examSessionProblemId: espIds[0],
        latestStatus: "TLE",
        latestSubmissionId: secondEasy,
        score: 0,
      }),
      expect.objectContaining({
        examSessionProblemId: espIds[1],
        latestStatus: "WA",
        latestSubmissionId: firstMedium,
        score: 0,
      }),
    ]);
    expect(result.problems[0]).not.toHaveProperty("sourceCode");
  });
});

describe("Submission API permissions", () => {
  it("protects result and history by role and ownership", async () => {
    const { sessionId } = await createSession(aliceToken, davidId);
    const { sessionId: eveSessionId } = await createSession(aliceToken, eveId);
    const { sessionId: bobSessionId } = await createSession(bobToken, davidId);

    const noAuth = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/result`,
    });
    expect(noAuth.statusCode).toBe(401);

    const otherCandidate = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${eveSessionId}/result`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(otherCandidate.statusCode).toBe(403);

    const otherInterviewer = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${bobSessionId}/result`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(otherInterviewer.statusCode).toBe(403);

    const problemSetter = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/submissions`,
      headers: { authorization: `Bearer ${carolToken}` },
    });
    expect(problemSetter.statusCode).toBe(403);

    const root = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${bobSessionId}/result`,
      headers: { authorization: `Bearer ${rootToken}` },
    });
    expect(root.statusCode).toBe(200);
  });

  it("allows interviewer to inspect latest and historical source code, but not submit", async () => {
    const { sessionId, espIds } = await createSession(aliceToken, davidId);
    await startSession(sessionId);

    const firstId = await submitCode(sessionId, espIds[0]!, "old wrong code");
    await settleSubmission(sessionId, firstId);
    const secondId = await submitCode(sessionId, espIds[0]!, "slow code");
    await settleSubmission(sessionId, secondId);
    const thirdId = await submitCode(sessionId, espIds[0]!, "final accepted code");
    await settleSubmission(sessionId, thirdId);

    const oldDetail = await getDetail(sessionId, firstId, aliceToken);
    expect(oldDetail.sourceCode).toBe("old wrong code");
    expect(oldDetail.verdict).toBe("WA");

    const latestDetail = await getDetail(sessionId, thirdId, aliceToken);
    expect(latestDetail.sourceCode).toBe("final accepted code");
    expect(latestDetail.verdict).toBe("AC");

    const listRes = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/submissions`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(listRes.json<{ sourceCode?: string }[]>()[0]).not.toHaveProperty("sourceCode");

    const interviewerSubmit = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/submissions`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        examSessionProblemId: espIds[0],
        language: "python3",
        sourceCode: "interviewer code",
      },
    });
    expect(interviewerSubmit.statusCode).toBe(403);
  });
});

describe("Submission API state guards", () => {
  it("rejects submissions before start, after cancel, after submitted, and after expiry", async () => {
    const { sessionId: notStartedId, espIds: notStartedEspIds } = await createSession(aliceToken, davidId);
    const notStarted = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${notStartedId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: {
        examSessionProblemId: notStartedEspIds[0],
        language: "python3",
        sourceCode: "too early",
      },
    });
    expect(notStarted.statusCode).toBe(409);

    const { sessionId: cancelledId, espIds: cancelledEspIds } = await createSession(aliceToken, davidId);
    await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${cancelledId}/cancel`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${cancelledId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: {
        examSessionProblemId: cancelledEspIds[0],
        language: "python3",
        sourceCode: "cancelled",
      },
    });
    expect(cancelled.statusCode).toBe(409);

    const { sessionId: submittedId, espIds: submittedEspIds } = await createSession(aliceToken, davidId);
    await db
      .update(examSessions)
      .set({ status: "submitted" })
      .where(eq(examSessions.id, submittedId));
    const submitted = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${submittedId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: {
        examSessionProblemId: submittedEspIds[0],
        language: "python3",
        sourceCode: "after submit",
      },
    });
    expect(submitted.statusCode).toBe(409);

    const { sessionId: expiredId, espIds: expiredEspIds } = await createSession(aliceToken, davidId);
    await startSession(expiredId);
    await db
      .update(examSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(examSessions.id, expiredId));
    const expired = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${expiredId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: {
        examSessionProblemId: expiredEspIds[0],
        language: "python3",
        sourceCode: "too late",
      },
    });
    expect(expired.statusCode).toBe(409);

    const [expiredSession] = await db
      .select({ status: examSessions.status })
      .from(examSessions)
      .where(eq(examSessions.id, expiredId));
    expect(expiredSession!.status).toBe("expired");
  });
});
