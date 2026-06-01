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

  it("GET /api/metrics returns Prometheus-format text", async () => {
    const res = await fetch("http://localhost:3000/api/metrics");
    expect(res.ok).toBe(true);
    const text = await res.text();
    // Prometheus format always starts with # HELP or # TYPE lines
    expect(text).toMatch(/^#\s+(HELP|TYPE)/m);
  });
});
