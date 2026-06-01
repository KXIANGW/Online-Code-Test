import { describe, it, expect } from "vitest";
import { api, login } from "../helpers/api.js";
import { SUM_PROBLEM } from "../helpers/fixtures.js";

const TS = Date.now().toString().slice(-8);
let _cnt = 0;

async function buildExamStack() {
  const suffix = `${TS}_${++_cnt}`;
  const rootToken = await login("root", "Root@1234");
  const aliceToken = await login("alice", "Test@1234");

  const ps = await api<{ id: number; username: string }>(
    "POST",
    "/users",
    {
      username: `e2e_ps5_${suffix}`,
      password: "E2e@1234",
      displayName: "PS5",
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
      username: `e2e_cand5_${suffix}`,
      password: "E2e@1234",
      displayName: "Cand5",
      roleNames: ["candidate"],
    },
    aliceToken,
    201,
  );
  const candToken = await login(cand.username, "E2e@1234");

  const problem = await api<{ id: number }>(
    "POST",
    "/problems",
    SUM_PROBLEM,
    psToken,
    201,
  );

  return {
    rootToken,
    aliceToken,
    psToken,
    candToken,
    problemId: problem.id,
    candId: cand.id,
  };
}

describe("Exam sessions", () => {
  it("create manual template, assign to candidate, candidate can start", async () => {
    const { aliceToken, candToken, problemId, candId } = await buildExamStack();

    const tmpl = await api<{ id: number }>(
      "POST",
      "/exam-sessions/templates/manual",
      {
        title: `E2E Template ${TS}`,
        durationMinutes: 5,
        problems: [{ problemId, scoreWeight: 100, orderIndex: 1 }],
      },
      aliceToken,
      201,
    );
    expect(tmpl.id).toBeGreaterThan(0);

    const sessions = await api<{ id: number; candidateId: number }[]>(
      "POST",
      `/exam-sessions/templates/${tmpl.id}/assign`,
      { candidateIds: [candId] },
      aliceToken,
      201,
    );
    expect(sessions).toHaveLength(1);
    const sessionId = sessions[0]!.id;

    const list = await api<{ id: number }[]>(
      "GET",
      "/exam-sessions",
      undefined,
      aliceToken,
      200,
    );
    expect(list.some((s) => s.id === sessionId)).toBe(true);

    const detail = await api<{ id: number; status: string }>(
      "GET",
      `/exam-sessions/${sessionId}`,
      undefined,
      aliceToken,
      200,
    );
    expect(detail.status).toBe("not_started");

    await api(
      "POST",
      `/exam-sessions/${sessionId}/start`,
      undefined,
      candToken,
      200,
    );
    const started = await api<{ status: string }>(
      "GET",
      `/exam-sessions/${sessionId}`,
      undefined,
      candToken,
      200,
    );
    expect(started.status).toBe("in_progress");

    const problems = await api<{ id: number; problemId: number }[]>(
      "GET",
      `/exam-sessions/${sessionId}/problems`,
      undefined,
      candToken,
      200,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]!.problemId).toBe(problemId);

    const espId = problems[0]!.id;
    const testcases = await api<{ isPublic: boolean }[]>(
      "GET",
      `/exam-sessions/${sessionId}/problems/${espId}/testcases`,
      undefined,
      candToken,
      200,
    );
    expect(testcases.every((tc) => tc.isPublic)).toBe(true);
  });

  it("candidate can manually submit the session", async () => {
    const { aliceToken, candToken, problemId, candId } = await buildExamStack();

    const tmpl = await api<{ id: number }>(
      "POST",
      "/exam-sessions/templates/manual",
      {
        title: `E2E Submit ${TS}`,
        durationMinutes: 5,
        problems: [{ problemId, scoreWeight: 100, orderIndex: 1 }],
      },
      aliceToken,
      201,
    );
    const sessions = await api<{ id: number }[]>(
      "POST",
      `/exam-sessions/templates/${tmpl.id}/assign`,
      { candidateIds: [candId] },
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
    await api(
      "POST",
      `/exam-sessions/${sessionId}/submit`,
      undefined,
      candToken,
      200,
    );
    const detail = await api<{ status: string }>(
      "GET",
      `/exam-sessions/${sessionId}`,
      undefined,
      candToken,
      200,
    );
    expect(detail.status).toBe("submitted");
  });

  it("interviewer can cancel a session", async () => {
    const { aliceToken, candId, problemId } = await buildExamStack();

    const tmpl = await api<{ id: number }>(
      "POST",
      "/exam-sessions/templates/manual",
      {
        title: `E2E Cancel ${TS}`,
        durationMinutes: 5,
        problems: [{ problemId, scoreWeight: 100, orderIndex: 1 }],
      },
      aliceToken,
      201,
    );
    const sessions = await api<{ id: number }[]>(
      "POST",
      `/exam-sessions/templates/${tmpl.id}/assign`,
      { candidateIds: [candId] },
      aliceToken,
      201,
    );
    const sessionId = sessions[0]!.id;
    await api(
      "POST",
      `/exam-sessions/${sessionId}/cancel`,
      undefined,
      aliceToken,
      200,
    );
    const detail = await api<{ status: string }>(
      "GET",
      `/exam-sessions/${sessionId}`,
      undefined,
      aliceToken,
      200,
    );
    expect(detail.status).toBe("cancelled");
  });

  it("GET /exam-sessions/templates returns created template", async () => {
    const { aliceToken, problemId } = await buildExamStack();
    const tmpl = await api<{ id: number }>(
      "POST",
      "/exam-sessions/templates/manual",
      {
        title: `E2E TmplList ${TS}`,
        durationMinutes: 5,
        problems: [{ problemId, scoreWeight: 100, orderIndex: 1 }],
      },
      aliceToken,
      201,
    );
    const list = await api<{ id: number }[]>(
      "GET",
      "/exam-sessions/templates",
      undefined,
      aliceToken,
      200,
    );
    expect(list.some((t) => t.id === tmpl.id)).toBe(true);
  });
});
