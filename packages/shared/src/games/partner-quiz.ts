import type { PlayerId } from "../types.js";
import type { GameScore } from "./sync-answer.js";

export interface PartnerQuizConfig {
  /** クイズ対象のプレイヤー (その人の趣向を問うクイズ) */
  target: PlayerId;
  /** 表示用に target の名前を含める (Setup から取得) */
  targetName: string;
  question: string;
  choices: [string, string, string, string];
}

export interface PartnerQuizInput {
  choice: 0 | 1 | 2 | 3;
}

export function scorePartnerQuiz(
  configs: Record<PlayerId, PartnerQuizConfig>,
  inputs: Partial<Record<PlayerId, PartnerQuizInput>>,
): GameScore {
  // A と B の config は同一 (target を両者が共有している前提)
  const target = configs.A.target;
  const other: PlayerId = target === "A" ? "B" : "A";
  const targetChoice = inputs[target]?.choice;
  const otherChoice = inputs[other]?.choice;
  if (targetChoice === undefined || otherChoice === undefined) {
    return { score: 0, qualitative: "どちらかが回答できませんでした…" };
  }
  const match = targetChoice === otherChoice;
  return {
    score: match ? 100 : 0,
    qualitative: match
      ? "相方のことをよく知っていますね！"
      : "相方のことをまだ分かりきれていないかも？",
  };
}
