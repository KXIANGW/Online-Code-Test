import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "../db/client";
import { createHealthServer, type HealthState } from "../healthcheck";

let server: http.Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
  vi.clearAllMocks();
});

async function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${path}`, (res) => {
        let body = "";
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

describe("healthcheck server", () => {
  it("returns 200 when rabbit is connected and db is healthy", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
    const state: HealthState = { rabbitConnected: true };
    server = createHealthServer(state, 18080);

    const { status, body } = await get(18080, "/healthz");

    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ status: "ok", rabbit: true, db: true });
  });

  it("returns 503 when rabbit is disconnected", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
    const state: HealthState = { rabbitConnected: false };
    server = createHealthServer(state, 18081);

    const { status, body } = await get(18081, "/healthz");

    expect(status).toBe(503);
    expect(JSON.parse(body)).toMatchObject({ status: "degraded", rabbit: false });
  });

  it("returns 503 when db is unreachable", async () => {
    vi.mocked(pool.query).mockRejectedValue(new Error("connection refused"));
    const state: HealthState = { rabbitConnected: true };
    server = createHealthServer(state, 18082);

    const { status, body } = await get(18082, "/healthz");

    expect(status).toBe(503);
    expect(JSON.parse(body)).toMatchObject({ status: "degraded", db: false });
  });

  it("returns 404 for unknown paths", async () => {
    const state: HealthState = { rabbitConnected: true };
    server = createHealthServer(state, 18083);

    const { status } = await get(18083, "/unknown");

    expect(status).toBe(404);
  });
});
