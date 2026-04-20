import type { PlayerId } from "../types.js";
import type { GameScore } from "./sync-answer.js";

export interface TimingSyncConfig {
  instruction: string;
}

export interface TimingSyncInput {
  /** クライアント側の `Date.now()` タップ時刻 */
  tapTime: number;
}

export function scoreTimingSync(
  configs: Record<PlayerId, TimingSyncConfig>,
  inputs: Partial<Record<PlayerId, TimingSyncInput>>,
): GameScore {
  const a = inputs.A?.tapTime;
  const b = inputs.B?.tapTime;
  if (a === undefined || b === undefined) {
    return { score: 0, qualitative: "どちらかが操作できませんでした…" };
  }
  const diffMs = Math.abs(a - b);
  // 10ms ずれるごとに 1 pt 減点、0 下限。
  const score = Math.max(0, 100 - Math.floor(diffMs / 10));
  const qualitative =
    diffMs < 200
      ? "2人の息がぴったりでした！"
      : diffMs < 500
        ? "ほぼ同じタイミングでした。"
        : "タイミングが少しずれましたね。";
  return { score, qualitative };
}
