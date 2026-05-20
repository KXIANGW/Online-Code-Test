import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { buildApp } from "./helpers/app";
import { truncateTestTables, seedUser, loginAs } from "./helpers/db";
import { db, pool } from "../db/client";
import {
  examSessionProblems,
  examSessions,
  languageDefaults,
  problems,
  problemTestcases,
  submissions,
} from "../db/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

vi.mock("../mq/publisher", () => ({
  publishJudgeTask: vi.fn().mockResolvedValue(undefined),
}));

import { publishJudgeTask } from "../mq/publisher";
import {
  buildJudgeResultPayload,
  buildSubmissionStatusPayload,
  handleJudgeResultMessage,
} from "../mq/consumer";
import { resetSubscribersForTests, subscribeToSession } from "../ws/hub";

const publishJudgeTaskMock = vi.mocked(publishJudgeTask);

let app: FastifyInstance;
let aliceToken: string;
let bobToken: string;
let carolToken: string;
let candToken: string;
let eveToken: string;
let rootToken: string;
let carolId: number;
let aliceId: number;
let bobId: number;
let davidId: number;
let eveId: number;
let frankId: number;
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
  vi.clearAllMocks();
  resetSubscribersForTests();
  await truncateTestTables();

  await seedUser({ username: "root", password: "Root@1234", displayName: "Root", isSuperuser: true });
  carolId = await seedUser({ username: "carol", password: "Test@1234", displayName: "Carol", roleNames: ["problem_setter"] });
  aliceId = await seedUser({ username: "alice", password: "Test@1234", displayName: "Alice", roleNames: ["interviewer"] });
  bobId = await seedUser({ username: "bob", password: "Bob@1234", displayName: "Bob", roleNames: ["interviewer"] });
  davidId = await seedUser({ username: "david", password: "Cand@1234", displayName: "David", roleNames: ["candidate"], createdBy: aliceId });
  eveId = await seedUser({ username: "eve", password: "Eve@1234", displayName: "Eve", roleNames: ["candidate"], createdBy: aliceId });
  frankId = await seedUser({ username: "frank", password: "Frank@1234", displayName: "Frank", roleNames: ["candidate"], createdBy: bobId });

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
    { problemId: easyProblemId, orderIndex: 1, isPublic: true, inputData: "1 2", expectedOutput: "3" },
    { problemId: easyProblemId, orderIndex: 2, isPublic: false, inputData: "40 2", expectedOutput: "42" },
    { problemId: mediumProblemId, orderIndex: 1, isPublic: true, inputData: "5", expectedOutput: "2" },
    { problemId: mediumProblemId, orderIndex: 2, isPublic: false, inputData: "hidden", expectedOutput: "-1" },
  ]);
});

