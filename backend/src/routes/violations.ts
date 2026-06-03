import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { authenticate } from "../hooks/authenticate";
import { db } from "../db/client";
import { examViolations, examSessions } from "../db/schema";
import { parsePositiveIntParam } from "./params";
import { BadRequestError } from "../errors";
import { getFreshSessionOrThrow } from "../services/session-lifecycle.service";

const VIOLATION_TYPES = ["fullscreen_exit", "tab_switch", "window_blur", "paste", "copy"] as const;

const reportViolationBody = z.object({
  type: z.enum(VIOLATION_TYPES),
  detail: z.string().max(500).optional(),
  occurredAt: z.string().datetime().optional(),
});

export const violationRoutes: FastifyPluginAsync = async (app) => {
  // POST /exam-sessions/:id/violations
  // 考生上報一筆違規事件（需為該場次的 candidate）
  app.post("/:id/violations", { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const sessionId = parsePositiveIntParam(id, "id");

    const result = reportViolationBody.safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);

    // 確認該場次屬於發出請求的考生，避免任意回報他人場次
    const [session] = await db
      .select({ id: examSessions.id })
      .from(examSessions)
      .where(and(eq(examSessions.id, sessionId), eq(examSessions.candidateId, request.user.id)))
      .limit(1);

    if (!session) return reply.status(403).send({ message: "Forbidden" });

    await db.insert(examViolations).values({
      sessionId,
      type: result.data.type,
      detail: result.data.detail ?? null,
      occurredAt: result.data.occurredAt ? new Date(result.data.occurredAt) : new Date(),
    });

    return reply.status(204).send();
  });

  // GET /exam-sessions/:id/violations
  // 面試官查詢特定場次的所有違規紀錄（需有 exam:manage 權限或為 superuser，且須為該場次建立者）
  app.get("/:id/violations", { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const sessionId = parsePositiveIntParam(id, "id");

    const canRead = request.user.isSuperuser || request.user.permissions.includes("exam:manage");
    if (!canRead) return reply.status(403).send({ message: "Forbidden" });

    const session = await getFreshSessionOrThrow(sessionId);
    if (!request.user.isSuperuser && session.createdBy !== request.user.id) {
      return reply.status(403).send({ message: "Forbidden" });
    }

    const violations = await db
      .select()
      .from(examViolations)
      .where(eq(examViolations.sessionId, sessionId))
      .orderBy(asc(examViolations.occurredAt));

    return reply.send(violations);
  });
};
