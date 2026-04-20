import Fastify, { type FastifyInstance } from "fastify";
import { SessionRuntime } from "./session-runtime.js";
import { registerHttpRoutes } from "./http.js";

export interface BuildAppOptions {
  runtime?: SessionRuntime;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const runtime = opts.runtime ?? new SessionRuntime();

  registerHttpRoutes(app);
  app.decorate("sessionRuntime", runtime);

  app.addHook("onClose", async () => {
    runtime.stop();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    sessionRuntime: SessionRuntime;
  }
}
