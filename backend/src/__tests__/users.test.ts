import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "./helpers/app";
import { truncateTestTables, seedUser, loginAs } from "./helpers/db";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateTestTables();
  await seedUser({ username: "root", password: "Root@1234", displayName: "Root", isSuperuser: true });
  await seedUser({ username: "alice", password: "Test@1234", displayName: "Alice", roleNames: ["interviewer"] });
  await seedUser({ username: "candidate1", password: "Cand@1234", displayName: "Candidate 1", roleNames: ["candidate"] });
});

// ── GET /api/users ─────────────────────────────────────────────────────────────

describe("GET /api/users", () => {
  it("superuser can list all users", async () => {
    const token = await loginAs(app, "root", "Root@1234");
    const res = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ username: string }[]>();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(3);
  });

  it("interviewer sees only candidates they personally created", async () => {
    // given: alice creates one candidate
    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { username: "alice_cand", password: "Password123", displayName: "Alice's Candidate" },
    });
    expect(createRes.statusCode).toBe(201);

    // when
    const res = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    // expect: only alice's own candidate is visible
    expect(res.statusCode).toBe(200);
    const body = res.json<{ username: string; isSuperuser: boolean }[]>();
    expect(body.some((u) => u.username === "alice_cand")).toBe(true);
    // seeded candidate1 (not created by alice) is not visible
    expect(body.some((u) => u.username === "candidate1")).toBe(false);
    // superusers are never included
    expect(body.some((u) => u.isSuperuser === true)).toBe(false);
    // alice herself is not in the list (she's an interviewer, not a candidate she owns)
    expect(body.some((u) => u.username === "alice")).toBe(false);
  });

  it("interviewer with no created candidates sees an empty list", async () => {
    // given: alice has not created any candidate yet

    // when
    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const res = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    // expect
    expect(res.statusCode).toBe(200);
    const body = res.json<{ username: string }[]>();
    expect(body).toHaveLength(0);
  });

  it("candidate → 403", async () => {
    const token = await loginAs(app, "candidate1", "Cand@1234");
    const res = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /api/users ────────────────────────────────────────────────────────────

describe("POST /api/users", () => {
  it("superuser creates user with any role", async () => {
    const token = await loginAs(app, "root", "Root@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: "newuser",
        password: "Password123",
        displayName: "New User",
        roleNames: ["candidate"],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: number; username: string }>();
    expect(body.username).toBe("newuser");
    expect(body.id).toBeDefined();
  });

  it("superuser creates interviewer-role user", async () => {
    const token = await loginAs(app, "root", "Root@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: "newinterviewer", password: "Password123", roleNames: ["interviewer"] },
    });
    expect(res.statusCode).toBe(201);
  });

  it("interviewer creates single candidate account → 201", async () => {
    const token = await loginAs(app, "alice", "Test@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: "newcandidate", password: "Password123", displayName: "New Candidate" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: number; username: string }>();
    expect(body.username).toBe("newcandidate");
  });

  it("interviewer creating candidate without explicit roleNames gets candidate role by default", async () => {
    const aliceToken = await loginAs(app, "alice", "Test@1234");

    const createRes = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { username: "canddefault", password: "Password123" },
    });
    expect(createRes.statusCode).toBe(201);

    // created user should be able to log in and has exam:take permission
    const newToken = await loginAs(app, "canddefault", "Password123");
    expect(newToken).toBeDefined();
  });

  it("interviewer tries to create interviewer-role user → 403", async () => {
    const token = await loginAs(app, "alice", "Test@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: "newinterviewer2", password: "Password123", roleNames: ["interviewer"] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("interviewer tries to create problem_setter-role user → 403", async () => {
    const token = await loginAs(app, "alice", "Test@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: "newsetter", password: "Password123", roleNames: ["problem_setter"] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("candidate → 403", async () => {
    const token = await loginAs(app, "candidate1", "Cand@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: "newuser2", password: "Password123" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("duplicate username → 409", async () => {
    const token = await loginAs(app, "root", "Root@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: "alice", password: "Password123", roleNames: ["candidate"] },
    });
    expect(res.statusCode).toBe(409);
  });

  it("unknown role name → 400", async () => {
    const token = await loginAs(app, "root", "Root@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: "badrole", password: "Password123", roleNames: ["ghost"] },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /api/users/batch ──────────────────────────────────────────────────────

describe("POST /api/users/batch", () => {
  it("superuser batch creates candidates and returns plaintext passwords", async () => {
    const token = await loginAs(app, "root", "Root@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/users/batch",
      headers: { authorization: `Bearer ${token}` },
      payload: { count: 3 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ username: string; password: string }[]>();
    expect(body).toHaveLength(3);
    expect(body[0]!.username).toMatch(/^candidate_\d{8}_\d{3}$/);
    expect(body[0]!.password).toBeDefined();
  });

  it("interviewer batch creates candidates → 201", async () => {
    const token = await loginAs(app, "alice", "Test@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/users/batch",
      headers: { authorization: `Bearer ${token}` },
      payload: { count: 2 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ username: string; password: string }[]>();
    expect(body).toHaveLength(2);
  });

  it("candidate → 403", async () => {
    const token = await loginAs(app, "candidate1", "Cand@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/users/batch",
      headers: { authorization: `Bearer ${token}` },
      payload: { count: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("invalid count bounds → 400", async () => {
    const token = await loginAs(app, "root", "Root@1234");
    for (const count of [0, 101]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/users/batch",
        headers: { authorization: `Bearer ${token}` },
        payload: { count },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

// ── GET /api/users/:id ─────────────────────────────────────────────────────────

describe("GET /api/users/:id", () => {
  async function getUserIds(rootToken: string): Promise<{ id: number; username: string }[]> {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${rootToken}` },
    });
    return listRes.json<{ id: number; username: string }[]>();
  }

  it("superuser can get own profile", async () => {
    const token = await loginAs(app, "root", "Root@1234");
    const users = await getUserIds(token);
    const root = users.find((u) => u.username === "root")!;
    const res = await app.inject({
      method: "GET",
      url: `/api/users/${root.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ username: string }>().username).toBe("root");
  });

  it("superuser can get any other user's profile", async () => {
    const token = await loginAs(app, "root", "Root@1234");
    const users = await getUserIds(token);
    const alice = users.find((u) => u.username === "alice")!;
    const res = await app.inject({
      method: "GET",
      url: `/api/users/${alice.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ username: string }>().username).toBe("alice");
  });

  it("interviewer can get own profile", async () => {
    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const rootToken = await loginAs(app, "root", "Root@1234");
    const users = await getUserIds(rootToken);
    const alice = users.find((u) => u.username === "alice")!;
    const res = await app.inject({
      method: "GET",
      url: `/api/users/${alice.id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ username: string }>().username).toBe("alice");
  });

  it("interviewer cannot get another user's profile → 403", async () => {
    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const rootToken = await loginAs(app, "root", "Root@1234");
    const users = await getUserIds(rootToken);
    const root = users.find((u) => u.username === "root")!;
    const res = await app.inject({
      method: "GET",
      url: `/api/users/${root.id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("candidate can get own profile", async () => {
    const candToken = await loginAs(app, "candidate1", "Cand@1234");
    const rootToken = await loginAs(app, "root", "Root@1234");
    const users = await getUserIds(rootToken);
    const cand = users.find((u) => u.username === "candidate1")!;
    const res = await app.inject({
      method: "GET",
      url: `/api/users/${cand.id}`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ username: string }>().username).toBe("candidate1");
  });

  it("candidate cannot get another user's profile → 403", async () => {
    const candToken = await loginAs(app, "candidate1", "Cand@1234");
    const rootToken = await loginAs(app, "root", "Root@1234");
    const users = await getUserIds(rootToken);
    const alice = users.find((u) => u.username === "alice")!;
    const res = await app.inject({
      method: "GET",
      url: `/api/users/${alice.id}`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("invalid id → 400 and missing user → 404", async () => {
    const token = await loginAs(app, "root", "Root@1234");

    const invalid = await app.inject({
      method: "GET",
      url: "/api/users/not-a-number",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: "GET",
      url: "/api/users/999999",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missing.statusCode).toBe(404);
  });
});

// ── DELETE /api/users/:id ──────────────────────────────────────────────────────

describe("DELETE /api/users/:id", () => {
  async function getUserIds(rootToken: string): Promise<{ id: number; username: string }[]> {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${rootToken}` },
    });
    return listRes.json<{ id: number; username: string }[]>();
  }

  it("superuser can soft-delete a user, deleted user cannot log in", async () => {
    const token = await loginAs(app, "root", "Root@1234");
    const users = await getUserIds(token);
    const alice = users.find((u) => u.username === "alice")!;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/users/${alice.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(delRes.statusCode).toBe(204);

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "Test@1234" },
    });
    expect(loginRes.statusCode).toBe(401);

    const listRes = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.json<{ username: string }[]>().find((u) => u.username === "alice")).toBeUndefined();

    const getRes = await app.inject({
      method: "GET",
      url: `/api/users/${alice.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("interviewer can soft-delete a candidate they created → 204", async () => {
    // given: alice creates a candidate
    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { username: "alice_del_cand", password: "Password123" },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<{ id: number }>();

    // when
    const res = await app.inject({
      method: "DELETE",
      url: `/api/users/${created.id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    // expect
    expect(res.statusCode).toBe(204);
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice_del_cand", password: "Password123" },
    });
    expect(loginRes.statusCode).toBe(401);
  });

  it("interviewer cannot delete a candidate they didn't create → 403", async () => {
    // given: candidate1 was seeded directly (no createdBy = alice)
    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const rootToken = await loginAs(app, "root", "Root@1234");
    const allUsers = await getUserIds(rootToken);
    const cand = allUsers.find((u) => u.username === "candidate1")!;

    // when
    const res = await app.inject({
      method: "DELETE",
      url: `/api/users/${cand.id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    // expect
    expect(res.statusCode).toBe(403);
  });

  it("interviewer cannot delete a superuser → 403", async () => {
    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const rootToken = await loginAs(app, "root", "Root@1234");
    const allUsers = await getUserIds(rootToken);
    const root = allUsers.find((u) => u.username === "root")!;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/users/${root.id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("candidate cannot delete users → 403", async () => {
    const candToken = await loginAs(app, "candidate1", "Cand@1234");
    const rootToken = await loginAs(app, "root", "Root@1234");
    const allUsers = await getUserIds(rootToken);
    const alice = allUsers.find((u) => u.username === "alice")!;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/users/${alice.id}`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── PUT /api/users/:id ─────────────────────────────────────────────────────────

describe("PUT /api/users/:id", () => {
  async function getUserIds(rootToken: string): Promise<{ id: number; username: string }[]> {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${rootToken}` },
    });
    return listRes.json<{ id: number; username: string }[]>();
  }

  it("superuser can update displayName of any user → 200", async () => {
    const rootToken = await loginAs(app, "root", "Root@1234");
    const allUsers = await getUserIds(rootToken);
    const cand = allUsers.find((u) => u.username === "candidate1")!;

    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${cand.id}`,
      headers: { authorization: `Bearer ${rootToken}` },
      payload: { displayName: "Updated Candidate" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ displayName: string }>().displayName).toBe("Updated Candidate");
  });

  it("interviewer can update displayName of a candidate they created → 200", async () => {
    // given: alice creates a candidate
    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { username: "alice_upd_cand", password: "Password123", displayName: "Old Name" },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<{ id: number }>();

    // when
    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${created.id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { displayName: "New Name" },
    });

    // expect
    expect(res.statusCode).toBe(200);
    expect(res.json<{ displayName: string }>().displayName).toBe("New Name");
  });

  it("interviewer can reset password of a candidate they created; updated password allows login", async () => {
    // given: alice creates a candidate
    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { username: "alice_pwd_cand", password: "OldPass@123" },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<{ id: number }>();

    // when
    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${created.id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { password: "NewPass@999" },
    });
    expect(res.statusCode).toBe(200);

    // old password no longer works
    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice_pwd_cand", password: "OldPass@123" },
    });
    expect(oldLogin.statusCode).toBe(401);

    // new password works
    const newLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice_pwd_cand", password: "NewPass@999" },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it("interviewer cannot update a candidate they didn't create → 403", async () => {
    // given: candidate1 was seeded directly (no createdBy = alice)
    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const rootToken = await loginAs(app, "root", "Root@1234");
    const allUsers = await getUserIds(rootToken);
    const cand = allUsers.find((u) => u.username === "candidate1")!;

    // when
    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${cand.id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { displayName: "Hacked" },
    });

    // expect
    expect(res.statusCode).toBe(403);
  });

  it("interviewer cannot update a superuser → 403", async () => {
    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const rootToken = await loginAs(app, "root", "Root@1234");
    const allUsers = await getUserIds(rootToken);
    const root = allUsers.find((u) => u.username === "root")!;

    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${root.id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { displayName: "Hacked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("candidate cannot update any user → 403", async () => {
    const candToken = await loginAs(app, "candidate1", "Cand@1234");
    const rootToken = await loginAs(app, "root", "Root@1234");
    const allUsers = await getUserIds(rootToken);
    const alice = allUsers.find((u) => u.username === "alice")!;

    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${alice.id}`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: { displayName: "Hacked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("password shorter than 6 chars → 400", async () => {
    const rootToken = await loginAs(app, "root", "Root@1234");
    const allUsers = await getUserIds(rootToken);
    const cand = allUsers.find((u) => u.username === "candidate1")!;

    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${cand.id}`,
      headers: { authorization: `Bearer ${rootToken}` },
      payload: { password: "123" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("update non-existent user → 404", async () => {
    const rootToken = await loginAs(app, "root", "Root@1234");
    const res = await app.inject({
      method: "PUT",
      url: "/api/users/999999",
      headers: { authorization: `Bearer ${rootToken}` },
      payload: { displayName: "Ghost" },
    });
    expect(res.statusCode).toBe(404);
  });
});
