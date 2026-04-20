import Fastify, { type FastifyInstance } from "fastify";
import { SessionRuntime } from "./session-runtime.js";
import { registerHttpRoutes } from "./http.js";
import { Orchestrator } from "./orchestrator/index.js";
import type { AiGateway } from "./ai/index.js";
import { MockAiGateway } from "./ai/mock.js";
import { GeminiGateway } from "./ai/gemini.js";
import { GeminiProxyGateway } from "./ai/gemini-proxy.js";
import { BgmController } from "./midi/bgm-controller.js";
import { selectMidiOutput, type MidiOutput } from "./midi/output.js";

export interface BuildAppOptions {
  runtime?: SessionRuntime;
  /** テスト等で Orchestrator を差し替え / 無効化する時に使う */
  orchestrator?: Orchestrator | null;
  /** テストから gateway を直接注入するときに使う (指定時は GEMINI_API_KEY を無視する)。*/
  gateway?: AiGateway;
  /** テスト等で BGM を差し替え / 無効化する時に使う (null で完全無効化)。*/
  bgm?: BgmController | null;
  /** BgmController を内部生成するときに使う MIDI 出力。省略時は MIDI_PORT env から選択。*/
  midiOutput?: MidiOutput;
}

/**
 * AI gateway を env から選ぶ。優先順位:
 *   1. GEMINI_PROXY_URL  → GeminiProxyGateway (Cloud Run 経由)
 *   2. GEMINI_API_KEY    → GeminiGateway (直叩き)
 *   3. いずれも無し       → MockAiGateway
 * ハッカソン会場 WiFi 障害やキー失効時でも Mock で完走するためのフェイルソフト。
 * 両方が同時に設定されている場合は proxy を優先する (直叩きより運用が簡単なため)。
 */
function selectGateway(): AiGateway {
  const proxyUrl = process.env.GEMINI_PROXY_URL?.trim();
  if (proxyUrl) {
    console.log("[ai] GEMINI_PROXY_URL present, using GeminiProxyGateway");
    return new GeminiProxyGateway(proxyUrl);
  }
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

  const bgm =
    opts.bgm === null
      ? null
      : (opts.bgm ??
        new BgmController(
          runtime,
          opts.midiOutput ?? selectMidiOutput(process.env.MIDI_PORT),
        ));

  registerHttpRoutes(app);
  app.decorate("sessionRuntime", runtime);
  app.decorate("orchestrator", orchestrator);
  app.decorate("bgmController", bgm);

  orchestrator?.start();
  bgm?.start();

  app.addHook("onClose", async () => {
    bgm?.dispose();
    orchestrator?.stop();
    runtime.stop();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    sessionRuntime: SessionRuntime;
    orchestrator: Orchestrator | null;
    bgmController: BgmController | null;
  }
}
