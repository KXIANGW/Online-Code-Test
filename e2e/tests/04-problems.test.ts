import { describe, it, expect } from "vitest";
import { api, login } from "../helpers/api.js";
import { SUM_PROBLEM } from "../helpers/fixtures.js";

const TS = Date.now().toString().slice(-8);

async function makePS() {
  const rootToken = await login("root", "Root@1234");
  const ps = await api<{ id: number; username: string }>(
    "POST",
    "/users",
    {
      username: `e2e_ps4_${TS}`,
      password: "E2e@1234",
      displayName: "E2E PS4",
      roleNames: ["problem_setter"],
    },
    rootToken,
    201,
  );
  return { rootToken, psToken: await login(ps.username, "E2e@1234"), psId: ps.id };
}

describe("Problem management", () => {
  it("problem_setter creates problem and it appears in GET list", async () => {
    const { psToken } = await makePS();
    const p = await api<{ id: number }>("POST", "/problems", SUM_PROBLEM, psToken, 201);
    expect(p.id).toBeGreaterThan(0);

    const list = await api<{ id: number }[]>("GET", "/problems", undefined, psToken, 200);
    expect(list.some((item) => item.id === p.id)).toBe(true);
  });

  it("GET /problems/:id returns full problem detail", async () => {
    const { psToken } = await makePS();
    const p = await api<{ id: number }>("POST", "/problems", SUM_PROBLEM, psToken, 201);
    const detail = await api<{ id: number; title: string; testcases: unknown[] }>(
      "GET",
      `/problems/${p.id}`,
      undefined,
      psToken,
      200,
    );
    expect(detail.title).toBe(SUM_PROBLEM.title);
    expect(detail.testcases).toHaveLength(2);
  });

  it("POST /problems/:id/testcases adds testcase", async () => {
    const { psToken } = await makePS();
    const p = await api<{ id: number }>("POST", "/problems", SUM_PROBLEM, psToken, 201);
    const tc = await api<{ id: number }>(
      "POST",
      `/problems/${p.id}/testcases`,
      { orderIndex: 3, isPublic: false, inputData: "10 20\n", expectedOutput: "30" },
      psToken,
      201,
    );
    expect(tc.id).toBeGreaterThan(0);

    const detail = await api<{ testcases: unknown[] }>(
      "GET",
      `/problems/${p.id}`,
      undefined,
      psToken,
      200,
    );
    expect(detail.testcases).toHaveLength(3);
  });

  it("PUT /problems/:id/testcases/:tcId updates testcase", async () => {
    const { psToken } = await makePS();
    const p = await api<{ id: number }>("POST", "/problems", SUM_PROBLEM, psToken, 201);
    const detail = await api<{ testcases: { id: number }[] }>(
      "GET",
      `/problems/${p.id}`,
      undefined,
      psToken,
      200,
    );
    const tcId = detail.testcases[0]!.id;
    await api(
      "PUT",
      `/problems/${p.id}/testcases/${tcId}`,
      { inputData: "5 6\n", expectedOutput: "11" },
      psToken,
      200,
    );
  });

  it("candidate cannot create problems (403)", async () => {
    const aliceToken = await login("alice", "Test@1234");
    const cand = await api<{ id: number; username: string }>(
      "POST",
      "/users",
      {
        username: `e2e_candp_${TS}`,
        password: "E2e@1234",
        displayName: "Cand",
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

  it("DELETE /problems/:id returns 204", async () => {
    const { psToken } = await makePS();
    const p = await api<{ id: number }>("POST", "/problems", SUM_PROBLEM, psToken, 201);
    await api("DELETE", `/problems/${p.id}`, undefined, psToken, 204);
    await expect(
      api("GET", `/problems/${p.id}`, undefined, psToken, 404),
    ).resolves.toBeDefined();
  });
});
