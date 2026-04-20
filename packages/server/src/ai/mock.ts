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
import type {
  AiGateway,
  QualitativeRefineArgs,
  SessionPlan,
  VerdictArgs,
} from "./index.js";

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
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

/** Phase 4 固定ローテーション: R1=sync-answer, R2=partner-quiz, R3=timing-sync。
 *  決定性のためテスト & ハッカソン会場で有用。*/
function mockGameForRound(round: RoundNumber): GameId {
  switch (round) {
    case 1:
      return "sync-answer";
    case 2:
      return "partner-quiz";
    case 3:
      return "timing-sync";
  }
}

function mockCurrentGame(gameId: GameId, setup: SetupData): CurrentGame {
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

function mockVerdictFromScores(
  scores: Record<RoundNumber, number | null>,
): string {
  const total = (scores[1] ?? 0) + (scores[2] ?? 0) + (scores[3] ?? 0);
  if (total >= 250) return "運命の相手！";
  if (total >= 200) return "とても相性が良いです";
  if (total >= 150) return "悪くない関係ですね";
  return "まだまだこれから！";
}

export class MockAiGateway implements AiGateway {
  // readonly だが `string` 型で宣言してサブクラス (テスト) が別の literal を
  // 代入できるようにしておく。"mock" 以外の name を付けたい場合はサブクラスで
  // override する。
  readonly name: string = "mock";

  async planSession(setup: SetupData): Promise<SessionPlan> {
    const r1 = mockCurrentGame(mockGameForRound(1), setup);
    const r2 = mockCurrentGame(mockGameForRound(2), setup);
    const r3 = mockCurrentGame(mockGameForRound(3), setup);
    return { rounds: [r1, r2, r3] };
  }

  async refineQualitative(args: QualitativeRefineArgs): Promise<string> {
    // mock は scoreFn の出力をそのまま通す (上書きしない)
    return args.qualitativeFromScoreFn;
  }

  async generateVerdict(args: VerdictArgs): Promise<string> {
    return mockVerdictFromScores(args.scores);
  }
}
