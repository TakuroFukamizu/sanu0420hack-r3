import Fastify, { type FastifyInstance } from "fastify";
import { SessionRuntime } from "./session-runtime.js";
import { registerHttpRoutes } from "./http.js";
import { Orchestrator } from "./orchestrator/index.js";
import type { AiGateway } from "./ai/index.js";
import { MockAiGateway } from "./ai/mock.js";
import { GeminiGateway } from "./ai/gemini.js";
import { GeminiProxyGateway } from "./ai/gemini-proxy.js";
import {
  MidiController,
  NullMidiOutput,
  openMidiOutput,
  type MidiOutput,
} from "./midi/index.js";

export interface BuildAppOptions {
  runtime?: SessionRuntime;
  /** テスト等で Orchestrator を差し替え / 無効化する時に使う */
  orchestrator?: Orchestrator | null;
  /** テストから gateway を直接注入するときに使う (指定時は GEMINI_API_KEY を無視する)。*/
  gateway?: AiGateway;
  /**
   * MIDI 層の注入。
   * - `undefined` (未指定): NullMidiOutput + MidiController を attach (デフォルト)。
   *   実 MIDI ポートは index.ts の起動時に attachRealMidi() で差し替える。
   * - `null`: MidiController を attach しない (テストで BGM 層を切りたい時)。
   * - `{ output }`: 与えた output で MidiController を attach する。
   */
  midi?: { output: MidiOutput } | null;
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

  // デフォルトでは Null の MidiController を即 attach する (onClose で確実に stop
  // されるように)。実際の MIDI ポートは attachRealMidi() で非同期に差し替える。
  const initialMidiOutput: MidiOutput =
    opts.midi === undefined
      ? new NullMidiOutput()
      : (opts.midi?.output ?? new NullMidiOutput());
  const midiController =
    opts.midi === null ? null : new MidiController(runtime, initialMidiOutput);

  registerHttpRoutes(app);
  app.decorate("sessionRuntime", runtime);
  app.decorate("orchestrator", orchestrator);
  app.decorate("midiController", midiController);
  app.decorate("midiOutput", initialMidiOutput);

  orchestrator?.start();
  midiController?.start();

  app.addHook("onClose", async () => {
    midiController?.stop();
    orchestrator?.stop();
    runtime.stop();
  });

  return app;
}

/**
 * 実 MIDI ポートを非同期に開き、既存の MidiController を新しい output で差し替える。
 * index.ts から app.ready() 後に await で呼ぶ。テストでは使わない。
 */
export async function attachRealMidi(
  app: FastifyInstance,
  portName: string | undefined,
): Promise<void> {
  const output = await openMidiOutput(portName);
  const old = app.midiController;
  old?.stop();
  const controller = new MidiController(app.sessionRuntime, output);
  // decorate 済みなので、型付きの参照を上書きする (fastify は再 decorate を許さない)。
  (app as unknown as { midiController: MidiController | null }).midiController =
    controller;
  (app as unknown as { midiOutput: MidiOutput }).midiOutput = output;
  controller.start();
}

declare module "fastify" {
  interface FastifyInstance {
    sessionRuntime: SessionRuntime;
    orchestrator: Orchestrator | null;
    midiController: MidiController | null;
    midiOutput: MidiOutput;
  }
}
