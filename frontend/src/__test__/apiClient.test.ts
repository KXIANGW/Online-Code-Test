import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import {
  addTestcase,
  api,
  assignExamToCandidates,
  createExamTemplateManual,
  createExamTemplateRandom,
  createProblem,
  createSubmission,
  createUser,
  createUsersBatch,
  deleteExamTemplate,
  deleteProblem,
  deleteTestcase,
  deleteUser,
  getCandidatePassword,
  getExamDrafts,
  getExamSession,
  getExamSessionProblems,
  getExamSessions,
  getLanguages,
  getProblemById,
  getProblems,
  getPublicTestcases,
  getSessionResult,
  getSubmissionDetail,
  getUserPassword,
  getUsers,
  getViolations,
  isRetryableError,
  listExamTemplates,
  listSessionSubmissions,
  logApiError,
  login,
  reportViolation,
  saveExamDraft,
  startExamSession,
  submitExamSession,
  updateExamTemplate,
  updateProblem,
  updateTestcase,
  updateUser,
  updateUserRoles,
} from "../api/client";
import type { ApiErrorData } from "../api/client";

let capturedAuthHeader: string | null | undefined = undefined;
let capturedRolesRequest: { url: string; method: string; body: unknown } | null = null;

// ── Test helper ───────────────────────────────────────────────────────────────
function makeAxiosError(
  status: number | null,
  data: ApiErrorData = {},
  method = "get",
  url = "/test",
  responseHeaders: Record<string, string> = {},
): AxiosError<ApiErrorData> {
  const config = { method, url } as InternalAxiosRequestConfig;
  const response =
    status !== null
      ? { status, statusText: "Error", data, headers: responseHeaders, config }
      : undefined;
  return {
    isAxiosError: true,
    config,
    response,
    message: "Request failed",
    name: "AxiosError",
  } as unknown as AxiosError<ApiErrorData>;
}

const server = setupServer(
  http.get("*/api/ping", ({ request }) => {
    capturedAuthHeader = request.headers.get("Authorization");
    return HttpResponse.json({ pong: true, ts: new Date().toISOString() });
  }),
  http.put("*/api/users/:id/roles", async ({ request, params }) => {
    capturedRolesRequest = {
      url: request.url,
      method: request.method,
      body: await request.json(),
    };
    return HttpResponse.json({
      id: Number(params.id),
      roles: (capturedRolesRequest.body as { roleNames: string[] }).roleNames,
    });
  }),
);

