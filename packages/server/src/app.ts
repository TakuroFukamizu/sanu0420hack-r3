import Fastify, { type FastifyInstance } from "fastify";
import { SessionRuntime } from "./session-runtime.js";
import { registerHttpRoutes } from "./http.js";
import { Orchestrator } from "./orchestrator/index.js";
import type { AiGateway } from "./ai/index.js";
import { MockAiGateway } from "./ai/mock.js";
import { GeminiGateway } from "./ai/gemini.js";

export interface BuildAppOptions {
  runtime?: SessionRuntime;
  /** テスト等で Orchestrator を差し替え / 無効化する時に使う */
  orchestrator?: Orchestrator | null;
  /** テストから gateway を直接注入するときに使う (指定時は GEMINI_API_KEY を無視する)。*/
  gateway?: AiGateway;
}

/**
 * GEMINI_API_KEY が設定されていれば GeminiGateway、無ければ MockAiGateway を返す。
 * ハッカソン会場 WiFi 障害やキー失効時でも Mock で完走するためのフェイルソフト。
 */
function selectGateway(): AiGateway {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    console.log("[ai] GEMINI_API_KEY not set, using MockAiGateway");
    return new MockAiGateway();
  }
  console.log("[ai] GEMINI_API_KEY present, using GeminiGateway");
  return new GeminiGateway(key);
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const runtime = opts.runtime ?? new SessionRuntime();
  const gateway = opts.gateway ?? selectGateway();
  const refineQualitative = process.env.AI_REFINE_QUALITATIVE === "true";
  const orchestrator =
    opts.orchestrator === null
      ? null
      : (opts.orchestrator ??
        new Orchestrator(runtime, undefined, undefined, {
          gateway,
          refineQualitative,
        }));

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
