import type { FastifyInstance } from "fastify";
import { registry } from "../metrics";

// Exposes Prometheus exposition format at GET /api/metrics.
// Not behind JWT — Prometheus has no concept of bearer tokens; production
// should restrict access via NetworkPolicy / nginx allowlist.
export async function metricsRoutes(app: FastifyInstance) {
  app.get("/metrics", async (_req, reply) => {
    const body = await registry.metrics();
    reply.header("Content-Type", registry.contentType).send(body);
  });
}
