import { describe, it, expect, vi } from "vitest";
import {
  FakeMidiOutput,
  NoopMidiOutput,
  selectMidiOutput,
} from "../src/midi/output.js";

describe("NoopMidiOutput", () => {
  it("is a no-op for all methods", () => {
    const n = new NoopMidiOutput();
    expect(() => n.noteOn(0, 60, 100)).not.toThrow();
    expect(() => n.noteOff(0, 60)).not.toThrow();
    expect(() => n.controlChange(0, 7, 100)).not.toThrow();
    expect(() => n.programChange(0, 1)).not.toThrow();
    expect(() => n.allNotesOff()).not.toThrow();
    expect(() => n.close()).not.toThrow();
    expect(n.name).toBe("(noop)");
  });
});

describe("FakeMidiOutput", () => {
  it("captures noteOn / noteOff / cc / program / allNotesOff in order", () => {
    const f = new FakeMidiOutput();
    f.noteOn(0, 60, 100);
    f.noteOff(0, 60);
    f.controlChange(1, 7, 120);
    f.programChange(2, 80);
    f.allNotesOff();
    f.close();

    expect(f.messages).toEqual([
      { kind: "noteOn", channel: 0, note: 60, velocity: 100 },
      { kind: "noteOff", channel: 0, note: 60 },
      { kind: "cc", channel: 1, controller: 7, value: 120 },
      { kind: "program", channel: 2, program: 80 },
      { kind: "allNotesOff" },
    ]);
    expect(f.closed).toBe(true);
  });
});

describe("selectMidiOutput", () => {
  it("returns NoopMidiOutput when MIDI_PORT is undefined", () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const out = selectMidiOutput(undefined, logger);
    expect(out.name).toBe("(noop)");
    expect(logger.log).toHaveBeenCalled();
  });

  it("returns NoopMidiOutput when MIDI_PORT is empty", () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const out = selectMidiOutput("   ", logger);
    expect(out.name).toBe("(noop)");
  });

  it("warns and falls back when port is not available on the system", () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const out = selectMidiOutput("__DOES_NOT_EXIST__", logger);
    expect(out.name).toBe("(noop)");
    expect(logger.warn).toHaveBeenCalled();
  });
});
