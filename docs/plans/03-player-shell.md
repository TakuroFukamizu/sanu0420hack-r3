# Phase 3 — Player Shell + Orchestrator 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2 完了状態 (intro の `SETUP_DONE` で player が自動で Loading へ遷移) の続きとして、**サーバ内 Orchestrator** を導入し、タイマー駆動で `ROUND_READY` → `ROUND_COMPLETE` → `NEXT_ROUND` (or `SESSION_DONE`) を自動発火する。これにより START→SETUP_DONE クリックだけで 3ラウンド+最終診断までひと通り進む。同時に Player 側の `RoundResultView` / `TotalResultView` と Intro `GuideView` のサブステート別 hint を実装し、プレイヤー画面 (LG 1920×540) の viewport を補正する。ゲーム本体 (Phase 4) と AI (Phase 5) はまだモックのまま。

**Architecture:** サーバ singleton `SessionRuntime` に `Orchestrator` を attach。Orchestrator は `SessionRuntime.subscribe` で state 変化を監視し、`state = roundLoading|roundPlaying|roundResult` に入ったら対応する固定時間 (env で調整可) の後に state machine に次のイベントを送る。mock スコア/定性評価/最終診断は `orchestrator/mock.ts` に分離し、Phase 5 で `ai/gemini.ts` に差し替え可能にする。タイマーは `Scheduler` インターフェースで抽象化してテストでは `FakeScheduler` に注入する。

**Tech Stack:** Phase 2 と同じ。新規 dep なし。

**受け入れ条件 (Phase完了の定義):**
- `pnpm -r test` グリーン (shared/server 既存 + 新 orchestrator テスト)。
- `pnpm -r typecheck` + `pnpm --filter @app/web build` グリーン (chrome84 target 維持)。
- 3 ブラウザ常時接続状態で:
  1. intro の START → Setup → SETUP_DONE 送信後、**以降はクリック操作なし** で
  2. player が roundLoading → roundPlaying → roundResult → roundLoading (Round 2) → ... → Round 3 roundResult → totalResult まで自動で進む
  3. 各 roundResult で player は **Round 番号 + 得点 + 定性評価文** を表示
  4. totalResult で player は **3 ラウンドの得点 + 最終診断文** を表示
  5. intro は state 変化に応じて GuideView の hint が切り替わる (roundLoading: "ゲーム選出中…" / roundPlaying: "Round N プレイ中…" / roundResult: "Round N 結果表示中…")
  6. Player 画面のみ viewport が `width=1920` に切り替わる (intro は `width=device-width` のまま)
  7. totalResult 後、intro で RESET を押すと waiting に戻り、再度 START でもう一周できる
- Orchestrator タイマは env (`ORCHESTRATOR_ROUND_LOADING_MS` / `_ROUND_PLAYING_MS` / `_ROUND_RESULT_MS`) で上書き可能。未設定時の default はそれぞれ 3000 / 5000 / 8000。

Phase 4 以降で実装する (本Phaseでは出さない):
- 実ゲームUI (sync-answer / partner-quiz / timing-sync) と `player:input` 集約
- Gemini によるゲーム選択・ラウンド評価・最終診断
- MIDI BGM

---

## File Structure (Phase 3 で作成 / 変更)

```
packages/
├── shared/
│   └── src/
│       └── round-durations.ts            # 新規 (env名とdefault値定義)
├── server/
│   ├── src/
│   │   ├── app.ts                         # Orchestrator を onReady で start / onClose で stop
│   │   ├── index.ts                       # (変更なし)
│   │   └── orchestrator/                  # 新規
│   │       ├── index.ts                   # Orchestrator クラス
│   │       ├── scheduler.ts               # Scheduler interface + realScheduler + FakeScheduler
│   │       └── mock.ts                    # mockScore / mockQualitative / mockVerdict
│   ├── test/
│   │   └── orchestrator.test.ts           # 新規 (FakeScheduler を使う)
│   └── .env.example                       # ORCHESTRATOR_* 追加
└── web/
    ├── src/
    │   ├── hooks/
    │   │   └── useViewport.ts             # 新規
    │   ├── views/
    │   │   ├── intro/
    │   │   │   └── GuideView.tsx          # hint を state サブ別に
    │   │   └── player/
    │   │       ├── RoundResultView.tsx    # 本実装
    │   │       └── TotalResultView.tsx    # 本実装
    │   ├── routes/
    │   │   └── Player.tsx                 # useViewport("width=1920") を差し込み
    │   └── styles.css                     # .player-round-result / .player-total-result を追加
```

