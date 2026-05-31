import { describe, it, expect } from "vitest";
import { api } from "../helpers/api.js";

describe("Health checks", () => {
  it("GET /api/health returns 200 with db latency", async () => {
    const body = await api<{ status: string; dbLatencyMs: number }>(
      "GET",
      "/health",
      undefined,
      undefined,
      200,
    );
    expect(body.status).toBe("ok");
    expect(typeof body.dbLatencyMs).toBe("number");
    expect(body.dbLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("GET /api/ping returns 200", async () => {
    const body = await api<unknown>("GET", "/ping", undefined, undefined, 200);
    expect(body).toBeDefined();
  });

  it("Worker healthz returns 200", async () => {
    const res = await fetch("http://localhost:8080/healthz");
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});
