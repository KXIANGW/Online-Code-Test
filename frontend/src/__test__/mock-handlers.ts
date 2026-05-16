import { http, HttpResponse } from "msw";
import {
  mockPasswords,
  mockTokens,
  mockTokenUserMap,
  mockLanguages,
  mockExamSessions,
  mockExamProblems,
  mockSubmissions,
  mockSubmissionDetail,
  mockSessionResult,
  mockUserSummaries,
} from "./mock-data";
import type { SubmissionCreated, UserSummary } from "../types";

const BASE = "/api";

export const handlers = [
  // ── Auth ───────────────────────────────────────────────────────────────────
  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { username?: string; password?: string };
    const { username = "", password = "" } = body;

    if (mockPasswords[username] === password) {
      return HttpResponse.json({ token: mockTokens[username] });
    }
    return HttpResponse.json({ message: "Invalid credentials" }, { status: 401 });
  }),

  // ── Users ──────────────────────────────────────────────────────────────────
  http.get(`${BASE}/users`, () => {
    return HttpResponse.json(mockUserSummaries);
  }),

  http.post(`${BASE}/users`, async ({ request }) => {
    const body = (await request.json()) as { username: string; displayName?: string; roleNames?: string[] };
    const created: UserSummary = {
      id: Date.now(),
      username: body.username,
      displayName: body.displayName ?? body.username,
      isSuperuser: false,
      createdAt: new Date().toISOString(),
      roles: body.roleNames ?? ["candidate"],
    };
    return HttpResponse.json(created, { status: 201 });
  }),

  http.put(`${BASE}/users/:id/roles`, async ({ request, params }) => {
    const body = (await request.json()) as { roleNames: string[] };
    return HttpResponse.json({ id: Number(params.id), roles: body.roleNames });
  }),

  http.delete(`${BASE}/users/:id`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // ── Languages ──────────────────────────────────────────────────────────────
  http.get(`${BASE}/languages`, () => {
    return HttpResponse.json(mockLanguages);
  }),

  // ── Exam Sessions ──────────────────────────────────────────────────────────
  http.get(`${BASE}/exam-sessions`, ({ request }) => {
    const auth = request.headers.get("Authorization") ?? "";
    const token = auth.replace("Bearer ", "");
    const user = mockTokenUserMap[token];
    if (!user) return HttpResponse.json({ message: "Unauthorized" }, { status: 401 });

    const sessions = user.isSuperuser
      ? mockExamSessions
      : mockExamSessions.filter((s) => s.candidateId === user.id);
    return HttpResponse.json(sessions);
  }),

  http.get(`${BASE}/exam-sessions/:id`, ({ params }) => {
    const session = mockExamSessions.find((s) => s.id === Number(params.id));
    if (!session) return HttpResponse.json({ message: "Not found" }, { status: 404 });
    return HttpResponse.json(session);
  }),

  http.post(`${BASE}/exam-sessions/:id/start`, ({ params }) => {
    const session = mockExamSessions.find((s) => s.id === Number(params.id));
    if (!session) return HttpResponse.json({ message: "Not found" }, { status: 404 });
    if (session.status !== "not_started") {
      return HttpResponse.json(
        { message: `Cannot start exam session: current status is '${session.status}'` },
        { status: 409 }
      );
    }
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + session.durationMinutes * 60 * 1000).toISOString();
    return HttpResponse.json({ ...session, status: "in_progress", actualStartAt: now, expiresAt: expires });
  }),

  http.post(`${BASE}/exam-sessions/:id/cancel`, ({ params }) => {
    const session = mockExamSessions.find((s) => s.id === Number(params.id));
    if (!session) return HttpResponse.json({ message: "Not found" }, { status: 404 });
    return HttpResponse.json({ ...session, status: "cancelled" });
  }),

  // ── Problems in Session ────────────────────────────────────────────────────
  http.get(`${BASE}/exam-sessions/:id/problems`, () => {
    return HttpResponse.json(mockExamProblems);
  }),

  // ── Submissions ────────────────────────────────────────────────────────────
  http.post(`${BASE}/exam-sessions/:sessionId/submissions`, async ({ request }) => {
    const body = (await request.json()) as {
      examSessionProblemId: number;
      language: string;
      sourceCode: string;
      type: "simple" | "formal";
    };
    const created: SubmissionCreated = {
      id: Date.now(),
      examSessionProblemId: body.examSessionProblemId,
      language: body.language,
      submissionType: body.type,
      status: "pending",
      verdict: null,
      runtimeMs: null,
      memoryKb: null,
      submittedAt: new Date().toISOString(),
      judgedAt: null,
    };
    return HttpResponse.json(created, { status: 202 });
  }),

  http.get(`${BASE}/exam-sessions/:sessionId/submissions`, () => {
    return HttpResponse.json(mockSubmissions);
  }),

  http.get(`${BASE}/exam-sessions/:sessionId/submissions/:submissionId`, ({ params }) => {
    const id = Number(params.submissionId);
    if (id === mockSubmissionDetail.id) {
      return HttpResponse.json(mockSubmissionDetail);
    }
    const summary = mockSubmissions.find((s) => s.id === id);
    if (!summary) return HttpResponse.json({ message: "Not found" }, { status: 404 });
    return HttpResponse.json({ ...summary, sourceCode: "# (source not available in mock)", testcaseResults: [] });
  }),

  // ── Session Result ─────────────────────────────────────────────────────────
  http.get(`${BASE}/exam-sessions/:sessionId/result`, ({ params }) => {
    if (Number(params.sessionId) === mockSessionResult.id) {
      return HttpResponse.json(mockSessionResult);
    }
    return HttpResponse.json({ message: "Not found" }, { status: 404 });
  }),
];
