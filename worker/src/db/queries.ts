import type { PoolClient } from "pg";
import { pool } from "./client";

export type SubmissionType = "simple" | "formal";
export type Verdict = "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE";
export type TestcaseVerdict = Verdict | "skipped";

export interface SubmissionForJudge {
  id: number;
  examSessionProblemId: number;
  examSessionId: number;
  candidateId: number;
  problemId: number;
  language: "python3" | "cpp17";
  sourceCode: string;
  submissionType: SubmissionType;
  timeLimitMs: number;
  memoryLimitMb: number;
  outputLimitKb: number;
  scoreWeight: number;
}

export interface TestcaseForJudge {
  id: number;
  orderIndex: number;
  isPublic: boolean;
  inputData: string;
  expectedOutput: string;
}

export interface TestcaseResultForWrite {
  testcaseId: number;
  verdict: TestcaseVerdict;
  runtimeMs: number | null;
  memoryKb: number | null;
  actualOutput: string | null;
}

export interface JudgeWriteInput {
  submissionId: number;
  examSessionProblemId: number;
  examSessionId: number;
  type: SubmissionType;
  verdict: Verdict;
  runtimeMs: number | null;
  memoryKb: number | null;
  testcaseResults: TestcaseResultForWrite[];
}

export async function getSubmissionById(id: number): Promise<SubmissionForJudge | null> {
  const result = await pool.query<{
    id: string;
    exam_session_problem_id: string;
    exam_session_id: string;
    candidate_id: string;
    problem_id: string;
    language: string;
    source_code: string;
    submission_type: SubmissionType;
    time_limit_ms: number;
    memory_limit_mb: number;
    output_limit_kb: number;
    score_weight: number;
  }>(
    `
      SELECT
        s.id,
        s.exam_session_problem_id,
        esp.exam_session_id,
        s.candidate_id,
        esp.problem_id,
        s.language,
        s.source_code,
        s.submission_type,
        CEIL(p.time_limit_ms * COALESCE(pll.time_multiplier, ld.time_multiplier))::INT AS time_limit_ms,
        CEIL(p.memory_limit_mb * COALESCE(pll.memory_multiplier, ld.memory_multiplier))::INT AS memory_limit_mb,
        p.output_limit_kb,
        esp.score_weight
      FROM submissions s
      JOIN exam_session_problems esp ON esp.id = s.exam_session_problem_id
      JOIN problems p ON p.id = esp.problem_id
      JOIN language_defaults ld ON ld.language = s.language
      LEFT JOIN problem_language_limits pll
        ON pll.problem_id = p.id AND pll.language = s.language
      WHERE s.id = $1
    `,
    [id]
  );

  const row = result.rows[0];
  if (!row) return null;
  if (row.language !== "python3" && row.language !== "cpp17") {
    throw new Error(`Unsupported language: ${row.language}`);
  }

  return {
    id: Number(row.id),
    examSessionProblemId: Number(row.exam_session_problem_id),
    examSessionId: Number(row.exam_session_id),
    candidateId: Number(row.candidate_id),
    problemId: Number(row.problem_id),
    language: row.language,
    sourceCode: row.source_code,
    submissionType: row.submission_type,
    timeLimitMs: row.time_limit_ms,
    memoryLimitMb: row.memory_limit_mb,
    outputLimitKb: row.output_limit_kb,
    scoreWeight: row.score_weight,
  };
}

export async function getTestcases(
  problemId: number,
  publicOnly: boolean
): Promise<TestcaseForJudge[]> {
  const result = await pool.query<{
    id: string;
    order_index: number;
    is_public: boolean;
    input_data: string;
    expected_output: string;
  }>(
    `
      SELECT id, order_index, is_public, input_data, expected_output
      FROM problem_testcases
      WHERE problem_id = $1
        AND ($2::BOOLEAN = FALSE OR is_public = TRUE)
      ORDER BY order_index ASC, id ASC
    `,
    [problemId, publicOnly]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    orderIndex: row.order_index,
    isPublic: row.is_public,
    inputData: row.input_data,
    expectedOutput: row.expected_output,
  }));
}

export async function updateSubmissionJudging(id: number): Promise<void> {
  await pool.query(
    `
      UPDATE submissions
      SET status = 'judging'
      WHERE id = $1
    `,
    [id]
  );
}

export async function writeJudgeResults(input: JudgeWriteInput): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM submission_testcase_results WHERE submission_id = $1", [
      input.submissionId,
    ]);

    await insertTestcaseResults(client, input.submissionId, input.testcaseResults);

    await client.query(
      `
        UPDATE submissions
        SET status = 'done',
            verdict = $2,
            runtime_ms = $3,
            memory_kb = $4,
            judged_at = NOW()
        WHERE id = $1
      `,
      [input.submissionId, input.verdict, input.runtimeMs, input.memoryKb]
    );

    if (input.type === "formal") {
      await client.query(
        `
          UPDATE exam_session_problems
          SET final_submission_id = $2,
              score = CASE WHEN $3 = 'AC' THEN score_weight ELSE 0 END,
              updated_at = NOW()
          WHERE id = $1
        `,
        [input.examSessionProblemId, input.submissionId, input.verdict]
      );

      await client.query(
        `
          UPDATE exam_sessions
          SET total_score = (
                SELECT COALESCE(SUM(score), 0)
                FROM exam_session_problems
                WHERE exam_session_id = $1
              ),
              updated_at = NOW()
          WHERE id = $1
        `,
        [input.examSessionId]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function markSubmissionSystemError(id: number): Promise<void> {
  await pool.query(
    `
      UPDATE submissions
      SET status = 'system_error',
          verdict = NULL,
          runtime_ms = NULL,
          memory_kb = NULL,
          judged_at = NOW()
      WHERE id = $1
    `,
    [id]
  );
}

async function insertTestcaseResults(
  client: PoolClient,
  submissionId: number,
  results: TestcaseResultForWrite[]
): Promise<void> {
  for (const result of results) {
    await client.query(
      `
        INSERT INTO submission_testcase_results
          (submission_id, testcase_id, verdict, runtime_ms, memory_kb, actual_output)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        submissionId,
        result.testcaseId,
        result.verdict,
        result.runtimeMs,
        result.memoryKb,
        result.actualOutput,
      ]
    );
  }
}
