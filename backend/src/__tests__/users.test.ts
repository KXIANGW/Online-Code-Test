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

  it("interviewer → 403", async () => {
    const token = await loginAs(app, "alice", "Test@1234");
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
    const rootToken = await loginAs(app, "root", "Root@1234");
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
});

// ── GET /api/users/:id ─────────────────────────────────────────────────────────

describe("GET /api/users/:id", () => {
  async function getUserIds(rootToken: string) {
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
});

// ── DELETE /api/users/:id ──────────────────────────────────────────────────────

describe("DELETE /api/users/:id", () => {
  async function getUserIds(rootToken: string) {
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
  });

  it("interviewer → 403 (cannot delete users)", async () => {
    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const rootToken = await loginAs(app, "root", "Root@1234");
    const users = await getUserIds(rootToken);
    const cand = users.find((u) => u.username === "candidate1")!;
    const res = await app.inject({
      method: "DELETE",
      url: `/api/users/${cand.id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
