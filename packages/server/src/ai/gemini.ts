/**
 * GeminiGateway — AiGateway implementation backed by `@google/genai` (SDK 1.50.1).
 *
 * API shape reference (確認済み 2026-04-21, Context7):
 *   const ai = new GoogleGenAI({ apiKey });
 *   const res = await ai.models.generateContent({
 *     model,
 *     contents: string,
 *     config: {
 *       responseMimeType?: "application/json",
 *       // responseJsonSchema? も使えるが、ここでは narrow 関数で手動検証する。
 *     },
 *   });
 *   res.text  // => string | undefined (accessor — 最初の候補の最初の text part)
 *
 * 本 Gateway は失敗時に例外を投げる。呼び出し側 (Orchestrator.safePlan 等) が
 * MockAiGateway へ silent fallback する責務を持つ。
 */

import type {
  CurrentGame,
  GameId,
  PartnerQuizConfig,
  PlayerId,
  SetupData,
  SyncAnswerConfig,
  TimingSyncConfig,
} from "@app/shared";
import { GoogleGenAI } from "@google/genai";
import type {
  AiGateway,
  QualitativeRefineArgs,
  SessionPlan,
  VerdictArgs,
} from "./index.js";

const DEFAULT_MODEL = "gemini-2.5-flash";

export class GeminiGateway implements AiGateway {
  readonly name: string = "gemini";
  private readonly ai: GoogleGenAI;
  private readonly model: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("GeminiGateway: apiKey is required");
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  }

  async planSession(setup: SetupData): Promise<SessionPlan> {
    const prompt = buildPlanPrompt(setup);
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });
    const text = res.text ?? "";
    if (!text) {
      throw new Error("planSession: empty response text");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `planSession: JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return normalizePlan(parsed, setup);
  }

  async refineQualitative(args: QualitativeRefineArgs): Promise<string> {
    const prompt = buildRefinePrompt(args);
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
    });
    const text = (res.text ?? "").trim().slice(0, 120);
    return text.length > 0 ? text : args.qualitativeFromScoreFn;
  }

  async generateVerdict(args: VerdictArgs): Promise<string> {
    const prompt = buildVerdictPrompt(args);
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
    });
    const text = (res.text ?? "").trim().slice(0, 200);
    if (!text) {
      throw new Error("generateVerdict: empty response text");
    }
    return text;
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildPlanPrompt(setup: SetupData): string {
  const { players, relationship } = setup;
  return `あなたは2人ペアで遊ぶアーケードゲームのディレクターです。
プレイヤー: A="${players.A.name}" / B="${players.B.name}"、関係性: "${relationship}"。

以下3種のゲームから3ラウンド分の内容を JSON で決めてください:
- "sync-answer": 同じ質問に2人が4択から同時回答、一致で得点
- "partner-quiz": target プレイヤーに関する4択クイズを2人が答え、一致で得点
- "timing-sync": 2人同時にタップ、時刻差が小さいほど高得点

応答フォーマット (必ず JSON だけで、それ以外の文字列を含めない):
{
  "rounds": [
    { "gameId": "...", "config": { ... } },
    { "gameId": "...", "config": { ... } },
    { "gameId": "...", "config": { ... } }
  ]
}

config は gameId に応じて以下の shape:
- sync-answer: { "question": string, "choices": [string, string, string, string] }
- partner-quiz: { "target": "A"|"B", "question": string, "choices": [string×4] }  (targetName はサーバ側で補完するので書かないでください)
- timing-sync: { "instruction": string }

関係性 "${relationship}" を踏まえ、2人の距離感を探るような質問・指示にしてください。
日本語で、絵文字は使わないでください。`;
}

function buildRefinePrompt(a: QualitativeRefineArgs): string {
  return `2人は${a.setup.relationship}の関係。
Round ${a.round} のゲームは "${a.current.gameId}"、得点 ${a.score} 点。
scoreFn が提示した感想: 「${a.qualitativeFromScoreFn}」。

この得点と関係性を踏まえ、1〜2文 (120字以内) の煽りコメントを日本語で返してください。
絵文字は使わない。括弧や前置きは書かず、文章のみ。`;
}

function buildVerdictPrompt(a: VerdictArgs): string {
  return `2人は${a.setup.relationship}の関係。3ラウンドの結果:
R1: ${a.scores[1] ?? 0}点 / "${a.qualitativeEvals[1] ?? ""}"
R2: ${a.scores[2] ?? 0}点 / "${a.qualitativeEvals[2] ?? ""}"
R3: ${a.scores[3] ?? 0}点 / "${a.qualitativeEvals[3] ?? ""}"

この2人の相性を1〜2文 (200字以内) の日本語で診断してください。
絵文字や括弧は不可、文章のみ。`;
}

// ---------------------------------------------------------------------------
// Narrowing helpers (exported for unit tests)
// ---------------------------------------------------------------------------

const VALID_GAME_IDS: readonly GameId[] = [
  "sync-answer",
  "partner-quiz",
  "timing-sync",
];

function isGameId(s: unknown): s is GameId {
  return (
    typeof s === "string" && (VALID_GAME_IDS as readonly string[]).includes(s)
  );
}

/** Gemini の planSession 応答トップレベルを SessionPlan に narrow。*/
export function normalizePlan(raw: unknown, setup: SetupData): SessionPlan {
  if (!raw || typeof raw !== "object") {
    throw new Error("plan: not an object");
  }
  const rounds = (raw as { rounds?: unknown }).rounds;
  if (!Array.isArray(rounds) || rounds.length !== 3) {
    throw new Error(
      `plan: rounds must be an array of length 3 (got ${
        Array.isArray(rounds) ? rounds.length : typeof rounds
      })`,
    );
  }
  return {
    rounds: [
      narrowRound(rounds[0], setup),
      narrowRound(rounds[1], setup),
      narrowRound(rounds[2], setup),
    ],
  };
}

/** `{ gameId, config }` 要素を `CurrentGame` に narrow。partner-quiz の targetName はここで補完。*/
export function narrowRound(raw: unknown, setup: SetupData): CurrentGame {
  if (!raw || typeof raw !== "object") {
    throw new Error("round: not an object");
  }
  const r = raw as Record<string, unknown>;
  if (!isGameId(r.gameId)) {
    throw new Error(`round.gameId: invalid (${JSON.stringify(r.gameId)})`);
  }
  const config = r.config;
  if (!config || typeof config !== "object") {
    throw new Error("round.config: missing or not an object");
  }
  switch (r.gameId) {
    case "sync-answer": {
      const cfg = narrowSyncAnswer(config);
      return {
        gameId: "sync-answer",
        perPlayerConfigs: { A: cfg, B: cfg },
      };
    }
    case "partner-quiz": {
      const base = narrowPartnerQuiz(config);
      const cfg: PartnerQuizConfig = {
        ...base,
        targetName: setup.players[base.target].name,
      };
      return {
        gameId: "partner-quiz",
        perPlayerConfigs: { A: cfg, B: cfg },
      };
    }
    case "timing-sync": {
      const cfg = narrowTimingSync(config);
      return {
        gameId: "timing-sync",
        perPlayerConfigs: { A: cfg, B: cfg },
      };
    }
  }
}

export function narrowSyncAnswer(config: object): SyncAnswerConfig {
  const r = config as Record<string, unknown>;
  const q = r.question;
  const choices = r.choices;
  if (typeof q !== "string" || q.length === 0) {
    throw new Error("sync-answer.question: non-empty string required");
  }
  if (!Array.isArray(choices) || choices.length !== 4) {
    throw new Error("sync-answer.choices: array of 4 strings required");
  }
  const normalized = choices.map((c) => {
    if (typeof c !== "string") {
      throw new Error("sync-answer.choices: all items must be strings");
    }
    return c;
  }) as [string, string, string, string];
  return { question: q, choices: normalized };
}

/** targetName はサーバ側で setup から補完するので narrow の戻り値からは外す。*/
export function narrowPartnerQuiz(
  config: object,
): Omit<PartnerQuizConfig, "targetName"> {
  const r = config as Record<string, unknown>;
  const target = r.target;
  if (target !== "A" && target !== "B") {
    throw new Error(
      `partner-quiz.target: must be "A" or "B" (got ${JSON.stringify(target)})`,
    );
  }
  const q = r.question;
  const choices = r.choices;
  if (typeof q !== "string" || q.length === 0) {
    throw new Error("partner-quiz.question: non-empty string required");
  }
  if (!Array.isArray(choices) || choices.length !== 4) {
    throw new Error("partner-quiz.choices: array of 4 strings required");
  }
  const normalized = choices.map((c) => {
    if (typeof c !== "string") {
      throw new Error("partner-quiz.choices: all items must be strings");
    }
    return c;
  }) as [string, string, string, string];
  return {
    target: target as PlayerId,
    question: q,
    choices: normalized,
  };
}

export function narrowTimingSync(config: object): TimingSyncConfig {
  const r = config as Record<string, unknown>;
  const instr = r.instruction;
  if (typeof instr !== "string" || instr.length === 0) {
    throw new Error("timing-sync.instruction: non-empty string required");
  }
  return { instruction: instr };
}
