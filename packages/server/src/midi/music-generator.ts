/**
 * Dynamic Love-Sync BGM Generator の Node 移植。
 * 原典: /Users/takuro/Downloads/index.html
 *
 * - `friendshipLevel` (0-100) に応じてメロディ密度/BPM/ドラム構成を変える。
 * - `generateMelody()` は 64 ステップ (16分音符 × 4 小節) の melody を返す。
 * - `scheduleStep()` は特定ステップで発火させる全パート (melody/bass/chord/arp/drums) を列挙する純関数。
 *   ランダム要素は上位 (BgmController) から渡した rng 関数経由で決まる — テスト時は seed 固定可能。
 */

import type { MidiOutput } from "./output.js";

// チャンネル割当 (HTML と同一):
//   ch 0 (Ch1): Square Lead (Melody)
//   ch 1 (Ch2): Synth Bass 1
//   ch 2 (Ch3): Vibraphone (Arp)
//   ch 4 (Ch5): Electric Piano 2 (Chord backing)
//   ch 9 (Ch10): GM Drum kit
// ch 3 は未使用。
export const CHANNELS = {
  melody: 0,
  bass: 1,
  arp: 2,
  chord: 4,
  drum: 9,
} as const;

export const GM_PROGRAMS = {
  squareLead: 80,
  synthBass1: 38,
  vibraphone: 11,
  electricPiano2: 5,
} as const;

export interface Chord {
  root: number;
  notes: readonly [number, number, number];
  name: string;
}

/** C - Am - F - G の4和音ループ (軽快 Pop)。*/
export const CHORD_PROGRESSION: readonly Chord[] = [
  { root: 48, notes: [48, 52, 55], name: "C" }, // C major
  { root: 45, notes: [45, 48, 52], name: "Am" }, // A minor
  { root: 41, notes: [41, 45, 48], name: "F" }, // F major
  { root: 43, notes: [43, 47, 50], name: "G" }, // G major
];

/** melody ループ長 (16分刻み × 16 × 4 = 4小節)。*/
export const MELODY_STEPS = 64;

/** level 0–100 にクランプ。負値やオーバーフローから下位ロジックを守る。*/
export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  if (level < 0) return 0;
  if (level > 100) return 100;
  return Math.floor(level);
}

/** HTML 版 `100 + level * 0.6` そのまま。level=0 → 100 BPM, level=100 → 160 BPM。*/
export function computeBpm(level: number): number {
  return 100 + clampLevel(level) * 0.6;
}

/** 16 分音符 1 ステップの秒数。*/
export function secondsPerStep(bpm: number): number {
  return 60.0 / bpm / 4;
}

export type Rng = () => number;

/**
 * HTML 版 generateNewMelody の port。64 要素の配列を返し、各要素は MIDI ノート番号 or null。
 * level により鳴らす密度が変わる (level<30: 8 分周期、level<60: 4 分 + 揺れ、それ以上: 8 分 + 複雑度)。
 */
export function generateMelody(level: number, rng: Rng = Math.random): (number | null)[] {
  const L = clampLevel(level);
  const complexity = L / 100;
  const melody: (number | null)[] = new Array(MELODY_STEPS).fill(null);

  for (let i = 0; i < MELODY_STEPS; i++) {
    const chordIdx = Math.floor(i / 16);
    const chord = CHORD_PROGRESSION[chordIdx];
    const tones = [...chord.notes, chord.root + 12];

    let shouldPlay = false;
    if (L < 30) {
      if (i % 8 === 0) shouldPlay = true;
    } else if (L < 60) {
      if (i % 4 === 0 || (i % 4 === 2 && rng() < 0.4)) shouldPlay = true;
    } else {
      if (i % 2 === 0 || rng() < complexity * 0.8) shouldPlay = true;
    }

    if (shouldPlay) {
      let noteBase = tones[Math.floor(rng() * tones.length)] + 12; // 1 オクターブ上
      if (L > 70 && rng() < 0.2) noteBase += 12;
      melody[i] = noteBase;
    }
  }
  return melody;
}

/** 発火対象となる MIDI ノート (channel + note + velocity + durationMs)。*/
export interface StepNote {
  channel: number;
  note: number;
  velocity: number;
  durationMs: number;
}

