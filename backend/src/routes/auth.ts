import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { login } from "../services/auth.service";
import { BadRequestError } from "../errors";

const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", async (request, reply) => {
    const result = loginBodySchema.safeParse(request.body);
    if (!result.success) throw BadRequestError("username and password are required");

    const token = await login(app, result.data.username, result.data.password);
    return reply.send({ token });
  });
};
