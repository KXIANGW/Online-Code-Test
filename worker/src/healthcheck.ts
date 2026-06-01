import http from "node:http";
import { pool } from "./db/client";
import { registry } from "./metrics";

export interface HealthState {
  rabbitConnected: boolean;
  rootfsReady?: () => Promise<boolean>;
}

export function createHealthServer(state: HealthState, port = 8080): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/healthz") {
      const dbOk = await pool.query("SELECT 1").then(() => true).catch(() => false);
      const rootfsOk = state.rootfsReady ? await state.rootfsReady().catch(() => false) : true;
      const ok = state.rabbitConnected && dbOk && rootfsOk;
      res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: ok ? "ok" : "degraded",
        rabbit: state.rabbitConnected,
        db: dbOk,
        ...(state.rootfsReady ? { rootfs: rootfsOk } : {}),
      }));
      return;
    }

    if (req.url === "/metrics") {
      try {
        const body = await registry.metrics();
        res.writeHead(200, { "Content-Type": registry.contentType });
        res.end(body);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(String(err));
      }
      return;
    }

    res.writeHead(404).end();
  });

  server.listen(port, () => {
    console.log(`[worker] healthcheck + metrics listening on :${port}`);
  });

  return server;
}
