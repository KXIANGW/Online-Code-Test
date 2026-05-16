import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "./helpers/app";
import { truncateTestTables, seedUser, loginAs } from "./helpers/db";
import { db } from "../db/client";
import { examSessions, problems } from "../db/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let carolToken: string;
let aliceToken: string;
let bobToken: string;
let candToken: string;   // david
let eveToken: string;
let rootToken: string;
let carolId: number;
let aliceId: number;
let bobId: number;
let davidId: number;
let eveId: number;
let graceId: number;

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
  aliceId = await seedUser({ username: "alice", password: "Test@1234", displayName: "Alice", roleNames: ["interviewer"] });
  bobId = await seedUser({ username: "bob", password: "Bob@1234", displayName: "Bob", roleNames: ["interviewer"] });
  davidId = await seedUser({ username: "david", password: "Cand@1234", displayName: "David", roleNames: ["candidate"], createdBy: aliceId });
  eveId = await seedUser({ username: "eve", password: "Eve@1234", displayName: "Eve", roleNames: ["candidate"], createdBy: bobId });
  graceId = await seedUser({ username: "grace", password: "Grace@1234", displayName: "Grace", roleNames: ["candidate"], createdBy: aliceId });

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

  it("interviewer cannot create session for another interviewer's candidate → 403", async () => {
    // Given: eveId is owned by bob, aliceToken is alice
    const { easy } = await getProblemIds();
    const res = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: eveId,
        durationMinutes: 60,
        problems: [{ problemId: easy, scoreWeight: 100, orderIndex: 1 }],
      },
    });
    // When: alice tries to assign bob's candidate
    // Expect: 403
    expect(res.statusCode).toBe(403);
  });

  it("superuser can create session for any candidate regardless of ownership", async () => {
    // Given: eveId is owned by bob, rootToken is superuser
    const { easy } = await getProblemIds();
    const res = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${rootToken}` },
      payload: {
        candidateId: eveId,
        durationMinutes: 60,
        problems: [{ problemId: easy, scoreWeight: 100, orderIndex: 1 }],
      },
    });
    // When: superuser creates session for bob's candidate
    // Expect: 201
    expect(res.statusCode).toBe(201);
  });

  it("rejects duplicate problem/order assignments and missing problems", async () => {
    const { easy } = await getProblemIds();

    const duplicateProblem = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 60,
        problems: [
          { problemId: easy, scoreWeight: 50, orderIndex: 1 },
          { problemId: easy, scoreWeight: 50, orderIndex: 2 },
        ],
      },
    });
    expect(duplicateProblem.statusCode).toBe(409);

    const duplicateOrder = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 60,
        problems: [
          { problemId: easy, scoreWeight: 50, orderIndex: 1 },
          { problemId: 999999, scoreWeight: 50, orderIndex: 1 },
        ],
      },
    });
    expect(duplicateOrder.statusCode).toBe(409);

    const missing = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 60,
        problems: [{ problemId: 999999, scoreWeight: 100, orderIndex: 1 }],
      },
    });
    expect(missing.statusCode).toBe(404);
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

  it("interviewer cannot create random session for another interviewer's candidate → 403", async () => {
    // Given: eveId is owned by bob, aliceToken is alice
    const res = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: eveId,
        durationMinutes: 60,
        distribution: { easy: 1 },
        scoreWeight: 100,
      },
    });
    // When: alice tries to assign bob's candidate via random
    // Expect: 403
    expect(res.statusCode).toBe(403);
  });

  it("rejects empty distribution and insufficient hard pool", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 60,
        distribution: {},
        scoreWeight: 100,
      },
    });
    expect(empty.statusCode).toBe(400);

    const hard = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 60,
        distribution: { hard: 1 },
        scoreWeight: 100,
      },
    });
    expect(hard.statusCode).toBe(409);
  });
});

// ── GET /api/exam-sessions ─────────────────────────────────────────────────────

describe("GET /api/exam-sessions", () => {
  it("superuser sees all sessions across all interviewers", async () => {
    const { easy } = await getProblemIds();
    // alice creates 2 sessions
    await createSession(aliceToken, davidId, easy);
    await createSession(aliceToken, graceId, easy);
    // bob creates 1 session
    await createSession(bobToken, eveId, easy);

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
    await createSession(aliceToken, graceId, easy);
    await createSession(bobToken, eveId, easy);

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
    await createSession(aliceToken, graceId, easy);  // grace's session

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
    const bobSessionId = await createSession(bobToken, eveId, easy);

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
    const graceSessionId = await createSession(aliceToken, graceId, easy);

    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${graceSessionId}`,
      headers: { authorization: `Bearer ${candToken}` }, // david trying to see grace's
    });
    expect(res.statusCode).toBe(403);
  });

  it("invalid id → 400 and missing session → 404", async () => {
    const invalid = await app.inject({
      method: "GET",
      url: "/api/exam-sessions/not-a-number",
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: "GET",
      url: "/api/exam-sessions/999999",
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(missing.statusCode).toBe(404);
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

// ── POST /api/exam-sessions/:id/submit ───────────────────────────────────────

describe("POST /api/exam-sessions/:id/submit", () => {
  let sessionId: number;

  beforeEach(async () => {
    const { easy } = await getProblemIds();
    sessionId = await createSession(aliceToken, davidId, easy);
  });

  it("candidate can submit an in-progress session and records submittedAt", async () => {
    await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/start`,
      headers: { authorization: `Bearer ${candToken}` },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/submit`,
      headers: { authorization: `Bearer ${candToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; submittedAt: string | null }>();
    expect(body.status).toBe("submitted");
    expect(body.submittedAt).toBeTruthy();
  });

  it("rejects submit when requester is not the assigned candidate", async () => {
    await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/start`,
      headers: { authorization: `Bearer ${candToken}` },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/submit`,
      headers: { authorization: `Bearer ${eveToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects submit outside the in-progress state", async () => {
    const notStarted = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/submit`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(notStarted.statusCode).toBe(409);

    await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/start`,
      headers: { authorization: `Bearer ${candToken}` },
    });

    const firstSubmit = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/submit`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(firstSubmit.statusCode).toBe(200);

    const alreadySubmitted = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/submit`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(alreadySubmitted.statusCode).toBe(409);
  });

  it("lazily expires sessions when reading exam detail", async () => {
    await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/start`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    await db
      .update(examSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(examSessions.id, sessionId));

    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}`,
      headers: { authorization: `Bearer ${candToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("expired");
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

  it("interviewer cannot cancel another interviewer's session → 403", async () => {
    const { easy } = await getProblemIds();
    const bobSessionId = await createSession(bobToken, eveId, easy);

    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${bobSessionId}/cancel`,
      headers: { authorization: `Bearer ${aliceToken}` },
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
    const bobSessionId = await createSession(bobToken, eveId, easy);

    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${bobSessionId}/problems`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("candidate cannot view problems of another candidate's session → 403", async () => {
    const { easy } = await getProblemIds();
    const graceSessionId = await createSession(aliceToken, graceId, easy);

    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${graceSessionId}/problems`,
      headers: { authorization: `Bearer ${candToken}` }, // david trying to see grace's
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── PUT /:id/drafts/:problemId & GET /:id/drafts ──────────────────────────────

describe("PUT /api/exam-sessions/:id/drafts/:problemId and GET /:id/drafts", () => {
  let sessionId: number;
  let easyProblemId: number;
  let mediumProblemId: number;

  beforeEach(async () => {
    const { easy, medium } = await getProblemIds();
    easyProblemId = easy;
    mediumProblemId = medium;

    const createRes = await app.inject({
      method: "POST",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateId: davidId,
        durationMinutes: 60,
        problems: [
          { problemId: easy, scoreWeight: 50, orderIndex: 1 },
          { problemId: medium, scoreWeight: 50, orderIndex: 2 },
        ],
      },
    });
    sessionId = createRes.json<{ id: number }>().id;

    await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/start`,
      headers: { authorization: `Bearer ${candToken}` },
    });
  });

  it("candidate can save a draft for their in-progress session", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/exam-sessions/${sessionId}/drafts/${easyProblemId}`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: { code: "print('hello')", language: "python3" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ ok: boolean }>().ok).toBe(true);
  });

  it("save draft rejects non-owner (interviewer) → 404", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/exam-sessions/${sessionId}/drafts/${easyProblemId}`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { code: "// interviewer", language: "cpp17" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("save draft rejects a problemId not in the session → 404", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/exam-sessions/${sessionId}/drafts/999999`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: { code: "print('x')", language: "python3" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("candidate can read back a previously saved draft", async () => {
    await app.inject({
      method: "PUT",
      url: `/api/exam-sessions/${sessionId}/drafts/${easyProblemId}`,
      headers: { authorization: `Bearer ${candToken}` },
      payload: { code: "saved = True", language: "python3" },
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/drafts`,
      headers: { authorization: `Bearer ${candToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, { code: string; language: string }>>();
    expect(body[String(easyProblemId)]).toEqual({ code: "saved = True", language: "python3" });
    expect(body[String(mediumProblemId)]).toBeUndefined();
  });

  it("get drafts for a session belonging to another candidate → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/drafts`,
      headers: { authorization: `Bearer ${eveToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
