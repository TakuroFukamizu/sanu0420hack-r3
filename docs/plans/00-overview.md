# ペアプレイ・アーケードゲーム 実装計画 — Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase's plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/README.md` のスペックを、段階的に動く・テストできるフェーズに分割して実装する。本ドキュメントは各フェーズ計画のインデックスとアーキテクチャ決定の記録である。

**Architecture:** TypeScript モノレポ (pnpm workspaces) 上で、Fastify + Socket.io のゲームサーバが **単一の XState v5 状態マシン** をホストし、以下3つの常時接続クライアントに状態変化をWebSocketでpushする:

1. **ノートPC上のイントロ画面** (role=intro)
2. **LG LD290EJS-FPN1 上のプレイヤー画面A** (role=player, id=A)
3. **LG LD290EJS-FPN1 上のプレイヤー画面B** (role=player, id=B)

各画面はゲームセット中ずっと開きっぱなし。**すべての画面遷移はサーバの状態マシン遷移によって駆動され、クライアント側で URL 遷移や手動ナビゲーションは行わない**。AI評価 (Gemini) と BGM (MIDI) はサーバが保持・実行する。

**Tech Stack:**

| 領域 | 選定 | 理由 |
| --- | --- | --- |
| Lang | TypeScript (strict) | 共有型で B-E / F-E / WS を安全に繋ぐ |
| Monorepo | pnpm workspaces | 設定が軽く、ロックファイル1本で済む |
| Server | Fastify 5 + Socket.io 4 | Fastify でヘルス/管理REST、Socket.io で双方向通信 |
| State machine | XState v5 (サーバ側唯一のソース) | `docs/README.md` の状態遷移図を宣言的に書ける |
| Frontend | React 18 + Vite + TypeScript | 配信が軽量、HMRが速い |
| Client routing | React Router v6 | `/` (intro) と `/player` の2ルートのみ |
| AI | `@google/genai` (Gemini) | 公式SDK、JSONモードで構造化出力 |
| MIDI | `easymidi` (node-midi ラッパ) | Node.jsから物理/仮想MIDIポートへ送信 |
| Test | Vitest + socket.io-client (WS契約) | 単一ランナー、実WSを叩いて契約テスト |

---

## 1. アーキテクチャ決定 (Decisions)

### 1.1 三画面モデル (常時接続・役割固定)

- 3つのブラウザが起動時から閉じるまで同じページを開き続ける:
  - ノートPC: `http://<server-host>:5173/` → イントロ画面
  - LGディスプレイ1: `http://<server-host>:5173/player?id=A`
  - LGディスプレイ2: `http://<server-host>:5173/player?id=B`
- 3画面とも Socket.io `/session` namespace に常時接続し、サーバからの `session:state` を購読する。
- ブラウザ側は **自分の role × 現在の state** から描画すべきビューを選ぶ。URL は起動時に開いた1種類のまま変わらない。
- 起動手順: サーバ → ノートPCイントロ → プレイヤー画面2台、の順で開く。

### 1.2 サーバが唯一の状態ソース、クライアントは投影 (projection)

- サーバに **single-session** の XState actor を1つ持つ (1テーブル1組のインスタレーション前提)。
- ステート遷移は以下3種類で発火する:
  1. **Intro画面からのユーザ操作** (`client:event`): `START`, `SETUP_DONE`, `RESET`
  2. **プレイヤー画面からの入力** (`player:input`): サーバ側オーケストレータが集約しスコアリングに使う (直接 state machine は叩かない)
  3. **サーバ内オーケストレータ** (タイマー / AI応答完了): `ROUND_READY`, `ROUND_COMPLETE`, `NEXT_ROUND`, `SESSION_DONE`
- どの遷移も最終的に `session:state` が全クライアントに broadcast される。

### 1.3 state × role → ビュー投影表

| state | intro (notebook PC) | player A / B (LG) |
| --- | --- | --- |
| `waiting` | Start ビュー (STARTボタン) | Waiting ビュー (1枚絵) |
| `setup` | Setup ビュー (関係性 4択ボタンのみ) | Waiting ビュー |
| `playerNaming` | PlayerNamingWait ビュー (プレイヤーの入力待機中) | NamingView (自分が未入力) / Waiting ビュー (入力済み) |
| `active.roundLoading` | Guide ビュー (プレイヤー画面へ誘導 / AI選出中) | Loading ビュー (次ラウンド準備中) |
| `active.roundPlaying` | Guide ビュー (Watchモード、進捗表示) | Game ビュー (当該Roundのゲーム) |
| `active.roundResult` | Guide ビュー (次Round告知) | RoundResult ビュー (煽りコメント) |
| `totalResult` | Finish ビュー (RESETボタン) | TotalResult ビュー (最終診断) |

