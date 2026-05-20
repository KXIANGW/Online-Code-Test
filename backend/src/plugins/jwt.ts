import fp from "fastify-plugin";
import fjwt from "@fastify/jwt";
import { env } from "../env";

export const jwtPlugin = fp(async (app) => {
  await app.register(fjwt, {
    secret: env.JWT_SECRET,
    formatUser: (payload: { sub: number; isSuperuser: boolean; permissions: string[] }) => ({
      id: payload.sub,
      isSuperuser: payload.isSuperuser,
      permissions: payload.permissions,
    }),
  });
});