describe("api request interceptor", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
  afterAll(() => server.close());

  beforeEach(() => {
    capturedAuthHeader = undefined;
    capturedRolesRequest = null;
    sessionStorage.clear();
  });

  // Happy path: token present
  it("attaches Bearer Authorization header when token exists in sessionStorage", async () => {
    // given
    sessionStorage.setItem("oct_token", "test-jwt-token");

    // when
    await api.get("/ping");

    // expect
    expect(capturedAuthHeader).toBe("Bearer test-jwt-token");
  });

  // Negative: no token
  it("does not attach Authorization header when sessionStorage has no token", async () => {
    // given — sessionStorage is empty

    // when
    await api.get("/ping");

    // expect
    expect(capturedAuthHeader).toBeNull();
  });

  // Boundary: token value is forwarded verbatim
  it("forwards the stored token value exactly without modification", async () => {
    // given
    const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature";
    sessionStorage.setItem("oct_token", token);

    // when
    await api.get("/ping");

    // expect
    expect(capturedAuthHeader).toBe(`Bearer ${token}`);
  });

  // Boundary: token is removed between requests
  it("does not attach header on a subsequent request after token is removed", async () => {
    // given
    sessionStorage.setItem("oct_token", "first-token");
    await api.get("/ping");
    expect(capturedAuthHeader).toBe("Bearer first-token");

    sessionStorage.removeItem("oct_token");
    capturedAuthHeader = undefined;

    // when
    await api.get("/ping");

    // expect
    expect(capturedAuthHeader).toBeNull();
  });

  // updateUserRoles HTTP contract
  describe("updateUserRoles()", () => {
    it("sends PUT to /api/users/:id/roles with { roleNames } body", async () => {
      // given
      sessionStorage.setItem("oct_token", "test-token");

      // when
      await updateUserRoles(5, ["interviewer", "problem_setter"]);

      // expect — method and URL
      expect(capturedRolesRequest?.method).toBe("PUT");
      expect(capturedRolesRequest?.url).toContain("/api/users/5/roles");
      // expect — body contains roleNames array
      expect(capturedRolesRequest?.body).toEqual({
        roleNames: ["interviewer", "problem_setter"],
      });
    });

    it("sends empty roleNames array when all roles are removed", async () => {
      // given
      sessionStorage.setItem("oct_token", "test-token");

      // when
      await updateUserRoles(3, []);

      // expect
      expect(capturedRolesRequest?.url).toContain("/api/users/3/roles");
      expect(capturedRolesRequest?.body).toEqual({ roleNames: [] });
    });

    it("attaches Authorization header for the roles request", async () => {
      // given
      sessionStorage.setItem("oct_token", "auth-token-xyz");

      // when
      await updateUserRoles(7, ["interviewer"]);

      // expect
      expect(capturedRolesRequest?.url).toContain("/api/users/7/roles");
    });
  });

  // Boundary: token is replaced between requests
  it("uses the latest token when sessionStorage is updated between requests", async () => {
    // given
    sessionStorage.setItem("oct_token", "old-token");
    await api.get("/ping");

    sessionStorage.setItem("oct_token", "new-token");
    capturedAuthHeader = undefined;

    // when
    await api.get("/ping");

    // expect
    expect(capturedAuthHeader).toBe("Bearer new-token");
  });
});

// ── isRetryableError() ────────────────────────────────────────────────────────

describe("isRetryableError()", () => {
  it("returns true for 429 Too Many Requests", () => {
    // given / when / expect
    expect(isRetryableError(makeAxiosError(429))).toBe(true);
  });

  it("returns true for 503 Service Unavailable", () => {
    expect(isRetryableError(makeAxiosError(503))).toBe(true);
  });

  it("returns true for network error (no response object)", () => {
    // given: no response means request never reached the server
    expect(isRetryableError(makeAxiosError(null))).toBe(true);
  });

  it("returns false for 400 Bad Request", () => {
    expect(isRetryableError(makeAxiosError(400))).toBe(false);
  });

  it("returns false for 401 Unauthorized", () => {
    expect(isRetryableError(makeAxiosError(401))).toBe(false);
  });

  it("returns false for 404 Not Found", () => {
    expect(isRetryableError(makeAxiosError(404))).toBe(false);
  });

  it("returns false for 500 Internal Server Error", () => {
    expect(isRetryableError(makeAxiosError(500))).toBe(false);
  });
});

// ── logApiError() ─────────────────────────────────────────────────────────────

