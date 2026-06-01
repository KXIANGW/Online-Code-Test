const API_BASE = (process.env["E2E_API_URL"] ?? "http://localhost:3000") + "/api";

async function apiSeed<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function loginToken(
  username: string,
  password: string,
): Promise<string> {
  const out = await apiSeed<{ token: string }>("POST", "/auth/login", {
    username,
    password,
  });
  return out.token;
}

export interface BrowserTestSession {
  candidateUsername: string;
  candidatePassword: string;
  sessionId: number;
  problemId: number;
}

export async function seedBrowserSession(
  suffix: string,
): Promise<BrowserTestSession> {
  const rootToken = await loginToken("root", "Root@1234");
  const aliceToken = await loginToken("alice", "Test@1234");

  const ps = await apiSeed<{ id: number; username: string }>(
    "POST",
    "/users",
    {
      username: `bps_${suffix}`,
      password: "E2e@1234",
      displayName: "Browser PS",
      roleNames: ["problem_setter"],
    },
    rootToken,
  );
  const psToken = await loginToken(ps.username, "E2e@1234");

  const cand = await apiSeed<{ id: number; username: string }>(
    "POST",
    "/users",
    {
      username: `bcand_${suffix}`,
      password: "E2e@1234",
      displayName: "Browser Cand",
      roleNames: ["candidate"],
    },
    aliceToken,
  );

  const problem = await apiSeed<{ id: number }>(
    "POST",
    "/problems",
    {
      title: "Browser Test Sum",
      descriptionMd: "Print the sum of two integers.",
      difficulty: "easy",
      timeLimitMs: 4000,
      memoryLimitMb: 128,
      outputLimitKb: 64,
      testcases: [
        { orderIndex: 1, isPublic: true, inputData: "1 2\n", expectedOutput: "3" },
        {
          orderIndex: 2,
          isPublic: false,
          inputData: "40 2\n",
          expectedOutput: "42",
        },
      ],
    },
    psToken,
  );

  const tmpl = await apiSeed<{ id: number }>(
    "POST",
    "/exam-sessions/templates/manual",
    {
      title: `Browser Exam ${suffix}`,
      durationMinutes: 15,
      problems: [
        { problemId: problem.id, scoreWeight: 100, orderIndex: 1 },
      ],
    },
    aliceToken,
  );
  const sessions = await apiSeed<{ id: number }[]>(
    "POST",
    `/exam-sessions/templates/${tmpl.id}/assign`,
    { candidateIds: [cand.id] },
    aliceToken,
  );

  return {
    candidateUsername: cand.username,
    candidatePassword: "E2e@1234",
    sessionId: sessions[0]!.id,
    problemId: problem.id,
  };
}
