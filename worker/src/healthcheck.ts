import http from "node:http";
import { pool } from "./db/client";

export interface HealthState {
  rabbitConnected: boolean;
}

export function createHealthServer(state: HealthState, port = 8080): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/healthz") {
      res.writeHead(404).end();
      return;
    }

    const dbOk = await pool.query("SELECT 1").then(() => true).catch(() => false);
    const ok = state.rabbitConnected && dbOk;

    res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: ok ? "ok" : "degraded", rabbit: state.rabbitConnected, db: dbOk }));
  });

  server.listen(port, () => {
    console.log(`[worker] healthcheck listening on :${port}`);
  });

  return server;
}
