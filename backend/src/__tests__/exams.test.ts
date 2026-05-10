import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "./helpers/app";
import { truncateTestTables, seedUser, loginAs } from "./helpers/db";
import { db } from "../db/client";
import { problems } from "../db/schema";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let carolToken: string;
let aliceToken: string;
let bobToken: string;
let candToken: string;   // david
let eveToken: string;
let rootToken: string;
let carolId: number;
let davidId: number;
let eveId: number;

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
  carolId = await seedUser({ username: "carol", password: "Test@1234", displayName: "Carol", roleNames: ["problem_setter"] });
  await seedUser({ username: "alice", password: "Test@1234", displayName: "Alice", roleNames: ["interviewer"] });
  await seedUser({ username: "bob", password: "Bob@1234", displayName: "Bob", roleNames: ["interviewer"] });
  davidId = await seedUser({ username: "david", password: "Cand@1234", displayName: "David", roleNames: ["candidate"] });
  eveId = await seedUser({ username: "eve", password: "Eve@1234", displayName: "Eve", roleNames: ["candidate"] });

  carolToken = await loginAs(app, "carol", "Test@1234");
  aliceToken = await loginAs(app, "alice", "Test@1234");
  bobToken = await loginAs(app, "bob", "Bob@1234");
  candToken = await loginAs(app, "david", "Cand@1234");
  eveToken = await loginAs(app, "eve", "Eve@1234");
  rootToken = await loginAs(app, "root", "Root@1234");

  await db.insert(problems).values([
    {
      title: "Two Sum",
      descriptionMd: "desc",
      difficulty: "easy",
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      outputLimitKb: 64,
      createdBy: carolId,
    },
    {
      title: "Binary Search",
      descriptionMd: "desc",
      difficulty: "medium",
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      outputLimitKb: 64,
      createdBy: carolId,
    },
  ]);
});

async function getProblemIds(): Promise<{ easy: number; medium: number }> {
  const all = await db.select({ id: problems.id, difficulty: problems.difficulty }).from(problems);
  return {
    easy: all.find((p) => p.difficulty === "easy")!.id,
    medium: all.find((p) => p.difficulty === "medium")!.id,
  };
}

async function createSession(
  token: string,
  candidateId: number,
  problemId: number
): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: "/api/exam-sessions",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      candidateId,
      durationMinutes: 60,
      problems: [{ problemId, scoreWeight: 100, orderIndex: 1 }],
    },
  });
  return res.json<{ id: number }>().id;
}

// ── POST /api/exam-sessions (manual) ──────────────────────────────────────────

