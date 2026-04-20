# Phase 2 — Intro & Setup 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 のスケルトン上に、イントロ画面の **Start / Setup / Guide / Finish** 各ビューを実装し、`SETUP_DONE` を実フォームから発火できるようにする。合わせてガイド画面で表示する **プレイヤー画面 A/B の URL + QRコード** を表示するための `/api/player-urls` エンドポイントを用意する。プレイヤー画面側は **Waiting / Loading** の視覚を整え、残り (`Game` / `RoundResult` / `Total`) はファイル分割のみ (実ビューは Phase 3〜4)。

**Architecture:** サーバは env var `PLAYER_URL_A` / `PLAYER_URL_B` を参照して `/api/player-urls` で配る (未設定時は `null`、クライアント側が `window.location.origin` からフォールバックで組み立てる)。Web は Intro / Player 各ルートを **`views/*` のサブコンポーネントに分割** し、ルートコンポーネントは `switch (state)` で振り分けるだけに薄くする。スタイルはグローバル `styles.css` で一元管理 (CSS Modules は導入せずハッカソン速度優先)。

**Tech Stack:** Phase 1 と同じ + `qrcode.react` (MIT, 4.x)

**受け入れ条件 (Phase完了の定義):**

- `pnpm -r test` / `pnpm -r typecheck` がグリーン
- `/api/player-urls` が env var からの値を返し、未設定時は `{A: null, B: null}` を返す (サーバの契約テスト)
- ブラウザ3枚常時接続状態で:
  1. intro `/` を開くと **Start ビュー** (動く背景 + START) が出る
  2. START クリック → **Setup ビュー** (2名 + 関係性 の入力フォーム)
  3. フォーム送信 → **Guide ビュー** (Player A / B の URL と QR) が intro に出る。**同時に player 画面2枚が自動で Loading ビューに切り替わる**
  4. URL が 3画面すべてで起動時のまま (`/`, `/player?id=A`, `/player?id=B`)
- 手動で強制的に `totalResult` に遷移させる手段は本Phaseでは設けない (Phase 3 の orchestrator 実装後に自然と到達できる)。FinishView は最低限の RESET ボタンのみ実装する

Phase 3 以降で実装する (本Phaseでは出さない):
- Orchestrator (サーバ内タイマーで `ROUND_READY` / `NEXT_ROUND` / `SESSION_DONE` を自動発火)
- Player 側の Round ごとのゲーム本体、ラウンド結果・最終結果ビジュアル

---

## File Structure (Phase 2 で作成 / 変更)

```
packages/
├── shared/
│   └── src/
│       └── types.ts              # PlayerUrls 型を追加
├── server/
│   ├── src/
│   │   └── http.ts               # /api/player-urls を追加
│   └── test/
│       └── app.test.ts           # /api/player-urls のテストを追加
└── web/
    ├── package.json              # qrcode.react を追加
    └── src/
        ├── main.tsx              # styles.css を import
        ├── styles.css            # 新規
        ├── routes/
        │   ├── Intro.tsx         # switch で views を呼ぶ薄い実装に
        │   └── Player.tsx        # 同上
        ├── views/
        │   ├── intro/
        │   │   ├── StartView.tsx
        │   │   ├── SetupView.tsx
        │   │   ├── GuideView.tsx
        │   │   └── FinishView.tsx
        │   └── player/
        │       ├── WaitingView.tsx
        │       ├── LoadingView.tsx
        │       ├── GameView.tsx            # stub (Phase 4)
        │       ├── RoundResultView.tsx     # stub (Phase 3)
        │       └── TotalResultView.tsx     # stub (Phase 3)
        └── net/
            └── api.ts            # 新規: fetch('/api/player-urls')
```

---

## Task 1: shared に `PlayerUrls` 型を追加 + サーバ `/api/player-urls`

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/server/src/http.ts`
- Modify: `packages/server/test/app.test.ts`

- [ ] **Step 1: shared に型を追加**

`packages/shared/src/types.ts` の末尾に追記:

```ts
export interface PlayerUrls {
  A: string | null;
  B: string | null;
}
```

- [ ] **Step 2: 失敗するテストを書く**

`packages/server/test/app.test.ts` の `describe` ブロックに以下を追加:

```ts
import { vi } from "vitest";

