import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "../hooks/authenticate";
import { BadRequestError } from "../errors";
import {
  createSubmission,
  getSessionResult,
  getSubmissionDetail,
  listSessionSubmissions,
} from "../services/submission.service";
import { parsePositiveIntParam } from "./params";

const createSubmissionBody = z.object({
  examSessionProblemId: z.number().int().positive(),
  language: z.string().min(1).max(32),
  sourceCode: z.string().min(1),
  type: z.enum(["simple", "formal"]).default("formal"),
});

export const submissionRoutes: FastifyPluginAsync = async (app) => {
  app.post("/:sessionId/submissions", { preHandler: [authenticate] }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const result = createSubmissionBody.safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);

    const submission = await createSubmission(
      request.user,
      parsePositiveIntParam(sessionId, "sessionId"),
      result.data,
    );
    return reply.status(202).send(submission);
  });

  app.get("/:sessionId/submissions", { preHandler: [authenticate] }, async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return listSessionSubmissions(request.user, parsePositiveIntParam(sessionId, "sessionId"));
  });

  app.get(
    "/:sessionId/submissions/:submissionId",
    { preHandler: [authenticate] },
    async (request) => {
      const { sessionId, submissionId } = request.params as {
        sessionId: string;
        submissionId: string;
      };
      return getSubmissionDetail(
        request.user,
        parsePositiveIntParam(sessionId, "sessionId"),
        parsePositiveIntParam(submissionId, "submissionId"),
      );
    },
  );

  app.get("/:sessionId/result", { preHandler: [authenticate] }, async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return getSessionResult(request.user, parsePositiveIntParam(sessionId, "sessionId"));
  });
};
