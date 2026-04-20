# Phase 6 — MIDI BGM 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 5 完了状態 (AiGateway 経由で AI 駆動のセッションが通る) の上に、**サーバ側から MIDI BGM を出力する** 層を載せる。`docs/README.md` §技術的観点 の「BGMはノートPCのnode.jsバックエンドからMIDIでMIDI音源に対して出力する」を満たす。`MIDI_PORT` 未指定 / `easymidi` ロード失敗 / ポート未検出 のいずれでも silent にフォールバック (NullMidiOutput) し、UX は一切崩れない (ハッカソン会場 MIDI 音源不在時の保険)。

**Architecture:** `SessionRuntime.subscribe` を使い、Orchestrator と **並立** する第 2 購読者として `MidiController` を走らせる。state 変化を `MidiScene` に 1:1 マッピングし、scene ごとの **programchange + 数発の noteon + (オプショナル) loopPeriodMs でのループ再発火** を出す。実 MIDI I/O は `MidiOutput` interface 越しに呼ぶ → 実機では `RealMidiOutput` (easymidi 動的 import)、テストでは `FakeMidiOutput` (送信メッセージ配列に積む)、MIDI 無効時は `NullMidiOutput` (no-op)。Scheduler は Orchestrator と **別インスタンス** を持たせ、テストで両者の timer を独立に drive できるようにする。

**Tech Stack:** Phase 5 と同じ + `easymidi`@latest (optionalDependency — native build 失敗しても install が通るように)。

**受け入れ条件 (Phase完了の定義):**

- `pnpm -r test` / `pnpm -r typecheck` / `pnpm -r build` がすべてグリーン。
- `MIDI_PORT` を `.env` に入れてサーバを起動し、対応ポート (例: macOS IAC Driver Bus 1) を Logic / SimpleSynth 等に繋ぐと、
  - 起動直後 (waiting) に pad 系の和音が鳴る
  - START → setup で scene が切り替わり (古い noteoff → 新 programchange → noteon)、音色が変わる
  - playerNaming / roundLoading / roundPlaying / roundResult / totalResult の各遷移で scene が都度切り替わる
  - RESET で waiting scene に戻る
- `MIDI_PORT` を **外した** 状態でサーバを起動 → ログに `[midi] MIDI_PORT not set, using NullMidiOutput` が出て、音は鳴らないが他のすべて (Phase 1〜5 の挙動) は完全に従来通り動く。
- `MIDI_PORT` に存在しないポート名を与えた場合 → ログに `[midi] port "<name>" not found in getOutputs(), using NullMidiOutput` が出て silent に Null に落ちる。
- `easymidi` の native binding が load できない環境 (CI 等) → ログに `[midi] failed to load easymidi, using NullMidiOutput` が出て silent に Null に落ちる。
- 新規テスト:
  - FakeMidiOutput + 実 SessionRuntime で state 遷移 (`waiting → setup → playerNaming → roundLoading → ...`) を起こし、各 scene 境界で **古い noteoff → 新 programchange → 新 noteon** の順でメッセージが来ることを検証。
  - MidiController 起動直後に現在 state (waiting) の scene が即発火することを検証 (`runtime.subscribe` が同期で現在スナップショットを流す仕様を前提)。
  - NullMidiOutput の no-op 挙動と、`MidiController.stop()` が保持中ノートを全部 noteoff してから output.close() を呼ぶことを検証。

Phase 6 の **非目標** (やらないこと):
- SE (効果音) — noteoff/noteon タイミングを player input に連動させる、等は含めない。scene 切替 = state 切替のみ。
- 楽曲データ (MIDI ファイル再生) — easymidi はリアルタイム送信のみ使う。`.mid` ファイルロードはしない。
- Web Audio フォールバック — ブラウザ側で音を鳴らすのは本 Phase では扱わない。
- チャンネルごとの複数パート / 複雑なシーケンサ — scene = 1 programchange + ≤3 notes + 任意 loop、の枠を越えない。

---

## 前提: 既存のアーキテクチャ

### SessionRuntime.subscribe の挙動

`packages/server/src/session-runtime.ts` の `subscribe(listener)` は **登録直後に現在の snapshot を同期で listener に流す** 仕様 (既存コード L30)。Orchestrator もこの挙動に依存している。MidiController も同じ仕様を使い、`start()` した瞬間に現在の state に対応する scene を即発火する。テストでも同じ挙動を期待する。

### Orchestrator と MidiController の並立

