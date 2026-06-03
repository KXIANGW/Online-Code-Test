/**
 * loadtest/seed-start.ts
 *
 * Bootstraps the data needed by k6-start.js: creates N candidate sessions in
 * `not_started` state (template assigned, candidate logged in, but /start NOT
 * called yet). This models the "all candidates arrive at once" thundering-herd
 * scenario.
 *
 * Pre-conditions: same as seed.ts (docker compose stack up, 10-scenarios.sql applied).
 *
 * What it does:
 *   1) alice logs in -> batch-creates N candidate accounts.
 *   2) alice creates one exam template and assigns it to all candidates.
 *   3) Each candidate logs in (token captured), session stays `not_started`.
 *   4) Writes loadtest/.start-tokens.json:
 *        [{ token, sessionId, candidateUsername }]
 *
 * Run with:
 *   cd loadtest
 *   npx tsx seed-start.ts        # default N=100
 *   N=50 npx tsx seed-start.ts
 *
 * NOTE: Sessions are consumed on the first k6-start.js run (state transitions
 * to in_progress). Re-run this script to generate a fresh batch.
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
const OUT_PATH = path.resolve(__dirname, ".start-tokens.json");

async function httpRequest<T = Json>(
  method: string,
  pathSuffix: string,
  body?: Json,
  token?: string
): Promise<T> {
  const url = `${BASE_URL}${pathSuffix}`;
  const headers: Record<string, string> = {};
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
  const out = await httpRequest<{ token: string }>("POST", "/auth/login", { username, password });
  return out.token;
}

interface BatchCandidate {
  username: string;
  password: string;
}

async function batchCreateCandidates(token: string, count: number): Promise<BatchCandidate[]> {
  return httpRequest<BatchCandidate[]>("POST", "/users/batch", { count }, token);
}

interface CandidateLookup {
  id: number;
  username: string;
}

async function listUsers(token: string): Promise<CandidateLookup[]> {
  return httpRequest<CandidateLookup[]>("GET", "/users", undefined, token);
}

interface TemplateCreated {
  id: number;
}

interface SessionCreated {
  id: number;
  candidateId: number;
}

async function createTemplate(token: string): Promise<TemplateCreated> {
  return httpRequest<TemplateCreated>("POST", "/exam-sessions/templates/manual", {
    title: `Load Test Start ${Date.now()}`,
    durationMinutes: DURATION_MINUTES,
    problems: [{ problemId: PROBLEM_ID, scoreWeight: 100, orderIndex: 1 }],
  }, token);
}

async function assignTemplate(
  token: string,
  templateId: number,
  candidateIds: number[]
): Promise<SessionCreated[]> {
  return httpRequest<SessionCreated[]>(
    "POST",
    `/exam-sessions/templates/${templateId}/assign`,
    { candidateIds },
    token
  );
}

async function main(): Promise<void> {
  console.log(`[seed-start] BASE_URL=${BASE_URL} count=${COUNT} problemId=${PROBLEM_ID}`);

  const aliceToken = await login(ALICE_USERNAME, ALICE_PASSWORD);
  console.log(`[seed-start] interviewer logged in as ${ALICE_USERNAME}`);

  const candidates = await batchCreateCandidates(aliceToken, COUNT);
  console.log(`[seed-start] batch-created ${candidates.length} candidates`);

  const userIndex = await listUsers(aliceToken);
  const byUsername = new Map(userIndex.map((u) => [u.username, u.id]));

  const template = await createTemplate(aliceToken);
  console.log(`[seed-start] created exam template id=${template.id}`);

  const candidateIds = candidates.map((c) => {
    const id = byUsername.get(c.username);
    if (!id) throw new Error(`Candidate ${c.username} not in users list`);
    return id;
  });
  const sessions = await assignTemplate(aliceToken, template.id, candidateIds);
  const sessionByCandidateId = new Map(sessions.map((s) => [s.candidateId, s.id]));
  console.log(`[seed-start] assigned template to ${sessions.length} candidates`);

  type Row = {
    token: string;
    sessionId: number;
    candidateUsername: string;
  };
  const out: Row[] = [];

  for (const [i, c] of candidates.entries()) {
    const candidateId = byUsername.get(c.username)!;
    const sessionId = sessionByCandidateId.get(candidateId);
    if (!sessionId) throw new Error(`No session found for candidate ${c.username}`);

    const candidateToken = await login(c.username, c.password);
    out.push({ token: candidateToken, sessionId, candidateUsername: c.username });

    if ((i + 1) % 10 === 0 || i + 1 === candidates.length) {
      console.log(`[seed-start] ${i + 1}/${candidates.length} tokens ready`);
    }
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log(`[seed-start] wrote ${out.length} start tokens to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("[seed-start] failed:", err);
  process.exit(1);
});
