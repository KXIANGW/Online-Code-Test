import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "./helpers/app";
import { truncateTestTables, seedUser } from "./helpers/db";
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
  await seedUser({
    username: "alice",
    password: "Test@1234",
    displayName: "Alice Chen",
    roleNames: ["interviewer"],
  });
  await seedUser({
    username: "root",
    password: "Root@1234",
    displayName: "System Root",
    isSuperuser: true,
  });
  await seedUser({
    username: "deleted_user",
    password: "Test@1234",
    displayName: "Deleted",
  });
  // soft-delete the user
  const { pool } = await import("../db/client");
  await pool.query("UPDATE users SET deleted_at = NOW() WHERE username = 'deleted_user'");
});

describe("POST /api/auth/login", () => {
  it("valid credentials → returns JWT token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "Test@1234" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string }>();
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe("string");
    expect(body.token.split(".")).toHaveLength(3); // JWT format
  });

  it("wrong password → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "wrongpassword" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("non-existent user → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "nobody", password: "Test@1234" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("soft-deleted user → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "deleted_user", password: "Test@1234" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("missing body fields → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("no Authorization on protected route → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/users",
    });
    expect(res.statusCode).toBe(401);
  });

  it("malformed Authorization token on protected route → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(res.statusCode).toBe(401);
  });
});