---

## Task 1: shared — タイマ定数の集約

**Files:**
- Create: `packages/shared/src/round-durations.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

動機: server (Orchestrator) と web (プログレスバー等、将来使う場合) が同じ defaults を参照できるようにする。env 駆動の実値は server でしか読まない (web はクライアント側で env を持たないので、現状 web 側の利用はない)。

- [ ] **Step 1: `packages/shared/src/round-durations.ts` を作成**

```ts
/**
 * Orchestrator が各 state に滞在する時間 (ms) の default。
 * 本値はサーバ側 `orchestrator/index.ts` が env (`ORCHESTRATOR_ROUND_LOADING_MS` 等)
 * で上書きして使う。web からも参照可能にしておくが、現状 web は読まない。
 */
export const DEFAULT_ROUND_LOADING_MS = 3000;
export const DEFAULT_ROUND_PLAYING_MS = 5000;
export const DEFAULT_ROUND_RESULT_MS = 8000;

export const ROUND_LOADING_ENV = "ORCHESTRATOR_ROUND_LOADING_MS";
export const ROUND_PLAYING_ENV = "ORCHESTRATOR_ROUND_PLAYING_MS";
export const ROUND_RESULT_ENV = "ORCHESTRATOR_ROUND_RESULT_MS";
```

- [ ] **Step 2: `packages/shared/src/index.ts` に re-export を追加**

```ts
export * from "./types.js";
export * from "./machine.js";
export * from "./round-durations.js";
```

- [ ] **Step 3: 型チェック**

Run: `pnpm --filter @app/shared typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/round-durations.ts packages/shared/src/index.ts
git commit -m "feat(shared): orchestrator round duration constants"
```

---

## Task 2: server — Orchestrator (Scheduler + mock + core) と TDD テスト

**Files:**
- Create: `packages/server/src/orchestrator/scheduler.ts`
- Create: `packages/server/src/orchestrator/mock.ts`
- Create: `packages/server/src/orchestrator/index.ts`
- Create: `packages/server/test/orchestrator.test.ts`
- Modify: `packages/server/src/app.ts` (orchestrator wire up)
- Modify: `packages/server/.env.example` (ORCHESTRATOR_* 追加)

### Step 1: `packages/server/src/orchestrator/scheduler.ts`

```ts
export interface Scheduler {
  /** fn を ms 後に実行する。返り値は cancel 関数。*/
  schedule(ms: number, fn: () => void): () => void;
}

