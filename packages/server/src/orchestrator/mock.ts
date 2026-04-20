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

export function mockVerdict(scores: Record<RoundNumber, number | null>): string[] {
  const total = (scores[1] ?? 0) + (scores[2] ?? 0) + (scores[3] ?? 0);
  const tier: readonly [string, string, string] =
    total >= 250
      ? [
          "息がぴったり。言葉を交わさなくても通じている瞬間が何度もありました。",
          "お互いの強みを素直に頼り合える関係です。",
          "このままの距離感でぜひ進んでいってください。",
        ]
      : total >= 200
        ? [
            "呼吸が合う時間が多く、安心感のあるペアでした。",
            "片方が迷っても、もう一方が自然とフォローに回っていました。",
            "小さな違いも楽しめる相性です。",
          ]
        : total >= 150
          ? [
              "良い瞬間と噛み合わない瞬間が半々でした。",
              "譲り合いが少し多めに出ていたかもしれません。",
              "もう一度やればぐっと伸びる関係です。",
            ]
          : [
              "お互いのリズムを掴むのに時間がかかっていました。",
              "意見がすれ違う場面が目立ちました。",
              "まだ伸びしろたっぷりのペアです。",
            ];
  return [...tier];
}
