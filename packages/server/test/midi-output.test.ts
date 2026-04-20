import { describe, expect, it } from "vitest";
import {
  FakeMidiOutput,
  NullMidiOutput,
  openMidiOutput,
} from "../src/midi/index.js";

describe("NullMidiOutput", () => {
  it("is a no-op for send / close", () => {
    const out = new NullMidiOutput();
    expect(out.name).toBe("null");
    out.send({ type: "noteon", note: 60, velocity: 100, channel: 0 });
    out.send({ type: "programchange", number: 10, channel: 0 });
    out.close();
    // no throw
  });
});

describe("FakeMidiOutput", () => {
  it("records all sent messages in order", () => {
    const out = new FakeMidiOutput();
    out.send({ type: "programchange", number: 10, channel: 0 });
    out.send({ type: "noteon", note: 60, velocity: 100, channel: 0 });
    out.send({ type: "noteoff", note: 60, velocity: 0, channel: 0 });
    expect(out.messages).toEqual([
      { type: "programchange", number: 10, channel: 0 },
      { type: "noteon", note: 60, velocity: 100, channel: 0 },
      { type: "noteoff", note: 60, velocity: 0, channel: 0 },
    ]);
  });

  it("close() sets closed flag", () => {
    const out = new FakeMidiOutput();
    expect(out.closed).toBe(false);
    out.close();
    expect(out.closed).toBe(true);
  });
});

describe("openMidiOutput", () => {
  it("returns NullMidiOutput when portName is undefined", async () => {
    const out = await openMidiOutput(undefined);
    expect(out).toBeInstanceOf(NullMidiOutput);
  });

  it("returns NullMidiOutput when portName is an empty string", async () => {
    const out = await openMidiOutput("");
    expect(out).toBeInstanceOf(NullMidiOutput);
  });

  it("returns NullMidiOutput when the port is not found (or easymidi fails to load)", async () => {
    // 環境によって easymidi ロード成功 (→ ポート未検出で null) / 失敗 (→ load error で null) の
    // どちらかに落ちるが、どちらも NullMidiOutput を返すのが契約。
    const out = await openMidiOutput("__definitely_not_a_real_midi_port__");
    expect(out).toBeInstanceOf(NullMidiOutput);
  });
});