- 上記は `state` が変われば即座に切り替わる。クライアントはこの表を実装するだけで良い。

### 1.4 URL / 画面識別

- URL は固定:
  - イントロ: `http://<host>:5173/`
  - プレイヤー: `http://<host>:5173/player?id=A|B`
- role は Socket.io 接続時のクエリで送る: `?role=intro` または `?role=player&id=A|B`
- サーバは role を検査し、権限外のイベントは無視する (例: player からの `client:event` は無視)。
- ガイド画面で表示する「プレイヤー画面 A/B のフルURL」は、env var `PLAYER_URL_A` / `PLAYER_URL_B` で指定する (Phase 2で追加)。無ければ `window.location.origin` を元に推測。

### 1.5 ミニゲーム3種 (本ハッカソン実装分)

- **`sync-answer` (シンクロ回答)**: 同じ質問に2人が選択肢から同時に答える。一致で得点。
- **`partner-quiz` (相方クイズ)**: 自分/相方についてのクイズに両者が答え、一致数で得点。
- **`timing-sync` (タイミング合わせ)**: 流れるバーを2人が同時にタップ。タップ時刻差が小さいほど高得点。

すべての game は player 画面内の `GameView` にレンダリング、`player:input` でサーバへ入力送信、サーバ側のスコアリングロジックが `ROUND_COMPLETE` を発火する。

### 1.6 AI 呼び出し (Gemini、3箇所、すべてサーバ側)

- セッション設定完了後: 関係性と名前をもとに **3ゲーム選択 + 各プレイヤー向けconfig生成**
- 各ラウンド終了時: そのラウンドの入力ログをもとに **定性評価文** を生成
- 全ラウンド終了時: スコア + 各ラウンド評価をもとに **最終相性診断文** を生成

API key はサーバの `.env` (`GEMINI_API_KEY`) にのみ置き、クライアントには渡さない。

### 1.7 MIDI / BGM

- `easymidi.getOutputs()` で MIDI出力ポートを列挙、`MIDI_PORT` env var で選択。
- 状態マシンの遷移に hook を仕込み、シーン (Waiting / Round開始 / Round結果 / 最終) ごとに BGM を切り替える。
- 実装は Phase 6 に切り出す (Phase 1〜5 では MIDI 出力なしで動く)。

---

## 2. ディレクトリ構成

```
.
├── package.json                 # pnpm workspaces root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── docs/
│   ├── README.md                # spec (既存)
│   └── plans/
│       ├── 00-overview.md       # 本ファイル
│       ├── 01-foundation.md
│       ├── 02-intro-setup.md    (未作成)
│       ├── 03-player-shell.md   (未作成)
│       ├── 04-games.md          (未作成)
│       ├── 05-ai-gemini.md      (未作成)
│       └── 06-midi-bgm.md       (未作成)
└── packages/
    ├── shared/                  # 共通型 + 状態マシン
    │   ├── src/
    │   │   ├── machine.ts
    │   │   ├── types.ts
    │   │   └── games/           # ゲームレジストリ (Phase 4)
    │   └── test/
    ├── server/
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── app.ts
    │   │   ├── session-runtime.ts  # singleton XState actor wrapper
    │   │   ├── http.ts             # /health 等 (Phase 1 では /health のみ)
    │   │   ├── ws.ts               # Socket.io /session 名前空間
    │   │   ├── orchestrator/       # サーバ駆動の遷移 (Phase 3〜5)
    │   │   ├── ai/                 # Gemini (Phase 5)
    │   │   └── midi/               # easymidi (Phase 6)
    │   └── test/
    └── web/
        ├── src/
        │   ├── main.tsx
        │   ├── App.tsx             # Routes: / と /player のみ
        │   ├── routes/
        │   │   ├── Intro.tsx       # state で Start/Setup/Guide/Finish を出し分け
        │   │   └── Player.tsx      # state で Waiting/Loading/Game/RoundResult/Total を出し分け
        │   ├── views/
        │   │   ├── intro/          # StartView, SetupView, GuideView, FinishView
        │   │   └── player/         # WaitingView, LoadingView, GameView, RoundResultView, TotalResultView
        │   ├── games/              # 3ゲームのコンポーネント (Phase 4)
        │   └── net/
        │       └── socket.ts       # intro/player 用 Socket.io クライアント
        └── test/
```

Phase 1 では `views/*` は最小のプレースホルダ (1行テキスト or 条件レンダリングで分岐のみ) で置き、実体は Phase 2〜4 で作り込む。

---

## 3. データコントラクト (Summary)

### 3.1 REST

