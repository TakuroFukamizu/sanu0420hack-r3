import type {
  CurrentGame,
  PlayerId,
  PlayerInput,
  RoundNumber,
  SessionSnapshot,
  SessionStateName,
  SetupData,
} from "@app/shared";
import {
  DEFAULT_ROUND_LOADING_MS,
  DEFAULT_ROUND_PLAYING_MS,
  DEFAULT_ROUND_RESULT_MS,
  ROUND_LOADING_ENV,
  ROUND_PLAYING_ENV,
  ROUND_RESULT_ENV,
  scoreGame,
} from "@app/shared";
import type { SessionRuntime } from "../session-runtime.js";
import type { AiGateway, SessionPlan, VerdictArgs } from "../ai/index.js";
import { MockAiGateway } from "../ai/mock.js";
import { withTimeout } from "../ai/safe.js";
import { realScheduler, type Scheduler } from "./scheduler.js";

export interface OrchestratorDurations {
  roundLoadingMs: number;
  roundPlayingMs: number;
  roundResultMs: number;
}

export interface OrchestratorOptions {
  /** 差し替え可能な AI 実装。default は MockAiGateway。*/
  gateway?: AiGateway;
  /** true の時だけ round 終了時に AI で qualitative をリファインする。*/
  refineQualitative?: boolean;
  /** safePlan/safeVerdict/safeRefine の共通タイムアウト (ms)。*/
  aiTimeoutMs?: number;
}

