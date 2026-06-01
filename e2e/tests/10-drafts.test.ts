import { describe, it, expect } from "vitest";
import { api, login } from "../helpers/api.js";
import { SUM_PROBLEM } from "../helpers/fixtures.js";

const TS = Date.now().toString().slice(-8);
let _cnt = 0;

async function buildSession() {
  const suffix = `${TS}_${++_cnt}`;
  const rootToken = await login("root", "Root@1234");
  const aliceToken = await login("alice", "Test@1234");

  const ps = await api<{ id: number; username: string }>(
    "POST",
    "/users",
    {
      username: `e2e_ps10_${suffix}`,
      password: "E2e@1234",
      displayName: "PS10",
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
      username: `e2e_cand10_${suffix}`,
      password: "E2e@1234",
      displayName: "Cand10",
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
      title: `E2E Draft ${TS}`,
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

  return { candToken, sessionId, problemId: p.id };
}

describe("Draft save and retrieval", () => {
  it("save draft then GET drafts returns the saved code", async () => {
    const { candToken, sessionId, problemId } = await buildSession();

    await api(
      "PUT",
      `/exam-sessions/${sessionId}/drafts/${problemId}/python3`,
      { code: "print('hello draft')\n" },
      candToken,
      200,
    );

    const drafts = await api<Record<string, string>>(
      "GET",
      `/exam-sessions/${sessionId}/drafts`,
      undefined,
      candToken,
      200,
    );
    expect(drafts[`${problemId}:python3`]).toBe("print('hello draft')\n");
  });

  it("save drafts for two languages, both appear in GET", async () => {
    const { candToken, sessionId, problemId } = await buildSession();

    await api(
      "PUT",
      `/exam-sessions/${sessionId}/drafts/${problemId}/python3`,
      { code: "# py" },
      candToken,
      200,
    );
    await api(
      "PUT",
      `/exam-sessions/${sessionId}/drafts/${problemId}/cpp17`,
      { code: "// cpp" },
      candToken,
      200,
    );

    const drafts = await api<Record<string, string>>(
      "GET",
      `/exam-sessions/${sessionId}/drafts`,
      undefined,
      candToken,
      200,
    );
    expect(drafts[`${problemId}:python3`]).toBe("# py");
    expect(drafts[`${problemId}:cpp17`]).toBe("// cpp");
  });

  it("overwriting draft stores the new value", async () => {
    const { candToken, sessionId, problemId } = await buildSession();

    await api(
      "PUT",
      `/exam-sessions/${sessionId}/drafts/${problemId}/python3`,
      { code: "v1" },
      candToken,
      200,
    );
    await api(
      "PUT",
      `/exam-sessions/${sessionId}/drafts/${problemId}/python3`,
      { code: "v2" },
      candToken,
      200,
    );

    const drafts = await api<Record<string, string>>(
      "GET",
      `/exam-sessions/${sessionId}/drafts`,
      undefined,
      candToken,
      200,
    );
    expect(drafts[`${problemId}:python3`]).toBe("v2");
  });

  it("candidate B cannot GET drafts for candidate A session (404)", async () => {
    const { candToken, sessionId } = await buildSession();

    const aliceToken = await login("alice", "Test@1234");
    const cand2 = await api<{ id: number; username: string }>(
      "POST",
      "/users",
      {
        username: `e2e_cand10b_${TS}`,
        password: "E2e@1234",
        displayName: "Cand10B",
        roleNames: ["candidate"],
      },
      aliceToken,
      201,
    );
    const cand2Token = await login(cand2.username, "E2e@1234");

    await expect(
      api(
        "GET",
        `/exam-sessions/${sessionId}/drafts`,
        undefined,
        cand2Token,
        404,
      ),
    ).resolves.toBeDefined();
  });
});
