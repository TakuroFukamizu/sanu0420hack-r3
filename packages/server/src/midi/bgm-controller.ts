import type { SessionSnapshot, SessionStateName, RoundNumber } from "@app/shared";
import type { SessionRuntime } from "../session-runtime.js";
import type { MidiOutput } from "./output.js";
import {
  computeBpm,
  generateMelody,
  initGmInstruments,
  scheduleStep,
  secondsPerStep,
  type Rng,
} from "./music-generator.js";

export interface BgmControllerOptions {
  /** CC #7 Main Volume に書き込む値 (0-1)。default 0.8。*/
  volume?: number;
  /** テスト用: 乱数源を差し替える。default は Math.random。*/
  rng?: Rng;
}

/**
 * SessionRuntime の状態遷移を購読して BGM を再生するコントローラ。
 *
 * 発火タイミング (Phase 6 仕様):
 * - `roundLoading` 進入時:
 *   - Round 1: friendship level = 0
 *   - Round 2: friendship level = scores[1] (直前 Round の得点)
 *   - Round 3: friendship level = scores[2]
 *   メロディを再生成し、ループ再生を開始する。
 * - `waiting` (RESET 後) / `totalResult` 進入時: ループ停止 + All Notes Off。
 * - `roundPlaying` / `roundResult` 中: 何もしない (直前 roundLoading で開始した
 *   ループが setTimeout ベースで自走し続ける)。
 */
export class BgmController {
  private unsubscribe: (() => void) | null = null;
  private loopHandle: ReturnType<typeof setTimeout> | null = null;
  private noteOffHandles: Set<ReturnType<typeof setTimeout>> = new Set();
  private currentStep = 0;
  private currentMelody: (number | null)[] = [];
  private currentLevel = 0;
  private lastState: SessionStateName | null = null;
  private lastRound: RoundNumber | null = null;
  /** restartLoop / stopPlayback のたびに +1。stale な setTimeout callback を invalidate する。*/
  private generation = 0;

  private readonly volume: number;
  private readonly rng: Rng;

  constructor(
    private readonly runtime: SessionRuntime,
    private readonly output: MidiOutput,
    opts: BgmControllerOptions = {},
  ) {
    this.volume = opts.volume ?? 0.8;
    this.rng = opts.rng ?? Math.random;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.runtime.subscribe((snap) => this.onState(snap));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopPlayback();
    this.lastState = null;
    this.lastRound = null;
  }

  /** buildApp の onClose フックから呼ぶ。MIDI ポートも閉じる。*/
  dispose(): void {
    this.stop();
    this.output.close();
  }

  private onState(snap: SessionSnapshot): void {
    const state = snap.state;
    const round = snap.currentRound;
    const prevState = this.lastState;
    const prevRound = this.lastRound;
    this.lastState = state;
    this.lastRound = round;

    if (state === "roundLoading") {
      // 進入時 (lastState 不一致) or round が進んだ時のみ再生成 + 再生。
      // roundResult → NEXT_ROUND → roundLoading で必ず prevState が "roundResult" なので
      // 2 周目以降も trigger される。
      const stateChanged = prevState !== "roundLoading";
      const roundChanged = prevRound !== round;
      if (stateChanged || roundChanged) {
        const level = this.computeFriendshipLevel(snap);
        this.restartLoop(level);
      }
      return;
    }

    if (state === "waiting" || state === "totalResult") {
      // prevState が null の場合 (= 起動直後の初期 snapshot) は何もしない。
      // 再生中でない場合も allNotesOff を空打ちしない。
      if (prevState !== null && prevState !== state && this.isPlaying()) {
        this.stopPlayback();
      }
      return;
    }

    // roundPlaying / roundResult / setup / playerNaming: loop が動いているなら触らない。
  }

  private isPlaying(): boolean {
    return this.loopHandle !== null || this.currentMelody.length > 0;
  }

  /** Round 1 は 0、Round 2 は scores[1]、Round 3 は scores[2]。null/未記録は 0。*/
  private computeFriendshipLevel(snap: SessionSnapshot): number {
    const round = snap.currentRound;
    if (round === 1 || round === null) return 0;
    const prev = (round - 1) as RoundNumber;
    const score = snap.scores[prev];
    return typeof score === "number" ? score : 0;
  }

  private restartLoop(level: number): void {
    this.stopPlayback();
    initGmInstruments(this.output, this.volume);
    this.currentMelody = generateMelody(level, this.rng);
    this.currentLevel = level;
    this.currentStep = 0;
    this.scheduleNextStep();
  }

  private scheduleNextStep(): void {
    const bpm = computeBpm(this.currentLevel);
    const stepMs = Math.max(1, secondsPerStep(bpm) * 1000);
    // generation を capture。stopPlayback / restartLoop は generation を bump するので、
    // この callback が起動した時点で自分が stale (既に stop された) かを判別できる。
    const myGen = this.generation;
    this.loopHandle = setTimeout(() => {
      if (myGen !== this.generation) return;
      this.emitStep(this.currentStep);
      this.currentStep += 1;
      if (myGen !== this.generation) return;
      this.scheduleNextStep();
    }, stepMs);
  }

  private emitStep(step: number): void {
    const { notes } = scheduleStep(
      step,
      this.currentMelody,
      this.currentLevel,
      this.rng,
    );
    for (const n of notes) {
      this.output.noteOn(n.channel, n.note, n.velocity);
      const h = setTimeout(() => {
        this.output.noteOff(n.channel, n.note);
        this.noteOffHandles.delete(h);
      }, n.durationMs);
      this.noteOffHandles.add(h);
    }
  }

  private stopPlayback(): void {
    this.generation += 1;
    if (this.loopHandle) {
      clearTimeout(this.loopHandle);
      this.loopHandle = null;
    }
    for (const h of this.noteOffHandles) {
      clearTimeout(h);
    }
    this.noteOffHandles.clear();
    this.currentMelody = [];
    this.currentStep = 0;
    this.output.allNotesOff();
  }
}