// 💡 將 submissions.test.ts 內的 createSession 修正為新版兩段式架構
async function createSession(token: string, candidateId: number, problemIds: number[] = [1]) {
  // 1. 先為這個測試場次手動建立一個基礎考卷模板（假定題目 ID 為 1，你在 db.ts 有 seed）
  const examRes = await app.inject({
    method: "POST",
    url: "/api/exam-sessions/templates/manual",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      title: "Submission Test Exam Template",
      durationMinutes: 60,
      problems: problemIds.map((problemId, index) => ({
        problemId,
        scoreWeight: index === 0 ? 30 : 70, // 💡 完美對齊舊版：第一題 30 分，其餘 70 分
        orderIndex: index + 1,
      })),
    },
  });
  
  const { id: examId } = examRes.json<{ id: number }>();

  // 2. 指派給指定的候選人（產生真正的 Exam Session）
  const assignRes = await app.inject({
    method: "POST",
    url: `/api/exam-sessions/templates/${examId}/assign`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      candidateIds: [candidateId], // 👈 批次指派
    },
  });

  // 3. 取得指派後產生的場次資料
  // 根據 assignExamToCandidates 服務，這通常會回傳一個場次陣列 [ { id, ... } ]
  const sessions = assignRes.json<{ id: number }[]>();
  const sessionId = sessions[0]!.id;

  // 4. 撈取該場次的題目清單（對接舊版測試需要的 espIds）
  const probRes = await app.inject({
    method: "GET",
    url: `/api/exam-sessions/${sessionId}/problems`,
    headers: { authorization: `Bearer ${token}` },
  });
  
  // 假設回傳格式包含題目關聯 ID 的陣列
  const problemsList = probRes.json<{ id: number }[]>();
  const espIds = problemsList.map((p) => p.id);

  return { sessionId, espIds };
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
  type?: "simple" | "formal",
  token = candToken
): Promise<{ id: number; submissionType: string }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/exam-sessions/${sessionId}/submissions`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      examSessionProblemId,
      language: "python3",
      sourceCode: "print(sum(map(int, input().split())))",
      ...(type ? { type } : {}),
    },
  });

  expect(res.statusCode).toBe(202);
  const body = res.json<{ id: number; status: string; verdict: string | null; submissionType: string }>();
  expect(body.status).toBe("pending");
  expect(body.verdict).toBeNull();
  return { id: body.id, submissionType: body.submissionType };
}

async function writeWorkerResult(
  submissionId: number,
  verdict: "AC" | "WA",
  type: "simple" | "formal"
) {
  const [submission] = await db
    .select({
      id: submissions.id,
      examSessionProblemId: submissions.examSessionProblemId,
      problemId: examSessionProblems.problemId,
      examSessionId: examSessionProblems.examSessionId,
    })
    .from(submissions)
    .innerJoin(examSessionProblems, eq(submissions.examSessionProblemId, examSessionProblems.id))
    .where(eq(submissions.id, submissionId));
  expect(submission).toBeTruthy();

  const testcases = await db
    .select()
    .from(problemTestcases)
    .where(eq(problemTestcases.problemId, submission!.problemId));

  await pool.query("BEGIN");
  try {
    await pool.query(
      `
        INSERT INTO submission_testcase_results
          (submission_id, testcase_id, verdict, runtime_ms, memory_kb, actual_output)
        SELECT $1, pt.id, $2::testcase_verdict_type, 12, 1024,
               CASE WHEN pt.is_public THEN pt.expected_output ELSE NULL END
        FROM problem_testcases pt
        WHERE pt.problem_id = $3
          AND ($4::BOOLEAN = FALSE OR pt.is_public = TRUE)
      `,
      [submissionId, verdict, submission!.problemId, type === "simple"]
    );
    await pool.query(
      `
        UPDATE submissions
        SET status = 'done', verdict = $2, runtime_ms = 12, memory_kb = 1024, judged_at = NOW()
        WHERE id = $1
      `,
      [submissionId, verdict]
    );
    if (type === "formal") {
      await pool.query(
        `
          UPDATE exam_session_problems
          SET final_submission_id = $2,
              score = CASE WHEN $3 = 'AC' THEN score_weight ELSE 0 END,
              updated_at = NOW()
          WHERE id = $1
        `,
        [submission!.examSessionProblemId, submissionId, verdict]
      );
      await pool.query(
        `
          UPDATE exam_sessions
          SET total_score = (
            SELECT COALESCE(SUM(score), 0)
            FROM exam_session_problems
            WHERE exam_session_id = $1
          )
          WHERE id = $1
        `,
        [submission!.examSessionId]
      );
    }
    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }

  expect(testcases.length).toBeGreaterThan(0);
}

describe("Submission API async judge", () => {
  it("creates pending submissions, persists submissionType, and publishes judge tasks", async () => {
    // 1. 建立並開始考試場次
    const { sessionId, espIds } = await createSession(aliceToken, davidId);

    const startRes = await startSession(sessionId);
    console.log("startSession Response Status/Body:", startRes);

    // 2. 進行第一次提交（正式提交 - formal）
    const formal = await submitCode(sessionId, espIds[0]!);

    // 3. 進行第二次提交（範例/簡易測試 - simple）
    const simple = await submitCode(sessionId, espIds[0]!, "simple");

    expect(formal.submissionType).toBe("formal");
    expect(simple.submissionType).toBe("simple");
    expect(publishJudgeTaskMock).toHaveBeenNthCalledWith(1, {
      submissionId: formal.id,
      type: "formal",
    });
    expect(publishJudgeTaskMock).toHaveBeenNthCalledWith(2, {
      submissionId: simple.id,
      type: "simple",
    });

    // 4. 直接撈取資料庫實體表，看寫入的欄位現況
    const rows = await db
      .select({ id: submissions.id, submissionType: submissions.submissionType })
      .from(submissions);
      
    expect(rows.map((row) => [row.id, row.submissionType])).toEqual([
      [formal.id, "formal"],
      [simple.id, "simple"],
    ]);
  });

  it("GET list/detail/result does not lazily advance pending submissions", async () => {
    const { sessionId, espIds } = await createSession(aliceToken, davidId);
    await startSession(sessionId);
    const { id } = await submitCode(sessionId, espIds[0]!, "formal");

    for (const url of [
      `/api/exam-sessions/${sessionId}/submissions`,
      `/api/exam-sessions/${sessionId}/submissions/${id}`,
      `/api/exam-sessions/${sessionId}/result`,
    ]) {
      const res = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${candToken}` },
      });
      expect(res.statusCode).toBe(200);
    }

    const [row] = await db
      .select({ status: submissions.status, verdict: submissions.verdict })
      .from(submissions)
      .where(eq(submissions.id, id));
    expect(row).toEqual({ status: "pending", verdict: null });
  });

  it("simple AC exposes only public testcase output and does not update score", async () => {
    const { sessionId, espIds } = await createSession(aliceToken, davidId);
    await startSession(sessionId);
    const { id } = await submitCode(sessionId, espIds[0]!, "simple");
    await writeWorkerResult(id, "AC", "simple");

    const detail = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/submissions/${id}`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    const body = detail.json<{ score: number; testcaseResults: { isPublic: boolean; actualOutput?: string }[] }>();
    expect(body.score).toBe(0);
    expect(body.testcaseResults).toHaveLength(1);
    expect(body.testcaseResults[0]).toMatchObject({ isPublic: true, actualOutput: "3" });

    const result = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/result`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(result.json<{ totalScore: number }>().totalScore).toBe(0);
  });

  it("formal AC updates final submission and score without exposing hidden actualOutput", async () => {
    const { sessionId, espIds } = await createSession(aliceToken, davidId);
    await startSession(sessionId);
    const { id } = await submitCode(sessionId, espIds[0]!, "formal");
    await writeWorkerResult(id, "AC", "formal");

    // 1. 查詢單一提交的詳細報告（包含測資結果）
    const detail = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/submissions/${id}`,
      headers: { authorization: `Bearer ${candToken}` },
    });

    // 📡 偵錯點 A：確認提交詳細報告的格式，觀察分數、isFinalSubmission 欄位以及 testcaseResults 陣列
    console.log("=== 🔍 [DEBUG A] GET /submissions/:id (Submission Report) ===");
    console.log("Status:", detail.statusCode);
    console.log("Body:", JSON.stringify(detail.json(), null, 2));

    const body = detail.json<{
      score: number;
      isFinalSubmission: boolean;
      testcaseResults: { isPublic: boolean; actualOutput?: string }[];
    }>();

    expect(detail.statusCode).toBe(200);
    expect(body.score).toBe(30);
    expect(body.isFinalSubmission).toBe(true);
    expect(body.testcaseResults).toHaveLength(2);
    expect(body.testcaseResults.find((tc) => tc.isPublic)).toHaveProperty("actualOutput", "3");
    expect(body.testcaseResults.find((tc) => !tc.isPublic)).not.toHaveProperty("actualOutput");

    // 2. 查詢該場考試的最終分數/結果
    const result = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/result`,
      headers: { authorization: `Bearer ${candToken}` },
    });

    // 📡 偵錯點 B：確認獲取考試總分 API 的回應，檢查 totalScore 是否正確加總
    console.log("=== 🔍 [DEBUG B] GET /exam-sessions/:id/result ===");
    console.log("Status:", result.statusCode);
    console.log("Body:", JSON.stringify(result.json(), null, 2));
    console.log("====================================================");

    expect(result.statusCode).toBe(200);
    expect(result.json<{ totalScore: number }>().totalScore).toBe(30);
  });

  it("latest formal submission decides final score, including non-AC after AC", async () => {
    const { sessionId, espIds } = await createSession(aliceToken, davidId);
    await startSession(sessionId);
    const first = await submitCode(sessionId, espIds[0]!, "formal");
    await writeWorkerResult(first.id, "AC", "formal");
    const second = await submitCode(sessionId, espIds[0]!, "formal");
    await writeWorkerResult(second.id, "WA", "formal");

    const firstDetail = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/submissions/${first.id}`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(firstDetail.json<{ isFinalSubmission: boolean; score: number }>())
      .toMatchObject({ isFinalSubmission: false, score: 0 });

    const secondDetail = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/submissions/${second.id}`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(secondDetail.json<{ isFinalSubmission: boolean; score: number }>())
      .toMatchObject({ isFinalSubmission: true, score: 0 });

    const result = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/result`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(result.json<{ totalScore: number; problems: { latestStatus: string }[] }>())
      .toMatchObject({ totalScore: 0, problems: [expect.objectContaining({ latestStatus: "WA" })] });
  });

  it("builds WebSocket result payloads and ACKs malformed result messages", async () => {
    const { sessionId, espIds } = await createSession(aliceToken, davidId);
    await startSession(sessionId);
    const { id } = await submitCode(sessionId, espIds[0]!, "formal");
    await writeWorkerResult(id, "AC", "formal");

    const payload = await buildJudgeResultPayload(id);
    expect(payload).toMatchObject({
      type: "judge_result",
      submissionId: id,
      sessionId,
      verdict: "AC",
      submissionType: "formal",
      score: 30,
    });
    expect(payload!.testcaseResults.find((tc) => !tc.isPublic)).not.toHaveProperty("actualOutput");

    const ack = vi.fn();
    await handleJudgeResultMessage(
      { ack },
      { content: Buffer.from("{bad json") } as never
    );
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("publishes pending immediately and streams worker status events to the same session", async () => {
    const { sessionId, espIds } = await createSession(aliceToken, davidId);
    await startSession(sessionId);
    const sent: string[] = [];
    subscribeToSession(sessionId, {
      readyState: 1,
      send: (data) => sent.push(data),
      close: vi.fn(),
      on: vi.fn(),
    });

    const { id } = await submitCode(sessionId, espIds[0]!, "formal");
    expect(JSON.parse(sent[0]!)).toMatchObject({
      type: "submission_status",
      submissionId: id,
      sessionId,
      status: "pending",
    });

    await db
      .update(submissions)
      .set({ status: "judging" })
      .where(eq(submissions.id, id));

    const payload = await buildSubmissionStatusPayload(id);
    expect(payload).toMatchObject({
      type: "submission_status",
      submissionId: id,
      sessionId,
      status: "judging",
    });

    const ack = vi.fn();
    await handleJudgeResultMessage(
      { ack },
      { content: Buffer.from(JSON.stringify({ submissionId: id, eventType: "status" })) } as never
    );

    expect(ack).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sent.at(-1)!)).toMatchObject({
      type: "submission_status",
      submissionId: id,
      sessionId,
      status: "judging",
    });
  });
});

describe("Submission API permissions", () => {
  it("protects result and history by role and ownership", async () => {
    const { sessionId } = await createSession(aliceToken, davidId);
    const { sessionId: eveSessionId } = await createSession(aliceToken, eveId);
    const { sessionId: bobSessionId } = await createSession(bobToken, frankId);

    const noAuth = await app.inject({ method: "GET", url: `/api/exam-sessions/${sessionId}/result` });
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

  it("allows interviewer to inspect source but not submit, and forbids superuser submit", async () => {
    const { sessionId, espIds } = await createSession(aliceToken, davidId);
    await startSession(sessionId);
    const { id } = await submitCode(sessionId, espIds[0]!, "formal");
    await writeWorkerResult(id, "WA", "formal");

    const oldDetail = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/submissions/${id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(oldDetail.statusCode).toBe(200);
    expect(oldDetail.json<{ sourceCode: string; verdict: string }>().sourceCode).toContain("print");

    for (const token of [aliceToken, rootToken]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/exam-sessions/${sessionId}/submissions`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          examSessionProblemId: espIds[0],
          language: "python3",
          sourceCode: "not allowed",
        },
      });
      expect(res.statusCode).toBe(403);
    }
  });
});

