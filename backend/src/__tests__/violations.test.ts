import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "./helpers/app";
import { truncateTestTables, seedUser, loginAs } from "./helpers/db";
import { db } from "../db/client";
import { examSessions, exams, examProblems, examViolations, problems } from "../db/schema";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let interviewerToken: string;
let candidateToken: string;
let otherCandidateToken: string;
let interviewerId: number;
let candidateId: number;
let otherCandidateId: number;
let sessionId: number;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateTestTables();

  interviewerId = await seedUser({
    username: "alice",
    password: "Alice@1234",
    displayName: "Alice",
    roleNames: ["interviewer"],
  });
  candidateId = await seedUser({
    username: "david",
    password: "David@1234",
    displayName: "David",
    roleNames: ["candidate"],
    createdBy: interviewerId,
  });
  otherCandidateId = await seedUser({
    username: "eve",
    password: "Eve@1234",
    displayName: "Eve",
    roleNames: ["candidate"],
    createdBy: interviewerId,
  });

  interviewerToken = await loginAs(app, "alice", "Alice@1234");
  candidateToken = await loginAs(app, "david", "David@1234");
  otherCandidateToken = await loginAs(app, "eve", "Eve@1234");

  // 建立一個 in_progress 的考試場次
  const [problem] = await db
    .insert(problems)
    .values({
      title: "Test Problem",
      descriptionMd: "## desc",
      difficulty: "easy",
      timeLimitMs: 1000,
      memoryLimitMb: 128,
      createdBy: interviewerId,
    })
    .returning({ id: problems.id });

  const [exam] = await db
    .insert(exams)
    .values({ title: "Test Exam", durationMinutes: 60, createdBy: interviewerId })
    .returning({ id: exams.id });

  await db
    .insert(examProblems)
    .values({ examId: exam!.id, problemId: problem!.id, orderIndex: 1, scoreWeight: 100 });

  const [session] = await db
    .insert(examSessions)
    .values({
      examId: exam!.id,
      candidateId,
      createdBy: interviewerId,
      status: "in_progress",
      maxScore: 100,
    })
    .returning({ id: examSessions.id });

  sessionId = session!.id;
});

// ── POST /exam-sessions/:id/violations ────────────────────────────────────────

describe("POST /api/exam-sessions/:id/violations", () => {
  it("candidate can report a fullscreen_exit violation", async () => {
    // given
    const body = { type: "fullscreen_exit" };

    // when
    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/violations`,
      headers: { Authorization: `Bearer ${candidateToken}` },
      payload: body,
    });

    // expect
    expect(res.statusCode).toBe(204);
    const rows = await db.select().from(examViolations);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("fullscreen_exit");
    expect(rows[0]!.detail).toBeNull();
  });

  it("candidate can report a paste violation with detail", async () => {
    // given
    const body = { type: "paste", detail: "length:250" };

    // when
    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/violations`,
      headers: { Authorization: `Bearer ${candidateToken}` },
      payload: body,
    });

    // expect
    expect(res.statusCode).toBe(204);
    const [row] = await db.select().from(examViolations);
    expect(row!.type).toBe("paste");
    expect(row!.detail).toBe("length:250");
  });

  it("stores the provided occurredAt timestamp", async () => {
    // given
    const occurredAt = "2026-01-15T10:30:00.000Z";
    const body = { type: "tab_switch", occurredAt };

    // when
    await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/violations`,
      headers: { Authorization: `Bearer ${candidateToken}` },
      payload: body,
    });

    // expect
    const [row] = await db.select().from(examViolations);
    expect(row!.occurredAt.toISOString()).toBe(occurredAt);
  });

  it("returns 403 when candidate reports a session that is not theirs", async () => {
    // given / when
    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/violations`,
      headers: { Authorization: `Bearer ${otherCandidateToken}` },
      payload: { type: "tab_switch" },
    });

    // expect
    expect(res.statusCode).toBe(403);
    const rows = await db.select().from(examViolations);
    expect(rows).toHaveLength(0);
  });

  it("returns 401 when unauthenticated", async () => {
    // given / when
    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/violations`,
      payload: { type: "fullscreen_exit" },
    });

    // expect
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for an invalid violation type", async () => {
    // given
    const body = { type: "unknown_event" };

    // when
    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/violations`,
      headers: { Authorization: `Bearer ${candidateToken}` },
      payload: body,
    });

    // expect
    expect(res.statusCode).toBe(400);
  });

  it("detail longer than 500 chars is rejected", async () => {
    // given: 501-char detail string
    const body = { type: "paste", detail: "x".repeat(501) };

    // when
    const res = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/${sessionId}/violations`,
      headers: { Authorization: `Bearer ${candidateToken}` },
      payload: body,
    });

    // expect
    expect(res.statusCode).toBe(400);
  });
});

// ── GET /exam-sessions/:id/violations ─────────────────────────────────────────

describe("GET /api/exam-sessions/:id/violations", () => {
  beforeEach(async () => {
    // Seed two violations for the session
    await db.insert(examViolations).values([
      { sessionId, type: "fullscreen_exit", detail: null },
      { sessionId, type: "paste", detail: "length:100" },
    ]);
  });

  it("interviewer can list violations ordered by occurredAt", async () => {
    // given / when
    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/violations`,
      headers: { Authorization: `Bearer ${interviewerToken}` },
    });

    // expect
    expect(res.statusCode).toBe(200);
    const body = res.json<{ type: string }[]>();
    expect(body).toHaveLength(2);
    expect(body[0]!.type).toBe("fullscreen_exit");
    expect(body[1]!.type).toBe("paste");
  });

  it("returns 403 for a candidate attempting to read violations", async () => {
    // given / when
    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/violations`,
      headers: { Authorization: `Bearer ${candidateToken}` },
    });

    // expect
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    // given / when
    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/violations`,
    });

    // expect
    expect(res.statusCode).toBe(401);
  });

  it("returns empty array when session has no violations", async () => {
    // given: clear any pre-seeded violations
    await db.delete(examViolations);

    // when
    const res = await app.inject({
      method: "GET",
      url: `/api/exam-sessions/${sessionId}/violations`,
      headers: { Authorization: `Bearer ${interviewerToken}` },
    });

    // expect
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
