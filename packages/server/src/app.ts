import Fastify, { type FastifyInstance } from "fastify";
import { SessionRuntime } from "./session-runtime.js";
import { registerHttpRoutes } from "./http.js";
import { Orchestrator } from "./orchestrator/index.js";

export interface BuildAppOptions {
  runtime?: SessionRuntime;
  /** テスト等で Orchestrator を差し替え / 無効化する時に使う */
  orchestrator?: Orchestrator | null;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const runtime = opts.runtime ?? new SessionRuntime();
  const orchestrator =
    opts.orchestrator === null
      ? null
      : (opts.orchestrator ?? new Orchestrator(runtime));

  registerHttpRoutes(app);
  app.decorate("sessionRuntime", runtime);
  app.decorate("orchestrator", orchestrator);

  orchestrator?.start();

  app.addHook("onClose", async () => {
    orchestrator?.stop();
    runtime.stop();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    sessionRuntime: SessionRuntime;
    orchestrator: Orchestrator | null;
  }
}
