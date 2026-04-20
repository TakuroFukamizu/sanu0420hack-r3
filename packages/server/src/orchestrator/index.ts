import type {
  CurrentGame,
  PlayerId,
  PlayerInput,
  RoundNumber,
  SessionSnapshot,
  SessionStateName,
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
import { realScheduler, type Scheduler } from "./scheduler.js";
import {
  genPerPlayerConfigs,
  mockVerdict,
  pickGameForRound,
} from "./mock.js";

export interface OrchestratorDurations {
  roundLoadingMs: number;
  roundPlayingMs: number;
  roundResultMs: number;
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
   * 現在 schedule 中の round/game と結び付けられたトークン。roundPlaying の遷移ごとに +1
   * して、enqueue 済みタイマ callback や scoreGame 発火の idempotency を保証する
   * (二重の ROUND_COMPLETE 発射や古いラウンドへの入力反映を防ぐ)。
   */
  private roundToken = 0;

  constructor(
    private runtime: SessionRuntime,
    private scheduler: Scheduler = realScheduler,
    private durations: OrchestratorDurations = durationsFromEnv(),
  ) {}

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
      this.completeRound(snap.currentGame, this.roundToken);
    }
  }

  /**
   * token で呼び出し時点の round 同一性を保証する。既に別ラウンドに遷移済みなら何もしない
   * (遅延して fire した古いタイマや二重呼び出しを吸収)。
   */
  private completeRound(current: CurrentGame, token: number): void {
    if (token !== this.roundToken) return;
    if (this.runtime.get().state !== "roundPlaying") return;
    // 以降 completeRound は 1 回限り: token を bump して後続を無効化する
    this.roundToken += 1;
    const { score, qualitative } = scoreGame(current, this.inputs);
    this.inputs = {};
    this.runtime.send({ type: "ROUND_COMPLETE", score, qualitative });
  }

  private onState(snap: SessionSnapshot): void {
    if (snap.state === this.lastState) return;
    this.lastState = snap.state;

    this.cancelPending?.();
    this.cancelPending = null;

    switch (snap.state) {
      case "roundLoading":
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundLoadingMs,
          () => this.emitRoundReady(),
        );
        return;
      case "roundPlaying": {
        // ROUND_READY 側で currentGame が context にセットされている前提
        this.inputs = {};
        const token = this.roundToken; // schedule 時点の token を capture
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundPlayingMs,
          () => {
            const cur = this.runtime.get().currentGame;
            if (!cur) return;
            this.completeRound(cur, token);
          },
        );
        return;
      }
      case "roundResult": {
        const round: RoundNumber | null = snap.currentRound;
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundResultMs,
          () => {
            // round === null は state machine の不変条件上起きないはずだが、
            // その場合も NEXT_ROUND を撃つと canAdvanceRound guard で弾かれて
            // 無音デッドロックになるので SESSION_DONE にフォールバックして抜ける。
            if (round === null || round === 3) {
              const verdict = mockVerdict(this.runtime.get().scores);
              this.runtime.send({ type: "SESSION_DONE", verdict });
            } else {
              this.runtime.send({ type: "NEXT_ROUND" });
            }
          },
        );
        return;
      }
      case "waiting":
      case "setup":
      case "playerNaming":
      case "totalResult":
        return;
    }
  }

  private emitRoundReady(): void {
    const snap = this.runtime.get();
    if (!snap.setup || snap.currentRound === null) return;
    const gameId = pickGameForRound(snap.currentRound);
    const game = genPerPlayerConfigs(gameId, snap.setup);
    this.runtime.send({ type: "ROUND_READY", game });
  }
}
