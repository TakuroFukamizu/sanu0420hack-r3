import type {
  CurrentGame,
  PlayerId,
  RoundNumber,
  SetupData,
} from "@app/shared";

/** AI 生成されたセッションプラン。3 ラウンド分の CurrentGame を保持。*/
export interface SessionPlan {
  rounds: [CurrentGame, CurrentGame, CurrentGame];
}

export interface QualitativeRefineArgs {
  setup: SetupData;
  round: RoundNumber;
  current: CurrentGame;
  inputs: Partial<Record<PlayerId, unknown>>;
  score: number;
  qualitativeFromScoreFn: string;
}

export interface VerdictArgs {
  setup: SetupData;
  scores: Record<RoundNumber, number | null>;
  qualitativeEvals: Record<RoundNumber, string | null>;
}

export interface AiGateway {
  /** 実装名 (ログ用)。"mock" / "gemini" 等。*/
  readonly name: string;

  /** Setup から 3 ラウンド分のゲーム + configs を生成する。
   *  失敗時は例外を投げる (呼び出し側が mock fallback する責務)。*/
  planSession(setup: SetupData): Promise<SessionPlan>;

  /** Round 終了時の qualitative を AI でリファインする。
   *  Mock は scoreFn の文をそのまま返すので実質 no-op。*/
  refineQualitative(args: QualitativeRefineArgs): Promise<string>;

  /** 3 ラウンドのスコア + 定性評価 + Setup から最終診断を生成。*/
  generateVerdict(args: VerdictArgs): Promise<string>;
}
