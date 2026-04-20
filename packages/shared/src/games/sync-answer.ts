import type { PlayerId } from "../types.js";

export interface SyncAnswerConfig {
  question: string;
  choices: [string, string, string, string];
}

export interface SyncAnswerInput {
  choice: 0 | 1 | 2 | 3;
}

export interface GameScore {
  score: number;
  qualitative: string;
}

export function scoreSyncAnswer(
  configs: Record<PlayerId, SyncAnswerConfig>,
  inputs: Partial<Record<PlayerId, SyncAnswerInput>>,
): GameScore {
  const a = inputs.A?.choice;
  const b = inputs.B?.choice;
  if (a === undefined || b === undefined) {
    return { score: 0, qualitative: "操作が間に合いませんでした…" };
  }
  const match = a === b;
  return {
    score: match ? 100 : 0,
    qualitative: match
      ? "2人の意見がシンクロしました！"
      : "意見が分かれましたね…",
  };
}
