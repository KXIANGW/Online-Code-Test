import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { pool } from "./client";
import {
  getSubmissionById,
  getTestcases,
  markSubmissionSystemError,
  updateSubmissionJudging,
  writeJudgeResults,
} from "./queries";

let candidateId: number;
let setterId: number;
let sessionId: number;
let espId: number;
let problemId: number;
let publicTcId: number;
let hiddenTcId: number;
let submissionId: number;

beforeEach(async () => {
  await pool.query(`
    TRUNCATE submission_testcase_results, submissions,
             exam_session_problems, exam_sessions,
             problem_testcases, problems,
             user_roles, users
    RESTART IDENTITY CASCADE
  `);

  await pool.query(`
    INSERT INTO language_defaults (language, display_name, time_multiplier, memory_multiplier, is_enabled)
    VALUES
      ('cpp17', 'C++17', 1.0, 1.0, TRUE),
      ('python3', 'Python 3', 3.0, 2.0, TRUE)
    ON CONFLICT (language) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      time_multiplier = EXCLUDED.time_multiplier,
      memory_multiplier = EXCLUDED.memory_multiplier,
      is_enabled = EXCLUDED.is_enabled
  `);

  const users = await pool.query<{ id: string; username: string }>(`
    INSERT INTO users (username, password_hash, display_name)
    VALUES
      ('candidate1', 'hash', 'Candidate'),
      ('setter1', 'hash', 'Setter')
    RETURNING id, username
  `);
  candidateId = Number(users.rows.find((u) => u.username === "candidate1")!.id);
  setterId = Number(users.rows.find((u) => u.username === "setter1")!.id);

  const problem = await pool.query<{ id: string }>(
    `
      INSERT INTO problems
        (title, description_md, difficulty, time_limit_ms, memory_limit_mb, output_limit_kb, created_by)
      VALUES ('Sum', 'desc', 'easy', 1000, 128, 8, $1)
      RETURNING id
    `,
    [setterId]
  );
  problemId = Number(problem.rows[0]!.id);

  await pool.query(
    `
      INSERT INTO problem_language_limits
        (problem_id, language, time_multiplier, memory_multiplier)
      VALUES ($1, 'python3', 2.5, 1.5)
    `,
    [problemId]
  );

  const testcases = await pool.query<{ id: string; is_public: boolean }>(
    `
      INSERT INTO problem_testcases
        (problem_id, order_index, is_public, input_data, expected_output)
      VALUES
        ($1, 2, FALSE, '40 2', '42'),
        ($1, 1, TRUE, '1 2', '3')
      RETURNING id, is_public
    `,
    [problemId]
  );
  publicTcId = Number(testcases.rows.find((tc) => tc.is_public)!.id);
  hiddenTcId = Number(testcases.rows.find((tc) => !tc.is_public)!.id);

  const session = await pool.query<{ id: string }>(
    `
      INSERT INTO exam_sessions (candidate_id, created_by, status, duration_minutes, max_score)
      VALUES ($1, $2, 'in_progress', 60, 30)
      RETURNING id
    `,
    [candidateId, setterId]
  );
  sessionId = Number(session.rows[0]!.id);

  const esp = await pool.query<{ id: string }>(
    `
      INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight)
      VALUES ($1, $2, 1, 30)
      RETURNING id
    `,
    [sessionId, problemId]
  );
  espId = Number(esp.rows[0]!.id);

  submissionId = await insertSubmission("formal");
});

afterAll(async () => {
  await pool.end();
});

