import { describe, it, expect } from "vitest";
import { api, login } from "../helpers/api.js";
import { pool, querySessionScore } from "../helpers/db.js";
import { waitForSubmissionsDone } from "../helpers/wait.js";
import { PYTHON_AC, PYTHON_WA, SUM_PROBLEM } from "../helpers/fixtures.js";

const TS = Date.now().toString().slice(-8);

interface SessionResult {
  totalScore: number;
  maxScore: number;
  problems: {
    examSessionProblemId: number;
    score: number;
    latestStatus: string;
    finalSubmissionId: number | null;
  }[];
}

async function buildStack(suffix: string) {
  const rootToken = await login("root", "Root@1234");
  const aliceToken = await login("alice", "Test@1234");

  const ps = await api<{ id: number; username: string }>(
    "POST",
    "/users",
    {
      username: `e2e_ps7_${suffix}`,
      password: "E2e@1234",
      displayName: "PS7",
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
      username: `e2e_cand7_${suffix}`,
      password: "E2e@1234",
      displayName: "Cand7",
      roleNames: ["candidate"],
    },
    aliceToken,
    201,
  );
  const candToken = await login(cand.username, "E2e@1234");

  const p = await api<{ id: number }>(
    "POST",
    "/problems",
    SUM_PROBLEM,
    psToken,
    201,
  );

  const tmpl = await api<{ id: number }>(
    "POST",
    "/exam-sessions/templates/manual",
    {
      title: `E2E Score ${suffix}`,
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
  const espId = sps[0]!.id;

  return { candToken, aliceToken, sessionId, espId };
}

describe("Scoring logic", () => {
  it(
    "formal AC sets score=100, formal WA overrides to score=0",
    async () => {
      const { candToken, aliceToken, sessionId, espId } = await buildStack(
        `override_${TS}`,
      );

      const ac = await api<{ id: number }>(
        "POST",
        `/exam-sessions/${sessionId}/submissions`,
        {
          examSessionProblemId: espId,
          language: "python3",
          sourceCode: PYTHON_AC,
          type: "formal",
        },
        candToken,
        202,
      );
      await waitForSubmissionsDone(pool, [ac.id]);

      const afterAC = await api<SessionResult>(
        "GET",
        `/exam-sessions/${sessionId}/result`,
        undefined,
        aliceToken,
        200,
      );
      expect(afterAC.totalScore).toBe(100);
      expect(afterAC.problems[0]!.score).toBe(100);

      const wa = await api<{ id: number }>(
        "POST",
        `/exam-sessions/${sessionId}/submissions`,
        {
          examSessionProblemId: espId,
          language: "python3",
          sourceCode: PYTHON_WA,
          type: "formal",
        },
        candToken,
        202,
      );
      await waitForSubmissionsDone(pool, [wa.id]);

      const afterWA = await api<SessionResult>(
        "GET",
        `/exam-sessions/${sessionId}/result`,
        undefined,
        aliceToken,
        200,
      );
      expect(afterWA.totalScore).toBe(0);
      expect(afterWA.problems[0]!.score).toBe(0);
      expect(afterWA.problems[0]!.finalSubmissionId).toBe(wa.id);

      expect(await querySessionScore(sessionId)).toBe(0);
    },
    120000,
  );

  it(
    "simple submission does not affect score",
    async () => {
      const { candToken, aliceToken, sessionId, espId } = await buildStack(
        `simple_${TS}`,
      );

      const simpleAc = await api<{ id: number }>(
        "POST",
        `/exam-sessions/${sessionId}/submissions`,
        {
          examSessionProblemId: espId,
          language: "python3",
          sourceCode: PYTHON_AC,
          type: "simple",
        },
        candToken,
        202,
      );
      await waitForSubmissionsDone(pool, [simpleAc.id]);

      let result = await api<SessionResult>(
        "GET",
        `/exam-sessions/${sessionId}/result`,
        undefined,
        aliceToken,
        200,
      );
      expect(result.totalScore).toBe(0);

      const formalAc = await api<{ id: number }>(
        "POST",
        `/exam-sessions/${sessionId}/submissions`,
        {
          examSessionProblemId: espId,
          language: "python3",
          sourceCode: PYTHON_AC,
          type: "formal",
        },
        candToken,
        202,
      );
      await waitForSubmissionsDone(pool, [formalAc.id]);

      result = await api<SessionResult>(
        "GET",
        `/exam-sessions/${sessionId}/result`,
        undefined,
        aliceToken,
        200,
      );
      expect(result.totalScore).toBe(100);
      expect(result.problems[0]!.finalSubmissionId).toBe(formalAc.id);

      const simpleWa = await api<{ id: number }>(
        "POST",
        `/exam-sessions/${sessionId}/submissions`,
        {
          examSessionProblemId: espId,
          language: "python3",
          sourceCode: PYTHON_WA,
          type: "simple",
        },
        candToken,
        202,
      );
      await waitForSubmissionsDone(pool, [simpleWa.id]);

      result = await api<SessionResult>(
        "GET",
        `/exam-sessions/${sessionId}/result`,
        undefined,
        aliceToken,
        200,
      );
      expect(result.totalScore).toBe(100);
      expect(result.problems[0]!.finalSubmissionId).toBe(formalAc.id);
    },
    120000,
  );
});
