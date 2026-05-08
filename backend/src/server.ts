import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { env } from "./env";
import { pool } from "./db/client";
import { healthRoutes } from "./routes/health";
import { pingRoutes } from "./routes/ping";

async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } } }
        : {}),
    },
  });

  await app.register(sensible);
  await app.register(async (api) => {
    await api.register(healthRoutes);
    await api.register(pingRoutes);
  }, { prefix: "/api" });

  return app;
}

async function start() {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error({ err }, "failed to start");
    process.exit(1);
  }
}

start();
