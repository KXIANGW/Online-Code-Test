import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "../hooks/authenticate";
import {
  listUsers,
  createUser,
  batchCreateCandidates,
  getUser,
  deleteUser,
} from "../services/user.service";
import { BadRequestError } from "../errors";
import { parsePositiveIntParam } from "./params";

const createUserBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(6),
  displayName: z.string().max(128).optional(),
  roleNames: z.array(z.string()).optional(),
});

const batchBody = z.object({
  count: z.number().int().min(1).max(100),
});

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [authenticate] }, async (request) => {
    return listUsers(request.user);
  });

  app.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const result = createUserBody.safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);
    const user = await createUser(request.user, result.data);
    return reply.status(201).send(user);
  });

  app.post("/batch", { preHandler: [authenticate] }, async (request, reply) => {
    const result = batchBody.safeParse(request.body);
    if (!result.success) throw BadRequestError("count (integer 1-100) is required");
    const created = await batchCreateCandidates(request.user, result.data.count);
    return reply.status(201).send(created);
  });

  app.get("/:id", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return getUser(request.user, parsePositiveIntParam(id, "id"));
  });

  app.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteUser(request.user, parsePositiveIntParam(id, "id"));
    return reply.status(204).send();
  });
};