両者は `SessionRuntime.subscribe` の独立した購読者であり、相互依存はない。state 遷移が起きると、両者の listener が別々に呼ばれる (順序は xstate の listener 登録順。Orchestrator を `app.ts` で先に `start()` させ、MidiController を後に `start()` させる運用で固定)。

### Scheduler を Orchestrator と共有しない

Orchestrator は scene 遷移のタイミング制御に Scheduler を使っているが、MidiController は **別の Scheduler** を持つ。理由:
- テストで `orchScheduler.runAll()` と `midiScheduler.runAll()` を独立に呼び分けられる (片方だけ進めて中間状態を検査できる)
- 本番で `realScheduler` を共有しても挙動は変わらない (timer id が独立するだけ)

---

## Architecture 詳細

### MidiOutput interface

```ts
export type MidiMessage =
  | { type: "noteon"; note: number; velocity: number; channel: number }
  | { type: "noteoff"; note: number; velocity: number; channel: number }
  | { type: "programchange"; number: number; channel: number };

export interface MidiOutput {
  readonly name: string; // ログ用 ("null" / "fake" / port name)
  send(msg: MidiMessage): void;
  close(): void;
}
```

### 3 実装

1. **NullMidiOutput** — send は no-op、close も no-op。`name = "null"`。
2. **FakeMidiOutput** (テスト専用) — `messages: MidiMessage[]` に全て push、`closed: boolean`。`name = "fake"`。
3. **RealMidiOutput** — `openRealMidiOutput(portName)` factory から生成。内部で **動的 `import("easymidi")`** して `getOutputs()` を列挙し、ポート名が含まれるなら `new easymidi.Output(portName)` を掴む。failure はすべて呼び出し側に Promise reject で伝え、factory でキャッチ → NullMidiOutput にフォールバック。

### factory: openMidiOutput

```ts
export async function openMidiOutput(portName: string | undefined): Promise<MidiOutput> {
  if (!portName) {
    console.log("[midi] MIDI_PORT not set, using NullMidiOutput");
    return new NullMidiOutput();
  }
  try {
    const easymidi = await import("easymidi");
    const outputs = easymidi.getOutputs();
    if (!outputs.includes(portName)) {
      console.warn(`[midi] port "${portName}" not found in getOutputs(), using NullMidiOutput`);
      return new NullMidiOutput();
    }
    return new RealMidiOutput(portName, new easymidi.Output(portName));
  } catch (e) {
    console.warn("[midi] failed to load easymidi, using NullMidiOutput:", e);
    return new NullMidiOutput();
  }
}
```

`RealMidiOutput` は `easymidi.Output` インスタンスを握り、`send({type, ...})` を `output.send(type, rest)` に素通ししつつ、`close()` で `output.close()` を呼ぶ。

### Scene 定義

`SessionStateName` と 1:1 の `MidiScene` (同値). scene ごとに以下を保持:

```ts
export interface SceneNote {
  note: number;       // 0..127
  velocity: number;   // 0..127
  channel: number;    // 0..15
  /** scene 開始後この時点で noteon する (ms)。*/
  offsetMs: number;
  /** noteon から noteoff までの長さ (ms)。*/
  durationMs: number;
}

export interface Scene {
  name: MidiScene;
  /** 任意: scene 開始時に programchange を送る。*/
  program?: { channel: number; number: number };
  notes: SceneNote[];
  /**
   * ループ周期。指定すると notes を loopPeriodMs 間隔で繰り返す。
   * 未指定なら 1 発で終わり (次の scene 遷移まで無音)。
   */
  loopPeriodMs?: number;
}
```

### 7 scene の最小定義 (ハッカソン向け)

GM (General MIDI) program は Piano(0) / Music Box(10) / Pad 2 "Warm"(89) / Synth Bass(38) / Kalimba(108) あたりから 1 発ずつ。音数は各 scene 1〜3 音、loop は `roundPlaying` のみ。

