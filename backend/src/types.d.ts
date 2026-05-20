import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: number; isSuperuser: boolean; permissions: string[] };
    user: { id: number; isSuperuser: boolean; permissions: string[] };
  }
}
