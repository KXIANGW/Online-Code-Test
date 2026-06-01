import { describe, it, expect } from "vitest";
import { api, login } from "../helpers/api.js";

const TS = Date.now().toString().slice(-8);

describe("User management", () => {
  it("superuser creates interviewer, interviewer creates candidate", async () => {
    const rootToken = await login("root", "Root@1234");

    const interviewer = await api<{ id: number; username: string }>(
      "POST",
      "/users",
      {
        username: `e2e_iv_${TS}`,
        password: "E2e@1234",
        displayName: "E2E IV",
        roleNames: ["interviewer"],
      },
      rootToken,
      201,
    );
    expect(interviewer.id).toBeGreaterThan(0);
    expect(interviewer.username).toBe(`e2e_iv_${TS}`);

    const ivToken = await login(interviewer.username, "E2e@1234");
    const cand = await api<{ id: number; username: string }>(
      "POST",
      "/users",
      {
        username: `e2e_cand_${TS}`,
        password: "E2e@1234",
        displayName: "E2E Cand",
        roleNames: ["candidate"],
      },
      ivToken,
      201,
    );
    expect(cand.id).toBeGreaterThan(0);
  });

  it("batch create 5 candidates returns 5 rows with username+password", async () => {
    const aliceToken = await login("alice", "Test@1234");
    const batch = await api<{ username: string; password: string }[]>(
      "POST",
      "/users/batch",
      { count: 5 },
      aliceToken,
      201,
    );
    expect(batch).toHaveLength(5);
    for (const u of batch) {
      expect(typeof u.username).toBe("string");
      expect(typeof u.password).toBe("string");
    }
  });

  it("GET /users as alice only returns candidates alice created", async () => {
    const rootToken = await login("root", "Root@1234");
    const aliceToken = await login("alice", "Test@1234");

    const cand = await api<{ id: number; username: string }>(
      "POST",
      "/users",
      {
        username: `e2e_alicecand_${TS}`,
        password: "E2e@1234",
        displayName: "Alice's Cand",
        roleNames: ["candidate"],
      },
      aliceToken,
      201,
    );

    const carol = await api<{ id: number; username: string }>(
      "POST",
      "/users",
      {
        username: `e2e_carol_${TS}`,
        password: "E2e@1234",
        displayName: "E2E Carol",
        roleNames: ["interviewer"],
      },
      rootToken,
      201,
    );
    const carolToken = await login(carol.username, "E2e@1234");
    await api<{ id: number }>(
      "POST",
      "/users",
      {
        username: `e2e_carolcand_${TS}`,
        password: "E2e@1234",
        displayName: "Carol's Cand",
        roleNames: ["candidate"],
      },
      carolToken,
      201,
    );

    const aliceUsers = await api<{ id: number; username?: string }[]>(
      "GET",
      "/users",
      undefined,
      aliceToken,
      200,
    );
    const ids = aliceUsers.map((u) => u.id);
    expect(ids).toContain(cand.id);
    const carolCandVisible = aliceUsers.some(
      (u) => u.username === `e2e_carolcand_${TS}`,
    );
    expect(carolCandVisible).toBe(false);
  });

  it("PUT /users/:id updates displayName", async () => {
    const rootToken = await login("root", "Root@1234");
    const user = await api<{ id: number }>(
      "POST",
      "/users",
      {
        username: `e2e_upd_${TS}`,
        password: "E2e@1234",
        displayName: "Old Name",
        roleNames: ["candidate"],
      },
      rootToken,
      201,
    );
    await api(
      "PUT",
      `/users/${user.id}`,
      { displayName: "New Name" },
      rootToken,
      200,
    );
    const detail = await api<{ displayName: string }>(
      "GET",
      `/users/${user.id}`,
      undefined,
      rootToken,
      200,
    );
    expect(detail.displayName).toBe("New Name");
  });

  it("DELETE /users/:id returns 204 and subsequent GET returns 404", async () => {
    const rootToken = await login("root", "Root@1234");
    const user = await api<{ id: number }>(
      "POST",
      "/users",
      {
        username: `e2e_del_${TS}`,
        password: "E2e@1234",
        displayName: "To Delete",
        roleNames: ["candidate"],
      },
      rootToken,
      201,
    );
    await api("DELETE", `/users/${user.id}`, undefined, rootToken, 204);
    await expect(
      api("GET", `/users/${user.id}`, undefined, rootToken, 404),
    ).resolves.toBeDefined();
  });

  it("candidate cannot create users (403)", async () => {
    const aliceToken = await login("alice", "Test@1234");
    const cand = await api<{ id: number; username: string }>(
      "POST",
      "/users",
      {
        username: `e2e_noperm_${TS}`,
        password: "E2e@1234",
        displayName: "No Perm",
        roleNames: ["candidate"],
      },
      aliceToken,
      201,
    );
    const candToken = await login(cand.username, "E2e@1234");
    await expect(
      api(
        "POST",
        "/users",
        {
          username: "hacker",
          password: "Hacker@1",
          displayName: "x",
          roleNames: ["candidate"],
        },
        candToken,
        403,
      ),
    ).resolves.toBeDefined();
  });
});