describe("Submission API state guards", () => {
  it("rejects submissions before start, after cancel, after submitted, after expiry, and for another candidate", async () => {
    const { sessionId: notStartedId, espIds: notStartedEspIds } = await createSession(aliceToken, davidId);
    const notStarted = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${notStartedId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: { examSessionProblemId: notStartedEspIds[0], language: "python3", sourceCode: "too early" },
    });
    expect(notStarted.statusCode).toBe(409);

    const otherCandidate = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${notStartedId}/submissions`,
      headers: { authorization: `Bearer ${eveToken}` },
      payload: { examSessionProblemId: notStartedEspIds[0], language: "python3", sourceCode: "wrong owner" },
    });
    expect(otherCandidate.statusCode).toBe(403);

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
      payload: { examSessionProblemId: cancelledEspIds[0], language: "python3", sourceCode: "cancelled" },
    });
    expect(cancelled.statusCode).toBe(409);

    const { sessionId: submittedId, espIds: submittedEspIds } = await createSession(aliceToken, davidId);
    await db.update(examSessions).set({ status: "submitted" }).where(eq(examSessions.id, submittedId));
    const submitted = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${submittedId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: { examSessionProblemId: submittedEspIds[0], language: "python3", sourceCode: "after submit" },
    });
    expect(submitted.statusCode).toBe(409);

    const { sessionId: expiredId, espIds: expiredEspIds } = await createSession(aliceToken, davidId);
    await startSession(expiredId);
    await db.update(examSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(examSessions.id, expiredId));
    const expired = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${expiredId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: { examSessionProblemId: expiredEspIds[0], language: "python3", sourceCode: "too late" },
    });
    expect(expired.statusCode).toBe(409);
  });

  it("rejects invalid payloads, unsupported/disabled languages, and wrong session problem id", async () => {
    const { sessionId, espIds } = await createSession(aliceToken, davidId);
    const { sessionId: otherSessionId, espIds: otherEspIds } = await createSession(aliceToken, eveId);
    await startSession(sessionId);

    const invalidType = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: { examSessionProblemId: espIds[0], language: "python3", sourceCode: "", type: "practice" },
    });
    expect(invalidType.statusCode).toBe(400);

    const unsupportedLanguage = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: { examSessionProblemId: espIds[0], language: "ruby", sourceCode: "puts 1" },
    });
    expect(unsupportedLanguage.statusCode).toBe(400);

    await db.update(languageDefaults).set({ isEnabled: false }).where(eq(languageDefaults.language, "python3"));
    const disabledLanguage = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: { examSessionProblemId: espIds[0], language: "python3", sourceCode: "print(1)" },
    });
    expect(disabledLanguage.statusCode).toBe(400);
    await db.update(languageDefaults).set({ isEnabled: true }).where(eq(languageDefaults.language, "python3"));

    const wrongSessionProblem = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/submissions`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: { examSessionProblemId: otherEspIds[0], language: "python3", sourceCode: "print(1)" },
    });
    expect(wrongSessionProblem.statusCode).toBe(404);

    expect(otherSessionId).toBeDefined();
  });

  it("invalid submission route ids → 400 and missing submission → 404", async () => {
    const { sessionId } = await createSession(aliceToken, davidId);

    const invalid = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/submissions/nope`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/submissions/999999`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(missing.statusCode).toBe(404);
  });
});
