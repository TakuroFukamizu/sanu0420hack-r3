import Fastify, { type FastifyInstance } from "fastify";
import { registerHttpRoutes } from "./http.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerHttpRoutes(app);
  return app;
}
