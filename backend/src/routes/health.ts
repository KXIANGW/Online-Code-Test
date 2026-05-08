import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_req, reply) => {
    const start = Date.now();
    try {
      await db.execute(sql`SELECT 1`);
      return reply.send({
        status: "ok",
        dbLatencyMs: Date.now() - start,
        uptimeSec: Math.round(process.uptime()),
      });
    } catch (err) {
      app.log.error({ err }, "health check db ping failed");
      return reply.code(503).send({
        status: "degraded",
        error: "database_unreachable",
      });
    }
  });
}