| Method | Path | Purpose | Phase |
| --- | --- | --- | --- |
| GET | `/health` | 死活確認 `{status:"ok"}` | 1 |
| GET | `/api/player-urls` | ガイドビュー用、A/BのフルURLを返す | 2 |

セッション制御はすべて WS 経由なので、REST は管理系のみ。

### 3.2 WebSocket (namespace `/session`)

**接続時クエリ:** `role=intro` または `role=player&id=A|B`

**クライアント → サーバ:**
- `client:event` `ClientEvent` — union:
  - `{ type: "START" }` (intro のみ)
  - `{ type: "SETUP_DONE", data: SetupData }` (intro のみ)
  - `{ type: "RESET" }` (intro のみ)
- `player:input` `PlayerInput` (player のみ、Phase 4 で利用)

**サーバ → クライアント:**
- `session:state` `SessionSnapshot` — state と全文脈 (scores, setup, current round など)
- `round:start` `{ round, gameId, perPlayerConfig }` (Phase 4)
- `round:end` `{ round, score, qualitativeEval }` (Phase 4)
- `final` `{ totalScore, verdict }` (Phase 5)

サーバは role と送信元を照合し、許可されないイベントは無視する。具体的な型は `01-foundation.md` Task 3 (shared types) で確定する。

### 3.3 サーバ内オーケストレーション

`SETUP_DONE` 受信後のサーバ側シーケンス (Phase 3〜5 で実装):

1. Gemini に3ゲーム + 各プレイヤーconfigを生成させる (Phase 5 までは固定モック)
2. actor に `ROUND_READY` を送って `roundPlaying` に遷移、プレイヤー画面にゲームが出る
3. タイムアップ or プレイヤー入力集約で `ROUND_COMPLETE` を送る (scoreとqualitativeをセット)
4. 画面で `roundResult` が一定秒 (例: 8秒) 表示された後、`NEXT_ROUND` (round < 3) または `SESSION_DONE` を送る
5. `SESSION_DONE` の前に Gemini で最終診断を生成し、verdict として渡す

Phase 1 ではここまでのロジックは実装せず、Intro画面 の STARTクリックで `START` イベントが走り、3クライアントすべてが `setup` に切り替わることのみ確認する。

---

## 4. 実装フェーズ

各フェーズはそれ単独で動いてテストできる最小単位で切る。

| # | Phase | 成果物 (動くもの) |
| --- | --- | --- |
| 1 | **Foundation** (`01-foundation.md`) | monorepo 初期化、shared 型 + XState、Fastify+Socket.io スケルトン、3画面の常時接続、Intro STARTクリックで3画面すべてが `state=setup` に切り替わるスモーク |
| 2 | Intro & Setup | Setup フォーム実装、Setup送信で `SETUP_DONE` が走り intro は Guide、player は Loading に切り替わる。`PLAYER_URL_A/B` 表示。 |
| 3 | Player shell + orchestrator | Loading / RoundResult / TotalResult ビュー、サーバ内タイマー駆動で `ROUND_READY`/`NEXT_ROUND`/`SESSION_DONE` が自動遷移 (ゲーム中身はモック) |
| 4 | Games (3種) | 3ミニゲームのUI実装 + per-player config 受け渡し + `player:input` 集約 + スコアリング |
| 5 | AI (Gemini) | ゲーム選択・ラウンド評価・最終評価を固定モックから Gemini API に差し替え |
| 6 | MIDI BGM | 状態遷移フックで easymidi 経由に BGM 再生 |

Phase 1 完了後、Phase 2〜6 の詳細計画は本 overview を元に都度書く (一度に全部書くと要件の揺れで無駄が多い)。

---

## 5. 実行方法

1. 本 overview をユーザがレビュー・決定上書き。
2. `docs/plans/01-foundation.md` の全タスクを superpowers:subagent-driven-development で消化。
3. Phase 1 完了後、次フェーズの詳細計画を書いて実行、を繰り返す。

---

## 6. オープン項目 (Phase着手前に決めたい)

- [ ] LG LD290EJS-FPN1 の実解像度 / 比率 → UIレイアウト (多分縦長かウルトラワイド)
- [ ] MIDI音源の実機 (IAC driver? 外部音源?)
- [ ] ノートPC / LG の LAN接続形態 (同一Wi-Fi? 有線?) — プレイヤー画面が参照する `PLAYER_URL_A/B` に影響
- [ ] 各ラウンドの制限時間 (default 60秒?)
- [ ] 各ビュー遷移後の表示時間 (`roundResult` を何秒表示して次へ? `totalResult` でRESET待ち?)

上記は Phase 2 着手時に決まっていれば手戻りが減る。Phase 1 は影響を受けない。
