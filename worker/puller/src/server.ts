import http from "http";
import type { Puller } from "./puller";

export interface ServerOptions {
  port: number;
  puller: Puller;
  // Shared secret required on POST /reload via X-Reload-Token header.
  reloadToken?: string;
}

export function createServer(options: ServerOptions): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.method === "POST" && req.url === "/reload") {
      if (options.reloadToken) {
        const token = req.headers["x-reload-token"];
        if (token !== options.reloadToken) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid token" }));
          return;
        }
      }
      try {
        const summary = await options.puller.reconcile();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(summary));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
}
