import { describe, it, expect } from "vitest";
import { api, login } from "../helpers/api.js";
import { pool } from "../helpers/db.js";
import { waitForSubmissionsDone } from "../helpers/wait.js";
import {
  PYTHON_AC,
  PYTHON_WA,
  PYTHON_TLE,
  PYTHON_RE,
  PYTHON_CE,
  CPP_AC,
  CPP_CE,
  SUM_PROBLEM,
  TLE_PROBLEM,
} from "../helpers/fixtures.js";

interface SubmissionDetail {
  id: number;
  status: string;
  verdict: string | null;
  score: number;
  isFinalSubmission: boolean;
  testcaseResults: {
    isPublic: boolean;
    verdict: string;
    actualOutput?: string | null;
  }[];
}

async function buildStack(suffix: string, problem = SUM_PROBLEM) {
  const rootToken = await login("root", "Root@1234");
  const aliceToken = await login("alice", "Test@1234");

  const ps = await api<{ id: number; username: string }>(
    "POST",
    "/users",
    {
      username: `e2e_ps6_${suffix}`,
      password: "E2e@1234",
      displayName: "PS6",
      roleNames: ["problem_setter"],
    },
    rootToken,
    201,
  );
  const psToken = await login(ps.username, "E2e@1234");

  const cand = await api<{ id: number; username: string }>(
    "POST",
    "/users",
    {
      username: `e2e_cand6_${suffix}`,
      password: "E2e@1234",
      displayName: "Cand6",
      roleNames: ["candidate"],
    },
    aliceToken,
    201,
  );
  const candToken = await login(cand.username, "E2e@1234");

  const p = await api<{ id: number }>("POST", "/problems", problem, psToken, 201);

  const tmpl = await api<{ id: number }>(
    "POST",
    "/exam-sessions/templates/manual",
    {
      title: `E2E Verdict ${suffix}`,
      durationMinutes: 10,
      problems: [{ problemId: p.id, scoreWeight: 100, orderIndex: 1 }],
    },
    aliceToken,
    201,
  );
  const sessions = await api<{ id: number }[]>(
    "POST",
    `/exam-sessions/templates/${tmpl.id}/assign`,
    { candidateIds: [cand.id] },
    aliceToken,
    201,
  );
  const sessionId = sessions[0]!.id;

  await api(
    "POST",
    `/exam-sessions/${sessionId}/start`,
    undefined,
    candToken,
    200,
  );

  const sps = await api<{ id: number; problemId: number }[]>(
    "GET",
    `/exam-sessions/${sessionId}/problems`,
    undefined,
    candToken,
    200,
  );
  const espId = sps.find((sp) => sp.problemId === p.id)!.id;

  return { candToken, aliceToken, sessionId, espId };
}

async function submit(
  sessionId: number,
  espId: number,
  candToken: string,
  source: string,
  language = "python3",
) {
  return api<{ id: number }>(
    "POST",
    `/exam-sessions/${sessionId}/submissions`,
    {
      examSessionProblemId: espId,
      language,
      sourceCode: source,
      type: "formal",
    },
    candToken,
    202,
  );
}

const TS = Date.now().toString().slice(-8);

