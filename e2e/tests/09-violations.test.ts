import { describe, it, expect } from "vitest";
import { api, login } from "../helpers/api.js";
import { pool } from "../helpers/db.js";
import { SUM_PROBLEM } from "../helpers/fixtures.js";

const TS = Date.now().toString().slice(-8);

async function buildSession() {
  const rootToken = await login("root", "Root@1234");
  const aliceToken = await login("alice", "Test@1234");

  const ps = await api<{ id: number; username: string }>(
    "POST",
    "/users",
    {
      username: `e2e_ps9_${TS}`,
      password: "E2e@1234",
      displayName: "PS9",
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
      username: `e2e_cand9_${TS}`,
      password: "E2e@1234",
      displayName: "Cand9",
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
      title: `E2E Viol ${TS}`,
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

  return { aliceToken, candToken, sessionId };
}

describe("Anti-cheat violations", () => {
  it("candidate reports violation, interviewer can list it", async () => {
    const { aliceToken, candToken, sessionId } = await buildSession();

    await api(
      "POST",
      `/exam-sessions/${sessionId}/violations`,
      { type: "fullscreen_exit" },
      candToken,
      204,
    );

    const violations = await api<{ type: string }[]>(
      "GET",
      `/exam-sessions/${sessionId}/violations`,
      undefined,
      aliceToken,
      200,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.type).toBe("fullscreen_exit");
  });

  it("multiple violations accumulate in order", async () => {
    const { aliceToken, candToken, sessionId } = await buildSession();

    await api(
      "POST",
      `/exam-sessions/${sessionId}/violations`,
      { type: "tab_switch" },
      candToken,
      204,
    );
    await api(
      "POST",
      `/exam-sessions/${sessionId}/violations`,
      { type: "copy", detail: "copied text" },
      candToken,
      204,
    );
    await api(
      "POST",
      `/exam-sessions/${sessionId}/violations`,
      { type: "paste" },
      candToken,
      204,
    );

    const violations = await api<{ type: string }[]>(
      "GET",
      `/exam-sessions/${sessionId}/violations`,
      undefined,
      aliceToken,
      200,
    );
    expect(violations).toHaveLength(3);
    expect(violations.map((v) => v.type)).toEqual([
      "tab_switch",
      "copy",
      "paste",
    ]);

    const res = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM exam_violations WHERE session_id = $1`,
      [sessionId],
    );
    expect(parseInt(res.rows[0]!.count)).toBe(3);
  });

  it("violation with detail is stored", async () => {
    const { aliceToken, candToken, sessionId } = await buildSession();
    await api(
      "POST",
      `/exam-sessions/${sessionId}/violations`,
      { type: "window_blur", detail: "user switched windows 3 times" },
      candToken,
      204,
    );

    const violations = await api<{ type: string; detail: string | null }[]>(
      "GET",
      `/exam-sessions/${sessionId}/violations`,
      undefined,
      aliceToken,
      200,
    );
    expect(violations[0]!.detail).toBe("user switched windows 3 times");
  });

  it("candidate cannot GET violations list (403)", async () => {
    const { candToken, sessionId } = await buildSession();
    await expect(
      api(
        "GET",
        `/exam-sessions/${sessionId}/violations`,
        undefined,
        candToken,
        403,
      ),
    ).resolves.toBeDefined();
  });

  it("invalid violation type returns 400", async () => {
    const { candToken, sessionId } = await buildSession();
    await expect(
      api(
        "POST",
        `/exam-sessions/${sessionId}/violations`,
        { type: "invalid_type" },
        candToken,
        400,
      ),
    ).resolves.toBeDefined();
  });
});
