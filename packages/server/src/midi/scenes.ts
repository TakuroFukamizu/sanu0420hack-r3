import type { SessionStateName } from "@app/shared";

export type MidiScene = SessionStateName;

export interface SceneNote {
  note: number;
  velocity: number;
  channel: number;
  offsetMs: number;
  durationMs: number;
}

export interface Scene {
  name: MidiScene;
  program?: { channel: number; number: number };
  notes: SceneNote[];
  /**
   * ループ周期。指定すると scene が変わるまで loopPeriodMs 間隔で
   * notes パターンを再発火する。未指定なら 1 発で終わり (scene 遷移までは無音)。
   */
  loopPeriodMs?: number;
}

const DEFAULT_CHANNEL = 0;
const DRUM_CHANNEL = 9; // GM のドラム専用 ch

function pad(
  notes: number[],
  startOffsetMs = 0,
  durationMs = 4000,
  velocity = 70,
): SceneNote[] {
  return notes.map((n) => ({
    note: n,
    velocity,
    channel: DEFAULT_CHANNEL,
    offsetMs: startOffsetMs,
    durationMs,
  }));
}

function seq(
  pattern: Array<{ note: number; at: number; dur?: number; vel?: number }>,
  channel = DEFAULT_CHANNEL,
): SceneNote[] {
  return pattern.map((p) => ({
    note: p.note,
    velocity: p.vel ?? 90,
    channel,
    offsetMs: p.at,
    durationMs: p.dur ?? 300,
  }));
}

export const scenesByState: Record<MidiScene, Scene> = {
  waiting: {
    name: "waiting",
    program: { channel: DEFAULT_CHANNEL, number: 89 }, // Pad 2 (warm)
    notes: pad([60, 64, 67]),
  },
  setup: {
    name: "setup",
    program: { channel: DEFAULT_CHANNEL, number: 10 }, // Music Box
    notes: seq([
      { note: 72, at: 0, dur: 400 },
      { note: 76, at: 300, dur: 400 },
      { note: 79, at: 600, dur: 500 },
    ]),
  },
  playerNaming: {
    name: "playerNaming",
    program: { channel: DEFAULT_CHANNEL, number: 108 }, // Kalimba
    notes: seq([
      { note: 67, at: 0, dur: 800 },
      { note: 72, at: 400, dur: 800 },
    ]),
  },
  roundLoading: {
    name: "roundLoading",
    program: { channel: DEFAULT_CHANNEL, number: 81 }, // Lead 2 sawtooth
    notes: seq([
      { note: 60, at: 0, dur: 150 },
      { note: 64, at: 120, dur: 150 },
      { note: 67, at: 240, dur: 150 },
      { note: 72, at: 360, dur: 300 },
    ]),
  },
  roundPlaying: {
    name: "roundPlaying",
    program: { channel: DEFAULT_CHANNEL, number: 38 }, // Synth Bass 1
    notes: [
      ...seq(
        [
          { note: 36, at: 0, dur: 100, vel: 110 },
          { note: 36, at: 1000, dur: 100, vel: 110 },
        ],
        DRUM_CHANNEL,
      ),
      ...seq([
        { note: 48, at: 500, dur: 400, vel: 100 },
        { note: 50, at: 1500, dur: 400, vel: 100 },
      ]),
    ],
    loopPeriodMs: 2000,
  },
  roundResult: {
    name: "roundResult",
    program: { channel: DEFAULT_CHANNEL, number: 0 }, // Grand Piano
    notes: pad([60, 64, 67, 71], 0, 2000, 85),
  },
  totalResult: {
    name: "totalResult",
    program: { channel: DEFAULT_CHANNEL, number: 48 }, // String Ensemble 1
    notes: pad([48, 55, 60, 64, 67], 0, 5000, 90),
  },
};