describe("Python judge verdicts", () => {
  it(
    "AC: correct Python solution gets verdict=AC and testcases pass",
    async () => {
      const { candToken, aliceToken, sessionId, espId } = await buildStack(
        `ac_${TS}`,
      );
      const sub = await submit(sessionId, espId, candToken, PYTHON_AC);
      await waitForSubmissionsDone(pool, [sub.id]);

      const detail = await api<SubmissionDetail>(
        "GET",
        `/exam-sessions/${sessionId}/submissions/${sub.id}`,
        undefined,
        aliceToken,
        200,
      );
      expect(detail.status).toBe("done");
      expect(detail.verdict).toBe("AC");
      expect(detail.score).toBe(100);
      expect(detail.testcaseResults).toHaveLength(2);
      expect(detail.testcaseResults.every((r) => r.verdict === "AC")).toBe(true);
    },
    120000,
  );

  it(
    "WA: wrong Python solution gets verdict=WA",
    async () => {
      const { candToken, aliceToken, sessionId, espId } = await buildStack(
        `wa_${TS}`,
      );
      const sub = await submit(sessionId, espId, candToken, PYTHON_WA);
      await waitForSubmissionsDone(pool, [sub.id]);

      const detail = await api<SubmissionDetail>(
        "GET",
        `/exam-sessions/${sessionId}/submissions/${sub.id}`,
        undefined,
        aliceToken,
        200,
      );
      expect(detail.verdict).toBe("WA");
      expect(detail.score).toBe(0);
      expect(detail.testcaseResults[0]!.verdict).toBe("WA");
    },
    120000,
  );

  it(
    "TLE: infinite loop gets verdict=TLE, later testcases skipped",
    async () => {
      const { candToken, aliceToken, sessionId, espId } = await buildStack(
        `tle_${TS}`,
        TLE_PROBLEM,
      );
      const sub = await submit(sessionId, espId, candToken, PYTHON_TLE);
      await waitForSubmissionsDone(pool, [sub.id]);

      const detail = await api<SubmissionDetail>(
        "GET",
        `/exam-sessions/${sessionId}/submissions/${sub.id}`,
        undefined,
        aliceToken,
        200,
      );
      expect(detail.verdict).toBe("TLE");
      expect(detail.testcaseResults[0]!.verdict).toBe("TLE");
      expect(detail.testcaseResults[1]!.verdict).toBe("skipped");
    },
    120000,
  );

  it(
    "RE: exception in code gets verdict=RE, later testcases skipped",
    async () => {
      const { candToken, aliceToken, sessionId, espId } = await buildStack(
        `re_${TS}`,
      );
      const sub = await submit(sessionId, espId, candToken, PYTHON_RE);
      await waitForSubmissionsDone(pool, [sub.id]);

      const detail = await api<SubmissionDetail>(
        "GET",
        `/exam-sessions/${sessionId}/submissions/${sub.id}`,
        undefined,
        aliceToken,
        200,
      );
      expect(detail.verdict).toBe("RE");
      expect(detail.testcaseResults[0]!.verdict).toBe("RE");
      expect(detail.testcaseResults[1]!.verdict).toBe("skipped");
    },
    120000,
  );

  it(
    "CE (Python): syntax error gets verdict=CE, no testcase results",
    async () => {
      const { candToken, aliceToken, sessionId, espId } = await buildStack(
        `ce_py_${TS}`,
      );
      const sub = await submit(sessionId, espId, candToken, PYTHON_CE);
      await waitForSubmissionsDone(pool, [sub.id]);

      const detail = await api<SubmissionDetail>(
        "GET",
        `/exam-sessions/${sessionId}/submissions/${sub.id}`,
        undefined,
        aliceToken,
        200,
      );
      expect(detail.verdict).toBe("CE");
      expect(detail.testcaseResults).toHaveLength(0);
      expect(detail.score).toBe(0);
    },
    120000,
  );
});

describe("C++ judge verdicts", () => {
  it(
    "AC: valid C++ sum solution gets verdict=AC",
    async () => {
      const { candToken, aliceToken, sessionId, espId } = await buildStack(
        `cpp_ac_${TS}`,
      );
      const sub = await submit(sessionId, espId, candToken, CPP_AC, "cpp17");
      await waitForSubmissionsDone(pool, [sub.id]);

      const detail = await api<SubmissionDetail>(
        "GET",
        `/exam-sessions/${sessionId}/submissions/${sub.id}`,
        undefined,
        aliceToken,
        200,
      );
      expect(detail.verdict).toBe("AC");
      expect(detail.score).toBe(100);
    },
    120000,
  );

  it(
    "CE (C++): invalid C++ gets verdict=CE, no testcase results",
    async () => {
      const { candToken, aliceToken, sessionId, espId } = await buildStack(
        `cpp_ce_${TS}`,
      );
      const sub = await submit(sessionId, espId, candToken, CPP_CE, "cpp17");
      await waitForSubmissionsDone(pool, [sub.id]);

      const detail = await api<SubmissionDetail>(
        "GET",
        `/exam-sessions/${sessionId}/submissions/${sub.id}`,
        undefined,
        aliceToken,
        200,
      );
      expect(detail.verdict).toBe("CE");
      expect(detail.testcaseResults).toHaveLength(0);
    },
    120000,
  );
});
