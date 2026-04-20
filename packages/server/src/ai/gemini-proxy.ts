/**
 * GeminiProxyGateway — Cloud Run 上にデプロイされたテキスト生成プロキシを叩く AiGateway 実装。
 *
 * プロキシ契約 (2026-04-21 時点):
 *   POST <url>
 *   Body: { "mode": "text", "prompt": string }
 *   Res:  { "mode": "text", "text": string }
 *
 * GeminiGateway と違い responseMimeType でモデルに JSON 出力を強制できないので、
 * `planSession` / `generateVerdict` の応答は markdown コードフェンスを含み得る。
 * narrow 前に `extractJsonText()` でフェンスを剥がす。
 *
 * 失敗時は例外を投げる (呼び出し側 Orchestrator.safePlan 等が MockAiGateway へ silent fallback)。
 */

import type { SetupData } from "@app/shared";
import type {
  AiGateway,
  QualitativeRefineArgs,
  SessionPlan,
  VerdictArgs,
} from "./index.js";
import {
  buildPlanPrompt,
  buildRefinePrompt,
  buildVerdictPrompt,
  normalizePlan,
  normalizeVerdict,
} from "./gemini.js";

interface ProxyResponse {
  mode?: unknown;
  text?: unknown;
}

export class GeminiProxyGateway implements AiGateway {
  readonly name: string = "gemini-proxy";
  private readonly url: string;

  constructor(url: string) {
    if (!url) {
      throw new Error("GeminiProxyGateway: url is required");
    }
    this.url = url;
  }

  async planSession(setup: SetupData): Promise<SessionPlan> {
    const text = await this.callProxy(buildPlanPrompt(setup));
    if (!text) {
      throw new Error("planSession: empty response text");
    }
    const json = extractJsonText(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      throw new Error(
        `planSession: JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return normalizePlan(parsed, setup);
  }

  async refineQualitative(args: QualitativeRefineArgs): Promise<string> {
    const text = (await this.callProxy(buildRefinePrompt(args)))
      .trim()
      .slice(0, 120);
    return text.length > 0 ? text : args.qualitativeFromScoreFn;
  }

  async generateVerdict(args: VerdictArgs): Promise<string[]> {
    const text = await this.callProxy(buildVerdictPrompt(args));
    if (!text) {
      throw new Error("generateVerdict: empty response text");
    }
    const json = extractJsonText(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      throw new Error(
        `generateVerdict: JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return normalizeVerdict(parsed);
  }

  private async callProxy(prompt: string): Promise<string> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "text", prompt }),
    });
    if (!res.ok) {
      throw new Error(
        `GeminiProxyGateway: proxy returned HTTP ${res.status} ${res.statusText}`,
      );
    }
    const body = (await res.json()) as ProxyResponse;
    const text = body.text;
    if (typeof text !== "string") {
      throw new Error(
        `GeminiProxyGateway: response.text is not a string (got ${typeof text})`,
      );
    }
    return text;
  }
}

/**
 * LLM 応答テキストから JSON 部分を抜き出す。
 * 1. そのまま JSON として parse 可能 → trim したものを返す
 * 2. ```json ... ``` / ``` ... ``` フェンスで囲まれている → 中身を返す
 * 3. 最初の `{` と最後の `}` で挟まれた substring を返す
 * いずれも該当しない場合は例外。
 */
export function extractJsonText(raw: string): string {
  const trimmed = raw.trim();

  // 1) 直接 parse 可能なら trimmed を返す
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // fall through
  }

  // 2) ```json ... ``` または ``` ... ``` のフェンス
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }

  // 3) 最初の { から最後の } まで
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }

  throw new Error("extractJsonText: no json-shaped content found");
}
