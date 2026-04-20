import { describe, it, expect } from "vitest";
import type { SetupData } from "@app/shared";
import { MockAiGateway } from "../src/ai/mock.js";
import {
  GeminiGateway,
  narrowPartnerQuiz,
  narrowRound,
  narrowSyncAnswer,
  narrowTimingSync,
  normalizePlan,
} from "../src/ai/gemini.js";
import type { AiGateway } from "../src/ai/index.js";

/**
 * このテストは実 API を叩かない:
 * - `GeminiGateway` インスタンスは dummy key で生成するだけ (SDK 構築のみ)
 * - `planSession` / `refineQualitative` / `generateVerdict` は呼ばない
 * narrow 関数 (export) と MockAiGateway のフォールバック挙動を検証する。
 */

function setupData(): SetupData {
  return {
    players: {
      A: { id: "A", name: "あきら" },
      B: { id: "B", name: "ひろみ" },
    },
    relationship: "友達",
  };
}

describe("GeminiGateway narrowing helpers", () => {
  it("normalizePlan returns 3 CurrentGame rounds from a valid Gemini response", () => {
    const setup = setupData();
    const raw = {
      rounds: [
        {
          gameId: "sync-answer",
          config: {
            question: "一緒にやりたい遊びは？",
            choices: ["旅行", "ゲーム", "映画", "料理"],
          },
        },
        {
          gameId: "partner-quiz",
          config: {
            target: "A",
            question: "あきらが好きな食べ物は？",
            choices: ["寿司", "カレー", "ラーメン", "焼肉"],
          },
        },
        {
          gameId: "timing-sync",
          config: { instruction: "友達の息を合わせて同時にタップ！" },
        },
      ],
    };

    const plan = normalizePlan(raw, setup);
    expect(plan.rounds).toHaveLength(3);
    expect(plan.rounds[0].gameId).toBe("sync-answer");
    expect(plan.rounds[1].gameId).toBe("partner-quiz");
    expect(plan.rounds[2].gameId).toBe("timing-sync");
    if (plan.rounds[0].gameId === "sync-answer") {
      expect(plan.rounds[0].perPlayerConfigs.A.question).toBe(
        "一緒にやりたい遊びは？",
      );
      expect(plan.rounds[0].perPlayerConfigs.B.choices).toHaveLength(4);
    }
  });

  it("normalizePlan fills partner-quiz.targetName from setup (not from Gemini response)", () => {
    const setup = setupData();
    const raw = {
      rounds: [
        {
          gameId: "partner-quiz",
          config: {
            target: "B",
            question: "ひろみの休日の過ごし方は？",
            choices: ["外出", "家", "映画", "読書"],
          },
        },
        {
          gameId: "sync-answer",
          config: { question: "q", choices: ["a", "b", "c", "d"] },
        },
        { gameId: "timing-sync", config: { instruction: "tap" } },
      ],
    };
    const plan = normalizePlan(raw, setup);
    const r0 = plan.rounds[0];
    expect(r0.gameId).toBe("partner-quiz");
    if (r0.gameId === "partner-quiz") {
      expect(r0.perPlayerConfigs.A.target).toBe("B");
      expect(r0.perPlayerConfigs.A.targetName).toBe("ひろみ"); // setup.players.B.name
      expect(r0.perPlayerConfigs.B.targetName).toBe("ひろみ");
    }
  });

  it("normalizePlan throws when rounds is not exactly length 3", () => {
    const setup = setupData();
    expect(() =>
      normalizePlan(
        {
          rounds: [
            {
              gameId: "sync-answer",
              config: { question: "q", choices: ["a", "b", "c", "d"] },
            },
          ],
        },
        setup,
      ),
    ).toThrow(/rounds/);

    expect(() => normalizePlan({}, setup)).toThrow(/rounds/);
    expect(() => normalizePlan(null, setup)).toThrow(/object/);
  });

  it("narrowRound rejects unknown gameId", () => {
    const setup = setupData();
    expect(() =>
      narrowRound(
        {
          gameId: "unknown-game",
          config: { question: "q", choices: ["a", "b", "c", "d"] },
        },
        setup,
      ),
    ).toThrow(/gameId/);
  });

  it("narrowSyncAnswer throws when question missing or choices length != 4", () => {
    expect(() =>
      narrowSyncAnswer({ choices: ["a", "b", "c", "d"] }),
    ).toThrow(/question/);
    expect(() =>
      narrowSyncAnswer({ question: "q", choices: ["a", "b", "c"] }),
    ).toThrow(/choices/);
    expect(() =>
      narrowSyncAnswer({ question: "q", choices: ["a", "b", "c", 1] }),
    ).toThrow(/strings/);
  });

  it("narrowPartnerQuiz throws when target is not A|B", () => {
    expect(() =>
      narrowPartnerQuiz({
        target: "C",
        question: "q",
        choices: ["a", "b", "c", "d"],
      }),
    ).toThrow(/target/);
    expect(() =>
      narrowPartnerQuiz({
        target: "A",
        question: "q",
        choices: ["a", "b", "c"],
      }),
    ).toThrow(/choices/);
  });

  it("narrowTimingSync throws when instruction missing", () => {
    expect(() => narrowTimingSync({})).toThrow(/instruction/);
    expect(() => narrowTimingSync({ instruction: "" })).toThrow(/instruction/);
  });

  it("GeminiGateway can be constructed with a dummy key (no API call)", () => {
    // 実呼び出しはしないので dummy key で OK。narrow メソッドが export 済みで
    // 直接テスト可能なので、ここでは construction だけ確認する。
    const gw: AiGateway = new GeminiGateway("dummy-key-for-test");
    expect(gw.name).toBe("gemini");
  });

  it("GeminiGateway throws if apiKey is empty string", () => {
    expect(() => new GeminiGateway("")).toThrow(/apiKey/);
  });
});

describe("MockAiGateway fallback shape", () => {
  it("planSession returns exactly 3 rounds with the fixed rotation", async () => {
    const g: AiGateway = new MockAiGateway();
    const plan = await g.planSession(setupData());
    expect(plan.rounds).toHaveLength(3);
    const ids = plan.rounds.map((r) => r.gameId);
    // Phase 4 固定ローテ: sync-answer, partner-quiz, timing-sync
    expect(ids).toEqual(["sync-answer", "partner-quiz", "timing-sync"]);
  });

  it("refineQualitative is a pass-through (returns qualitativeFromScoreFn unchanged)", async () => {
    const g: AiGateway = new MockAiGateway();
    const s = "originalは変更されない";
    const out = await g.refineQualitative({
      setup: setupData(),
      round: 1,
      current: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "q", choices: ["a", "b", "c", "d"] },
          B: { question: "q", choices: ["a", "b", "c", "d"] },
        },
      },
      inputs: {},
      score: 50,
      qualitativeFromScoreFn: s,
    });
    expect(out).toBe(s);
  });

  it("generateVerdict returns a string", async () => {
    const g: AiGateway = new MockAiGateway();
    const out = await g.generateVerdict({
      setup: setupData(),
      scores: { 1: 100, 2: 100, 3: 100 },
      qualitativeEvals: { 1: "good", 2: "good", 3: "good" },
    });
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
