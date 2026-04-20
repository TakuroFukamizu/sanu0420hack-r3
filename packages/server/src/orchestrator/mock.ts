import type {
  CurrentGame,
  GameId,
  PartnerQuizConfig,
  PlayerId,
  RoundNumber,
  SetupData,
  SyncAnswerConfig,
  TimingSyncConfig,
} from "@app/shared";

export function mockVerdict(
  scores: Record<RoundNumber, number | null>,
): string {
  const total = (scores[1] ?? 0) + (scores[2] ?? 0) + (scores[3] ?? 0);
  if (total >= 250) return "運命の相手！";
  if (total >= 200) return "とても相性が良いです";
  if (total >= 150) return "悪くない関係ですね";
  return "まだまだこれから！";
}

/** Phase 4 固定ローテーション: R1=sync-answer, R2=partner-quiz, R3=timing-sync。
 * Phase 5 で Gemini に「関係性から 3 ゲーム選んで」と依頼する形に置き換わる。*/
export function pickGameForRound(round: RoundNumber): GameId {
  switch (round) {
    case 1:
      return "sync-answer";
    case 2:
      return "partner-quiz";
    case 3:
      return "timing-sync";
  }
}

const syncAnswerPool: Array<{
  question: string;
  choices: [string, string, string, string];
}> = [
  { question: "デートで行きたいのは？", choices: ["海", "山", "街", "家"] },
  { question: "朝食の主食は？", choices: ["ご飯", "パン", "フルーツ", "抜く"] },
  {
    question: "休みの日の過ごし方は？",
    choices: ["外出", "映画", "ゲーム", "昼寝"],
  },
];

const partnerQuizPool: Array<{
  question: string;
  choices: [string, string, string, string];
}> = [
  { question: "好きな季節は？", choices: ["春", "夏", "秋", "冬"] },
  { question: "好きな色は？", choices: ["赤", "青", "緑", "黄"] },
  {
    question: "好きな食べ物は？",
    choices: ["寿司", "焼肉", "ラーメン", "カレー"],
  },
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function genPerPlayerConfigs(
  gameId: GameId,
  setup: SetupData,
): CurrentGame {
  switch (gameId) {
    case "sync-answer": {
      const q = pick(syncAnswerPool);
      const cfg: SyncAnswerConfig = {
        question: q.question,
        choices: q.choices,
      };
      return {
        gameId: "sync-answer",
        perPlayerConfigs: { A: cfg, B: cfg },
      };
    }
    case "partner-quiz": {
      const q = pick(partnerQuizPool);
      const target: PlayerId = Math.random() < 0.5 ? "A" : "B";
      const targetName = setup.players[target].name;
      const cfg: PartnerQuizConfig = {
        target,
        targetName,
        question: q.question,
        choices: q.choices,
      };
      return {
        gameId: "partner-quiz",
        perPlayerConfigs: { A: cfg, B: cfg },
      };
    }
    case "timing-sync": {
      const cfg: TimingSyncConfig = { instruction: "2人同時にタップ！" };
      return {
        gameId: "timing-sync",
        perPlayerConfigs: { A: cfg, B: cfg },
      };
    }
  }
}