export const realScheduler: Scheduler = {
  schedule(ms, fn) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

/** テスト用: 予約を手で回す。ms は無視して FIFO で実行する。*/
export class FakeScheduler implements Scheduler {
  private tasks: Array<{ fn: () => void; cancelled: boolean }> = [];

  schedule(_ms: number, fn: () => void): () => void {
    const task = { fn, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  }

  /** 予約された (キャンセルされていない) 全タスクを実行する。
   * 実行中に新たに schedule されたタスクは含まれない (次回 runAll で実行)。*/
  runAll(): number {
    const pending = this.tasks.filter((t) => !t.cancelled);
    this.tasks = [];
    pending.forEach((t) => t.fn());
    return pending.length;
  }

  get pendingCount(): number {
    return this.tasks.filter((t) => !t.cancelled).length;
  }
}
```

### Step 2: `packages/server/src/orchestrator/mock.ts`

```ts
import type { RoundNumber } from "@app/shared";

/**
 * Phase 3 用の mock スコア/評価/最終診断。Phase 5 で Gemini 呼び出しに差し替わる。
 * 決定的にしたい場合は `Math.random` を seed 付き RNG に差し替える。本実装はハッカソン
 * 用のため非決定で OK。
 */
export function mockScore(): number {
  return 50 + Math.floor(Math.random() * 51); // 50〜100
}

const qualitativePool = [
  "2人の息はぴったりでした！",
  "片方が頑張りすぎていた印象です…",
  "お互いの理解度が試される瞬間でした。",
  "想像以上に噛み合っていました。",
  "もう少し相手を知る必要がありそうです。",
];

export function mockQualitative(): string {
  return qualitativePool[Math.floor(Math.random() * qualitativePool.length)]!;
}

export function mockVerdict(scores: Record<RoundNumber, number | null>): string {
  const total = (scores[1] ?? 0) + (scores[2] ?? 0) + (scores[3] ?? 0);
  if (total >= 250) return "運命の相手！";
  if (total >= 200) return "とても相性が良いです";
  if (total >= 150) return "悪くない関係ですね";
  return "まだまだこれから！";
}
```

### Step 3: 失敗するテストを書く

`packages/server/test/orchestrator.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionRuntime } from "../src/session-runtime.js";
import { Orchestrator } from "../src/orchestrator/index.js";
import { FakeScheduler } from "../src/orchestrator/scheduler.js";
import type { SetupData } from "@app/shared";

function setupData(): SetupData {
  return {
    players: {
      A: { id: "A", name: "Alice" },
      B: { id: "B", name: "Bob" },
    },
    relationship: "友人",
  };
}

describe("Orchestrator", () => {
  let rt: SessionRuntime;
  let sched: FakeScheduler;
  let orch: Orchestrator;

  beforeEach(() => {
    rt = new SessionRuntime();
    sched = new FakeScheduler();
    orch = new Orchestrator(rt, sched);
    orch.start();
  });

  afterEach(() => {
    orch.stop();
    rt.stop();
  });

  it("does nothing while waiting / setup / totalResult", () => {
    expect(sched.pendingCount).toBe(0);
    rt.send({ type: "START" }); // -> setup
    expect(sched.pendingCount).toBe(0);
  });

  it("schedules ROUND_READY when entering roundLoading", () => {
    rt.send({ type: "START" });
    rt.send({ type: "SETUP_DONE", data: setupData() });
    expect(rt.get().state).toBe("roundLoading");
    expect(sched.pendingCount).toBe(1);

    sched.runAll();
    expect(rt.get().state).toBe("roundPlaying");
  });

  it("runs a full 3-round cycle to totalResult", () => {
    rt.send({ type: "START" });
    rt.send({ type: "SETUP_DONE", data: setupData() });
    // roundLoading (auto) -> roundPlaying -> roundResult -> roundLoading (round 2) -> ...
    // 5 schedule calls total to reach round 3 roundResult:
    //   1: roundLoading -> roundPlaying
    //   2: roundPlaying -> roundResult (r1, score set, qual set)
    //   3: roundResult -> roundLoading (r2)
    //   4: roundLoading -> roundPlaying
    //   5: roundPlaying -> roundResult (r2)
    //   6: roundResult -> roundLoading (r3)
    //   7: roundLoading -> roundPlaying
    //   8: roundPlaying -> roundResult (r3)
    //   9: roundResult -> totalResult (SESSION_DONE, verdict)
    for (let i = 0; i < 9; i++) {
      expect(sched.pendingCount).toBe(1);
      sched.runAll();
    }

    const snap = rt.get();
    expect(snap.state).toBe("totalResult");
    expect(snap.scores[1]).not.toBeNull();
    expect(snap.scores[2]).not.toBeNull();
    expect(snap.scores[3]).not.toBeNull();
    expect(snap.qualitativeEvals[1]).toBeTypeOf("string");
    expect(snap.qualitativeEvals[2]).toBeTypeOf("string");
    expect(snap.qualitativeEvals[3]).toBeTypeOf("string");
    expect(snap.finalVerdict).toBeTypeOf("string");
    expect(sched.pendingCount).toBe(0); // totalResult では待機しない
  });

  it("does not schedule additional timers in totalResult", () => {
    rt.send({ type: "START" });
    rt.send({ type: "SETUP_DONE", data: setupData() });
    for (let i = 0; i < 9; i++) sched.runAll();
    expect(rt.get().state).toBe("totalResult");
    rt.send({ type: "RESET" });
    expect(rt.get().state).toBe("waiting");
    expect(sched.pendingCount).toBe(0);
  });

  it("stop() cancels pending timers", () => {
    rt.send({ type: "START" });
    rt.send({ type: "SETUP_DONE", data: setupData() });
    expect(sched.pendingCount).toBe(1);
    orch.stop();
    expect(sched.pendingCount).toBe(0);

    // stop 後は state 変化に反応しないことを確認
    rt.send({ type: "ROUND_READY" }); // 手動で進めてみる
    expect(sched.pendingCount).toBe(0);
  });
});
```

Run: `pnpm --filter @app/server test orchestrator`
Expected: FAIL (Orchestrator が未実装)。

### Step 4: `packages/server/src/orchestrator/index.ts` を実装

```ts
import type {
  RoundNumber,
  SessionSnapshot,
  SessionStateName,
} from "@app/shared";
import {
  DEFAULT_ROUND_LOADING_MS,
  DEFAULT_ROUND_PLAYING_MS,
  DEFAULT_ROUND_RESULT_MS,
  ROUND_LOADING_ENV,
  ROUND_PLAYING_ENV,
  ROUND_RESULT_ENV,
} from "@app/shared";
import type { SessionRuntime } from "../session-runtime.js";
import { realScheduler, type Scheduler } from "./scheduler.js";
import { mockQualitative, mockScore, mockVerdict } from "./mock.js";

export interface OrchestratorDurations {
  roundLoadingMs: number;
  roundPlayingMs: number;
  roundResultMs: number;
}

function readDuration(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function durationsFromEnv(): OrchestratorDurations {
  return {
    roundLoadingMs: readDuration(ROUND_LOADING_ENV, DEFAULT_ROUND_LOADING_MS),
    roundPlayingMs: readDuration(ROUND_PLAYING_ENV, DEFAULT_ROUND_PLAYING_MS),
    roundResultMs: readDuration(ROUND_RESULT_ENV, DEFAULT_ROUND_RESULT_MS),
  };
}

export class Orchestrator {
  private unsubscribe: (() => void) | null = null;
  private cancelPending: (() => void) | null = null;
  private lastState: SessionStateName | null = null;

  constructor(
    private runtime: SessionRuntime,
    private scheduler: Scheduler = realScheduler,
    private durations: OrchestratorDurations = durationsFromEnv(),
  ) {}

  start(): void {
    if (this.unsubscribe) return; // idempotent
    this.unsubscribe = this.runtime.subscribe((snap) => this.onState(snap));
  }

  stop(): void {
    this.cancelPending?.();
    this.cancelPending = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.lastState = null;
  }

  private onState(snap: SessionSnapshot): void {
    // state 名が前回と同じなら context の変化だけなので無視する
    if (snap.state === this.lastState) return;
    this.lastState = snap.state;

    // state 切り替わったら前の予約を破棄 (NEXT_ROUND 連発などの二重スケジュール防止)
    this.cancelPending?.();
    this.cancelPending = null;

    switch (snap.state) {
      case "roundLoading":
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundLoadingMs,
          () => {
            this.runtime.send({ type: "ROUND_READY" });
          },
        );
        return;
      case "roundPlaying":
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundPlayingMs,
          () => {
            this.runtime.send({
              type: "ROUND_COMPLETE",
              score: mockScore(),
              qualitative: mockQualitative(),
            });
          },
        );
        return;
      case "roundResult": {
        const round: RoundNumber | null = snap.currentRound;
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundResultMs,
          () => {
            if (round === 3) {
              const verdict = mockVerdict(this.runtime.get().scores);
              this.runtime.send({ type: "SESSION_DONE", verdict });
            } else {
              this.runtime.send({ type: "NEXT_ROUND" });
            }
          },
        );
        return;
      }
      case "waiting":
      case "setup":
      case "totalResult":
        // ユーザ操作待ち。timer は張らない。
        return;
    }
  }
}
```

### Step 5: `packages/server/src/app.ts` を更新 — Orchestrator を起動/停止

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { SessionRuntime } from "./session-runtime.js";
import { registerHttpRoutes } from "./http.js";
import { Orchestrator } from "./orchestrator/index.js";

export interface BuildAppOptions {
  runtime?: SessionRuntime;
  /** テスト等で Orchestrator を差し替え / 無効化する時に使う */
  orchestrator?: Orchestrator | null;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const runtime = opts.runtime ?? new SessionRuntime();
  const orchestrator =
    opts.orchestrator === null
      ? null
      : (opts.orchestrator ?? new Orchestrator(runtime));

  registerHttpRoutes(app);
  app.decorate("sessionRuntime", runtime);

  orchestrator?.start();

  app.addHook("onClose", async () => {
    orchestrator?.stop();
    runtime.stop();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    sessionRuntime: SessionRuntime;
  }
}
```

