# Phase 6 — MIDI BGM

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

## Scope

サーバ側 (Node.js) から MIDI 音源へ BGM を出力する。ベースは
`/Users/takuro/Downloads/index.html` の Dynamic Love-Sync BGM Generator を
Node.js 実装に移植し、XState の状態遷移にフックする。

### 発火タイミングと `friendshipLevel` 割り当て

| 遷移 | friendship level | 挙動 |
| --- | --- | --- |
| `active.roundLoading` 進入 / `currentRound === 1` | `0` | メロディ再生成 + ループ再生開始 |
| `active.roundLoading` 進入 / `currentRound === 2` | `scores[1]` (0-100) | メロディ再生成 + ループ再生開始 |
| `active.roundLoading` 進入 / `currentRound === 3` | `scores[2]` (0-100) | メロディ再生成 + ループ再生開始 |
| `waiting` (RESET 後) 進入 | n/a | 再生停止 + All Notes Off |
| `totalResult` 進入 | n/a | 再生停止 (Round 3 の BGM を止める) |
| `roundPlaying` / `roundResult` | (変化なし) | 直前 roundLoading で張ったループがそのまま継続 |

`roundPlaying` 中は melody/bass/drum をループし続け、`roundResult` に遷移しても
次の `roundLoading` で再生成されるまで同じ曲が鳴り続ける。

### スコア範囲

3 ゲームいずれも `GameScore.score` は 0–100 の整数。生成器は `Math.max(0, Math.min(100, level))`
でクランプする (境界防御)。

## アーキテクチャ

```
packages/server/src/midi/
├── output.ts           # MidiOutput interface + EasyMidiOutput + NoopMidiOutput
├── music-generator.ts  # HTML 版の純粋ロジック移植 (chord progression / generateMelody / BPM 計算)
└── bgm-controller.ts   # SessionRuntime 購読 + 再生ループ
```

- `MidiOutput` は `noteOn / noteOff / controlChange / programChange / allNotesOff / close` を持つ最小インターフェース。
  テスト用に送信メッセージを貯める `FakeMidiOutput` と、実機用 `EasyMidiOutput` (`easymidi.Output` ラッパ)、
  そして `MIDI_PORT` 未設定時の `NoopMidiOutput` を用意する。
- `MusicScheduler` (BgmController 内) は `currentStep` をインクリメントしながら `setTimeout`
  でループする。`secondsPerStep = 60 / bpm / 4` で 16分音符刻み、64 ステップで melody ループ。
  - WebMIDI 版は `send([...], timestamp + durationMs)` で note-off を未来時刻にキューできるが、
    `easymidi` は即時送信しかできないので、各 `noteOn` 時に `setTimeout(durationMs, noteOff)` を張る。
- `BgmController.onState` は `Orchestrator.onState` と同様に `lastState` + `currentRound` を
  見てサイド効果を発火する。`roundLoading` 進入時は `lastState` が違う or 別 round に変わったときのみ再生成。

## ライフサイクル

- `buildApp` で `selectMidiOutput()` を呼び、`process.env.MIDI_PORT` があれば `EasyMidiOutput`、
  無ければ `NoopMidiOutput` を生成 (ハッカソン会場で MIDI 未配線でも落ちないように)。
  - `easymidi.getOutputs()` に無いポート名が指定されたときは警告ログ + `NoopMidiOutput` にフォールバック。
- `onClose` フックで `BgmController.stop()` → `MidiOutput.close()` の順に解放。

## タスク

- [x] `docs/plans/06-midi-bgm.md` を書く (本ドキュメント)
- [ ] `@app/server` に `easymidi` (+ `@types/easymidi` があれば) を追加
- [ ] `packages/server/src/midi/output.ts` に `MidiOutput` / `EasyMidiOutput` / `NoopMidiOutput` / `FakeMidiOutput`
- [ ] `packages/server/src/midi/music-generator.ts` に HTML の `generateNewMelody` + `scheduleNote` を port
- [ ] `packages/server/src/midi/bgm-controller.ts` に `BgmController` (runtime 購読 + 再生ループ)
- [ ] `packages/server/src/app.ts` に `selectMidiOutput()` + `BgmController` 起動/停止を配線
- [ ] Vitest: music-generator (生成が deterministic seed で落ちる形で書ける範囲) / BgmController (fake 出力 + fake timers)
- [ ] `pnpm -r typecheck` / `pnpm -r test` がグリーン

## 受け入れ条件

1. `MIDI_PORT` 未設定でサーバを起動しても例外が出ず、他 Phase の動作に影響しない。
2. `MIDI_PORT` 設定時、Round 1/2/3 の `roundLoading` 進入で MIDI ポートに noteOn が出る (実機確認)。
3. Round 2/3 は直前ラウンドの `scores[r-1]` を friendship level として BGM が生成されている
   (ログ or スナップショットで確認)。
4. RESET で `waiting` に戻ると All Notes Off が送られ、無音になる。
5. Phase 1〜5 の既存テストが引き続きグリーン。
