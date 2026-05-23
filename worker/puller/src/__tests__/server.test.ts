import http from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../server";
import type { Puller } from "../puller";

function fakePuller(): Pick<Puller, "reconcile"> & { reconcile: ReturnType<typeof vi.fn> } {
  return {
    reconcile: vi.fn().mockResolvedValue({ pulled: [], skipped: ["cpp17"], failed: [] }),
  } as never;
}

async function request(
  server: http.Server,
  method: string,
  url: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const address = server.address();
    if (!address || typeof address === "string") {
      reject(new Error("server not listening"));
      return;
    }
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: url,
        method,
        headers,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => {
          raw += chunk.toString("utf8");
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw });
          }
        });
      }
    );
    req.once("error", reject);
    req.end();
  });
}

describe("puller HTTP server", () => {
  let puller: ReturnType<typeof fakePuller>;
  let server: http.Server;

  beforeEach(() => {
    puller = fakePuller();
    server = createServer({ port: 0, puller: puller as never });
    server.listen(0);
  });

  afterEach(() => {
    server.close();
  });

  it("GET /healthz returns 200", async () => {
    const res = await request(server, "GET", "/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("POST /reload triggers reconcile and returns summary", async () => {
    const res = await request(server, "POST", "/reload");
    expect(res.status).toBe(200);
    expect(puller.reconcile).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ skipped: ["cpp17"] });
  });

  it("POST /reload returns 401 when token is required and missing/wrong", async () => {
    server.close();
    server = createServer({ port: 0, puller: puller as never, reloadToken: "secret" });
    server.listen(0);

    const wrong = await request(server, "POST", "/reload", { "x-reload-token": "nope" });
    expect(wrong.status).toBe(401);
    expect(puller.reconcile).not.toHaveBeenCalled();

    const right = await request(server, "POST", "/reload", { "x-reload-token": "secret" });
    expect(right.status).toBe(200);
    expect(puller.reconcile).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for unknown paths", async () => {
    const res = await request(server, "GET", "/nope");
    expect(res.status).toBe(404);
  });
});