> `opts.orchestrator === null` で明示的に無効化できるようにしておく (既存 app.test.ts / session-runtime.test.ts / ws.test.ts は `Orchestrator` を使わず buildApp してもよいが、default で Orchestrator が起動しても既存テストに影響しないことを確認する。realScheduler で `setTimeout` するが、各テストの `afterEach` で `app.close()` が呼ばれるので pending timer はクリアされる)。

### Step 6: `packages/server/.env.example` に追記

ファイル末尾に:

```
# [Phase 3] Orchestrator の各 state 滞在時間 (ms)。
# 未指定なら shared/src/round-durations.ts の default (3000/5000/8000) が使われる。
ORCHESTRATOR_ROUND_LOADING_MS=3000
ORCHESTRATOR_ROUND_PLAYING_MS=5000
ORCHESTRATOR_ROUND_RESULT_MS=8000
```

### Step 7: テストがパスすることを確認 + 既存テストに影響がないこと

Run: `pnpm --filter @app/server test`
Expected: **18 tests pass** (既存 13 + orchestrator 5)。

Run: `pnpm --filter @app/server typecheck`
Expected: clean.

### Step 8: Commit

2 コミットに分けると差分が読みやすい:

```bash
# 内部実装とテスト
git add packages/server/src/orchestrator packages/server/test/orchestrator.test.ts
git commit -m "feat(server): Orchestrator class with Scheduler abstraction + mock drivers"

# Fastify に差し込み + env
git add packages/server/src/app.ts packages/server/.env.example
git commit -m "feat(server): wire Orchestrator into buildApp lifecycle"
```