/**
 * HTML 版 scheduleNote の port。
 * 指定ステップ (0-indexed、loop は呼び出し側で `step % MELODY_STEPS` 済みを渡す) で
 * 鳴らす全ノートを列挙する。純関数: MIDI 送信は行わない。
 *
 * - melody: `currentMelody[loopStep]` を鳴らす
 * - bass: `step % 4 === 0` で root-12、level>60 なら裏拍にも混ぜる
 * - chord backing: level>20 で 4打ち (level<50) or 裏打ち (level>=50)
 * - arp: level>75 で 8分刻みに chord tone を +24 で散らす
 * - drums: level>10 で Kick/Snare/Hi-hat
 */
export function scheduleStep(
  step: number,
  currentMelody: (number | null)[],
  level: number,
  rng: Rng = Math.random,
): { chord: Chord; notes: StepNote[] } {
  const L = clampLevel(level);
  const loopStep = ((step % MELODY_STEPS) + MELODY_STEPS) % MELODY_STEPS;
  const chordIdx = Math.floor(loopStep / 16);
  const chord = CHORD_PROGRESSION[chordIdx];
  const notes: StepNote[] = [];

  // 1. Melody
  const melNote = currentMelody[loopStep];
  if (melNote !== null && melNote !== undefined) {
    notes.push({
      channel: CHANNELS.melody,
      note: melNote,
      velocity: 0x60,
      durationMs: 150,
    });
  }

  // 2. Bass
  if (step % 4 === 0 || (L > 60 && step % 4 === 2 && rng() < 0.5)) {
    let bassNote = chord.root - 12;
    if (L > 50 && step % 4 !== 0) bassNote += 12;
    notes.push({
      channel: CHANNELS.bass,
      note: bassNote,
      velocity: 0x55,
      durationMs: 250,
    });
  }

  // 3. Chord backing
  if (L > 20) {
    let playChord = false;
    if (L < 50 && (step % 8 === 0 || step % 8 === 4)) playChord = true;
    else if (L >= 50 && (step % 8 === 2 || step % 8 === 6)) playChord = true;
    if (playChord) {
      for (const note of chord.notes) {
        notes.push({
          channel: CHANNELS.chord,
          note,
          velocity: 0x40,
          durationMs: 150,
        });
      }
    }
  }

  // 4. Arpeggio
  if (L > 75 && step % 2 === 0) {
    const note =
      chord.notes[Math.floor(step / 2) % chord.notes.length] + 24;
    notes.push({
      channel: CHANNELS.arp,
      note,
      velocity: 0x40,
      durationMs: 100,
    });
  }

  // 5. Drums (GM Ch10 == channel 9)
  if (L > 10) {
    // Kick (note 36)
    if (step % 8 === 0 || (L > 60 && step % 16 === 10)) {
      notes.push({
        channel: CHANNELS.drum,
        note: 36,
        velocity: 0x64,
        durationMs: 50,
      });
    }
    // Snare (note 38)
    if (L > 30 && step % 8 === 4) {
      notes.push({
        channel: CHANNELS.drum,
        note: 38,
        velocity: 0x65,
        durationMs: 50,
      });
    }
    // Hi-hat (note 42 closed / 46 open)
    if (L > 20) {
      if (step % 4 === 0 || (L > 60 && step % 2 === 0)) {
        const open = L > 80 && step % 8 === 6;
        notes.push({
          channel: CHANNELS.drum,
          note: open ? 46 : 42,
          velocity: 0x45,
          durationMs: 50,
        });
      }
    }
  }

  return { chord, notes };
}

/**
 * GM ポップ音色 (HTML 版 initGMInstruments) を各チャンネルに設定 + 音量 CC7 を揃える。
 * `close()` 不要なので純サイド効果のみ。
 */
export function initGmInstruments(output: MidiOutput, volume01 = 0.8): void {
  output.programChange(CHANNELS.melody, GM_PROGRAMS.squareLead);
  output.programChange(CHANNELS.bass, GM_PROGRAMS.synthBass1);
  output.programChange(CHANNELS.arp, GM_PROGRAMS.vibraphone);
  output.programChange(CHANNELS.chord, GM_PROGRAMS.electricPiano2);
  // drum (ch 9) は GM で自動的に drum kit、program change 不要。

  const vol = Math.max(0, Math.min(127, Math.floor(volume01 * 127)));
  for (const ch of [
    CHANNELS.melody,
    CHANNELS.bass,
    CHANNELS.arp,
    CHANNELS.chord,
    CHANNELS.drum,
  ]) {
    output.controlChange(ch, 7, vol);
  }
}
