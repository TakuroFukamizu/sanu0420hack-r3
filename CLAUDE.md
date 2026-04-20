# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

2人1組でプレイするアーケードゲーム (ハッカソン案件) のモノレポ。仕様は `docs/README.md`、
実装計画は `docs/plans/00-overview.md` を起点にしたフェーズ分割 (01-foundation.md 〜 06)。
現状は **Phase 1 着手前のスケルトン** で、`package.json` と `docs/plans/` だけが整備済み・
`packages/*/src` は空。実装は `docs/plans/01-foundation.md` のタスクを順番に消化していく。

## 必須コマンド

Node 20 (`.nvmrc`) + pnpm 9 (`packageManager` ピン止め)。

| 目的 | コマンド |
| --- | --- |
| インストール | `pnpm install` |
| ルートから全パッケージテスト | `pnpm -r test` (= 各パッケージの `vitest run`) |
| ルートから全パッケージ型チェック | `pnpm -r typecheck` |
| ルートから全パッケージビルド | `pnpm -r build` |
| サーバ開発起動 (port 3000) | `pnpm --filter @app/server dev` (tsx watch) |
| Web 開発起動 (port 5173) | `pnpm --filter @app/web dev` (Vite) |
| 単一パッケージのテスト | `pnpm --filter @app/<name> test` |
| 単一テストファイル | `pnpm --filter @app/<name> test <partial-path>` (例: `test machine`) |

Vite dev server は `/socket.io` と `/api` を `:3000` の Fastify にプロキシするので、
フロント実装中は上記2コマンドを2ペインで並行起動する運用が前提。

## アーキテクチャ (big picture)

単一ファイルを読んでも把握しづらい設計上の決定事項。

### 三画面モデル・常時接続・URL固定

実行時にブラウザが **3枚同時に開いて閉じない** 前提で設計されている:

1. ノートPC = イントロ画面: `http://<host>:5173/`
2. LG LD290EJS-FPN1 (A): `http://<host>:5173/player?id=A`
3. LG LD290EJS-FPN1 (B): `http://<host>:5173/player?id=B`

3画面とも起動時に Socket.io `/session` namespace に接続し、閉じるまで繋ぎっぱなし。
**URL 遷移は一切行わない**。ビューの切り替えはすべてサーバから push される状態の変化で発火する。
`Intro.tsx` / `Player.tsx` の 2 ルートしかないのはこのため。

### サーバ側 XState actor が唯一の状態ソース

`packages/shared/src/machine.ts` に定義する **単一 XState v5 マシン** を、サーバ側で
**1 プロセス 1 インスタンス (singleton)** だけ生成する (`packages/server/src/session-runtime.ts`)。
状態遷移は次の 3 種類で発火する:

1. **intro → サーバ** (`client:event`): `START` / `SETUP_DONE` / `RESET`
2. **player → サーバ** (`player:input`): サーバ内オーケストレータが集約してスコアリング。
   state machine を直接は叩かない。
3. **サーバ内オーケストレータ** (タイマー / AI応答完了): `ROUND_READY` / `ROUND_COMPLETE` /
   `NEXT_ROUND` / `SESSION_DONE`

どの経路で発火した遷移も、最後は `session:state` が全 socket に broadcast される。
**クライアントは自身の `role` と受信した `state` から描画するビューを選ぶだけ** (projection 型)。
その対応表は `docs/plans/00-overview.md` §1.3 にある。

### shared パッケージが型と状態マシンの正本

`packages/shared/src/` に:
- `types.ts`: DTO (`SessionSnapshot`, `ClientEvent`, `PlayerInput`, `ClientToServerEvents` 等)
- `machine.ts`: XState マシン本体 + `snapshotToDTO(actor.getSnapshot())` 変換関数

server / web はどちらもワークスペース参照 (`"@app/shared": "workspace:*"`) で直接 TS ソースを
import する (`package.json` の `main` が `./src/index.ts` を指している)。build 前でも解決されるので、
shared を変更したら即座に両側の型に反映される。

### role ベースの権限分離

Socket.io 接続時のクエリで `?role=intro` または `?role=player&id=A|B` を送り、
サーバ (`packages/server/src/ws.ts`) が検査する。**role 外の操作は無視する**:
- `client:event` は intro のみ許可
- `player:input` は player のみ許可
- 未知の role は `disconnect(true)`

### AI と MIDI はサーバ側完結

- **Gemini**: `GEMINI_API_KEY` はサーバ `.env` のみ。クライアントには渡さない。
  呼び出しは 3 箇所 (ゲーム選択 / ラウンド評価 / 最終診断)。Phase 5 で追加。
- **MIDI/BGM**: `easymidi` でノート PC の MIDI ポートに直接出す。`MIDI_PORT` env で選択。
  状態遷移フックから発火する。Phase 6 で追加。

いずれも Phase 1〜4 では実装しない (モックで進める)。

## プレイヤー画面の技術的制約 (重要)

プレイヤー画面は **LG LD290EJS-FPN1 に載った Chrome 84.0.4147.125 / Android 7.1.2** で動く。
使える / 使えない WebAPI・CSS や、ビルドターゲット設定 (Vite `build.target = ['chrome84']`、
TS `target = "ES2019"` 推奨) は **必ず `docs/knowledge/player-display-lg-ld290ejs-fpn1.md` を参照**
してから実装すること。解像度は **1920 × 540 (横長ストレッチバー, 約 70 DPI)**、タッチ入力あり。

## テストの作法 (計画ドキュメントから抽出)

- `docs/plans/01-foundation.md` の各タスクは **失敗するテストを先に書く → 実装 → グリーン** の
  TDD サイクルで進む。新規ロジックを追加する時はこの流れを踏む。
- 状態マシンのテストは `createActor(sessionMachine).start()` で actor を起こしてイベントを `send` する。
- Socket.io の契約テストは **実サーバを `app.server.listen(0)` でランダムポート起動** して
  `socket.io-client` から叩く。mock しない (`packages/server/test/ws.test.ts` 参照)。

## 作業フロー (Phase 実装時)

1. `docs/plans/00-overview.md` で全体像を確認。
2. `docs/plans/01-foundation.md` (以降 `02-*.md` ... ) のタスクを上から順にチェックボックス消化。
   各タスクに該当する sub-skill (`superpowers:subagent-driven-development` が推奨) が指定されている。
3. Phase 完了時点の「受け入れ条件」がその計画ファイル冒頭に明記されている。必ずそれを満たして終える。
4. Phase 2 以降の計画ファイルは **そのフェーズを始める直前に書く** (00-overview.md §4 の方針)。

## ドキュメント構成

- `docs/README.md` — プロダクト仕様 (状態遷移図・画面構成・ハードウェア構成)
- `docs/plans/00-overview.md` — 実装計画インデックス + アーキテクチャ決定
- `docs/plans/01-foundation.md` 〜 — フェーズ別タスクリスト (各 Phase 開始時に追記)
- `docs/knowledge/` — 実装判断に必要な技術リファレンス (デバイス仕様等)
