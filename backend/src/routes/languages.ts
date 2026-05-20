import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../hooks/authenticate";
import { listLanguages } from "../services/language.service";

export const languageRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [authenticate] }, async () => {
    return listLanguages();
  });
};
