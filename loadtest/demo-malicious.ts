/**
 * loadtest/demo-malicious.ts
 *
 * Demo A 驅動腳本：證明「惡意 / 濫用程式碼被沙箱隔離，不影響系統」。
 *
 * 流程：
 *   1) 以 interviewer 身分登入（生產環境用 root；superuser 可建帳號/考場）。
 *   2) batch 建立 1 個 candidate，並『立刻』把 {id, username} 寫進
 *      loadtest/.demo-accounts.json（清理用的 manifest，先寫再做事，
 *      確保即使後續中斷也能清乾淨）。
 *   3) 建立 exam template、指派、以 candidate 身分 start。
 *   4) 逐一提交 fixtures/malicious/*.py，輪詢判題結果，印出 verdict。
 *      （superuser 不能交題，所以一定要用 candidate token 提交。）
 *
 * 重點：每支惡意程式都會回 TLE/MLE/RE/WA 等「被控制」的 verdict，
 *       而不是 AC，也不會讓系統 5xx。搭配 Grafana「API RED」板觀察
 *       backend 在提交期間維持健康，即為佐證。
 *
 * 執行（本地 docker-compose）：
 *   cd loadtest && npx tsx demo-malicious.ts
 *
 * 執行（生產環境）：
 *   cd loadtest && \
 *   BASE_URL=https://ikmlab.cs.nthu.edu.tw/online_code_test/api \
 *   INTERVIEWER_USERNAME=root INTERVIEWER_PASSWORD='Root@1234' \
 *   npx tsx demo-malicious.ts
 *
 * 清理（務必執行）：見 demo-cleanup.ts。
 */
import fs from "node:fs/promises";
import path from "node:path";

type Json = Record<string, unknown>;

const BASE_URL = process.env["BASE_URL"] ?? "http://localhost:3000/api";
const INTERVIEWER_USERNAME = process.env["INTERVIEWER_USERNAME"] ?? "alice";
const INTERVIEWER_PASSWORD = process.env["INTERVIEWER_PASSWORD"] ?? "Test@1234";
const PROBLEM_ID = Number(process.env["SEED_PROBLEM_ID"] ?? 1);
const LANGUAGE = process.env["DEMO_LANGUAGE"] ?? "python3";
const POLL_TIMEOUT_MS = Number(process.env["POLL_TIMEOUT_MS"] ?? 30_000);
const FIXTURE_DIR = path.resolve(__dirname, "fixtures", "malicious");
const MANIFEST_PATH = path.resolve(__dirname, ".demo-accounts.json");

async function http<T = Json>(
  method: string,
  pathSuffix: string,
  body?: Json,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${pathSuffix}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${pathSuffix} -> ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

const login = async (u: string, p: string) =>
  (await http<{ token: string }>("POST", "/auth/login", { username: u, password: p })).token;

interface ManifestEntry {
  id: number;
  username: string;
  createdAt: string;
  source: string;
}

/** Append created accounts to the cleanup manifest (merge by id, never overwrite). */
async function recordAccounts(entries: ManifestEntry[]): Promise<void> {
  let existing: ManifestEntry[] = [];
  try {
    existing = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
  } catch {
    /* first run — file absent */
  }
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of entries) byId.set(e.id, e);
  await fs.writeFile(MANIFEST_PATH, JSON.stringify([...byId.values()], null, 2), "utf8");
  console.log(`[demo-A] recorded ${entries.length} account(s) to ${MANIFEST_PATH}`);
}

