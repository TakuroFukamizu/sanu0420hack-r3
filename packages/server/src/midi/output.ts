export type MidiMessage =
  | { type: "noteon"; note: number; velocity: number; channel: number }
  | { type: "noteoff"; note: number; velocity: number; channel: number }
  | { type: "programchange"; number: number; channel: number };

export interface MidiOutput {
  readonly name: string;
  send(msg: MidiMessage): void;
  close(): void;
}

export class NullMidiOutput implements MidiOutput {
  readonly name = "null";
  send(_msg: MidiMessage): void {}
  close(): void {}
}

/**
 * テスト専用。send したメッセージを messages に全部積み、close() で closed を立てる。
 */
export class FakeMidiOutput implements MidiOutput {
  readonly name = "fake";
  readonly messages: MidiMessage[] = [];
  closed = false;
  send(msg: MidiMessage): void {
    this.messages.push(msg);
  }
  close(): void {
    this.closed = true;
  }
}

type EasymidiOutputInstance = {
  send(type: string, args: Record<string, number>): void;
  close(): void;
};

export class RealMidiOutput implements MidiOutput {
  readonly name: string;
  private readonly inner: EasymidiOutputInstance;
  private closed = false;
  constructor(portName: string, inner: EasymidiOutputInstance) {
    this.name = portName;
    this.inner = inner;
  }
  send(msg: MidiMessage): void {
    if (this.closed) return;
    try {
      const { type, ...rest } = msg;
      this.inner.send(type, rest);
    } catch (e) {
      console.warn(`[midi:${this.name}] send failed:`, e);
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.inner.close();
    } catch (e) {
      console.warn(`[midi:${this.name}] close failed:`, e);
    }
  }
}

type EasymidiModule = {
  getOutputs?: () => string[];
  Output: new (portName: string) => EasymidiOutputInstance;
};

/**
 * MIDI_PORT env に基づいて MidiOutput を返す。未設定 / ロード失敗 / ポート未検出
 * のいずれでも NullMidiOutput を返す (silent fallback)。
 */
export async function openMidiOutput(
  portName: string | undefined,
): Promise<MidiOutput> {
  if (!portName) {
    console.log("[midi] MIDI_PORT not set, using NullMidiOutput");
    return new NullMidiOutput();
  }
  try {
    const easymidi = (await import("easymidi")) as unknown as EasymidiModule;
    const outputs: string[] = easymidi.getOutputs?.() ?? [];
    if (!outputs.includes(portName)) {
      console.warn(
        `[midi] port "${portName}" not found in getOutputs() (available: ${
          outputs.join(", ") || "<none>"
        }), using NullMidiOutput`,
      );
      return new NullMidiOutput();
    }
    const inner = new easymidi.Output(portName);
    console.log(`[midi] opened output "${portName}"`);
    return new RealMidiOutput(portName, inner);
  } catch (e) {
    console.warn("[midi] failed to load easymidi, using NullMidiOutput:", e);
    return new NullMidiOutput();
  }
}
