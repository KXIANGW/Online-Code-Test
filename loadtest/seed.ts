/**
 * loadtest/seed.ts
 *
 * Bootstraps the data needed by k6-submit.js for the 100-concurrent
 * demo. Pre-conditions:
 *   - docker compose stack is up (postgres / rabbitmq / redis / backend)
 *   - seed scenario data (10-scenarios.sql) has been applied — gives us
 *     `root`, `alice` (interviewer), and at least one published problem.
 *
 * What it does:
 *   1) alice logs in -> batch-creates N candidate accounts.
 *   2) alice creates one in_progress exam session per candidate, all
 *      bound to the same problem (configurable via $SEED_PROBLEM_ID,
 *      default 1).
 *   3) Each candidate logs in -> POST /:id/start.
 *   4) Writes loadtest/.session-tokens.json:
 *        [{ token, sessionId, examSessionProblemId, candidateUsername }]
 *
 * Run with:
 *   cd loadtest
 *   npx tsx seed.ts        # default N=100
 *   N=50 npx tsx seed.ts
 */
import fs from "node:fs/promises";
import path from "node:path";

type Json = Record<string, unknown>;

const BASE_URL = process.env["BASE_URL"] ?? "http://localhost:3000/api";
const ALICE_USERNAME = process.env["INTERVIEWER_USERNAME"] ?? "alice";
const ALICE_PASSWORD = process.env["INTERVIEWER_PASSWORD"] ?? "Test@1234";
const PROBLEM_ID = Number(process.env["SEED_PROBLEM_ID"] ?? 1);
const DURATION_MINUTES = Number(process.env["SEED_DURATION_MINUTES"] ?? 120);
const COUNT = Number(process.env["N"] ?? 100);
const OUT_PATH = path.resolve(__dirname, ".session-tokens.json");

async function http<T = Json>(
  method: string,
  pathSuffix: string,
  body?: Json,
  token?: string
): Promise<T> {
  const url = `${BASE_URL}${pathSuffix}`;
  const headers: Record<string, string> = {};
  // Only set Content-Type when actually sending a body; Fastify rejects
  // POST application/json with no body otherwise (FST_ERR_CTP_EMPTY_JSON_BODY).
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${method} ${pathSuffix} -> ${text}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function login(username: string, password: string): Promise<string> {
  const out = await http<{ token: string }>("POST", "/auth/login", { username, password });
  return out.token;
}

interface BatchCandidate {
  username: string;
  password: string;
}

async function batchCreateCandidates(token: string, count: number): Promise<BatchCandidate[]> {
  return http<BatchCandidate[]>("POST", "/users/batch", { count }, token);
}

interface CandidateLookup {
  id: number;
  username: string;
}

async function listUsers(token: string): Promise<CandidateLookup[]> {
  const rows = await http<CandidateLookup[]>("GET", "/users", undefined, token);
  return rows;
}

interface SessionCreated {
  id: number;
}

async function createSession(
  token: string,
  candidateId: number
): Promise<SessionCreated> {
  return http<SessionCreated>("POST", "/exam-sessions", {
    candidateId,
    durationMinutes: DURATION_MINUTES,
    problems: [{ problemId: PROBLEM_ID, scoreWeight: 100, orderIndex: 1 }],
  }, token);
}

interface SessionProblem {
  id: number;
  problemId: number;
}

async function startSessionAndGetEsp(
  token: string,
  sessionId: number
): Promise<number> {
  await http("POST", `/exam-sessions/${sessionId}/start`, undefined, token);
  const problems = await http<SessionProblem[]>(
    "GET",
    `/exam-sessions/${sessionId}/problems`,
    undefined,
    token
  );
  const match = problems.find((p) => p.problemId === PROBLEM_ID);
  if (!match) throw new Error(`exam_session_problem not found for problem ${PROBLEM_ID}`);
  return match.id;
}

async function main(): Promise<void> {
  console.log(`[seed] BASE_URL=${BASE_URL} count=${COUNT} problemId=${PROBLEM_ID}`);

  const aliceToken = await login(ALICE_USERNAME, ALICE_PASSWORD);
  console.log(`[seed] interviewer logged in as ${ALICE_USERNAME}`);

  const candidates = await batchCreateCandidates(aliceToken, COUNT);
  console.log(`[seed] batch-created ${candidates.length} candidates`);

  const userIndex = await listUsers(aliceToken);
  const byUsername = new Map(userIndex.map((u) => [u.username, u.id]));

  type Row = {
    token: string;
    sessionId: number;
    examSessionProblemId: number;
    candidateUsername: string;
  };
  const out: Row[] = [];

  for (const [i, c] of candidates.entries()) {
    const candidateId = byUsername.get(c.username);
    if (!candidateId) throw new Error(`Candidate ${c.username} not in users list`);

    const session = await createSession(aliceToken, candidateId);
    const candidateToken = await login(c.username, c.password);
    const espId = await startSessionAndGetEsp(candidateToken, session.id);
    out.push({
      token: candidateToken,
      sessionId: session.id,
      examSessionProblemId: espId,
      candidateUsername: c.username,
    });

    if ((i + 1) % 10 === 0 || i + 1 === candidates.length) {
      console.log(`[seed] ${i + 1}/${candidates.length} sessions ready`);
    }
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log(`[seed] wrote ${out.length} session tokens to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
