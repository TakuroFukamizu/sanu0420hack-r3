import type { RoundNumber } from "@app/shared";

/**
 * Phase 3 用の mock スコア/評価/最終診断。Phase 5 で Gemini 呼び出しに差し替わる。
 */
export function mockScore(): number {
  return 50 + Math.floor(Math.random() * 51); // 50〜100
}

const qualitativePool = [
  "2人の息はぴったりでした！",
  "片方が頑張りすぎていた印象です…",
  "お互いの理解度が試される瞬間でした。",
  "想像以上に噛み合っていました。",
  "もう少し相手を知る必要がありそうです。",
];

export function mockQualitative(): string {
  return qualitativePool[Math.floor(Math.random() * qualitativePool.length)]!;
}

export function mockVerdict(scores: Record<RoundNumber, number | null>): string {
  const total = (scores[1] ?? 0) + (scores[2] ?? 0) + (scores[3] ?? 0);
  if (total >= 250) return "運命の相手！";
  if (total >= 200) return "とても相性が良いです";
  if (total >= 150) return "悪くない関係ですね";
  return "まだまだこれから！";
}
