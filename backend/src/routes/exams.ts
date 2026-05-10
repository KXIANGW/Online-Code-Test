import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "../hooks/authenticate";
import {
  createExamSession,
  createExamSessionRandom,
  listExamSessions,
  getExamSession,
  startExamSession,
  cancelExamSession,
  getExamSessionProblems,
} from "../services/exam.service";
import { BadRequestError } from "../errors";

const manualSessionBody = z.object({
  candidateId: z.number().int(),
  durationMinutes: z.number().int().min(1),
  problems: z.array(
    z.object({
      problemId: z.number().int(),
      scoreWeight: z.number().int().min(1),
      orderIndex: z.number().int().min(1),
    })
  ).min(1),
});

const randomSessionBody = z.object({
  candidateId: z.number().int(),
  durationMinutes: z.number().int().min(1),
  distribution: z.object({
    easy: z.number().int().min(0).optional(),
    medium: z.number().int().min(0).optional(),
    hard: z.number().int().min(0).optional(),
  }),
  scoreWeight: z.number().int().min(1),
});

export const examRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    if ("problems" in body) {
      const result = manualSessionBody.safeParse(body);
      if (!result.success) throw BadRequestError(result.error.message);
      const session = await createExamSession(request.user, result.data);
      return reply.status(201).send(session);
    }

    if ("distribution" in body) {
      const result = randomSessionBody.safeParse(body);
      if (!result.success) throw BadRequestError(result.error.message);
      const session = await createExamSessionRandom(request.user, result.data);
      return reply.status(201).send(session);
    }

    throw BadRequestError("Body must contain either 'problems' (manual) or 'distribution' (random)");
  });

  app.get("/", { preHandler: [authenticate] }, async (request) => {
    return listExamSessions(request.user);
  });

  app.get("/:id", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return getExamSession(request.user, parseInt(id));
  });

  app.post("/:id/start", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return startExamSession(request.user, parseInt(id));
  });

  app.post("/:id/cancel", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return cancelExamSession(request.user, parseInt(id));
  });

  app.get("/:id/problems", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return getExamSessionProblems(request.user, parseInt(id));
  });
};
