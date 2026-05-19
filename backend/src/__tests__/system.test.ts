import { createRequire } from "module";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "./helpers/app";
import { loginAs, seedUser, truncateTestTables } from "./helpers/db";
import type { FastifyInstance } from "fastify";

type TestWebSocket = {
  send(data: string): void;
  close(): void;
  once(event: "open" | "close" | "message", cb: (data?: unknown) => void): void;
};

type WebSocketCtor = new (url: string) => TestWebSocket;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateTestTables();
});

describe("system routes", () => {
  it("GET /api/ping returns a timestamped pong", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ping" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ pong: boolean; ts: string }>();
    expect(body.pong).toBe(true);
    expect(new Date(body.ts).toString()).not.toBe("Invalid Date");
  });

  it("GET /api/health checks database connectivity", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string; dbLatencyMs: number }>()).toMatchObject({
      status: "ok",
      dbLatencyMs: expect.any(Number),
    });
  });
});

describe("GET /api/ws", () => {
  it("closes connections without token and reports invalid messages for authenticated clients", async () => {
    const require = createRequire(__filename);
    const WebSocket = require("ws") as WebSocketCtor;

    await seedUser({
      username: "candidate1",
      password: "Cand@1234",
      displayName: "Candidate",
      roleNames: ["candidate"],
    });
    const token = await loginAs(app, "candidate1", "Cand@1234");

    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string")
      throw new Error("server did not bind a TCP port");
    const baseUrl = `ws://127.0.0.1:${address.port}/api/ws`;

    const missingToken = new WebSocket(baseUrl);
    await waitFor(missingToken, "close");

    const authed = new WebSocket(`${baseUrl}?token=${token}`);
    await waitFor(authed, "open");
    authed.send(JSON.stringify({ type: "bogus" }));
    const raw = await waitFor(authed, "message");
    authed.close();

    expect(JSON.parse(String(raw))).toEqual({ type: "error", message: "Invalid message" });
  });
});

function waitFor(socket: TestWebSocket, event: "open" | "close" | "message"): Promise<unknown> {
  return new Promise((resolve) => socket.once(event, resolve));
}
