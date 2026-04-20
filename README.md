# sanu0420hack-r3 — Pair Arcade

2人1組でプレイするアーケードゲーム。
仕様: [docs/README.md](./docs/README.md) ・
実装計画インデックス: [docs/plans/00-overview.md](./docs/plans/00-overview.md) ・
セッション向けオリエンテーション: [CLAUDE.md](./CLAUDE.md)。

## Prerequisites
- Node 20 (`.nvmrc`)
- pnpm 9 (`packageManager` でピン止め済み)

## Setup
```bash
pnpm install
```

## Dev (2ペインで起動)
```bash
# ペイン1
pnpm --filter @app/server dev

# ペイン2
pnpm --filter @app/web dev
```

Vite dev server (`:5173`) が `/socket.io` と `/api` を Fastify (`:3000`) にプロキシする。

3 つのブラウザで開きっぱなしにする:
- ノートPC (intro): <http://localhost:5173/>
- LG ディスプレイ A (player): `http://<host>:5173/player?id=A`
- LG ディスプレイ B (player): `http://<host>:5173/player?id=B`

すべての画面遷移はサーバの XState 状態マシンが駆動するため、プレイヤーは
intro 画面で STARTボタン / Setup送信 を押すだけでよい。プレイヤー画面は
`session:state` 受信に従って自動で描画を切り替える。

## Test
```bash
pnpm -r test        # shared (9) + server (10) = 19 tests
pnpm -r typecheck
```

## Phase 1 受け入れ手動スモーク
1. 上記 2 ペインでサーバと Web を起動。
2. ブラウザを3つ開く (同一マシンでタブ3つでも可):
   - `http://localhost:5173/` → "state: waiting" と `START` ボタン
   - `http://localhost:5173/player?id=A` → debug snapshot に `"state":"waiting"`
   - `http://localhost:5173/player?id=B` → 同上
3. intro で **START** をクリック → 3画面とも `state: setup` に切り替わる (URLは不変)。
4. intro で **SETUP_DONE (mock)** をクリック → intro は Guide セクション、playerは "Round 1 準備中…" に切り替わる。

Phase 2 以降は [docs/plans/00-overview.md §4](./docs/plans/00-overview.md) のフェーズ表を参照。
