import type { FastifyInstance } from "fastify";

export async function pingRoutes(app: FastifyInstance) {
  app.get("/ping", async () => ({ pong: true, ts: new Date().toISOString() }));
}