| scene | program (GM#) | 音 (MIDI note番号) | loopPeriodMs |
| --- | --- | --- | --- |
| waiting | 89 (Pad 2 warm) | C4(60), E4(64), G4(67) を 4s sustain | — (繰り返さない) |
| setup | 10 (Music Box) | C5(72) 0.5s, E5(76) 0.5s, G5(79) 0.5s, sequential | — |
| playerNaming | 108 (Kalimba) | G4(67), C5(72) — 1s ずつ | — |
| roundLoading | 81 (Lead 2 sawtooth) | C4(60) → G4(67) → C5(72) 早い arpeggio | — |
| roundPlaying | 38 (Synth Bass 1) | kick-pattern (note 36, ch 9 = drum) 4 発 / バス (note 48) 2 発 | 2000 (2秒ループ) |
| roundResult | 0 (Piano) | C major 7th (60,64,67,71) 2s sustain | — |
| totalResult | 48 (Strings) | C3,G3,C4,E4,G4 (3,55,60,64,67) 5s sustain | — |

> この表は実装着手時に鳴らしながら微調整する。**コードには注数 ≤ 4 / scene、合計 bytes < 2KB 程度を堅持**。凝ったら負け。

### MidiController の責務

- `start()`: runtime.subscribe して毎回 scene を判定、変わっていれば切替。初回呼び出しで現在 state の scene を即発火 (subscribe の同期初期通知)。
- `stop()`: 保持中ノートをすべて noteoff → output.close() → scheduler 解除。二重 stop 安全。
- scene 切替時の手順:
  1. **extinguish**: 現在保持中の `(note, channel)` を全 noteoff し、pending scheduler cancel を全発火
  2. scene.program があれば programchange を即送信
  3. scene.notes の各 note について offsetMs 後に noteon を scheduler に詰む。発火時に `heldNotes` に add。durationMs 後に noteoff を scheduler に詰む (発火時に `heldNotes` から remove)
  4. scene.loopPeriodMs があれば loopPeriodMs 後に「同じ scene をもう一度再発火」する再帰 scheduler を詰む (scene が変わっていたら noop)

保持中ノートは `Set<`${channel}:${note}`>` で管理。extinguish は Set を iterate して全 noteoff してから clear する。

### 失敗モード

- `output.send` が throw (easymidi のポート切断等) → try/catch で握り潰し、warn ログ。scene loop は継続。
- `output.close` が throw → 同様に握り潰し。

---

## File Structure (Phase 6 で作成 / 変更)

```
packages/
├── server/
│   ├── package.json                    # easymidi を optionalDependencies に追加
│   ├── .env.example                    # MIDI_PORT コメント更新 (既存の placeholder は残す)
│   ├── src/
│   │   ├── midi/                       # 新規ディレクトリ
│   │   │   ├── index.ts                # re-export
│   │   │   ├── output.ts               # MidiOutput interface + Null/Real/Fake 実装 + openMidiOutput
│   │   │   ├── scenes.ts               # Scene 定義 (7 scene)
│   │   │   └── controller.ts           # MidiController
│   │   └── app.ts                      # openMidiOutput → MidiController を生成 / start / onClose で stop
│   └── test/
│       ├── midi-output.test.ts         # 新規: Null / Fake の挙動 + openMidiOutput のフォールバック
│       └── midi-controller.test.ts     # 新規: 実 SessionRuntime + FakeMidiOutput で scene 遷移を検査
```

Web パッケージ・shared パッケージは Phase 6 では **変更しない** (BGM はサーバ完結なので)。

---

## Task 1: easymidi 依存追加 + MidiOutput 抽象を実装

**Files:**
- Modify: `packages/server/package.json` (optionalDependencies に easymidi 追加)
- Create: `packages/server/src/midi/output.ts`
- Create: `packages/server/src/midi/index.ts`

### Step 1: easymidi を optionalDependencies に追加

```bash
pnpm --filter @app/server add -O easymidi
```

> `-O` / `--save-optional` で optionalDependencies に入れる。失敗しても install 全体は続行する。pnpm-lock.yaml が更新される。

もし native build が失敗して install が止まる場合:
```bash
pnpm install --no-optional
```
で一旦抜け、後で MIDI 音源に繋ぐ PC でだけ `pnpm install` を再実行する運用でもよい。

### Step 2: `packages/server/src/midi/output.ts` を作る

```ts
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
  send(): void {}
  close(): void {}
}

/**
 * テスト用。send したメッセージを messages に全部積む。
 * close() は closed = true にするだけ。
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

/**
 * MIDI_PORT env に基づいて MidiOutput を返す。未設定 / ロード失敗 / ポート未検出
 * のいずれでも NullMidiOutput を返す (silent fallback)。
 */
export async function openMidiOutput(portName: string | undefined): Promise<MidiOutput> {
  if (!portName) {
    console.log("[midi] MIDI_PORT not set, using NullMidiOutput");
    return new NullMidiOutput();
  }
  try {
    const easymidi: any = await import("easymidi");
    const outputs: string[] = easymidi.getOutputs?.() ?? [];
    if (!outputs.includes(portName)) {
      console.warn(
        `[midi] port "${portName}" not found in getOutputs() (available: ${outputs.join(", ") || "<none>"}), using NullMidiOutput`,
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
```

### Step 3: `packages/server/src/midi/index.ts`

```ts
export type { MidiMessage, MidiOutput } from "./output.js";
export { NullMidiOutput, FakeMidiOutput, RealMidiOutput, openMidiOutput } from "./output.js";
export { MidiController } from "./controller.js"; // Task 3 で追加
export { scenesByState, type Scene, type SceneNote, type MidiScene } from "./scenes.js"; // Task 3 で追加
```

index.ts は Task 3 完了までは `./controller.js` と `./scenes.js` の re-export を落として段階的に通す。

### Step 4: typecheck (この時点ではまだ controller/scenes が無いので index.ts の re-export は未記載)

```bash
pnpm --filter @app/server typecheck
```

Expected: clean。

### Step 5: Commit

```bash
git add packages/server/src/midi/output.ts packages/server/src/midi/index.ts packages/server/package.json pnpm-lock.yaml
git commit -m "feat(server): MidiOutput abstraction + optional easymidi dependency"
```

---

## Task 2: Scene 定義を実装

**Files:**
- Create: `packages/server/src/midi/scenes.ts`

### Step 1: scenes.ts

```ts
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
  loopPeriodMs?: number;
}

const DEFAULT_CHANNEL = 0;
const DRUM_CHANNEL = 9; // GM のドラム専用ch

function pad(notes: number[], startOffsetMs = 0, durationMs = 4000, velocity = 70): SceneNote[] {
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
      // drum (kick on ch9, note 36)
      ...seq(
        [
          { note: 36, at: 0, dur: 100, vel: 110 },
          { note: 36, at: 1000, dur: 100, vel: 110 },
        ],
        DRUM_CHANNEL,
      ),
      // bass (ch0)
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
```

### Step 2: typecheck

```bash
pnpm --filter @app/server typecheck
```

Expected: clean。

### Step 3: Commit

```bash
git add packages/server/src/midi/scenes.ts
git commit -m "feat(server): MIDI scene definitions for 7 states"
```

---

## Task 3: MidiController 実装

**Files:**
- Create: `packages/server/src/midi/controller.ts`
- Modify: `packages/server/src/midi/index.ts` (controller + scenes を re-export)

### Step 1: controller.ts

```ts
import type { SessionSnapshot, SessionStateName } from "@app/shared";
import type { SessionRuntime } from "../session-runtime.js";
import type { Scheduler } from "../orchestrator/scheduler.js";
import { realScheduler } from "../orchestrator/scheduler.js";
import type { MidiOutput } from "./output.js";
import { scenesByState, type Scene } from "./scenes.js";

type HeldKey = `${number}:${number}`; // `${channel}:${note}`

export class MidiController {
  private unsubscribe: (() => void) | null = null;
  private pendingCancels: Array<() => void> = [];
  private heldNotes = new Set<HeldKey>();
  private lastScene: SessionStateName | null = null;
  /** scene 内で loop 中 (loopPeriodMs による再発火) であることを示す。*/
  private activeLoopGen = 0;
  private stopped = false;

  constructor(
    private runtime: SessionRuntime,
    private output: MidiOutput,
    private scheduler: Scheduler = realScheduler,
  ) {}

  start(): void {
    if (this.unsubscribe || this.stopped) return;
    this.unsubscribe = this.runtime.subscribe((snap) => this.onState(snap));
    // subscribe() は同期で現在 snapshot を listener に流すので、この時点で scene 発火済み。
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.extinguish();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.output.close();
  }

  private onState(snap: SessionSnapshot): void {
    if (this.stopped) return;
    const next = snap.state;
    if (next === this.lastScene) return;
    this.lastScene = next;
    const scene = scenesByState[next];
    this.playScene(scene);
  }

  private playScene(scene: Scene): void {
    this.extinguish();
    this.activeLoopGen += 1;
    const gen = this.activeLoopGen;
    if (scene.program) {
      this.output.send({
        type: "programchange",
        channel: scene.program.channel,
        number: scene.program.number,
      });
    }
    for (const n of scene.notes) {
      this.scheduleNoteOn(n, gen);
    }
    if (scene.loopPeriodMs && scene.loopPeriodMs > 0) {
      this.scheduleLoop(scene, gen);
    }
  }

  private scheduleNoteOn(
    n: { note: number; velocity: number; channel: number; offsetMs: number; durationMs: number },
    gen: number,
  ): void {
    const cancelOn = this.scheduler.schedule(n.offsetMs, () => {
      if (gen !== this.activeLoopGen || this.stopped) return;
      const key: HeldKey = `${n.channel}:${n.note}`;
      this.heldNotes.add(key);
      this.output.send({
        type: "noteon",
        note: n.note,
        velocity: n.velocity,
        channel: n.channel,
      });
      const cancelOff = this.scheduler.schedule(n.durationMs, () => {
        if (gen !== this.activeLoopGen || this.stopped) {
          // extinguish 経由で既に消えている
          return;
        }
        if (this.heldNotes.delete(key)) {
          this.output.send({
            type: "noteoff",
            note: n.note,
            velocity: 0,
            channel: n.channel,
          });
        }
      });
      this.pendingCancels.push(cancelOff);
    });
    this.pendingCancels.push(cancelOn);
  }

  private scheduleLoop(scene: Scene, gen: number): void {
    const cancel = this.scheduler.schedule(scene.loopPeriodMs!, () => {
      if (gen !== this.activeLoopGen || this.stopped) return;
      // 同一 scene を再発火。extinguish → noteon re-schedule。
      // scene が変わっていたら onState がすでに activeLoopGen を進めているので no-op。
      this.playScene(scene);
    });
    this.pendingCancels.push(cancel);
  }

  /** 現在鳴っている全ノートを noteoff、pending timer を全 cancel。*/
  private extinguish(): void {
    for (const cancel of this.pendingCancels) cancel();
    this.pendingCancels = [];
    for (const key of this.heldNotes) {
      const [channelStr, noteStr] = key.split(":");
      const channel = Number(channelStr);
      const note = Number(noteStr);
      this.output.send({ type: "noteoff", note, velocity: 0, channel });
    }
    this.heldNotes.clear();
  }
}
```

### Step 2: index.ts を更新

`packages/server/src/midi/index.ts` の Task 1 で仮コメントアウトした re-export を有効化:

```ts
export type { MidiMessage, MidiOutput } from "./output.js";
export {
  NullMidiOutput,
  FakeMidiOutput,
  RealMidiOutput,
  openMidiOutput,
} from "./output.js";
export { MidiController } from "./controller.js";
export { scenesByState, type Scene, type SceneNote, type MidiScene } from "./scenes.js";
```

### Step 3: typecheck

```bash
pnpm --filter @app/server typecheck
```

Expected: clean。

### Step 4: Commit

```bash
git add packages/server/src/midi/controller.ts packages/server/src/midi/index.ts
git commit -m "feat(server): MidiController drives scene transitions from state machine"
```

---

## Task 4: buildApp で MIDI を配線

**Files:**
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/.env.example` (コメント補足)

### Step 1: app.ts を更新

`buildApp` は現在 sync だが、`openMidiOutput` は async なので `buildApp` を async 化する選択肢と、**MidiController を遅延 attach する** 選択肢がある。後者を選ぶ: `buildApp` は sync のまま残し、`index.ts` で `app.ready()` の後 `attachMidi(app)` を await する。テスト (app.test.ts) は MIDI を触らないので何もしなくてよい (デフォルトで MIDI_PORT 未設定 → Null → テストに影響しない)。

ただし MidiController を app の lifecycle と連動させたい (onClose で stop)。以下のように `app.decorate` で保持する。

**app.ts:**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { SessionRuntime } from "./session-runtime.js";
import { registerHttpRoutes } from "./http.js";
import { Orchestrator } from "./orchestrator/index.js";
import type { AiGateway } from "./ai/index.js";
import { MockAiGateway } from "./ai/mock.js";
import { GeminiGateway } from "./ai/gemini.js";
import {
  MidiController,
  NullMidiOutput,
  openMidiOutput,
  type MidiOutput,
} from "./midi/index.js";

export interface BuildAppOptions {
  runtime?: SessionRuntime;
  orchestrator?: Orchestrator | null;
  gateway?: AiGateway;
  /** テストから MIDI 層を差し替える (デフォルトは NullMidiOutput + MidiController を attach)。 */
  midi?: { output: MidiOutput } | null;
}

function selectGateway(): AiGateway {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    console.log("[ai] GEMINI_API_KEY not set, using MockAiGateway");
    return new MockAiGateway();
  }
  console.log("[ai] GEMINI_API_KEY present, using GeminiGateway");
  return new GeminiGateway(key);
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const runtime = opts.runtime ?? new SessionRuntime();
  const gateway = opts.gateway ?? selectGateway();
  const refineQualitative = process.env.AI_REFINE_QUALITATIVE === "true";
  const orchestrator =
    opts.orchestrator === null
      ? null
      : (opts.orchestrator ??
        new Orchestrator(runtime, undefined, undefined, {
          gateway,
          refineQualitative,
        }));

  // デフォルトでは Null の MidiController を即 attach (onClose で stop されるように)。
  // 実際の MIDI ポートを開くのは attachMidi() で非同期に差し替える。
  const initialMidiOutput: MidiOutput =
    opts.midi === undefined ? new NullMidiOutput() : (opts.midi?.output ?? new NullMidiOutput());
  const midiController =
    opts.midi === null ? null : new MidiController(runtime, initialMidiOutput);

  registerHttpRoutes(app);
  app.decorate("sessionRuntime", runtime);
  app.decorate("orchestrator", orchestrator);
  app.decorate("midiController", midiController);
  app.decorate("midiOutput", initialMidiOutput);

  orchestrator?.start();
  midiController?.start();

  app.addHook("onClose", async () => {
    midiController?.stop();
    orchestrator?.stop();
    runtime.stop();
  });

  return app;
}

/**
 * 実 MIDI ポートを非同期に開き、app に attach する。既に動いている
 * MidiController を停止して、新しい output で再起動する。
 *
 * index.ts から app.ready() 後に await で呼ぶ。テストでは使わない。
 */
export async function attachRealMidi(app: FastifyInstance, portName: string | undefined): Promise<void> {
  const output = await openMidiOutput(portName);
  const old = app.midiController;
  old?.stop();
  const controller = new MidiController(app.sessionRuntime, output);
  // 再 decorate は許可されないので、replace 的に参照を差し替える
  (app as unknown as { midiController: MidiController | null }).midiController = controller;
  (app as unknown as { midiOutput: MidiOutput }).midiOutput = output;
  controller.start();
}

declare module "fastify" {
  interface FastifyInstance {
    sessionRuntime: SessionRuntime;
    orchestrator: Orchestrator | null;
    midiController: MidiController | null;
    midiOutput: MidiOutput;
  }
}
```

### Step 2: index.ts (entry) を更新

```ts
import "dotenv/config";

import { attachRealMidi, buildApp } from "./app.js";
import { attachSocketIo } from "./ws.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

await app.ready();
await attachRealMidi(app, process.env.MIDI_PORT?.trim());
attachSocketIo(app.server, app.sessionRuntime, app.orchestrator);

app
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => {
    console.log(`server listening on ${addr}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

### Step 3: .env.example を整える

既存の `MIDI_PORT=` の placeholder を活かしつつ、コメントで「空なら無効」を強調:

```
# [Phase 6] easymidi が出力する MIDI ポート名。
# 未指定 / 存在しないポート名 / easymidi ロード失敗 のいずれでも silent に no-op
# (NullMidiOutput) にフォールバックし、UX は崩れない。
# 利用可能なポート名は `node -e "console.log(require('easymidi').getOutputs())"` で確認できる。
# 例: macOS IAC Driver なら "IAC Driver Bus 1"。
MIDI_PORT=
```

### Step 4: typecheck + test

```bash
pnpm --filter @app/server typecheck
pnpm --filter @app/server test
```

Expected: 既存 test 全 pass (MIDI_PORT 未指定なので NullMidiOutput + MidiController は副作用なしで動く)。app.test.ts の close 経路で MidiController.stop が呼ばれることを typecheck レベルで確認。

### Step 5: Commit

```bash
git add packages/server/src/app.ts packages/server/src/index.ts packages/server/.env.example
git commit -m "feat(server): wire MidiController into buildApp + attachRealMidi on startup"
```

---

## Task 5: テスト追加

**Files:**
- Create: `packages/server/test/midi-output.test.ts`
- Create: `packages/server/test/midi-controller.test.ts`

### Step 1: midi-output.test.ts

```ts
import { describe, it, expect } from "vitest";
import {
  FakeMidiOutput,
  NullMidiOutput,
  openMidiOutput,
} from "../src/midi/index.js";

describe("NullMidiOutput", () => {
  it("is a no-op", () => {
    const out = new NullMidiOutput();
    expect(out.name).toBe("null");
    out.send({ type: "noteon", note: 60, velocity: 100, channel: 0 });
    out.close();
    // no throw
  });
});

describe("FakeMidiOutput", () => {
  it("records all messages and tracks closed state", () => {
    const out = new FakeMidiOutput();
    out.send({ type: "programchange", number: 10, channel: 0 });
    out.send({ type: "noteon", note: 60, velocity: 100, channel: 0 });
    out.close();
    expect(out.messages).toEqual([
      { type: "programchange", number: 10, channel: 0 },
      { type: "noteon", note: 60, velocity: 100, channel: 0 },
    ]);
    expect(out.closed).toBe(true);
  });
});

describe("openMidiOutput", () => {
  it("returns NullMidiOutput when portName is undefined", async () => {
    const out = await openMidiOutput(undefined);
    expect(out).toBeInstanceOf(NullMidiOutput);
  });

  it("returns NullMidiOutput when portName is empty string", async () => {
    const out = await openMidiOutput("");
    expect(out).toBeInstanceOf(NullMidiOutput);
  });

  it("returns NullMidiOutput when port is not found (includes easymidi load failure path)", async () => {
    // easymidi がロードできない環境でも NullMidiOutput が返ること。
    // load できても存在しないポート名なら同じ。
    const out = await openMidiOutput("__definitely_not_a_real_midi_port__");
    expect(out).toBeInstanceOf(NullMidiOutput);
  });
});
```

> `openMidiOutput` の 3 ケース目は easymidi が native build に成功していれば「ポート未検出」で Null、失敗していれば「ロード失敗」で Null。どちらの経路も同じ結果なので 1 本のテストで両方をカバーできる。

### Step 2: midi-controller.test.ts

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionRuntime } from "../src/session-runtime.js";
import { FakeScheduler } from "../src/orchestrator/scheduler.js";
import { FakeMidiOutput, MidiController, scenesByState } from "../src/midi/index.js";

