import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { api } from "../api/client";

let capturedAuthHeader: string | null | undefined = undefined;

const server = setupServer(
  http.get("*/api/ping", ({ request }) => {
    capturedAuthHeader = request.headers.get("Authorization");
    return HttpResponse.json({ pong: true, ts: new Date().toISOString() });
  })
);

describe("api request interceptor", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
  afterAll(() => server.close());

  beforeEach(() => {
    capturedAuthHeader = undefined;
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
