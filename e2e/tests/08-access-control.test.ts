import { describe, it, expect } from "vitest";
import { api, login } from "../helpers/api.js";
import { SUM_PROBLEM } from "../helpers/fixtures.js";

const TS = Date.now().toString().slice(-8);

describe("Access control (RBAC)", () => {
  it("interviewer B cannot GET result for interviewer A session (403)", async () => {
    const rootToken = await login("root", "Root@1234");
    const aliceToken = await login("alice", "Test@1234");

    const carol = await api<{ id: number; username: string }>(
      "POST",
      "/users",
      {
        username: `e2e_carol8_${TS}`,
        password: "E2e@1234",
        displayName: "Carol8",
        roleNames: ["interviewer"],
      },
      rootToken,
      201,
    );
    const carolToken = await login(carol.username, "E2e@1234");

    const ps = await api<{ id: number; username: string }>(
      "POST",
      "/users",
      {
        username: `e2e_ps8_${TS}`,
        password: "E2e@1234",
        displayName: "PS8",
        roleNames: ["problem_setter"],
      },
      rootToken,
      201,
    );
    const psToken = await login(ps.username, "E2e@1234");
    const p = await api<{ id: number }>(
      "POST",
      "/problems",
      SUM_PROBLEM,
      psToken,
      201,
    );

    const cand = await api<{ id: number }>(
      "POST",
      "/users",
      {
        username: `e2e_cand8_${TS}`,
        password: "E2e@1234",
        displayName: "Cand8",
        roleNames: ["candidate"],
      },
      aliceToken,
      201,
    );
    const tmpl = await api<{ id: number }>(
      "POST",
      "/exam-sessions/templates/manual",
      {
        title: `E2E AC8 ${TS}`,
        durationMinutes: 5,
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
      "GET",
      `/exam-sessions/${sessionId}/result`,
      undefined,
      aliceToken,
      200,
    );

    await expect(
      api(
        "GET",
        `/exam-sessions/${sessionId}/result`,
        undefined,
        carolToken,
        403,
      ),
    ).resolves.toBeDefined();
  });

  it("superuser can GET any session result", async () => {
    const rootToken = await login("root", "Root@1234");
    const aliceToken = await login("alice", "Test@1234");

    const ps = await api<{ id: number; username: string }>(
      "POST",
      "/users",
      {
        username: `e2e_ps8b_${TS}`,
        password: "E2e@1234",
        displayName: "PS8B",
        roleNames: ["problem_setter"],
      },
      rootToken,
      201,
    );
    const psToken = await login(ps.username, "E2e@1234");
    const p = await api<{ id: number }>(
      "POST",
      "/problems",
      SUM_PROBLEM,
      psToken,
      201,
    );

    const cand = await api<{ id: number }>(
      "POST",
      "/users",
      {
        username: `e2e_cand8b_${TS}`,
        password: "E2e@1234",
        displayName: "Cand8B",
        roleNames: ["candidate"],
      },
      aliceToken,
      201,
    );
    const tmpl = await api<{ id: number }>(
      "POST",
      "/exam-sessions/templates/manual",
      {
        title: `E2E AC8B ${TS}`,
        durationMinutes: 5,
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
      "GET",
      `/exam-sessions/${sessionId}/result`,
      undefined,
      rootToken,
      200,
    );
  });

  it("candidate cannot POST problems (403)", async () => {
    const aliceToken = await login("alice", "Test@1234");
    const cand = await api<{ id: number; username: string }>(
      "POST",
      "/users",
      {
        username: `e2e_cand8c_${TS}`,
        password: "E2e@1234",
        displayName: "Cand8C",
        roleNames: ["candidate"],
      },
      aliceToken,
      201,
    );
    const candToken = await login(cand.username, "E2e@1234");
    await expect(
      api("POST", "/problems", SUM_PROBLEM, candToken, 403),
    ).resolves.toBeDefined();
  });

  it("unauthenticated request returns 401", async () => {
    await expect(
      api("GET", "/users", undefined, undefined, 401),
    ).resolves.toBeDefined();
    await expect(
      api("GET", "/problems", undefined, undefined, 401),
    ).resolves.toBeDefined();
    await expect(
      api("GET", "/exam-sessions", undefined, undefined, 401),
    ).resolves.toBeDefined();
  });
});