describe("logApiError()", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("logs METHOD URL → STATUS and message on a 4xx error", () => {
    // given
    const err = makeAxiosError(
      422,
      { message: "validation failed" },
      "post",
      "/exam-sessions/5/submissions",
    );

    // when
    logApiError(err);

    // expect
    expect(consoleSpy).toHaveBeenCalledWith(
      "[API Error] POST /exam-sessions/5/submissions → 422\nmessage: validation failed",
    );
  });

  it("includes x-request-id line when response header is present", () => {
    // given
    const err = makeAxiosError(500, { message: "internal error" }, "get", "/ping", {
      "x-request-id": "req-abc-123",
    });

    // when
    logApiError(err);

    // expect
    expect(consoleSpy).toHaveBeenCalledWith(
      "[API Error] GET /ping → 500\nmessage: internal error\nrequest-id: req-abc-123",
    );
  });

  it("omits request-id line when header is absent", () => {
    // given
    const err = makeAxiosError(403, { message: "forbidden" }, "delete", "/users/9");

    // when
    logApiError(err);

    // expect: no third line
    const logged = (consoleSpy.mock.calls[0] as string[])[0];
    expect(logged).not.toContain("request-id");
  });

  it("shows NETWORK_ERROR as status when there is no response", () => {
    // given: network / timeout error — response is undefined
    const err = makeAxiosError(null);

    // when
    logApiError(err);

    // expect
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("NETWORK_ERROR"));
  });

  it("falls back to error.message when response data has no message field", () => {
    // given
    const err = makeAxiosError(503, {}, "get", "/health");
    (err as AxiosError<ApiErrorData>).message = "socket hang up";

    // when
    logApiError(err);

    // expect: uses axios error message as fallback
    const logged = (consoleSpy.mock.calls[0] as string[])[0];
    expect(logged).toContain("socket hang up");
  });
});

// ── Response error interceptor (integration via MSW) ─────────────────────────

describe("response error interceptor", () => {
  const retryServer = setupServer();

  beforeAll(() => retryServer.listen({ onUnhandledRequest: "bypass" }));
  afterEach(() => retryServer.resetHandlers());
  afterAll(() => retryServer.close());

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries on 429 and succeeds when a later attempt returns 200", async () => {
    // given: first two calls return 429, third returns 200
    let callCount = 0;
    retryServer.use(
      http.get("*/retry-429", () => {
        callCount++;
        if (callCount < 3) return HttpResponse.json({}, { status: 429 });
        return HttpResponse.json({ ok: true });
      }),
    );

    // when
    const promise = api.get("/retry-429");
    await vi.advanceTimersByTimeAsync(1000); // retry 1 delay
    await vi.advanceTimersByTimeAsync(2000); // retry 2 delay
    const result = await promise;

    // expect
    expect(result.data).toEqual({ ok: true });
    expect(callCount).toBe(3);
  });

  it("retries on 503 and succeeds on the second attempt", async () => {
    // given
    let callCount = 0;
    retryServer.use(
      http.get("*/retry-503", () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({}, { status: 503 });
        return HttpResponse.json({ healthy: true });
      }),
    );

    const promise = api.get("/retry-503");
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.data).toEqual({ healthy: true });
    expect(callCount).toBe(2);
  });

  it("exhausts 3 retries on persistent 429, logs the error, and rejects", async () => {
    // given: always 429
    let callCount = 0;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    retryServer.use(
      http.get("*/always-429", () => {
        callCount++;
        return HttpResponse.json({ message: "rate limited" }, { status: 429 });
      }),
    );

    // Attach rejection handler immediately so the promise is never "unhandled"
    const promise = api.get("/always-429");
    const assertion = expect(promise).rejects.toMatchObject({ response: { status: 429 } });

    await vi.advanceTimersByTimeAsync(1000); // retry 1 delay
    await vi.advanceTimersByTimeAsync(2000); // retry 2 delay
    await vi.advanceTimersByTimeAsync(4000); // retry 3 delay — exhausted

    // expect: rejected after 4 total attempts (1 original + 3 retries)
    await assertion;
    expect(callCount).toBe(4);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[API Error]"));
    consoleSpy.mockRestore();
  });

  it("does NOT retry on 400 Bad Request — logs immediately and rejects", async () => {
    // given
    let callCount = 0;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    retryServer.use(
      http.post("*/bad-request", () => {
        callCount++;
        return HttpResponse.json({ message: "invalid input" }, { status: 400 });
      }),
    );

    // Attach rejection handler immediately to avoid unhandled rejection window
    const promise = api.post("/bad-request", {});
    const assertion = expect(promise).rejects.toMatchObject({ response: { status: 400 } });
    await vi.runAllTimersAsync();

    // expect: exactly one call, immediate log, reject
    await assertion;
    expect(callCount).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("→ 400"));
    consoleSpy.mockRestore();
  });

  it("does NOT retry on 401 Unauthorized", async () => {
    // given
    let callCount = 0;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    retryServer.use(
      http.get("*/protected", () => {
        callCount++;
        return HttpResponse.json({ message: "unauthorized" }, { status: 401 });
      }),
    );

    // Attach rejection handler immediately to avoid unhandled rejection window
    const promise = api.get("/protected");
    const assertion = expect(promise).rejects.toMatchObject({ response: { status: 401 } });
    await vi.runAllTimersAsync();

    await assertion;
    expect(callCount).toBe(1);
    consoleSpy.mockRestore();
  });

  it("logs and rejects unexpected non-Axios errors without retrying", async () => {
    // given
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawError = new Error("adapter exploded before Axios wrapped the error");

    // when
    const promise = api.get("/non-axios-error", {
      adapter: () => Promise.reject(rawError),
    });

    // expect
    await expect(promise).rejects.toBe(rawError);
    expect(consoleSpy).toHaveBeenCalledWith("[API Error] Unexpected non-Axios error:", rawError);
    consoleSpy.mockRestore();
  });
});