describe("POST /api/exam-sessions (manual)", () => {
  it("interviewer creates session with manual problem assignment", async () => {
    const { easy, medium } = await getProblemIds();
    const res = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 90,
        problems: [
          { problemId: easy, scoreWeight: 30, orderIndex: 1 },
          { problemId: medium, scoreWeight: 70, orderIndex: 2 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: number; status: string; maxScore: number }>();
    expect(body.status).toBe("not_started");
    expect(body.maxScore).toBe(100);
  });

  it("superuser creates session with manual problem assignment", async () => {
    const { easy } = await getProblemIds();
    const res = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${rootToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 60,
        problems: [{ problemId: easy, scoreWeight: 100, orderIndex: 1 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: number; status: string }>();
    expect(body.status).toBe("not_started");
    expect(body.id).toBeDefined();
  });

  it("candidate → 403 on create", async () => {
    const { easy } = await getProblemIds();
    const res = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${candToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 90,
        problems: [{ problemId: easy, scoreWeight: 100, orderIndex: 1 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /api/exam-sessions (random) ──────────────────────────────────────────

describe("POST /api/exam-sessions (random)", () => {
  it("interviewer creates session with random assignment", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 60,
        distribution: { easy: 1, medium: 1 },
        scoreWeight: 50,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: number; maxScore: number }>();
    expect(body.maxScore).toBe(100); // 2 problems × 50
  });

  it("random excludes previously used problems for the same candidate", async () => {
    const { easy } = await getProblemIds();

    // first session uses the easy problem
    await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 60,
        problems: [{ problemId: easy, scoreWeight: 100, orderIndex: 1 }],
      },
    });

    // second session tries to pick a new easy problem — pool exhausted
    const res = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 60,
        distribution: { easy: 1 },
        scoreWeight: 100,
      },
    });
    expect(res.statusCode).toBe(409);
  });
});

// ── GET /api/exam-sessions ─────────────────────────────────────────────────────

describe("GET /api/exam-sessions", () => {
  it("superuser sees all sessions across all interviewers", async () => {
    const { easy } = await getProblemIds();
    // alice creates 2 sessions
    await createSession(aliceToken, davidId, easy);
    await createSession(aliceToken, eveId, easy);
    // bob creates 1 session
    await createSession(bobToken, davidId, easy);

    const res = await app.inject({
      method: "GET",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${rootToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<unknown[]>()).toHaveLength(3);
  });

  it("interviewer sees only sessions they created", async () => {
    const { easy } = await getProblemIds();
    await createSession(aliceToken, davidId, easy);
    await createSession(aliceToken, eveId, easy);
    await createSession(bobToken, davidId, easy);

    const res = await app.inject({
      method: "GET",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<unknown[]>();
    expect(body).toHaveLength(2); // alice's 2, not bob's
  });

  it("candidate sees only sessions where they are the candidate", async () => {
    const { easy } = await getProblemIds();
    await createSession(aliceToken, davidId, easy); // david's session
    await createSession(aliceToken, eveId, easy);  // eve's session

    const res = await app.inject({
      method: "GET",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<unknown[]>();
    expect(body).toHaveLength(1); // only david's session
  });
});

// ── GET /api/exam-sessions/:id ─────────────────────────────────────────────────

describe("GET /api/exam-sessions/:id", () => {
  it("interviewer can get a session they created", async () => {
    const { easy } = await getProblemIds();
    const sessionId = await createSession(aliceToken, davidId, easy);

    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: number }>().id).toBe(sessionId);
  });

  it("interviewer cannot get a session created by another interviewer → 403", async () => {
    const { easy } = await getProblemIds();
    const bobSessionId = await createSession(bobToken, davidId, easy);

    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${bobSessionId}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("candidate can get their own session", async () => {
    const { easy } = await getProblemIds();
    const sessionId = await createSession(aliceToken, davidId, easy);

    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ candidateId: number }>().candidateId).toBe(davidId);
  });

  it("candidate cannot get another candidate's session → 403", async () => {
    const { easy } = await getProblemIds();
    const eveSessionId = await createSession(aliceToken, eveId, easy);

    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${eveSessionId}`,
      headers: { authorization: `Bearer ${candToken}` }, // david trying to see eve's
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /api/exam-sessions/:id/start ─────────────────────────────────────────

describe("POST /api/exam-sessions/:id/start", () => {
  let sessionId: number;

  beforeEach(async () => {
    const { easy } = await getProblemIds();
    sessionId = await createSession(aliceToken, davidId, easy);
  });

  it("candidate can start their own session", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/start`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; actualStartAt: string; expiresAt: string }>();
    expect(body.status).toBe("in_progress");
    expect(body.actualStartAt).toBeDefined();
    expect(body.expiresAt).toBeDefined();
  });

  it("already-started exam → 409", async () => {
    await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/start`,
      headers: { authorization: `Bearer ${candToken}` },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/start`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(res.statusCode).toBe(409);
  });
});

// ── POST /api/exam-sessions/:id/cancel ────────────────────────────────────────

describe("POST /api/exam-sessions/:id/cancel", () => {
  it("interviewer can cancel a session they created", async () => {
    const { easy } = await getProblemIds();
    const sessionId = await createSession(aliceToken, davidId, easy);

    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/cancel`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("cancelled");
  });

  it("candidate cannot cancel → 403", async () => {
    const { easy } = await getProblemIds();
    const sessionId = await createSession(aliceToken, davidId, easy);

    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/cancel`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /api/exam-sessions/:id/problems ───────────────────────────────────────

describe("GET /api/exam-sessions/:id/problems", () => {
  it("candidate can view their session's problems", async () => {
    const { easy, medium } = await getProblemIds();
    const res = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 90,
        problems: [
          { problemId: easy, scoreWeight: 30, orderIndex: 1 },
          { problemId: medium, scoreWeight: 70, orderIndex: 2 },
        ],
      },
    });
    const sessionId = res.json<{ id: number }>().id;

    const listRes = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/problems`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json<{ title: string; orderIndex: number; descriptionMd: string; outputLimitKb: number; languageLimits: unknown[] }[]>();
    expect(body).toHaveLength(2);
    expect(body.map((p) => p.orderIndex).sort()).toEqual([1, 2]);
    expect(body[0]!.descriptionMd).toBeDefined();
    expect(body[0]!.outputLimitKb).toBeDefined();
    expect(Array.isArray(body[0]!.languageLimits)).toBe(true);
  });

  it("interviewer can view problems of a session they created", async () => {
    const { easy } = await getProblemIds();
    const sessionId = await createSession(aliceToken, davidId, easy);

    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/problems`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<unknown[]>()).toHaveLength(1);
  });

  it("interviewer cannot view problems of another interviewer's session → 403", async () => {
    const { easy } = await getProblemIds();
    const bobSessionId = await createSession(bobToken, davidId, easy);

    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${bobSessionId}/problems`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("candidate cannot view problems of another candidate's session → 403", async () => {
    const { easy } = await getProblemIds();
    const eveSessionId = await createSession(aliceToken, eveId, easy);

    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${eveSessionId}/problems`,
      headers: { authorization: `Bearer ${candToken}` }, // david trying to see eve's
    });
    expect(res.statusCode).toBe(403);
  });
});