---

## Task 3: web — `useViewport` フック + Player route で `width=1920` に

**Files:**
- Create: `packages/web/src/hooks/useViewport.ts`
- Modify: `packages/web/src/routes/Player.tsx`

### Step 1: `packages/web/src/hooks/useViewport.ts` を作成

```tsx
import { useEffect } from "react";

/**
 * `<meta name="viewport">` を mount 中に上書きし、unmount 時に元に戻す。
 * Player route だけ 1920×540 LG ディスプレイ向けに `width=1920` を指定する用途。
 * intro route はこのフックを使わないので index.html の `width=device-width` が
 * 維持される。
 */
export function useViewport(content: string): void {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute("content");
    meta.setAttribute("content", content);
    return () => {
      if (original !== null) meta.setAttribute("content", original);
    };
  }, [content]);
}
```

### Step 2: `packages/web/src/routes/Player.tsx` にフックを差し込む

先頭 import 群に追加:

```tsx
import { useViewport } from "../hooks/useViewport.js";
```

`export function Player()` の最初の行に (他の hooks の前):

```tsx
export function Player() {
  useViewport("width=1920");
  // ...既存の useSearchParams 以下
}
```

### Step 3: 型チェック + build

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web build`
Expected: clean / built.

### Step 4: Commit

```bash
git add packages/web/src/hooks/useViewport.ts packages/web/src/routes/Player.tsx
git commit -m "feat(web): Player route overrides viewport to width=1920 for LG display"
```

---

## Task 4: web — `RoundResultView` 本実装

**Files:**
- Modify: `packages/web/src/views/player/RoundResultView.tsx`
- Modify: `packages/web/src/styles.css`

### Step 1: `RoundResultView.tsx` を差し替え

```tsx
import { useEffect, useState } from "react";

