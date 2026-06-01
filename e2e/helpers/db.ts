import { Pool } from "pg";

const PG_PORT = process.env["HOST_POSTGRES_PORT"] ?? "5432";
export const pool = new Pool({
  connectionString:
    process.env["E2E_DATABASE_URL"] ??
    `postgres://oct:oct_dev_password_change_me@localhost:${PG_PORT}/oct`,
  max: 5,
});

export interface SubmissionRow {
  id: number;
  status: "pending" | "judging" | "done" | "system_error";
  verdict: "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | null;
}

export async function querySubmission(id: number): Promise<SubmissionRow> {
  const result = await pool.query<SubmissionRow>(
    `SELECT id, status, verdict FROM submissions WHERE id = $1`,
    [id],
  );
  if (!result.rows[0]) throw new Error(`Submission ${id} not found`);
  return result.rows[0];
}

export async function querySessionScore(sessionId: number): Promise<number> {
  const result = await pool.query<{ total_score: number }>(
    `SELECT total_score FROM exam_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!result.rows[0]) throw new Error(`Session ${sessionId} not found`);
  return result.rows[0].total_score;
}
