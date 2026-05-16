import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { api, updateUserRoles } from "../api/client";

let capturedAuthHeader: string | null | undefined = undefined;
let capturedRolesRequest: { url: string; method: string; body: unknown } | null = null;

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
    return HttpResponse.json({ id: Number(params.id), roles: (capturedRolesRequest.body as { roleNames: string[] }).roleNames });
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
    const token =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature";
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
