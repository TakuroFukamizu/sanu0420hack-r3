import type { FastifyInstance } from "fastify";

export function registerHttpRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({ status: "ok" }));
}