// ...既存の describe 内 または 新しい describe に追加

describe("GET /api/player-urls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns env-configured URLs when PLAYER_URL_A/B are set", async () => {
    vi.stubEnv("PLAYER_URL_A", "http://10.0.0.1:5173/player?id=A");
    vi.stubEnv("PLAYER_URL_B", "http://10.0.0.1:5173/player?id=B");
    const localApp = buildApp();
    try {
      const res = await localApp.inject({ method: "GET", url: "/api/player-urls" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        A: "http://10.0.0.1:5173/player?id=A",
        B: "http://10.0.0.1:5173/player?id=B",
      });
    } finally {
      await localApp.close();
    }
  });

  it("returns {A: null, B: null} when env is unset", async () => {
    vi.stubEnv("PLAYER_URL_A", "");
    vi.stubEnv("PLAYER_URL_B", "");
    const localApp = buildApp();
    try {
      const res = await localApp.inject({ method: "GET", url: "/api/player-urls" });
      expect(res.json()).toEqual({ A: null, B: null });
    } finally {
      await localApp.close();
    }
  });
});
```

> 注: `vi.stubEnv("X", "")` は空文字を返すので、実装では空文字を `null` 扱いにする。

- [ ] **Step 3: テスト失敗を確認**

Run: `pnpm --filter @app/server test app`
Expected: FAIL — `/api/player-urls` が未実装。

- [ ] **Step 4: `packages/server/src/http.ts` を更新**

```ts
import type { FastifyInstance } from "fastify";
import type { PlayerUrls } from "@app/shared";

function readPlayerUrl(envKey: string): string | null {
  const v = process.env[envKey];
  return v && v.trim().length > 0 ? v : null;
}

export function registerHttpRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/player-urls", async (): Promise<PlayerUrls> => ({
    A: readPlayerUrl("PLAYER_URL_A"),
    B: readPlayerUrl("PLAYER_URL_B"),
  }));
}
```

- [ ] **Step 5: テストがパスすることを確認**

Run: `pnpm --filter @app/server test`
Expected: 全 PASS (app / session-runtime / ws)。

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/server/src/http.ts packages/server/test/app.test.ts
git commit -m "feat(server): GET /api/player-urls endpoint (env-driven)"
```

---

