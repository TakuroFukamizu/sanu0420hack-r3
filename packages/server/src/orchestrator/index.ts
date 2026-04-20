import type {
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
} from "@app/shared";
import type { SessionRuntime } from "../session-runtime.js";
import { realScheduler, type Scheduler } from "./scheduler.js";
import { mockQualitative, mockScore, mockVerdict } from "./mock.js";

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
          () => {
            this.runtime.send({ type: "ROUND_READY" });
          },
        );
        return;
      case "roundPlaying":
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundPlayingMs,
          () => {
            this.runtime.send({
              type: "ROUND_COMPLETE",
              score: mockScore(),
              qualitative: mockQualitative(),
            });
          },
        );
        return;
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
}
