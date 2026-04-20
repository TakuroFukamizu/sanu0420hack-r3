import easymidi from "easymidi";

type EasyMidiChannel = easymidi.Channel;

/**
 * 最小 MIDI 出力抽象。`easymidi.Output` を直接依存させず、テスト用の
 * FakeMidiOutput / 未配線時の NoopMidiOutput を差し替え可能にする。
 * 呼び出し側は CHANNELS 定数から 0-15 の数値を渡す (実装側で Channel にキャスト)。
 */
export interface MidiOutput {
  readonly name: string;
  noteOn(channel: number, note: number, velocity: number): void;
  noteOff(channel: number, note: number): void;
  controlChange(channel: number, controller: number, value: number): void;
  programChange(channel: number, program: number): void;
  /** 全チャンネル All Notes Off + Reset All Controllers。緊急停止用。*/
  allNotesOff(): void;
  close(): void;
}

const ALL_CHANNELS: EasyMidiChannel[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
];

function toChannel(n: number): EasyMidiChannel {
  return (n & 0x0f) as EasyMidiChannel;
}

/** `easymidi.Output` ラッパ。起動時にポート名を渡して開く。*/
export class EasyMidiOutput implements MidiOutput {
  private output: easymidi.Output;
  readonly name: string;

  constructor(portName: string) {
    this.output = new easymidi.Output(portName);
    this.name = portName;
  }

  noteOn(channel: number, note: number, velocity: number): void {
    this.output.send("noteon", { note, velocity, channel: toChannel(channel) });
  }

  noteOff(channel: number, note: number): void {
    this.output.send("noteoff", {
      note,
      velocity: 0,
      channel: toChannel(channel),
    });
  }

  controlChange(channel: number, controller: number, value: number): void {
    this.output.send("cc", {
      controller,
      value,
      channel: toChannel(channel),
    });
  }

  programChange(channel: number, program: number): void {
    this.output.send("program", {
      number: program,
      channel: toChannel(channel),
    });
  }

  allNotesOff(): void {
    for (const ch of ALL_CHANNELS) {
      // CC 123: All Notes Off, CC 121: Reset All Controllers
      this.output.send("cc", { controller: 123, value: 0, channel: ch });
      this.output.send("cc", { controller: 121, value: 0, channel: ch });
    }
  }

  close(): void {
    this.output.close();
  }
}

/** MIDI_PORT 未指定時のフォールバック。全メソッドが no-op。*/
export class NoopMidiOutput implements MidiOutput {
  readonly name = "(noop)";
  noteOn(_channel: number, _note: number, _velocity: number): void {}
  noteOff(_channel: number, _note: number): void {}
  controlChange(_channel: number, _controller: number, _value: number): void {}
  programChange(_channel: number, _program: number): void {}
  allNotesOff(): void {}
  close(): void {}
}

export type MidiMessage =
  | { kind: "noteOn"; channel: number; note: number; velocity: number }
  | { kind: "noteOff"; channel: number; note: number }
  | { kind: "cc"; channel: number; controller: number; value: number }
  | { kind: "program"; channel: number; program: number }
  | { kind: "allNotesOff" };

/** テスト用。送信された MIDI メッセージを順序通りに貯める。*/
export class FakeMidiOutput implements MidiOutput {
  readonly name = "(fake)";
  readonly messages: MidiMessage[] = [];
  closed = false;

  noteOn(channel: number, note: number, velocity: number): void {
    this.messages.push({ kind: "noteOn", channel, note, velocity });
  }
  noteOff(channel: number, note: number): void {
    this.messages.push({ kind: "noteOff", channel, note });
  }
  controlChange(channel: number, controller: number, value: number): void {
    this.messages.push({ kind: "cc", channel, controller, value });
  }
  programChange(channel: number, program: number): void {
    this.messages.push({ kind: "program", channel, program });
  }
  allNotesOff(): void {
    this.messages.push({ kind: "allNotesOff" });
  }
  close(): void {
    this.closed = true;
  }
}

/**
 * MIDI_PORT env var から出力を選ぶ。未設定 or リスト外なら NoopMidiOutput。
 * リスト外のポートが指定された場合はコンソール警告を出す (タイポ検知)。
 */
export function selectMidiOutput(
  portName: string | undefined,
  logger: Pick<Console, "log" | "warn"> = console,
): MidiOutput {
  if (!portName || portName.trim() === "") {
    logger.log("[midi] MIDI_PORT not set, using NoopMidiOutput");
    return new NoopMidiOutput();
  }
  const available = easymidi.getOutputs();
  if (!available.includes(portName)) {
    logger.warn(
      `[midi] MIDI_PORT='${portName}' not found. Available: [${available.join(", ")}]. Falling back to NoopMidiOutput.`,
    );
    return new NoopMidiOutput();
  }
  logger.log(`[midi] Opening MIDI output '${portName}'`);
  return new EasyMidiOutput(portName);
}