interface Props {
  round: number | null;
  score: number | null;
  qualitative: string | null;
}

export function RoundResultView({ round, score, qualitative }: Props) {
  // score を 0 から target までアニメーション表示する (800ms)
  const target = score ?? 0;
  const [displayed, setDisplayed] = useState(0);
  useEffect(() => {
    setDisplayed(0);
    if (target === 0) return;
    const start = performance.now();
    const duration = 800;
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      setDisplayed(Math.round(target * t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return (
    <main className="player-round-result">
      <h1>Round {round ?? "?"} 結果</h1>
      <div className="score" aria-live="polite">
        <span className="score-value">{displayed}</span>
        <span className="score-unit">pt</span>
      </div>
      {qualitative && <p className="qualitative">{qualitative}</p>}
    </main>
  );
}
```

> Props に `qualitative` が増えるので、呼び出し元 `Player.tsx` も合わせて渡す必要がある (Step 3)。

### Step 2: `packages/web/src/styles.css` に追加

ファイル末尾 (Player の stub スタイル群の後) に:

```css
/* ---------------- Player: Round Result (Phase 3 実装) ---------------- */
.player-round-result {
  display: grid;
  place-items: center;
  text-align: center;
  padding: 40px;
  background: linear-gradient(180deg, #1b1044, #120a28);
  color: white;
  gap: 24px;
}
.player-round-result h1 {
  font-size: clamp(40px, 6vw, 72px);
  margin: 0;
  letter-spacing: 0.02em;
}
.player-round-result .score {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-variant-numeric: tabular-nums;
}
.player-round-result .score-value {
  font-size: clamp(80px, 16vw, 200px);
  font-weight: 800;
  color: #ffde6b;
  text-shadow: 0 4px 40px rgba(255, 222, 107, 0.4);
}
.player-round-result .score-unit {
  font-size: 36px;
  color: #aab;
}
.player-round-result .qualitative {
  font-size: clamp(20px, 3vw, 32px);
  color: #ccd;
  max-width: 900px;
  margin: 0 32px;
  line-height: 1.5;
}
```

### Step 3: `Player.tsx` の呼び出し側を調整

```tsx
case "roundResult": {
  const r = snap.currentRound;
  const score = r !== null ? snap.scores[r] : null;
  const qualitative = r !== null ? snap.qualitativeEvals[r] : null;
  return <RoundResultView round={r} score={score} qualitative={qualitative} />;
}
```

### Step 4: 型チェック + build

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web build`
Expected: clean / built.

### Step 5: Commit

```bash
git add packages/web/src/views/player/RoundResultView.tsx packages/web/src/styles.css packages/web/src/routes/Player.tsx
git commit -m "feat(web): RoundResultView animated score + qualitative"
```

---

## Task 5: web — `TotalResultView` 本実装

**Files:**
- Modify: `packages/web/src/views/player/TotalResultView.tsx`
- Modify: `packages/web/src/routes/Player.tsx` (呼び出し時に scores を渡す)
- Modify: `packages/web/src/styles.css`

### Step 1: `TotalResultView.tsx` を差し替え

```tsx
import type { RoundNumber } from "@app/shared";

interface Props {
  scores: Record<RoundNumber, number | null>;
  verdict: string | null;
}

function sumScores(scores: Record<RoundNumber, number | null>): number {
  return (scores[1] ?? 0) + (scores[2] ?? 0) + (scores[3] ?? 0);
}

export function TotalResultView({ scores, verdict }: Props) {
  const total = sumScores(scores);
  const rounds: RoundNumber[] = [1, 2, 3];

  return (
    <main className="player-total-result">
      <h1>最終診断</h1>
      <p className="verdict">{verdict ?? "(準備中)"}</p>
      <div className="score-grid">
        {rounds.map((r) => (
          <div key={r} className="round-cell">
            <div className="round-label">Round {r}</div>
            <div className="round-score">{scores[r] ?? "-"}</div>
          </div>
        ))}
        <div className="round-cell total">
          <div className="round-label">合計</div>
          <div className="round-score">{total}</div>
        </div>
      </div>
    </main>
  );
}
```

### Step 2: `styles.css` に追加

```css
/* ---------------- Player: Total Result (Phase 3 実装) ---------------- */
.player-total-result {
  display: grid;
  place-items: center;
  align-content: center;
  text-align: center;
  padding: 40px;
  background: radial-gradient(ellipse at center, #332066, #0a0a14);
  color: white;
  gap: 24px;
}
.player-total-result h1 {
  font-size: clamp(36px, 5vw, 56px);
  margin: 0;
  color: #ffde6b;
}
.player-total-result .verdict {
  font-size: clamp(28px, 4vw, 48px);
  font-weight: 700;
  margin: 0;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
  max-width: 1200px;
  line-height: 1.4;
}
.player-total-result .score-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-top: 16px;
  max-width: 1200px;
  width: 100%;
}
.player-total-result .round-cell {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 16px 12px;
}
.player-total-result .round-cell.total {
  background: rgba(255, 222, 107, 0.2);
  border: 1px solid #ffde6b;
}
.player-total-result .round-label {
  font-size: 16px;
  color: #aab;
  margin-bottom: 4px;
}
.player-total-result .round-score {
  font-size: clamp(36px, 6vw, 64px);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
```

### Step 3: `Player.tsx` の呼び出しを調整

```tsx
case "totalResult":
  return <TotalResultView scores={snap.scores} verdict={snap.finalVerdict} />;
```

### Step 4: 型チェック + build

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web build`
Expected: clean / built.

### Step 5: Commit

```bash
git add packages/web/src/views/player/TotalResultView.tsx packages/web/src/styles.css packages/web/src/routes/Player.tsx
git commit -m "feat(web): TotalResultView with per-round + total score + verdict"
```

---

## Task 6: web — Intro `GuideView` の hint をサブステート別に

**Files:**
- Modify: `packages/web/src/views/intro/GuideView.tsx`
- Modify: `packages/web/src/routes/Intro.tsx` (現在の state を渡す)

### Step 1: `GuideView.tsx` を更新

Props に `state` を追加し、hint を state 別に切り替える。

現在:

```tsx
interface Props {
  currentRound: number | null;
}
```

変更後:

```tsx
import type { SessionStateName } from "@app/shared";

type GuideSubState = Extract<
  SessionStateName,
  "roundLoading" | "roundPlaying" | "roundResult"
>;

interface Props {
  currentRound: number | null;
  subState: GuideSubState;
}
```

`return (...)` 内の `<p className="hint">...</p>` を差し替える:

```tsx
<p className="hint">
  {subState === "roundLoading" && `Round ${currentRound ?? 1} ゲーム選出中…`}
  {subState === "roundPlaying" && `Round ${currentRound ?? 1} プレイ中…`}
  {subState === "roundResult" && `Round ${currentRound ?? 1} 結果表示中…`}
</p>
```

### Step 2: `Intro.tsx` の呼び出しで `subState` を渡す

```tsx
case "roundLoading":
case "roundPlaying":
case "roundResult":
  return <GuideView currentRound={snap.currentRound} subState={snap.state} />;
```

### Step 3: 型チェック + build

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web build`
Expected: clean.

### Step 4: Commit

```bash
git add packages/web/src/views/intro/GuideView.tsx packages/web/src/routes/Intro.tsx
git commit -m "feat(web): GuideView hint per active sub-state"
```

---

## Task 7: E2E 手動スモーク + 最終レビュー

### Step 1: 全テスト + 型チェック

Run: `pnpm -r test && pnpm -r typecheck`
Expected: 既存 22 tests + orchestrator 5 tests = **27 tests pass**。typecheck clean。

### Step 2: サーバと Web を並行起動

本Phaseはタイマで動くので default (3s/5s/8s) で進めると 1 セッション完走までおおよそ 48 秒 (3+5+8)×3 + α。デバッグしやすさ優先で短縮したい場合は `.env` で:

```
ORCHESTRATOR_ROUND_LOADING_MS=500
ORCHESTRATOR_ROUND_PLAYING_MS=1000
ORCHESTRATOR_ROUND_RESULT_MS=2000
```

ターミナル1: `pnpm --filter @app/server dev`
ターミナル2: `pnpm --filter @app/web dev`

### Step 3: 3 ブラウザ起動 + フロー確認

1. intro `/` / player A `?id=A` / player B `?id=B` を開く
2. intro で **START** → 3画面 `state=setup` (player 画面は Waiting のまま)
3. intro Setup フォームに 3 項目入力 → **次へ** 送信
4. Expected 自動遷移 (以下、intro側/player側 両方を目視確認):

| 経過 | intro | player A / B |
| --- | --- | --- |
| 0s | Guide — "Round 1 ゲーム選出中…" | Loading — "Round 1 準備中…" |
| +3s | Guide — "Round 1 プレイ中…" | Game — "Game — Round 1 (Phase 4)" |
| +3+5s | Guide — "Round 1 結果表示中…" | **RoundResult** — Round 1 + score アニメ + 定性評価文 |
| +3+5+8s | Guide — "Round 2 ゲーム選出中…" | Loading — "Round 2 準備中…" |
| ...Round 2, 3 も同様... | | |
| Round 3 roundResult 終了後 | Finish — Session finished + RESET | **TotalResult** — Round 1/2/3 得点 + 合計 + 最終診断文 |

5. intro で **RESET** → 3画面 `waiting` に戻る (再度 START 可能)

### Step 4: 最終コードレビュー (superpowers:code-reviewer)

Phase 1/2 と同じパターンで `superpowers:code-reviewer` subagent を dispatch する。
特に確認:

- Orchestrator の `lastState` で context 変化を無視するロジックが正しく働いているか (同一 state 内のスコア書き込みで二重 schedule にならないか)
- `Orchestrator.stop()` が全ての pending timer を cancel できているか (`app.close()` フックが動けば OK)
- Player の viewport フックが StrictMode 下で mount 2 回しても最終 content が `width=1920` になっているか
- Chrome 84 の CSS 制約: 新規 styles.css (round-result / total-result) に aspect-ratio / `:has()` / `@layer` / `subgrid` / `inset` shorthand が無いこと
- 新しい `ROUND_COMPLETE` 経路で `snapshot.qualitativeEvals[r]` が正しく埋まるか

### Step 5: Commit (レビュー指摘がなければ不要、あれば修正コミット)

---

## Self-Review (本計画の最終確認)

Phase 3 完了時点で達成されていること:
- Orchestrator がタイマ駆動で `ROUND_READY` / `ROUND_COMPLETE` / `NEXT_ROUND` / `SESSION_DONE` を自動発火する (Task 2)。
- Orchestrator は `Scheduler` 注入で決定的にテスト可能 (Task 2 test)。`runAll()` で 9 回回すと full 3 ラウンドサイクル + totalResult に到達することがテストで保証される。
- mock スコア/評価/最終診断は `orchestrator/mock.ts` に分離済みで、Phase 5 の `ai/gemini.ts` への差し替え対象が明確 (Task 2)。
- Player RoundResultView は score を 0→target にアニメーション表示し、定性評価文を見せる (Task 4)。
- Player TotalResultView は 3 ラウンドのスコア一覧 + 合計 + 最終診断文を見せる (Task 5)。
- Intro GuideView は active のサブステートに合わせた hint を出す (Task 6)。
- Player 画面のみ viewport が `width=1920` に切り替わる (Task 3)。
- env で default タイマを上書きできる (Task 2 Step 6、`.env.example`)。

Phase 4 で着手する範囲 (完了後に `04-games.md` を書く):
- shared `games/` レジストリ: `gameId` の列挙と各ゲーム用 config 型
- Phase 2/3 のスタブ `GameView` を 3 種ゲーム (sync-answer / partner-quiz / timing-sync) 本体に差し替え
- `player:input` 集約ロジックを Orchestrator (もしくは新クラス `RoundDriver`) に追加
- 各ゲームごとのスコア計算ロジック
- Orchestrator のタイマ完了条件を「タイムアップ or 全員入力完了」の 2 軸に拡張 (今はタイムアップのみ)