describe("endpoint wrapper contracts", () => {
  let getSpy: ReturnType<typeof vi.spyOn>;
  let postSpy: ReturnType<typeof vi.spyOn>;
  let putSpy: ReturnType<typeof vi.spyOn>;
  let deleteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSpy = vi.spyOn(api, "get").mockResolvedValue({ data: [] });
    postSpy = vi.spyOn(api, "post").mockResolvedValue({ data: { ok: true } });
    putSpy = vi.spyOn(api, "put").mockResolvedValue({ data: { ok: true } });
    deleteSpy = vi.spyOn(api, "delete").mockResolvedValue({ data: undefined });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the documented endpoint and payload for each API helper", async () => {
    await login({ username: "alice", password: "secret" });
    expect(postSpy).toHaveBeenLastCalledWith("/auth/login", {
      username: "alice",
      password: "secret",
    });

    await getExamSessions();
    expect(getSpy).toHaveBeenLastCalledWith("/exam-sessions");
    await startExamSession(11);
    expect(postSpy).toHaveBeenLastCalledWith("/exam-sessions/11/start");
    await submitExamSession(11);
    expect(postSpy).toHaveBeenLastCalledWith("/exam-sessions/11/submit");
    await getSessionResult(11);
    expect(getSpy).toHaveBeenLastCalledWith("/exam-sessions/11/result");
    await getExamSession(11);
    expect(getSpy).toHaveBeenLastCalledWith("/exam-sessions/11");
    await getExamSessionProblems(11);
    expect(getSpy).toHaveBeenLastCalledWith("/exam-sessions/11/problems");
    await getPublicTestcases(11, 22);
    expect(getSpy).toHaveBeenLastCalledWith("/exam-sessions/11/problems/22/testcases");

    await getUsers();
    expect(getSpy).toHaveBeenLastCalledWith("/users");
    await createUser({ username: "bob", password: "password", roleNames: ["candidate"] });
    expect(postSpy).toHaveBeenLastCalledWith("/users", {
      username: "bob",
      password: "password",
      roleNames: ["candidate"],
    });
    await createUsersBatch(3);
    expect(postSpy).toHaveBeenLastCalledWith("/users/batch", { count: 3 });
    await updateUser(7, { displayName: "Bob" });
    expect(putSpy).toHaveBeenLastCalledWith("/users/7", { displayName: "Bob" });
    await updateUserRoles(7, ["interviewer"]);
    expect(putSpy).toHaveBeenLastCalledWith("/users/7/roles", { roleNames: ["interviewer"] });
    await deleteUser(7);
    expect(deleteSpy).toHaveBeenLastCalledWith("/users/7");
    await getUserPassword(7);
    expect(getSpy).toHaveBeenLastCalledWith("/users/7/password");

    await getProblems();
    expect(getSpy).toHaveBeenLastCalledWith("/problems");
    await getProblemById(9);
    expect(getSpy).toHaveBeenLastCalledWith("/problems/9");
    await createProblem({ title: "Two Sum" } as never);
    expect(postSpy).toHaveBeenLastCalledWith("/problems", { title: "Two Sum" });
    await updateProblem(9, { title: "Updated" } as never);
    expect(putSpy).toHaveBeenLastCalledWith("/problems/9", { title: "Updated" });
    await deleteProblem(9);
    expect(deleteSpy).toHaveBeenLastCalledWith("/problems/9");
    await addTestcase(9, { inputData: "1", expectedOutput: "1", isPublic: true } as never);
    expect(postSpy).toHaveBeenLastCalledWith("/problems/9/testcases", {
      inputData: "1",
      expectedOutput: "1",
      isPublic: true,
    });
    await updateTestcase(9, 4, { expectedOutput: "2" });
    expect(putSpy).toHaveBeenLastCalledWith("/problems/9/testcases/4", { expectedOutput: "2" });
    await deleteTestcase(9, 4);
    expect(deleteSpy).toHaveBeenLastCalledWith("/problems/9/testcases/4");

    await createExamTemplateManual({ title: "Manual" } as never);
    expect(postSpy).toHaveBeenLastCalledWith("/exam-sessions/templates/manual", {
      title: "Manual",
    });
    await createExamTemplateRandom({ title: "Random" } as never);
    expect(postSpy).toHaveBeenLastCalledWith("/exam-sessions/templates/random", {
      title: "Random",
    });
    await updateExamTemplate(5, { title: "Updated" } as never);
    expect(putSpy).toHaveBeenLastCalledWith("/exam-sessions/templates/5", {
      title: "Updated",
    });
    await deleteExamTemplate(5);
    expect(deleteSpy).toHaveBeenLastCalledWith("/exam-sessions/templates/5");
    await listExamTemplates();
    expect(getSpy).toHaveBeenLastCalledWith("/exam-sessions/templates");
    await assignExamToCandidates(5, [1, 2]);
    expect(postSpy).toHaveBeenLastCalledWith("/exam-sessions/templates/5/assign", {
      candidateIds: [1, 2],
    });

    await createSubmission(11, {
      problemId: 22,
      language: "python3",
      sourceCode: "print(1)",
    } as never);
    expect(postSpy).toHaveBeenLastCalledWith("/exam-sessions/11/submissions", {
      problemId: 22,
      language: "python3",
      sourceCode: "print(1)",
    });
    await getSubmissionDetail(11, 33);
    expect(getSpy).toHaveBeenLastCalledWith("/exam-sessions/11/submissions/33");
    await listSessionSubmissions(11);
    expect(getSpy).toHaveBeenLastCalledWith("/exam-sessions/11/submissions");

    await getLanguages();
    expect(getSpy).toHaveBeenLastCalledWith("/languages");
    await saveExamDraft(11, 22, "python3", { code: "print(1)" });
    expect(putSpy).toHaveBeenLastCalledWith("/exam-sessions/11/drafts/22/python3", {
      code: "print(1)",
    });
    await getExamDrafts(11);
    expect(getSpy).toHaveBeenLastCalledWith("/exam-sessions/11/drafts");
    await getCandidatePassword(11);
    expect(getSpy).toHaveBeenLastCalledWith("/exam-sessions/11/candidate-password");
    await reportViolation(11, { violationType: "copy_paste", detail: "paste" } as never);
    expect(postSpy).toHaveBeenLastCalledWith("/exam-sessions/11/violations", {
      violationType: "copy_paste",
      detail: "paste",
    });
    await getViolations(11);
    expect(getSpy).toHaveBeenLastCalledWith("/exam-sessions/11/violations");
  });
});