## Task 2: Web の依存追加 + グローバルスタイル

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/src/styles.css`
- Modify: `packages/web/src/main.tsx`

- [ ] **Step 1: `qrcode.react` を追加**

`packages/web/package.json` の `dependencies` に追記:

```json
"qrcode.react": "4.1.0"
```

- [ ] **Step 2: 依存インストール**

Run: `pnpm install`
Expected: `qrcode.react` が node_modules に入る。

- [ ] **Step 3: `packages/web/src/styles.css` を作成**

```css
:root {
  color-scheme: dark;
  font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif;
}
html, body, #root { margin: 0; padding: 0; height: 100%; }
body { background: #111; color: #eee; }
main { min-height: 100vh; box-sizing: border-box; }
button { font-family: inherit; }
code { font-family: ui-monospace, SFMono-Regular, monospace; }

/* ---------------- 動く背景 (Start / Waiting 共通) ---------------- */
.bg-pan {
  position: absolute;
  inset: -20%;
  background: linear-gradient(135deg, #ff7a59, #7a5aff, #59c3ff, #59ffb6);
  background-size: 300% 300%;
  animation: bg-pan 20s ease-in-out infinite;
  filter: blur(60px);
  opacity: 0.85;
  z-index: 0;
}
@keyframes bg-pan {
  0%   { background-position: 0% 0%; }
  50%  { background-position: 100% 100%; }
  100% { background-position: 0% 0%; }
}

/* ---------------- Intro: Start ---------------- */
.intro-start, .player-waiting {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.intro-start .content, .player-waiting .content {
  position: relative;
  z-index: 1;
  text-align: center;
  color: white;
  text-shadow: 0 2px 20px rgba(0,0,0,0.6);
}
.intro-start h1, .player-waiting h1 {
  font-size: clamp(48px, 8vw, 96px);
  margin: 0 0 32px;
  letter-spacing: 0.05em;
}
.start-button {
  font-size: clamp(32px, 5vw, 56px);
  padding: 20px 64px;
  border-radius: 999px;
  background: white;
  color: black;
  cursor: pointer;
  border: none;
  box-shadow: 0 8px 40px rgba(0,0,0,0.4);
  transition: transform 120ms ease;
}
.start-button:hover, .start-button:focus-visible { transform: scale(1.05); outline: none; }

/* ---------------- Intro: Setup ---------------- */
.intro-setup {
  display: grid;
  place-items: center;
  padding: 40px;
  background: #141428;
}
.intro-setup form {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 520px;
  width: 100%;
}
.intro-setup h1 { margin: 0; font-size: 32px; }
.intro-setup label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 18px;
  color: #ccd;
}
.intro-setup input {
  font-size: 24px;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid #334;
  background: #1e1e32;
  color: white;
}
.intro-setup input:focus-visible { outline: 2px solid #7a5aff; }
.intro-setup button {
  font-size: 24px;
  padding: 14px 24px;
  border-radius: 8px;
  background: #7a5aff;
  color: white;
  border: none;
  cursor: pointer;
  margin-top: 8px;
}
.intro-setup button:disabled { opacity: 0.4; cursor: not-allowed; }

/* ---------------- Intro: Guide ---------------- */
.intro-guide {
  padding: 40px;
  text-align: center;
  background: #141428;
}
.intro-guide h1 { font-size: 36px; margin: 0 0 12px; }
.intro-guide .hint { color: #aab; margin-bottom: 32px; }
.intro-guide .url-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  max-width: 900px;
  margin: 0 auto;
}
.intro-guide .url-grid .card {
  background: #1e1e32;
  border-radius: 12px;
  padding: 24px;
}
.intro-guide .url-grid h2 { margin: 0 0 12px; font-size: 24px; }
.intro-guide .url-grid code {
  display: block;
  word-break: break-all;
  margin-top: 12px;
  font-size: 14px;
  color: #9ae;
}
.intro-guide .qr-wrap {
  background: white;
  padding: 16px;
  border-radius: 8px;
  display: inline-block;
}

/* ---------------- Intro: Finish ---------------- */
.intro-finish {
  display: grid;
  place-items: center;
  padding: 40px;
  background: #141428;
  text-align: center;
}
.intro-finish button {
  font-size: 20px;
  padding: 12px 24px;
  border-radius: 8px;
  background: #ff7a59;
  color: white;
  border: none;
  cursor: pointer;
  margin-top: 24px;
}

/* ---------------- Player: Loading ---------------- */
.player-loading {
  display: grid;
  place-items: center;
  text-align: center;
  padding: 40px;
  background: radial-gradient(ellipse at center, #201844, #0a0a14);
  color: white;
}
.player-loading h1 { font-size: clamp(48px, 10vw, 96px); margin: 0 0 16px; }
.player-loading .pulse {
  font-size: 28px;
  animation: pulse 1.2s ease-in-out infinite;
  color: #ccd;
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

/* ---------------- Player: stubs (Phase 3〜4 で差し替え) ---------------- */
.player-stub {
  display: grid;
  place-items: center;
  text-align: center;
  padding: 40px;
  color: #ccd;
}
.player-stub h1 { font-size: 40px; margin: 0 0 12px; }
.player-stub .tag { color: #8af; font-size: 14px; }

/* ---------------- 共通 ---------------- */
.loading-screen, .error-screen {
  display: grid;
  place-items: center;
  padding: 40px;
  font-size: 20px;
}
.error-screen { color: #ff6b6b; }
```

- [ ] **Step 4: `packages/web/src/main.tsx` に styles import を追加**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 5: 型チェック**

Run: `pnpm --filter @app/web typecheck`
Expected: エラーなし。

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json packages/web/src/styles.css packages/web/src/main.tsx pnpm-lock.yaml
git commit -m "chore(web): add qrcode.react + global styles"
```

---

## Task 3: Intro — StartView と SetupView を実装

**Files:**
- Create: `packages/web/src/views/intro/StartView.tsx`
- Create: `packages/web/src/views/intro/SetupView.tsx`

- [ ] **Step 1: `StartView.tsx` を作成**

```tsx
interface Props {
  onStart: () => void;
}

export function StartView({ onStart }: Props) {
  return (
    <main className="intro-start">
      <div className="bg-pan" />
      <div className="content">
        <h1>Pair Arcade</h1>
        <button className="start-button" onClick={onStart} autoFocus>
          START
        </button>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: `SetupView.tsx` を作成**

```tsx
import { useState, type FormEvent } from "react";
import type { SetupData } from "@app/shared";

interface Props {
  onSubmit: (data: SetupData) => void;
}

export function SetupView({ onSubmit }: Props) {
  const [nameA, setNameA] = useState("");
  const [nameB, setNameB] = useState("");
  const [relationship, setRelationship] = useState("");

  const valid =
    nameA.trim().length > 0 &&
    nameB.trim().length > 0 &&
    relationship.trim().length > 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onSubmit({
      players: {
        A: { id: "A", name: nameA.trim() },
        B: { id: "B", name: nameB.trim() },
      },
      relationship: relationship.trim(),
    });
  }

  return (
    <main className="intro-setup">
      <form onSubmit={handleSubmit}>
        <h1>2人の名前と関係性を入力</h1>
        <label>
          Player A の名前
          <input
            value={nameA}
            onChange={(e) => setNameA(e.target.value)}
            placeholder="例: あきら"
            maxLength={24}
            autoFocus
          />
        </label>
        <label>
          Player B の名前
          <input
            value={nameB}
            onChange={(e) => setNameB(e.target.value)}
            placeholder="例: さくら"
            maxLength={24}
          />
        </label>
        <label>
          2人の関係性
          <input
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            placeholder="例: 友人 / 恋人 / 親子 / 同僚 ..."
            maxLength={32}
          />
        </label>
        <button type="submit" disabled={!valid}>
          次へ
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Commit (ここではまだ Intro.tsx と繋がっていないので表示変化はないが、単体ファイルはコンパイル可能)**

Run: `pnpm --filter @app/web typecheck`
Expected: エラーなし。

```bash
git add packages/web/src/views/intro/StartView.tsx packages/web/src/views/intro/SetupView.tsx
git commit -m "feat(web): Intro StartView and SetupView"
```

---

## Task 4: Intro — GuideView (URL + QR) と FinishView

**Files:**
- Create: `packages/web/src/net/api.ts`
- Create: `packages/web/src/views/intro/GuideView.tsx`
- Create: `packages/web/src/views/intro/FinishView.tsx`

- [ ] **Step 1: `packages/web/src/net/api.ts` を作成**

```ts
import type { PlayerUrls } from "@app/shared";

export async function fetchPlayerUrls(): Promise<PlayerUrls> {
  const res = await fetch("/api/player-urls");
  if (!res.ok) throw new Error(`fetchPlayerUrls failed: ${res.status}`);
  return (await res.json()) as PlayerUrls;
}
```

- [ ] **Step 2: `GuideView.tsx` を作成**

```tsx
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PlayerUrls } from "@app/shared";
import { fetchPlayerUrls } from "../../net/api.js";

interface Props {
  currentRound: number | null;
}

function fallbackUrls(): PlayerUrls {
  if (typeof window === "undefined") return { A: null, B: null };
  const origin = window.location.origin;
  return {
    A: `${origin}/player?id=A`,
    B: `${origin}/player?id=B`,
  };
}

export function GuideView({ currentRound }: Props) {
  const [urls, setUrls] = useState<PlayerUrls | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fb = fallbackUrls();
      try {
        const server = await fetchPlayerUrls();
        if (cancelled) return;
        setUrls({
          A: server.A ?? fb.A,
          B: server.B ?? fb.B,
        });
      } catch {
        if (!cancelled) setUrls(fb);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="intro-guide">
      <h1>プレイヤー画面の前に移動してください</h1>
      <p className="hint">
        Round {currentRound ?? 1} の準備中…
      </p>
      <div className="url-grid">
        <div className="card">
          <h2>Player A</h2>
          <div className="qr-wrap">
            {urls?.A ? (
              <QRCodeSVG value={urls.A} size={192} />
            ) : (
              <p>(URL未取得)</p>
            )}
          </div>
          <code>{urls?.A ?? "—"}</code>
        </div>
        <div className="card">
          <h2>Player B</h2>
          <div className="qr-wrap">
            {urls?.B ? (
              <QRCodeSVG value={urls.B} size={192} />
            ) : (
              <p>(URL未取得)</p>
            )}
          </div>
          <code>{urls?.B ?? "—"}</code>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: `FinishView.tsx` を作成 (Phase 2 最低限)**

```tsx
interface Props {
  onReset: () => void;
}

export function FinishView({ onReset }: Props) {
  return (
    <main className="intro-finish">
      <h1>Session finished</h1>
      <p>最終診断はプレイヤー画面に表示されています。</p>
      <button onClick={onReset}>もう一度遊ぶ (RESET)</button>
    </main>
  );
}
```

- [ ] **Step 4: 型チェック**

Run: `pnpm --filter @app/web typecheck`
Expected: エラーなし。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/net/api.ts packages/web/src/views/intro/GuideView.tsx packages/web/src/views/intro/FinishView.tsx
git commit -m "feat(web): Intro GuideView with QR, FinishView stub"
```

---

## Task 5: `Intro.tsx` を views を呼び分ける薄い実装にリファクタ

**Files:**
- Modify: `packages/web/src/routes/Intro.tsx`

- [ ] **Step 1: `Intro.tsx` を書き換え**

```tsx
import { useEffect, useRef, useState } from "react";
import type { ClientEvent, SessionSnapshot } from "@app/shared";
import { connectIntroSocket, type AppSocket } from "../net/socket.js";
import { StartView } from "../views/intro/StartView.js";
import { SetupView } from "../views/intro/SetupView.js";
import { GuideView } from "../views/intro/GuideView.js";
import { FinishView } from "../views/intro/FinishView.js";

export function Intro() {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const socketRef = useRef<AppSocket | null>(null);

  useEffect(() => {
    const s = connectIntroSocket();
    socketRef.current = s;
    s.on("session:state", setSnap);
    return () => {
      s.close();
      socketRef.current = null;
    };
  }, []);

  function trigger(ev: ClientEvent) {
    socketRef.current?.emit("client:event", ev);
  }

  if (!snap) return <main className="loading-screen">connecting...</main>;

  switch (snap.state) {
    case "waiting":
      return <StartView onStart={() => trigger({ type: "START" })} />;
    case "setup":
      return <SetupView onSubmit={(data) => trigger({ type: "SETUP_DONE", data })} />;
    case "roundLoading":
    case "roundPlaying":
    case "roundResult":
      return <GuideView currentRound={snap.currentRound} />;
    case "totalResult":
      return <FinishView onReset={() => trigger({ type: "RESET" })} />;
  }
}
```

- [ ] **Step 2: 型チェック + Vite起動確認**

Run: `pnpm --filter @app/web typecheck`
Expected: エラーなし。

Run: `pnpm --filter @app/web dev` を立ち上げ、ブラウザで `/` を開いて Start 画面 (背景が動く + START ボタン) が出ることを目視確認。Ctrl+C で止める。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/routes/Intro.tsx
git commit -m "refactor(web): Intro delegates rendering to views/*"
```

---

## Task 6: Player ビュー分割 + Waiting/Loading 実装 + 残り stub

**Files:**
- Create: `packages/web/src/views/player/WaitingView.tsx`
- Create: `packages/web/src/views/player/LoadingView.tsx`
- Create: `packages/web/src/views/player/GameView.tsx`
- Create: `packages/web/src/views/player/RoundResultView.tsx`
- Create: `packages/web/src/views/player/TotalResultView.tsx`
- Modify: `packages/web/src/routes/Player.tsx`

- [ ] **Step 1: `WaitingView.tsx`**

```tsx
import type { PlayerId } from "@app/shared";

interface Props {
  playerId: PlayerId;
}

export function WaitingView({ playerId }: Props) {
  return (
    <main className="player-waiting">
      <div className="bg-pan" />
      <div className="content">
        <h1>Player {playerId}</h1>
        <p style={{ fontSize: 24 }}>まもなく始まります</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: `LoadingView.tsx`**

```tsx
interface Props {
  round: number | null;
}

export function LoadingView({ round }: Props) {
  return (
    <main className="player-loading">
      <h1>Round {round ?? 1}</h1>
      <p className="pulse">準備中…</p>
    </main>
  );
}
```

- [ ] **Step 3: `GameView.tsx` (stub)**

```tsx
interface Props {
  round: number | null;
}

export function GameView({ round }: Props) {
  return (
    <main className="player-stub">
      <h1>Game — Round {round ?? "?"}</h1>
      <p className="tag">(Phase 4 で実装)</p>
    </main>
  );
}
```

- [ ] **Step 4: `RoundResultView.tsx` (stub)**

```tsx
interface Props {
  round: number | null;
  score: number | null;
}

export function RoundResultView({ round, score }: Props) {
  return (
    <main className="player-stub">
      <h1>Round {round ?? "?"} 結果</h1>
      <p>score: {score ?? "-"}</p>
      <p className="tag">(Phase 3 で実装)</p>
    </main>
  );
}
```

- [ ] **Step 5: `TotalResultView.tsx` (stub)**

```tsx
interface Props {
  verdict: string | null;
}

export function TotalResultView({ verdict }: Props) {
  return (
    <main className="player-stub">
      <h1>最終診断</h1>
      <p>{verdict ?? "(準備中)"}</p>
      <p className="tag">(Phase 3 で実装)</p>
    </main>
  );
}
```

- [ ] **Step 6: `Player.tsx` を書き換え**

```tsx
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { PlayerId, SessionSnapshot } from "@app/shared";
import { connectPlayerSocket } from "../net/socket.js";
import { WaitingView } from "../views/player/WaitingView.js";
import { LoadingView } from "../views/player/LoadingView.js";
import { GameView } from "../views/player/GameView.js";
import { RoundResultView } from "../views/player/RoundResultView.js";
import { TotalResultView } from "../views/player/TotalResultView.js";

export function Player() {
  const [params] = useSearchParams();
  const rawId = params.get("id");
  const playerId: PlayerId | null = rawId === "A" || rawId === "B" ? rawId : null;

  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!playerId) {
      setErr("?id=A または ?id=B のクエリが必要です");
      return;
    }
    const s = connectPlayerSocket(playerId);
    s.on("session:state", setSnap);
    s.on("connect_error", (e) => setErr(String(e)));
    return () => {
      s.close();
    };
  }, [playerId]);

  if (err) return <main className="error-screen">{err}</main>;
  if (!snap || !playerId) return <main className="loading-screen">connecting...</main>;

  switch (snap.state) {
    case "waiting":
    case "setup":
      return <WaitingView playerId={playerId} />;
    case "roundLoading":
      return <LoadingView round={snap.currentRound} />;
    case "roundPlaying":
      return <GameView round={snap.currentRound} />;
    case "roundResult": {
      const r = snap.currentRound;
      const score = r ? snap.scores[r] : null;
      return <RoundResultView round={r} score={score} />;
    }
    case "totalResult":
      return <TotalResultView verdict={snap.finalVerdict} />;
  }
}
```

- [ ] **Step 7: 型チェック**

Run: `pnpm --filter @app/web typecheck`
Expected: エラーなし。

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/views/player packages/web/src/routes/Player.tsx
git commit -m "feat(web): split Player into views + Waiting/Loading visuals"
```

---

## Task 7: E2E 手動スモーク (本Phase の受け入れ)

- [ ] **Step 1: 全テスト + 型チェック**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: 全 PASS。

- [ ] **Step 2: (任意) `.env` で `PLAYER_URL_A/B` を指定**

`packages/server/.env` を作成 (動作確認用、コミットしない):

```
PLAYER_URL_A=http://localhost:5173/player?id=A
PLAYER_URL_B=http://localhost:5173/player?id=B
```

> 現状 `buildApp` は dotenv を読み込まない。env を使いたい場合は一時的に `PLAYER_URL_A=... PLAYER_URL_B=... pnpm --filter @app/server dev` として起動する。dotenv統合は Phase 5 で入れる予定。

- [ ] **Step 3: サーバと Web を並行起動**

ターミナル1:
```bash
PLAYER_URL_A=http://localhost:5173/player?id=A PLAYER_URL_B=http://localhost:5173/player?id=B pnpm --filter @app/server dev
```

ターミナル2:
```bash
pnpm --filter @app/web dev
```

- [ ] **Step 4: 3つのブラウザを開きっぱなしにする**

- ウィンドウ1 (intro): `http://localhost:5173/`
- ウィンドウ2 (player A): `http://localhost:5173/player?id=A`
- ウィンドウ3 (player B): `http://localhost:5173/player?id=B`

Expected:
- ウィンドウ1: **動く背景 + START ボタン** の Start画面
- ウィンドウ2/3: Player A/B の Waiting 画面 (動く背景 + "まもなく始まります")

- [ ] **Step 5: Start → Setup (intro 手動操作)**

ウィンドウ1 の START をクリック。
Expected:
- ウィンドウ1: Setup フォーム画面に切り替わる (名前2つ + 関係性)
- ウィンドウ2/3: **変化なし** (まだ Waiting のまま。state は `setup` になるが Player の投影では `waiting|setup → WaitingView` なので表示は同じ)

- [ ] **Step 6: Setup フォーム送信 → Guide + player 自動 Loading**

ウィンドウ1 で:
- Player A の名前に "あきら"
- Player B の名前に "さくら"
- 関係性に "友人"
- 「次へ」をクリック

Expected (同時に起こる):
- ウィンドウ1: **Guide 画面** (Player A/B の URL と QR コード)
- ウィンドウ2: **Loading 画面** ("Round 1" + "準備中…" の pulse)
- ウィンドウ3: 同上

これで本Phaseの核心要件 "Setup→Guide の intro 遷移と同時に、player が自動で Loading に遷移する" が視認できる。

- [ ] **Step 7: フォーム検証の確認**

`RESET` がまだ押せないので、ブラウザを一度リロードして初期状態 (`waiting`) に戻し、もう一度 Setup に入る。
- 3つのフィールドのどれか1つを空にして「次へ」が disabled のままであることを確認
- 全部埋めると enabled になることを確認

> 注: リロードすると intro は再接続するが、サーバの state は既に `roundLoading` になっている。そのまま開き直すと Guide が表示される。完全リセットは Phase 3 で orchestrator から `SESSION_DONE` → Finish → RESET を流して確認する。Phase 2 ではここまでで十分。

- [ ] **Step 8: Commit (最終)**

(Phase 2 のコード追加分は Task 1〜6 で既にコミット済み。ここでは docs 更新があればコミットする。なければ skip)

---

## Self-Review (本計画の最終確認)

Phase 2 完了時点で達成されていること:

- `/api/player-urls` が env から URL を返し、未設定時は null を返す契約テストがある (Task 1)
- Intro が **Start / Setup / Guide / Finish** の4ビューに分かれ、state 投影で切り替わる (Task 3〜5)
- Setup フォームは 2名 + 関係性 のバリデーション付きで、送信すると `SETUP_DONE` を実データで発火する (Task 3)
- Guide ビューは Player A/B の URL + QR を表示する。env で URL 指定可能、未指定時は `window.location.origin` からフォールバック (Task 4)
- Player がビュー分割され、Waiting / Loading の最低限の視覚が整う (Task 6)
- ユーザ要件 "Setup送信 (intro操作) で、intro は Guide に、player は自動で Round Loading に遷移する" が手動スモークで視認できる (Task 7 Step 6)

Phase 3 で着手する範囲 (完了後に詳細計画 `03-player-shell-orchestrator.md` を書く):
- Server orchestrator: タイマーやAIモック応答をトリガに `ROUND_READY` / `ROUND_COMPLETE` / `NEXT_ROUND` / `SESSION_DONE` を自動発火
- Player RoundResultView / TotalResultView の実ビジュアル (得点アニメ、煽りコメント、最終診断)
- Intro GuideView の round内進捗表示 (roundLoading / roundPlaying / roundResult で hint を出し分け)
