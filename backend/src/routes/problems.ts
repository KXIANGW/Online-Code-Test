import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "../hooks/authenticate";
import {
  listProblems,
  createProblem,
  getProblem,
  updateProblem,
  deleteProblem,
  addTestcase,
  updateTestcase,
  deleteTestcase,
  setProblemLanguageLimits,
} from "../services/problem.service";
import { BadRequestError } from "../errors";

const testcaseSchema = z.object({
  orderIndex: z.number().int().min(0),
  isPublic: z.boolean(),
  inputData: z.string(),
  expectedOutput: z.string(),
});

const languageLimitSchema = z.object({
  language: z.string().min(1).max(32),
  timeMultiplier: z.number().positive(),
  memoryMultiplier: z.number().positive(),
});

const createProblemBody = z.object({
  title: z.string().min(1).max(255),
  descriptionMd: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  timeLimitMs: z.number().int().min(1),
  memoryLimitMb: z.number().int().min(1),
  outputLimitKb: z.number().int().min(1).optional(),
  testcases: z.array(testcaseSchema).optional(),
  languageLimits: z.array(languageLimitSchema).optional(),
});

const updateProblemBody = z.object({
  title: z.string().min(1).max(255).optional(),
  descriptionMd: z.string().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  timeLimitMs: z.number().int().min(1).optional(),
  memoryLimitMb: z.number().int().min(1).optional(),
  outputLimitKb: z.number().int().min(1).optional(),
});

export const problemRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [authenticate] }, async (request) => {
    return listProblems(request.user);
  });

  app.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const result = createProblemBody.safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);
    const problem = await createProblem(request.user, result.data);
    return reply.status(201).send(problem);
  });

  app.get("/:id", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return getProblem(request.user, parseInt(id));
  });

  app.put("/:id", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = updateProblemBody.safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);
    return updateProblem(request.user, parseInt(id), result.data);
  });

  app.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteProblem(request.user, parseInt(id));
    return reply.status(204).send();
  });

  app.post("/:id/testcases", { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = testcaseSchema.safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);
    const tc = await addTestcase(request.user, parseInt(id), result.data);
    return reply.status(201).send(tc);
  });

  app.put("/:id/testcases/:tcId", { preHandler: [authenticate] }, async (request) => {
    const { id, tcId } = request.params as { id: string; tcId: string };
    const result = testcaseSchema.partial().safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);
    return updateTestcase(request.user, parseInt(id), parseInt(tcId), result.data);
  });

  app.delete("/:id/testcases/:tcId", { preHandler: [authenticate] }, async (request, reply) => {
    const { id, tcId } = request.params as { id: string; tcId: string };
    await deleteTestcase(request.user, parseInt(id), parseInt(tcId));
    return reply.status(204).send();
  });

  app.put("/:id/languages", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = z.array(languageLimitSchema).safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);
    return setProblemLanguageLimits(request.user, parseInt(id), result.data);
  });
};