describe("worker DB queries", () => {
  it("loads submission data with language overrides and output limits", async () => {
    const submission = await getSubmissionById(submissionId);
    expect(submission).toMatchObject({
      id: submissionId,
      examSessionProblemId: espId,
      examSessionId: sessionId,
      candidateId,
      problemId,
      language: "python3",
      timeLimitMs: 2500,
      memoryLimitMb: 192,
      outputLimitKb: 8,
      scoreWeight: 30,
    });
  });

  it("returns public-only or all testcases in judge order", async () => {
    await expect(getTestcases(problemId, true)).resolves.toMatchObject([
      { id: publicTcId, orderIndex: 1, isPublic: true },
    ]);

    await expect(getTestcases(problemId, false)).resolves.toMatchObject([
      { id: publicTcId, orderIndex: 1 },
      { id: hiddenTcId, orderIndex: 2 },
    ]);
  });

  it("writes formal AC and non-AC results as the final score source", async () => {
    await writeJudgeResults({
      submissionId,
      examSessionProblemId: espId,
      examSessionId: sessionId,
      type: "formal",
      verdict: "AC",
      runtimeMs: 10,
      memoryKb: 1000,
      testcaseResults: [
        { testcaseId: publicTcId, verdict: "AC", runtimeMs: 4, memoryKb: 900, actualOutput: "3" },
        { testcaseId: hiddenTcId, verdict: "AC", runtimeMs: 6, memoryKb: 1000, actualOutput: null },
      ],
    });

    await expectScoreState(submissionId, 30, 30);

    const waSubmissionId = await insertSubmission("formal");
    await writeJudgeResults({
      submissionId: waSubmissionId,
      examSessionProblemId: espId,
      examSessionId: sessionId,
      type: "formal",
      verdict: "WA",
      runtimeMs: 7,
      memoryKb: 800,
      testcaseResults: [
        { testcaseId: publicTcId, verdict: "WA", runtimeMs: 7, memoryKb: 800, actualOutput: "4" },
        { testcaseId: hiddenTcId, verdict: "skipped", runtimeMs: null, memoryKb: null, actualOutput: null },
      ],
    });

    await expectScoreState(waSubmissionId, 0, 0);
  });

  it("does not let simple submissions affect score and stores CE without testcase rows", async () => {
    const simpleId = await insertSubmission("simple");
    await writeJudgeResults({
      submissionId: simpleId,
      examSessionProblemId: espId,
      examSessionId: sessionId,
      type: "simple",
      verdict: "AC",
      runtimeMs: 3,
      memoryKb: 700,
      testcaseResults: [
        { testcaseId: publicTcId, verdict: "AC", runtimeMs: 3, memoryKb: 700, actualOutput: "3" },
      ],
    });
    await expectScoreState(null, 0, 0);

    const ceId = await insertSubmission("formal");
    await writeJudgeResults({
      submissionId: ceId,
      examSessionProblemId: espId,
      examSessionId: sessionId,
      type: "formal",
      verdict: "CE",
      runtimeMs: 0,
      memoryKb: null,
      testcaseResults: [],
    });

    const resultRows = await pool.query("SELECT 1 FROM submission_testcase_results WHERE submission_id = $1", [ceId]);
    expect(resultRows.rowCount).toBe(0);
    await expectScoreState(ceId, 0, 0);
  });

  it("updates judging and system_error states", async () => {
    await updateSubmissionJudging(submissionId);
    await expectSubmissionState(submissionId, "judging", null);

    await markSubmissionSystemError(submissionId);
    await expectSubmissionState(submissionId, "system_error", null);
  });
});

async function insertSubmission(type: "simple" | "formal"): Promise<number> {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO submissions
        (exam_session_problem_id, candidate_id, language, source_code, submission_type, status)
      VALUES ($1, $2, 'python3', 'print(1)', $3, 'pending')
      RETURNING id
    `,
    [espId, candidateId, type]
  );
  return Number(result.rows[0]!.id);
}

async function expectScoreState(
  finalSubmissionId: number | null,
  problemScore: number,
  totalScore: number
): Promise<void> {
  const state = await pool.query<{
    final_submission_id: string | null;
    score: number;
    total_score: number;
  }>(
    `
      SELECT esp.final_submission_id, esp.score, es.total_score
      FROM exam_session_problems esp
      JOIN exam_sessions es ON es.id = esp.exam_session_id
      WHERE esp.id = $1
    `,
    [espId]
  );

  expect(state.rows[0]).toMatchObject({
    final_submission_id: finalSubmissionId === null ? null : String(finalSubmissionId),
    score: problemScore,
    total_score: totalScore,
  });
}

async function expectSubmissionState(
  id: number,
  status: string,
  verdict: string | null
): Promise<void> {
  const state = await pool.query<{ status: string; verdict: string | null }>(
    "SELECT status, verdict FROM submissions WHERE id = $1",
    [id]
  );
  expect(state.rows[0]).toEqual({ status, verdict });
}
