import Fastify from "fastify";
import sensible from "@fastify/sensible";
import websocket from "@fastify/websocket";
import { env } from "./env";
import { pool } from "./db/client";
import { healthRoutes } from "./routes/health";
import { metricsRoutes } from "./routes/metrics";
import { pingRoutes } from "./routes/ping";
import { httpRequestDurationSeconds } from "./metrics";
import { jwtPlugin } from "./plugins/jwt";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { problemRoutes } from "./routes/problems";
import { examRoutes } from "./routes/exams";
import { languageRoutes } from "./routes/languages";
import { submissionRoutes } from "./routes/submissions";
import { closeMq } from "./mq/client";
import { startJudgeResultConsumer } from "./mq/consumer";
import { redis } from "./db/redis";
import { assertSessionResultAccess } from "./services/submission.service";
import { subscribeToSession, unsubscribeClient } from "./ws/hub";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } } }
        : {}),
    },
  });

  await app.register(sensible);
  await app.register(websocket);
  await app.register(jwtPlugin);

  // Record HTTP RED metrics for every request. Uses the matched route URL
  // (e.g. /api/exam-sessions/:sessionId/submissions) so cardinality is bounded.
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions?.url ?? request.url;
    const status = String(Math.floor(reply.statusCode / 100)) + "xx";
    httpRequestDurationSeconds
      .labels(route, request.method, status)
      .observe(reply.elapsedTime / 1000);
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(metricsRoutes);
      await api.register(pingRoutes);
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(userRoutes, { prefix: "/users" });
      await api.register(problemRoutes, { prefix: "/problems" });
      await api.register(submissionRoutes, { prefix: "/exam-sessions" });
      await api.register(examRoutes, { prefix: "/exam-sessions" });
      await api.register(languageRoutes, { prefix: "/languages" });

      api.get("/ws", { websocket: true }, async (connection, request) => {
        const socket = connection.socket;
        const { token } = request.query as { token?: string };

        if (!token) {
          socket.close();
          return;
        }

        let currentUser: { id: number; isSuperuser: boolean; permissions: string[] };
        try {
          const payload = await app.jwt.verify<{
            sub: number;
            isSuperuser: boolean;
            permissions: string[];
          }>(token);
          currentUser = {
            id: payload.sub,
            isSuperuser: payload.isSuperuser,
            permissions: payload.permissions,
          };
        } catch {
          socket.close();
          return;
        }

        socket.on("message", async (raw: unknown) => {
          try {
            const message = JSON.parse(String(raw));
            if (
              message?.type !== "subscribe" ||
              typeof message.sessionId !== "number" ||
              !Number.isInteger(message.sessionId)
            ) {
              socket.send(JSON.stringify({ type: "error", message: "Invalid message" }));
              return;
            }

            await assertSessionResultAccess(currentUser, message.sessionId);
            subscribeToSession(message.sessionId, socket);
            socket.send(JSON.stringify({ type: "subscribed", sessionId: message.sessionId }));
          } catch {
            socket.send(JSON.stringify({ type: "error", message: "Forbidden" }));
          }
        });

        socket.on("close", () => unsubscribeClient(socket));
        socket.on("error", () => unsubscribeClient(socket));
      });
    },
    { prefix: "/api" },
  );

  if (env.NODE_ENV !== "test") {
    app.addHook("onReady", async () => {
      await startJudgeResultConsumer();
    });
  }

  app.addHook("onReady", async () => {
    redis.connect().catch((err) => app.log.warn({ err }, "Redis connect failed"));
  });

  app.addHook("onClose", async () => {
    await closeMq();
    await redis.quit().catch((err) => app.log.warn({ err }, "Redis quit failed"));
  });

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

if (require.main === module) {
  start();
}