function readDuration(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function durationsFromEnv(): OrchestratorDurations {
  return {
    roundLoadingMs: readDuration(ROUND_LOADING_ENV, DEFAULT_ROUND_LOADING_MS),
    roundPlayingMs: readDuration(ROUND_PLAYING_ENV, DEFAULT_ROUND_PLAYING_MS),
    roundResultMs: readDuration(ROUND_RESULT_ENV, DEFAULT_ROUND_RESULT_MS),
  };
}

export class Orchestrator {
  private unsubscribe: (() => void) | null = null;
  private cancelPending: (() => void) | null = null;
  private lastState: SessionStateName | null = null;

  /** 現在ラウンドのプレイヤー入力 payload を蓄積する。roundPlaying エントリ時にクリア。*/
  private inputs: Partial<Record<PlayerId, unknown>> = {};

  /**
   * 現在 schedule 中の round/game と結び付けられたトークン。completeRound で +1
   * して、enqueue 済みタイマ callback や scoreGame 発火の idempotency を保証する
   * (二重の ROUND_COMPLETE 発射や古いラウンドへの入力反映を防ぐ)。
   * Phase 5 で refineQualitative の await 中のステール化も同じトークンで検出する。
   */
  private roundToken = 0;

  // AI 応答キャッシュ (セッション単位)。RESET で waiting に戻った時にクリア。
  private sessionPlanPromise: Promise<SessionPlan> | null = null;
  private verdictPromise: Promise<string[]> | null = null;

  /**
   * stop() のたびに +1 される generation。async timer callback が
   * `await sessionPlanPromise` / `await verdictPromise` から戻った時点で、
   * generation が進んでいれば「既に shutdown 済み」なので runtime.send を止める。
   * (Codex Phase 5 review: stop()-vs-in-flight-async race の防御)
   */
  private generation = 0;

  private readonly gateway: AiGateway;
  /** 安全網としての mock。safeXxx 系が gateway 失敗時にフォールバックする先。*/
  private readonly fallback: AiGateway;
  private readonly refineQualitativeOn: boolean;
  private readonly aiTimeoutMs: number;

  constructor(
    private runtime: SessionRuntime,
    private scheduler: Scheduler = realScheduler,
    private durations: OrchestratorDurations = durationsFromEnv(),
    opts: OrchestratorOptions = {},
  ) {
    this.gateway = opts.gateway ?? new MockAiGateway();
    this.fallback = new MockAiGateway();
    this.refineQualitativeOn = opts.refineQualitative ?? false;
    this.aiTimeoutMs = opts.aiTimeoutMs ?? 10_000;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.runtime.subscribe((snap) => this.onState(snap));
  }

  stop(): void {
    this.cancelPending?.();
    this.cancelPending = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.lastState = null;
    this.inputs = {};
    this.sessionPlanPromise = null;
    this.verdictPromise = null;
    // 進行中の async callback が stop 後に runtime.send() するのを防ぐ
    this.generation += 1;
  }

  /**
   * ws.ts から forward される。roundPlaying 以外は無視。両者揃ったら即 complete。
   * 同一プレイヤーの 2 回目以降の入力は **first-wins で無視** (client UI も disable
   * 済みだが、壊れた client や再送からの防御)。
   */
  onPlayerInput(playerId: PlayerId, input: PlayerInput): void {
    const snap = this.runtime.get();
    if (snap.state !== "roundPlaying") return;
    if (!snap.currentGame) return;
    if (input.round !== snap.currentRound) return;
    if (input.gameId !== snap.currentGame.gameId) return;
    if (this.inputs[playerId] !== undefined) return; // first-wins

    this.inputs[playerId] = input.payload;

    if (this.inputs.A !== undefined && this.inputs.B !== undefined) {
      this.cancelPending?.();
      this.cancelPending = null;
      // fire-and-forget: completeRound は内部で token / state guard するので
      // ここで await する必要はない。Promise の拒否は吸収する。
      void this.completeRound(snap.currentGame, this.roundToken);
    }
  }

  private async safePlan(setup: SetupData): Promise<SessionPlan> {
    try {
      return await withTimeout(
        this.gateway.planSession(setup),
        this.aiTimeoutMs,
      );
    } catch (e) {
      console.warn(
        `[ai:${this.gateway.name}] planSession failed, fallback to mock:`,
        e,
      );
      return this.fallback.planSession(setup);
    }
  }

  private async safeVerdict(args: VerdictArgs): Promise<string[]> {
    try {
      return await withTimeout(
        this.gateway.generateVerdict(args),
        this.aiTimeoutMs,
      );
    } catch (e) {
      console.warn(
        `[ai:${this.gateway.name}] generateVerdict failed, fallback to mock:`,
        e,
      );
      return this.fallback.generateVerdict(args);
    }
  }

  private async safeRefine(
    args: Parameters<AiGateway["refineQualitative"]>[0],
  ): Promise<string> {
    try {
      return await withTimeout(
        this.gateway.refineQualitative(args),
        this.aiTimeoutMs,
      );
    } catch (e) {
      console.warn(
        `[ai:${this.gateway.name}] refineQualitative failed, fallback to mock:`,
        e,
      );
      return args.qualitativeFromScoreFn;
    }
  }

  /**
   * token で呼び出し時点の round 同一性を保証する。既に別ラウンドに遷移済みなら何もしない
   * (遅延して fire した古いタイマや二重呼び出しを吸収)。
   *
   * refineQualitative ON の場合、await の前に token を bump して "claim" し、
   * await 後に myTurn と roundToken が一致することを再確認する。
   * await 中に stop() / 別 completeRound が走るケースでの stale write を防ぐ。
   */
  private async completeRound(
    current: CurrentGame,
    token: number,
  ): Promise<void> {
    if (token !== this.roundToken) return;
    if (this.runtime.get().state !== "roundPlaying") return;

    // 以降 completeRound は 1 回限り: token を bump して後続を無効化する。
    // await 前に bump しておくので同時に競合した 2 本目の completeRound は
    // 冒頭の token guard で弾かれる。
    this.roundToken += 1;
    const myTurn = this.roundToken;

    const { score, qualitative: fromScoreFn } = scoreGame(current, this.inputs);
    const capturedInputs = { ...this.inputs };
    this.inputs = {};

    let qualitative = fromScoreFn;
    const snapNow = this.runtime.get();
    if (this.refineQualitativeOn && snapNow.setup && snapNow.currentRound) {
      const myGen = this.generation;
      qualitative = await this.safeRefine({
        setup: snapNow.setup,
        round: snapNow.currentRound,
        current,
        inputs: capturedInputs,
        score,
        qualitativeFromScoreFn: fromScoreFn,
      });
      // await 中に stop() / 別ラウンド開始があった場合に stale write を避ける。
      if (myTurn !== this.roundToken) return;
      if (myGen !== this.generation) return;
    }

    this.runtime.send({ type: "ROUND_COMPLETE", score, qualitative });
  }

  private onState(snap: SessionSnapshot): void {
    if (snap.state === this.lastState) return;
    this.lastState = snap.state;

    this.cancelPending?.();
    this.cancelPending = null;

    switch (snap.state) {
      case "roundLoading":
        // round=1 エントリ時にセッションプランを kick off (並行)。
        // round=2/3 では既にキャッシュ済み Promise を再利用する。
        if (
          snap.currentRound === 1 &&
          !this.sessionPlanPromise &&
          snap.setup
        ) {
          this.sessionPlanPromise = this.safePlan(snap.setup);
        }
        {
          const myGen = this.generation;
          this.cancelPending = this.scheduler.schedule(
            this.durations.roundLoadingMs,
            async () => {
              await this.emitRoundReady(myGen);
            },
          );
        }
        return;
      case "roundPlaying": {
        // ROUND_READY 側で currentGame が context にセットされている前提
        this.inputs = {};
        const token = this.roundToken; // schedule 時点の token を capture
        const myGen = this.generation;
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundPlayingMs,
          async () => {
            if (myGen !== this.generation) return;
            const cur = this.runtime.get().currentGame;
            if (!cur) return;
            await this.completeRound(cur, token);
          },
        );
        return;
      }
      case "roundResult": {
        const round: RoundNumber | null = snap.currentRound;
        // 最終ラウンドなら verdict を並行生成しておく。
        if (round === 3 && !this.verdictPromise && snap.setup) {
          this.verdictPromise = this.safeVerdict({
            setup: snap.setup,
            scores: this.runtime.get().scores,
            qualitativeEvals: this.runtime.get().qualitativeEvals,
          });
        }
        {
        const myGen = this.generation;
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundResultMs,
          async () => {
            // round === null は state machine の不変条件上起きないはずだが、
            // その場合も NEXT_ROUND を撃つと canAdvanceRound guard で弾かれて
            // 無音デッドロックになるので SESSION_DONE にフォールバックして抜ける。
            if (round === null || round === 3) {
              const snapNow = this.runtime.get();
              const verdict = this.verdictPromise
                ? await this.verdictPromise
                : await this.safeVerdict({
                    setup: snapNow.setup!,
                    scores: snapNow.scores,
                    qualitativeEvals: snapNow.qualitativeEvals,
                  });
              // stop() 後 or 既に別 session に遷移していたら撃たない
              if (myGen !== this.generation) return;
              this.runtime.send({ type: "SESSION_DONE", verdict });
            } else {
              if (myGen !== this.generation) return;
              this.runtime.send({ type: "NEXT_ROUND" });
            }
          },
        );
        }
        return;
      }
      case "waiting":
        // 新セッションに備えキャッシュクリア (RESET 経由でここに来る)
        this.sessionPlanPromise = null;
        this.verdictPromise = null;
        return;
      case "setup":
      case "playerNaming":
      case "totalResult":
        return;
      default: {
        // 将来の新 state を追加したときに TS2322 で気付けるよう never で束ねる
        const _exhaustive: never = snap.state;
        return _exhaustive;
      }
    }
  }

  private async emitRoundReady(gen: number): Promise<void> {
    const snap = this.runtime.get();
    if (!snap.setup || snap.currentRound === null) return;
    if (!this.sessionPlanPromise) {
      // 念のため (通常は round=1 で張られている)
      this.sessionPlanPromise = this.safePlan(snap.setup);
    }
    const plan = await this.sessionPlanPromise;
    // await から戻ったら stop() or 別 session に遷移しているかもしれない。
    if (gen !== this.generation) return;
    const game = plan.rounds[snap.currentRound - 1];
    this.runtime.send({ type: "ROUND_READY", game });
  }
}
