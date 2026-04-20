import { describe, it, expect } from "vitest";
import {
  CHANNELS,
  CHORD_PROGRESSION,
  GM_PROGRAMS,
  MELODY_STEPS,
  clampLevel,
  computeBpm,
  generateMelody,
  initGmInstruments,
  scheduleStep,
  secondsPerStep,
} from "../src/midi/music-generator.js";
import { FakeMidiOutput } from "../src/midi/output.js";

/** 決定論的な rng。コンストラクタで与えた配列を順繰りに返す。*/
function seededRng(seq: number[]): () => number {
  let i = 0;
  return () => seq[i++ % seq.length];
}

describe("music-generator", () => {
  describe("clampLevel", () => {
    it("clamps negative to 0", () => {
      expect(clampLevel(-10)).toBe(0);
    });
    it("clamps >100 to 100", () => {
      expect(clampLevel(150)).toBe(100);
    });
    it("floors fractional values", () => {
      expect(clampLevel(42.9)).toBe(42);
    });
    it("guards NaN / Infinity", () => {
      expect(clampLevel(Number.NaN)).toBe(0);
      expect(clampLevel(Number.POSITIVE_INFINITY)).toBe(0);
    });
  });

  describe("computeBpm", () => {
    it("is 100 at level=0", () => {
      expect(computeBpm(0)).toBe(100);
    });
    it("is 160 at level=100", () => {
      expect(computeBpm(100)).toBe(160);
    });
    it("is 130 at level=50", () => {
      expect(computeBpm(50)).toBe(130);
    });
  });

  describe("secondsPerStep", () => {
    it("100 BPM → 0.15s per 16th", () => {
      expect(secondsPerStep(100)).toBeCloseTo(0.15, 5);
    });
  });

  describe("generateMelody", () => {
    it("returns 64-step array", () => {
      const melody = generateMelody(0, seededRng([0.5]));
      expect(melody).toHaveLength(MELODY_STEPS);
    });

    it("level=0 → plays only on 8th beats (i % 8 === 0)", () => {
      const melody = generateMelody(0, seededRng([0.5]));
      for (let i = 0; i < MELODY_STEPS; i++) {
        if (i % 8 === 0) expect(melody[i]).not.toBeNull();
        else expect(melody[i]).toBeNull();
      }
    });

    it("notes come from chord progression tones (per 16-step block)", () => {
      const melody = generateMelody(0, seededRng([0.5]));
      for (let i = 0; i < MELODY_STEPS; i++) {
        const n = melody[i];
        if (n === null) continue;
        const chordIdx = Math.floor(i / 16);
        const chord = CHORD_PROGRESSION[chordIdx];
        // melody uses tone + 12 (and optionally + 24 above level 70).
        const allowed = [
          ...chord.notes.map((t) => t + 12),
          chord.root + 24, // root + 12 (tones extension) + 12 (octave lift)
        ];
        expect(allowed).toContain(n);
      }
    });
  });

  describe("scheduleStep", () => {
    it("step=0 on C chord: bass + kick + hi-hat + chord backing (level=25 → no chord)", () => {
      const melody = generateMelody(0, seededRng([0.5]));
      const { chord, notes } = scheduleStep(0, melody, 25, seededRng([0.5]));
      expect(chord.name).toBe("C");

      const channels = notes.map((n) => n.channel);
      // melody from step 0
      expect(channels).toContain(CHANNELS.melody);
      // bass on every 4th step
      expect(channels).toContain(CHANNELS.bass);
      // level=25 → drums are on (>10), kick on step 0, hi-hat on step 0 (step % 4 === 0)
      expect(notes.filter((n) => n.channel === CHANNELS.drum)).toHaveLength(2);
    });

    it("level=0 skips drums entirely", () => {
      const melody = generateMelody(0, seededRng([0.5]));
      const { notes } = scheduleStep(0, melody, 0, seededRng([0.5]));
      expect(notes.find((n) => n.channel === CHANNELS.drum)).toBeUndefined();
    });

    it("level=90 triggers arp on even steps", () => {
      const melody = generateMelody(90, seededRng([0.5]));
      const { notes } = scheduleStep(2, melody, 90, seededRng([0.5]));
      expect(notes.find((n) => n.channel === CHANNELS.arp)).toBeDefined();
    });

    it("chord backing on step 4 at level=40 (4打ち)", () => {
      const melody = generateMelody(40, seededRng([0.5]));
      const { notes } = scheduleStep(4, melody, 40, seededRng([0.5]));
      const chordNotes = notes.filter((n) => n.channel === CHANNELS.chord);
      // chord has 3 notes, all fire on step 4
      expect(chordNotes).toHaveLength(3);
    });

    it("chord backing on step 2 at level=60 (裏打ち), not on step 4", () => {
      const melody = generateMelody(60, seededRng([0.5]));
      const step2 = scheduleStep(2, melody, 60, seededRng([0.5])).notes.filter(
        (n) => n.channel === CHANNELS.chord,
      );
      const step4 = scheduleStep(4, melody, 60, seededRng([0.5])).notes.filter(
        (n) => n.channel === CHANNELS.chord,
      );
      expect(step2).toHaveLength(3);
      expect(step4).toHaveLength(0);
    });

    it("wraps loopStep modulo MELODY_STEPS", () => {
      const melody = generateMelody(0, seededRng([0.5]));
      const a = scheduleStep(0, melody, 30, seededRng([0.5]));
      const b = scheduleStep(MELODY_STEPS, melody, 30, seededRng([0.5]));
      expect(a.chord.name).toBe(b.chord.name);
    });
  });

  describe("initGmInstruments", () => {
    it("sends program changes to ch 0/1/2/4 and CC #7 volume to all 5 channels", () => {
      const fake = new FakeMidiOutput();
      initGmInstruments(fake, 1.0);

      const programs = fake.messages.filter((m) => m.kind === "program");
      expect(programs).toEqual([
        { kind: "program", channel: CHANNELS.melody, program: GM_PROGRAMS.squareLead },
        { kind: "program", channel: CHANNELS.bass, program: GM_PROGRAMS.synthBass1 },
        { kind: "program", channel: CHANNELS.arp, program: GM_PROGRAMS.vibraphone },
        {
          kind: "program",
          channel: CHANNELS.chord,
          program: GM_PROGRAMS.electricPiano2,
        },
      ]);

      const ccVol = fake.messages.filter(
        (m) => m.kind === "cc" && m.controller === 7,
      );
      expect(ccVol).toHaveLength(5); // 5 channels
      for (const m of ccVol) {
        if (m.kind === "cc") expect(m.value).toBe(127);
      }
    });
  });
});