describe("MidiController", () => {
  let runtime: SessionRuntime;
  let output: FakeMidiOutput;
  let scheduler: FakeScheduler;
  let controller: MidiController;

  beforeEach(() => {
    runtime = new SessionRuntime();
    output = new FakeMidiOutput();
    scheduler = new FakeScheduler();
    controller = new MidiController(runtime, output, scheduler);
  });

  afterEach(() => {
    controller.stop();
    runtime.stop();
  });

  it("fires the waiting scene immediately on start()", async () => {
    controller.start();
    // subscribe は同期で現在 snapshot を流すので programchange は即送信済み。
    expect(output.messages[0]).toEqual({
      type: "programchange",
      channel: 0,
      number: scenesByState.waiting.program!.number,
    });
    // noteon は offsetMs=0 の scheduler に積まれている
    expect(output.messages.length).toBe(1);
    await scheduler.runAll();
    // waiting scene の note 数だけ noteon が出たこと
    const noteons = output.messages.filter((m) => m.type === "noteon");
    expect(noteons.length).toBe(scenesByState.waiting.notes.length);
  });

  it("extinguishes held notes with noteoff before firing the next scene's programchange", async () => {
    controller.start();
    await scheduler.runAll(); // waiting scene の noteon を発火
    const noteonCount = output.messages.filter((m) => m.type === "noteon").length;
    expect(noteonCount).toBeGreaterThan(0);

    // 次の scene へ遷移
    runtime.send({ type: "START" });

    // 遷移時点で「古い noteoff 群 → 新 programchange」の順で出ていること。
    const afterStart = output.messages.slice(noteonCount + 1); // programchange + noteon(s) より後ろ
    const firstNewProgramIdx = afterStart.findIndex((m) => m.type === "programchange");
    expect(firstNewProgramIdx).toBeGreaterThanOrEqual(0);
    // programchange より前はすべて noteoff
    for (let i = 0; i < firstNewProgramIdx; i++) {
      expect(afterStart[i]!.type).toBe("noteoff");
    }
    // programchange の番号は setup scene のもの
    const pc = afterStart[firstNewProgramIdx]!;
    expect(pc).toMatchObject({
      type: "programchange",
      number: scenesByState.setup.program!.number,
    });
  });

  it("does not re-fire scene when state snapshot updates without state change", async () => {
    controller.start();
    await scheduler.runAll();
    const baseline = output.messages.length;
    // 同じ waiting state で再 subscribe → 副作用なし
    // (ここでは runtime.get を呼ぶだけ。実際の xstate は state 維持中は listener に通知しない)
    runtime.get();
    expect(output.messages.length).toBe(baseline);
  });

  it("stop() emits noteoff for all held notes, closes the output, and is idempotent", async () => {
    controller.start();
    await scheduler.runAll(); // waiting notes が held に入る
    const beforeStop = output.messages.length;
    controller.stop();
    const after = output.messages.slice(beforeStop);
    // held note の noteoff が出ている (waiting scene の note 数 = held 数)
    expect(after.every((m) => m.type === "noteoff")).toBe(true);
    expect(after.length).toBe(scenesByState.waiting.notes.length);
    expect(output.closed).toBe(true);

    // 二重 stop は no-op
    const len1 = output.messages.length;
    controller.stop();
    expect(output.messages.length).toBe(len1);
  });

  it("ignores state events after stop()", async () => {
    controller.start();
    await scheduler.runAll();
    controller.stop();
    const before = output.messages.length;
    runtime.send({ type: "START" });
    expect(output.messages.length).toBe(before);
  });
});
```

### Step 3: Run tests

```bash
pnpm --filter @app/server test
```

Expected: 既存 + 新規 (midi-output 4 + midi-controller 5) すべて pass。

### Step 4: Commit

```bash
git add packages/server/test/midi-output.test.ts packages/server/test/midi-controller.test.ts
git commit -m "test(server): MidiController scene transitions + MidiOutput fallback"
```

---

## Task 6: 全体グリーン確認 + スモーク + 最終レビュー

### Step 1: モノレポ全体で確認

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

Expected: すべてグリーン。

### Step 2: MIDI_PORT 未指定モードで動作確認

```bash
pnpm --filter @app/server dev
```

Expected log: `[midi] MIDI_PORT not set, using NullMidiOutput`。3 ブラウザで START → full 1 セッション走破。音は鳴らないが Phase 5 までの UX が完全に維持される。

### Step 3: MIDI_PORT 設定で動作確認 (macOS の場合)

`Audio MIDI 設定.app` の IAC ドライバを有効化し `"IAC Driver Bus 1"` 等のポートを作成。SimpleSynth や Logic Pro で受信する。

```
MIDI_PORT=IAC Driver Bus 1
```

Expected:
- 起動直後に waiting scene の pad が鳴る
- START で setup scene (Music Box) に切替
- SETUP_DONE → 名前入力 → roundLoading → roundPlaying (drums + bass loop 2s) と scene が切り替わる
- RESET で waiting に戻って pad が鳴る

### Step 4: 最終レビュー (superpowers:code-reviewer)

確認:
- `MidiController.stop()` が pending timer を全 cancel し、held notes を全 noteoff してから output.close() を呼ぶか。
- scene 切替時の「古い noteoff → 新 programchange → 新 noteon」順序が守られているか。
- RESET → waiting への遷移で loop generation がリセットされ、stale scheduler callback が再発火しないか。
- `openMidiOutput` が MIDI_PORT 未指定 / ポート未検出 / easymidi ロード失敗 のすべてで silent に NullMidiOutput を返すか。
- `easymidi` を optionalDependency にしたことで CI/vitest のインストール経路が壊れていないか。

### Step 5: レビュー指摘が重大なら修正、そうでなければ Phase 6 完了。docs/plans/00-overview.md の Phase 6 行を ✅ 済みに印を付ける (任意)。

---

## Self-Review

Phase 6 完了時点で達成されていること:

- `SessionRuntime.subscribe` の第 2 購読者として `MidiController` が走り、state → scene のマッピングに従って programchange + noteon/noteoff を `MidiOutput` 越しに送出する。
- MIDI 層は `MidiOutput` interface で抽象化され、テストは `FakeMidiOutput`、本番は `RealMidiOutput`、それ以外は `NullMidiOutput`。`openMidiOutput(portName)` が 3 方向 (unset / not found / load failure) のフォールバックを一手に引き受ける。
- `easymidi` は optionalDependencies + 動的 import で、native build に失敗する環境でも install / test / build が通る。
- scene 切替で held note の noteoff が **必ず先行** する。hardware で stuck note にならない。
- `MidiController` は Orchestrator とは独立した `Scheduler` を持ち、テストで両者のタイマーを独立に drive できる。
- ハッカソン要件: docs/README.md §技術的観点 の「BGMはノートPCのnode.jsバックエンドからMIDIでMIDI音源に対して出力する」を満たす。

Phase 6 までで `docs/README.md` で予定していた実装はすべて反映されている。以降は演出チューニング (scene の和音・ループ・velocity 調整) のみで、アーキテクチャ変更は不要。
