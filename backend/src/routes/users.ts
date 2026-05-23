import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "../hooks/authenticate";
import {
  listUsers,
  createUser,
  batchCreateCandidates,
  getUser,
  updateUser,
  updateUserRoles,
  deleteUser,
  getUserPassword,
} from "../services/user.service";
import { BadRequestError } from "../errors";
import { parsePositiveIntParam } from "./params";

const createUserBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(6),
  displayName: z.string().max(128).optional(),
  roleNames: z.array(z.string()).optional(),
});

const updateUserBody = z.object({
  displayName: z.string().max(128).optional(),
  password: z.string().min(6).optional(),
});

const batchBody = z.object({
  count: z.number().int().min(1).max(100),
});

const updateRolesBody = z.object({
  roleNames: z.array(z.string()),
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

  app.get("/:id/password", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return getUserPassword(request.user, parsePositiveIntParam(id, "id"));
  });

  app.put("/:id/roles", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = updateRolesBody.safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);
    return updateUserRoles(request.user, parsePositiveIntParam(id, "id"), result.data.roleNames);
  });

  app.put("/:id", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = updateUserBody.safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);
    return updateUser(request.user, parsePositiveIntParam(id, "id"), result.data);
  });

  app.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteUser(request.user, parsePositiveIntParam(id, "id"));
    return reply.status(204).send();
  });
};
