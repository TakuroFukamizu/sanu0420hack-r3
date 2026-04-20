import type { PlayerId } from "../types.js";
import {
  scoreSyncAnswer,
  type GameScore,
  type SyncAnswerConfig,
  type SyncAnswerInput,
} from "./sync-answer.js";
import {
  scorePartnerQuiz,
  type PartnerQuizConfig,
  type PartnerQuizInput,
} from "./partner-quiz.js";
import {
  scoreTimingSync,
  type TimingSyncConfig,
  type TimingSyncInput,
} from "./timing-sync.js";

export type GameId = "sync-answer" | "partner-quiz" | "timing-sync";

export type CurrentGame =
  | { gameId: "sync-answer"; perPlayerConfigs: Record<PlayerId, SyncAnswerConfig> }
  | { gameId: "partner-quiz"; perPlayerConfigs: Record<PlayerId, PartnerQuizConfig> }
  | { gameId: "timing-sync"; perPlayerConfigs: Record<PlayerId, TimingSyncConfig> };

export type GameInput =
  | { gameId: "sync-answer"; payload: SyncAnswerInput }
  | { gameId: "partner-quiz"; payload: PartnerQuizInput }
  | { gameId: "timing-sync"; payload: TimingSyncInput };

/**
 * gameId ごとの scoreFn をランタイム統一形で呼べるようにしたラッパ。
 * 呼び出し側 (Orchestrator) は CurrentGame とプレイヤ入力 (payload の記録) を渡すだけ。
 */
export function scoreGame(
  current: CurrentGame,
  inputs: Partial<Record<PlayerId, unknown>>,
): GameScore {
  switch (current.gameId) {
    case "sync-answer":
      return scoreSyncAnswer(
        current.perPlayerConfigs,
        inputs as Partial<Record<PlayerId, SyncAnswerInput>>,
      );
    case "partner-quiz":
      return scorePartnerQuiz(
        current.perPlayerConfigs,
        inputs as Partial<Record<PlayerId, PartnerQuizInput>>,
      );
    case "timing-sync":
      return scoreTimingSync(
        current.perPlayerConfigs,
        inputs as Partial<Record<PlayerId, TimingSyncInput>>,
      );
  }
}

export const GAME_IDS: readonly GameId[] = ["sync-answer", "partner-quiz", "timing-sync"] as const;