async function main(): Promise<void> {
  console.log(`[demo-A] BASE_URL=${BASE_URL} problemId=${PROBLEM_ID} language=${LANGUAGE}`);

  const fixtureNames = (await fs.readdir(FIXTURE_DIR)).filter((f) => f.endsWith(".py")).sort();
  if (fixtureNames.length === 0) throw new Error(`no .py fixtures in ${FIXTURE_DIR}`);

  const interviewerToken = await login(INTERVIEWER_USERNAME, INTERVIEWER_PASSWORD);
  console.log(`[demo-A] interviewer logged in as ${INTERVIEWER_USERNAME}`);

  // 1) create exactly one candidate
  const [candidate] = await http<{ username: string; password: string }[]>(
    "POST",
    "/users/batch",
    { count: 1 },
    interviewerToken,
  );
  if (!candidate) throw new Error("batch create returned no candidate");

  // resolve id and record to manifest BEFORE doing anything else
  const users = await http<{ id: number; username: string }[]>("GET", "/users", undefined, interviewerToken);
  const candidateId = users.find((u) => u.username === candidate.username)?.id;
  if (!candidateId) throw new Error(`created candidate ${candidate.username} not found in /users`);
  await recordAccounts([
    { id: candidateId, username: candidate.username, createdAt: new Date().toISOString(), source: "demo-malicious" },
  ]);
  console.log(`[demo-A] candidate ready: ${candidate.username} (id=${candidateId})`);

  // 2) template -> assign -> start (as candidate)
  const template = await http<{ id: number }>(
    "POST",
    "/exam-sessions/templates/manual",
    {
      title: `Demo A Malicious ${Date.now()}`,
      durationMinutes: 120,
      problems: [{ problemId: PROBLEM_ID, scoreWeight: 100, orderIndex: 1 }],
    },
    interviewerToken,
  );
  const [session] = await http<{ id: number; candidateId: number }[]>(
    "POST",
    `/exam-sessions/templates/${template.id}/assign`,
    { candidateIds: [candidateId] },
    interviewerToken,
  );
  if (!session) throw new Error("assign returned no session");

  const candidateToken = await login(candidate.username, candidate.password);
  await http("POST", `/exam-sessions/${session.id}/start`, undefined, candidateToken);
  const problems = await http<{ id: number; problemId: number }[]>(
    "GET",
    `/exam-sessions/${session.id}/problems`,
    undefined,
    candidateToken,
  );
  const espId = problems.find((p) => p.problemId === PROBLEM_ID)?.id;
  if (!espId) throw new Error(`exam_session_problem not found for problem ${PROBLEM_ID}`);
  console.log(`[demo-A] session ${session.id} started (esp=${espId})\n`);

  // 3) submit each malicious fixture and poll for the verdict
  const results: { fixture: string; verdict: string; runtimeMs?: number; memoryKb?: number | null }[] = [];
  for (const name of fixtureNames) {
    const sourceCode = await fs.readFile(path.join(FIXTURE_DIR, name), "utf8");
    const created = await http<{ id: number }>(
      "POST",
      `/exam-sessions/${session.id}/submissions`,
      { examSessionProblemId: espId, language: LANGUAGE, sourceCode, type: "formal" },
      candidateToken,
    );

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let detail: { status: string; verdict: string | null; runtimeMs?: number; memoryKb?: number | null } | undefined;
    while (Date.now() < deadline) {
      detail = await http(
        "GET",
        `/exam-sessions/${session.id}/submissions/${created.id}`,
        undefined,
        candidateToken,
      );
      if (detail.status === "done") break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    const verdict = detail?.status === "done" ? (detail.verdict ?? "?") : `TIMEOUT(${detail?.status})`;
    results.push({ fixture: name, verdict, runtimeMs: detail?.runtimeMs, memoryKb: detail?.memoryKb });
    console.log(`[demo-A] ${name.padEnd(28)} -> ${verdict}`);
  }

  console.log("\n[demo-A] summary");
  console.table(results);
  console.log(
    "\n[demo-A] 期望：全部為 TLE/MLE/RE/WA（被控制），無 AC、無系統 5xx。" +
      "\n[demo-A] 清理：cd loadtest && npx tsx demo-cleanup.ts   （預設 dry-run，加 --confirm 才真的刪）",
  );
}

main().catch((err) => {
  console.error("[demo-A] failed:", err);
  process.exit(1);
});
