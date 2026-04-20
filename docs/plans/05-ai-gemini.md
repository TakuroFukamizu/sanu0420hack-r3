# Phase 5 — AI (Gemini) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 4 完了状態 (3 ゲームが実入力で動く) の上に、Gemini を **3 箇所** で呼ぶ: (1) SETUP_DONE 後のセッションプラン生成 (3 ラウンドのゲーム選択 + `perPlayerConfigs`)、(2) 各 round 終了時の qualitative 評価文のリファイン (オプショナル)、(3) Round 3 終了時の最終診断文生成。Phase 4 の `orchestrator/mock.ts` 相当は `ai/mock.ts` に移し、`AiGateway` 抽象越しに mock / gemini を切替える。`GEMINI_API_KEY` 未設定ならデフォルトで mock のまま動く (ハッカソン会場の WiFi 事情フォールバック)。

**Architecture:** `Scheduler` の callback を sync から **`() => void | Promise<void>`** に拡張し、`FakeScheduler.runAll` を async 化 (Phase 3 レビューで予告した変更)。`Orchestrator` は `AiGateway` interface をコンストラクタ注入で受け取り、`roundLoading`(round=1) エントリで `gateway.planSession(setup)` を **並行に** 走らせ Promise を保持する。`roundLoading` の既存タイマが発火した時に `await sessionPlan` して ROUND_READY を emit する → AI 応答が遅ければ遷移が遅れるだけで、roundLoading 画面から「ゲーム選出中…」の guide 表示は継続する。Round 3 roundResult エントリで `gateway.generateVerdict(...)` を並行走らせ、同様に roundResult タイマ発火時に await。qualitative リファインはオプショナル (hackathon MVP では scoreFn の出力をそのまま使うフラグで切替可能)。

**Tech Stack:** Phase 4 と同じ + `@google/genai`@latest (公式 SDK)。

**受け入れ条件 (Phase完了の定義):**
- `pnpm -r test` グリーン。`FakeScheduler.runAll()` は `Promise<number>` を返す形に変わり、既存 orchestrator テストは `await sched.runAll()` に追従。新規テストで `AiGateway` 注入 (mock) での完走を確認、および gemini gateway が JSON パース失敗時に mock フォールバックすることを確認。
- `GEMINI_API_KEY` を `.env` に入れてサーバ起動 → 1 セッション走らせると、各 round の `currentGame.perPlayerConfigs` が Gemini 生成の内容 (関係性を反映した質問文など) になり、`finalVerdict` も Gemini の文面になっている。server ログに `[ai:gemini] planSession succeeded (XXX ms)` 系の行が出る。
- `GEMINI_API_KEY` を **外した** 状態でサーバ起動 → 全く同じ UX で完走する (mock fallback)。
- qualitative リファインはデフォルト OFF (`AI_REFINE_QUALITATIVE=false`)、ON にすると roundResult 遷移が Gemini 応答待ちで少し遅れるが、scoreFn の出力を上書きする動きが目視できる。
- Gemini の JSON 応答がスキーマに合わない、もしくは呼び出しが 10s 以上待っても返らない場合は silent に mock に切替わる。ユーザに例外は伝搬しない (ゲーム中断しない)。

Phase 6 で着手する範囲 (本Phaseでは出さない):
- `easymidi` で BGM 切替 (Phase 5 には含めない)

---

## 前提: playerNaming state

Phase 3 完了後に別途追加された `playerNaming` state (`setup → SETUP_DONE → playerNaming → (PLAYER_NAMED × 2, always guard) → active.roundLoading`) の存在を前提にしている。本 Phase で気をつける点:

- Orchestrator は `playerNaming` では何もしない。idle states switch に **`case "playerNaming":` を明示的に並べる** (`default:` で never 束ねる形にしたので、state 追加忘れが TS で気付ける)。
- `sessionPlanPromise` の kick-off タイミングは **`roundLoading` round=1 エントリ** のまま。playerNaming を越えた段階でしか両プレイヤー名が確定しないので、Gemini に投げる意味があるのは roundLoading 入った瞬間。
- 既存テスト (`orchestrator.test.ts`) は `completeSetupAndNaming(rt)` ヘルパ (`START → SETUP_DONE → PLAYER_NAMED × 2`) 経由で roundLoading に到達している。Phase 5 の新規テストも同じヘルパを使う。
- `Relationship` 型は `"カップル" | "気になっている" | "友達" | "親子"` の 4 値ユニオンに narrow されている。テストや prompt 例で使う文字列はこの 4 値のいずれかを使うこと。

---

## Architecture 詳細

### AiGateway の API

```ts
export interface SessionPlan {
  rounds: [CurrentGame, CurrentGame, CurrentGame]; // 3 ラウンド分
}

export interface AiGateway {
  /** Setup から 3 ラウンド分のゲーム + configs を生成する。
   *  失敗時は例外を投げる (呼び出し側が mock fallback する責務)。*/
  planSession(setup: SetupData): Promise<SessionPlan>;

  /** Round 終了時の qualitative を Gemini でリファインする。
   *  Mock は scoreFn の文をそのまま返すので実質 no-op。*/
  refineQualitative(args: {
    setup: SetupData;
    round: RoundNumber;
    current: CurrentGame;
    inputs: Partial<Record<PlayerId, unknown>>;
    score: number;
    qualitativeFromScoreFn: string;
  }): Promise<string>;

  /** 3 ラウンドのスコア + 定性評価 + Setup から最終診断を生成。*/
  generateVerdict(args: {
    setup: SetupData;
    scores: Record<RoundNumber, number | null>;
    qualitativeEvals: Record<RoundNumber, string | null>;
  }): Promise<string>;
}
```

### タイマと AI 呼び出しのライフサイクル

```
state=setup -------(SETUP_DONE)------> state=roundLoading (round=1)
                                       |
                                       | Orchestrator.onState(roundLoading, round=1)
                                       |   sessionPlanPromise = gateway.planSession(setup)  [kick off]
                                       |   scheduler.schedule(LOADING_MS, tick)            [timer]
                                       |
                                       v
       timer fires (LOADING_MS 経過)
       ↓
       const plan = await sessionPlanPromise
       runtime.send({ type: "ROUND_READY", ...plan.rounds[0] })
       ↓
       state=roundPlaying
       ... (Phase 4 と同じ入力集約フロー)
       state=roundResult
       ↓
       Orchestrator.onState(roundResult, round=1)
         if (round === 3) verdictPromise = gateway.generateVerdict(...)
         scheduler.schedule(RESULT_MS, tick)
       ...
       NEXT_ROUND → state=roundLoading (round=2)
       ↓
       Orchestrator.onState(roundLoading, round=2)
         timer.schedule(LOADING_MS, () => {
           const plan = await sessionPlanPromise  ← キャッシュ済み、即 resolve
           runtime.send({ type: "ROUND_READY", ...plan.rounds[1] })
         })
       ...
       最終 roundResult timer fires:
         const verdict = await verdictPromise
         runtime.send({ type: "SESSION_DONE", verdict })
```

### エラーハンドリング

各 AI 呼び出しは try/catch で包み、失敗時は **同じシグネチャの mock を呼ぶ**:

```ts
async function safePlanSession(gateway, setup): Promise<SessionPlan> {
  try {
    return await withTimeout(gateway.planSession(setup), 10_000);
  } catch (e) {
    console.warn("[ai] planSession failed, falling back to mock:", e);
    return mockGateway.planSession(setup);
  }
}
```

Mock gateway は常にローカルなので失敗しない。

---

## File Structure (Phase 5 で作成 / 変更)

```
packages/
├── shared/
│   └── src/
│       └── games/registry.ts           # SessionPlan 型を追加 (optional / could live server-side)
├── server/
│   ├── package.json                    # @google/genai 追加
│   ├── .env.example                    # GEMINI_API_KEY + GEMINI_MODEL + AI_REFINE_QUALITATIVE
│   ├── src/
│   │   ├── ai/                         # 新規ディレクトリ
│   │   │   ├── index.ts                # AiGateway interface + selectGateway()
│   │   │   ├── mock.ts                 # MockAiGateway (Phase 4 orchestrator/mock.ts の中身を移動)
│   │   │   ├── gemini.ts               # GeminiGateway (@google/genai)
│   │   │   └── safe.ts                 # withTimeout + try/fallback ラッパ
│   │   ├── orchestrator/
│   │   │   ├── scheduler.ts            # Scheduler callback を async 対応
│   │   │   ├── index.ts                # gateway 注入 + sessionPlan/verdict promise キャッシュ
│   │   │   └── mock.ts                 # 削除 (ai/mock.ts に移動した中身以外は Phase 4 段階でも空寸前)
│   │   └── app.ts                      # AiGateway を選択して Orchestrator に注入
│   └── test/
│       ├── orchestrator.test.ts        # await sched.runAll() + mock gateway でのフルサイクル
│       └── ai-gemini.test.ts           # 新規: gateway mock/fallback の単体テスト
```

> `orchestrator/mock.ts` の `mockVerdict` / `pickGameForRound` / `genPerPlayerConfigs` は `ai/mock.ts` に実装を移す。Phase 4 時点の import 参照を壊さないよう一度リエクスポートする手もあるが、Phase 5 で一気に切り替えた方がコードパスが明確。

---

## Task 1: Scheduler を async callback 対応に

**Files:**
- Modify: `packages/server/src/orchestrator/scheduler.ts`
- Modify: `packages/server/test/orchestrator.test.ts` (既存テストの `sched.runAll()` を `await` に)

### Step 1: `scheduler.ts` を置き換え

```ts
export type ScheduledFn = () => void | Promise<void>;

export interface Scheduler {
  /** fn を ms 後に実行する。返り値は cancel 関数。fn は async でよい。*/
  schedule(ms: number, fn: ScheduledFn): () => void;
}

export const realScheduler: Scheduler = {
  schedule(ms, fn) {
    const t = setTimeout(() => {
      // async 関数から Promise が返っても setTimeout は await しないが、
      // Promise 内エラーは unhandledRejection に流れるので catch しておく。
      Promise.resolve()
        .then(fn)
        .catch((e) => {
          console.error("[scheduler] async task threw:", e);
        });
    }, ms);
    return () => clearTimeout(t);
  },
};

export class FakeScheduler implements Scheduler {
  private tasks: Array<{ fn: ScheduledFn; cancelled: boolean }> = [];

  schedule(_ms: number, fn: ScheduledFn): () => void {
    const task = { fn, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  }

  async runAll(): Promise<number> {
    const pending = this.tasks.filter((t) => !t.cancelled);
    this.tasks = [];
    for (const t of pending) {
      await t.fn();
    }
    return pending.length;
  }

  get pendingCount(): number {
    return this.tasks.filter((t) => !t.cancelled).length;
  }
}
```

### Step 2: 既存テストを追従

`orchestrator.test.ts` の `sched.runAll()` を **すべて** `await sched.runAll()` に置換。`it(...)` の callback を `async` に変更 (vitest は async it 対応済み)。

例:
```ts
it("runs a full 3-round cycle to totalResult", async () => {
  rt.send({ type: "START" });
  rt.send({ type: "SETUP_DONE", data: setupData() });
  for (let i = 0; i < 9; i++) {
    expect(sched.pendingCount).toBe(1);
    await sched.runAll();
  }
  // ...assertions...
});
```

### Step 3: Run tests

Run: `pnpm --filter @app/server test orchestrator`
Expected: 既存 5 + Phase 4 追加 2 = 7 tests 全部 pass。

### Step 4: Commit

```bash
git add packages/server/src/orchestrator/scheduler.ts packages/server/test/orchestrator.test.ts
git commit -m "refactor(server): Scheduler callbacks may be async (FakeScheduler.runAll → Promise)"
```

---

## Task 2: `ai/` モジュール — interface + MockAiGateway + safe ラッパ

**Files:**
- Create: `packages/server/src/ai/index.ts`
- Create: `packages/server/src/ai/mock.ts`
- Create: `packages/server/src/ai/safe.ts`
- Delete: `packages/server/src/orchestrator/mock.ts` (中身を ai/mock.ts に移動)
- Modify: `packages/server/src/orchestrator/index.ts` (import 経路を ai/mock.ts 経由に。詳細は Task 3)

### Step 1: `packages/server/src/ai/index.ts`

```ts
import type {
  CurrentGame,
  PlayerId,
  RoundNumber,
  SetupData,
} from "@app/shared";

export interface SessionPlan {
  rounds: [CurrentGame, CurrentGame, CurrentGame];
}

export interface QualitativeRefineArgs {
  setup: SetupData;
  round: RoundNumber;
  current: CurrentGame;
  inputs: Partial<Record<PlayerId, unknown>>;
  score: number;
  qualitativeFromScoreFn: string;
}

export interface VerdictArgs {
  setup: SetupData;
  scores: Record<RoundNumber, number | null>;
  qualitativeEvals: Record<RoundNumber, string | null>;
}

export interface AiGateway {
  readonly name: string; // "mock" / "gemini" (ログ用)
  planSession(setup: SetupData): Promise<SessionPlan>;
  refineQualitative(args: QualitativeRefineArgs): Promise<string>;
  generateVerdict(args: VerdictArgs): Promise<string>;
}
```

### Step 2: `packages/server/src/ai/mock.ts`

Phase 4 の `orchestrator/mock.ts` の中身を吸収し、`AiGateway` 実装に整える。

```ts
import type {
  CurrentGame,
  GameId,
  PartnerQuizConfig,
  PlayerId,
  RoundNumber,
  SetupData,
  SyncAnswerConfig,
  TimingSyncConfig,
} from "@app/shared";
import type {
  AiGateway,
  QualitativeRefineArgs,
  SessionPlan,
  VerdictArgs,
} from "./index.js";

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

const syncAnswerPool: Array<{ question: string; choices: [string, string, string, string] }> = [
  { question: "デートで行きたいのは？", choices: ["海", "山", "街", "家"] },
  { question: "朝食の主食は？", choices: ["ご飯", "パン", "フルーツ", "抜く"] },
  { question: "休みの日の過ごし方は？", choices: ["外出", "映画", "ゲーム", "昼寝"] },
];

const partnerQuizPool: Array<{ question: string; choices: [string, string, string, string] }> = [
  { question: "好きな季節は？", choices: ["春", "夏", "秋", "冬"] },
  { question: "好きな色は？", choices: ["赤", "青", "緑", "黄"] },
  { question: "好きな食べ物は？", choices: ["寿司", "焼肉", "ラーメン", "カレー"] },
];

function mockGameForRound(round: RoundNumber): GameId {
  // 固定ローテーションは Phase 4 と同じ (テスト時の決定性のため)
  if (round === 1) return "sync-answer";
  if (round === 2) return "partner-quiz";
  return "timing-sync";
}

function mockCurrentGame(gameId: GameId, setup: SetupData): CurrentGame {
  switch (gameId) {
    case "sync-answer": {
      const q = pick(syncAnswerPool);
      const cfg: SyncAnswerConfig = { question: q.question, choices: q.choices };
      return { gameId, perPlayerConfigs: { A: cfg, B: cfg } };
    }
    case "partner-quiz": {
      const q = pick(partnerQuizPool);
      const target: PlayerId = Math.random() < 0.5 ? "A" : "B";
      const cfg: PartnerQuizConfig = {
        target,
        targetName: setup.players[target].name,
        question: q.question,
        choices: q.choices,
      };
      return { gameId, perPlayerConfigs: { A: cfg, B: cfg } };
    }
    case "timing-sync": {
      const cfg: TimingSyncConfig = { instruction: "2人同時にタップ！" };
      return { gameId, perPlayerConfigs: { A: cfg, B: cfg } };
    }
  }
}

function mockVerdictFromScores(scores: Record<RoundNumber, number | null>): string {
  const total = (scores[1] ?? 0) + (scores[2] ?? 0) + (scores[3] ?? 0);
  if (total >= 250) return "運命の相手！";
  if (total >= 200) return "とても相性が良いです";
  if (total >= 150) return "悪くない関係ですね";
  return "まだまだこれから！";
}

export class MockAiGateway implements AiGateway {
  readonly name = "mock";

  async planSession(setup: SetupData): Promise<SessionPlan> {
    const r1 = mockCurrentGame(mockGameForRound(1), setup);
    const r2 = mockCurrentGame(mockGameForRound(2), setup);
    const r3 = mockCurrentGame(mockGameForRound(3), setup);
    return { rounds: [r1, r2, r3] };
  }

  async refineQualitative(args: QualitativeRefineArgs): Promise<string> {
    // mock は scoreFn の出力をそのまま通す (上書きしない)
    return args.qualitativeFromScoreFn;
  }

  async generateVerdict(args: VerdictArgs): Promise<string> {
    return mockVerdictFromScores(args.scores);
  }
}
```

### Step 3: `packages/server/src/ai/safe.ts`

```ts
import type { AiGateway } from "./index.js";
import { MockAiGateway } from "./mock.js";

const mock = new MockAiGateway();

/** 指定の Promise を ms でタイムアウトさせる。失敗時は reject。*/
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** gateway の関数を呼び出し、失敗 or 10s 超過時は mock にフォールバックする HOF。*/
export function safeCall<TArgs extends unknown[], TRet>(
  label: string,
  gateway: AiGateway,
  fn: (g: AiGateway) => (...args: TArgs) => Promise<TRet>,
  timeoutMs = 10_000,
): (...args: TArgs) => Promise<TRet> {
  return async (...args: TArgs): Promise<TRet> => {
    try {
      return await withTimeout(fn(gateway)(...args), timeoutMs);
    } catch (e) {
      console.warn(`[ai:${gateway.name}] ${label} failed, fallback to mock:`, e);
      return fn(mock)(...args);
    }
  };
}
```

> `safeCall` は少し抽象的なので、実際には `orchestrator/index.ts` で直接 try/catch 書く方が読みやすい。Task 3 で使い方を決める。

### Step 4: 一時的に orchestrator/mock.ts を削除 or 空に

Task 3 で `orchestrator/index.ts` の import 経路を書き換えるまでは、Phase 4 の mock.ts を残したまま ai/mock.ts と並立していても build は通る。Task 3 のコミットで削除する。

### Step 5: typecheck

Run: `pnpm --filter @app/server typecheck`
Expected: clean (AiGateway interface は未使用でもエラーにならない)。

### Step 6: Commit

```bash
git add packages/server/src/ai
git commit -m "feat(server): AiGateway interface + MockAiGateway (wraps Phase 4 mock functions)"
```

---

## Task 3: Orchestrator を AiGateway 駆動にリファクタ

**Files:**
- Modify: `packages/server/src/orchestrator/index.ts`
- Delete: `packages/server/src/orchestrator/mock.ts`
- Modify: `packages/server/test/orchestrator.test.ts` (MockAiGateway 注入)

### Step 1: `orchestrator/index.ts` を書き換え

主な変更:
- Constructor が `AiGateway` を受け取る (default: `new MockAiGateway()`)
- `sessionPlanPromise: Promise<SessionPlan> | null`
- `verdictPromise: Promise<string> | null`
- `onState(roundLoading)` で round=1 の時に `planSession` を kick off
- `onState(roundResult)` で round=3 の時に `generateVerdict` を kick off
- roundLoading の timer callback は async に: `await sessionPlanPromise`、`plan.rounds[round-1]` を使って ROUND_READY
- roundResult round=3 の timer callback は async に: `await verdictPromise` → SESSION_DONE
- `completeRound` はオプショナルで `refineQualitative` を呼ぶ (env で ON/OFF)

```ts
import type {
  CurrentGame,
  PlayerId,
  PlayerInput,
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
  scoreGame,
} from "@app/shared";
import type { SessionRuntime } from "../session-runtime.js";
import type { AiGateway, SessionPlan } from "../ai/index.js";
import { MockAiGateway } from "../ai/mock.js";
import { withTimeout } from "../ai/safe.js";
import { realScheduler, type Scheduler } from "./scheduler.js";

export interface OrchestratorDurations {
  roundLoadingMs: number;
  roundPlayingMs: number;
  roundResultMs: number;
}

export interface OrchestratorOptions {
  gateway?: AiGateway;
  refineQualitative?: boolean;
  aiTimeoutMs?: number;
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

  private inputs: Partial<Record<PlayerId, unknown>> = {};

  // AI 応答キャッシュ (セッション単位)
  private sessionPlanPromise: Promise<SessionPlan> | null = null;
  private verdictPromise: Promise<string> | null = null;

  private readonly gateway: AiGateway;
  private readonly fallback: AiGateway;
  private readonly refineQualitative: boolean;
  private readonly aiTimeoutMs: number;

  constructor(
    private runtime: SessionRuntime,
    private scheduler: Scheduler = realScheduler,
    private durations: OrchestratorDurations = durationsFromEnv(),
    opts: OrchestratorOptions = {},
  ) {
    this.gateway = opts.gateway ?? new MockAiGateway();
    this.fallback = new MockAiGateway();
    this.refineQualitative = opts.refineQualitative ?? false;
    this.aiTimeoutMs = opts.aiTimeoutMs ?? 10_000;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.runtime.subscribe((snap) => this.onState(snap));
  }

  stop(): void {
    this.cancelPending?.();
    this.cancelPending = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.lastState = null;
    this.inputs = {};
    this.sessionPlanPromise = null;
    this.verdictPromise = null;
  }

  onPlayerInput(playerId: PlayerId, input: PlayerInput): void {
    const snap = this.runtime.get();
    if (snap.state !== "roundPlaying") return;
    if (!snap.currentGame) return;
    if (input.round !== snap.currentRound) return;
    if (input.gameId !== snap.currentGame.gameId) return;

    this.inputs[playerId] = input.payload;

    if (this.inputs.A !== undefined && this.inputs.B !== undefined) {
      this.cancelPending?.();
      this.cancelPending = null;
      void this.completeRound(snap.currentGame, snap.currentRound!);
    }
  }

  private async safePlan(setup: import("@app/shared").SetupData): Promise<SessionPlan> {
    try {
      return await withTimeout(this.gateway.planSession(setup), this.aiTimeoutMs);
    } catch (e) {
      console.warn(`[ai:${this.gateway.name}] planSession failed, fallback:`, e);
      return this.fallback.planSession(setup);
    }
  }

  private async safeVerdict(args: Parameters<AiGateway["generateVerdict"]>[0]): Promise<string> {
    try {
      return await withTimeout(this.gateway.generateVerdict(args), this.aiTimeoutMs);
    } catch (e) {
      console.warn(`[ai:${this.gateway.name}] generateVerdict failed, fallback:`, e);
      return this.fallback.generateVerdict(args);
    }
  }

  private async safeRefine(args: Parameters<AiGateway["refineQualitative"]>[0]): Promise<string> {
    try {
      return await withTimeout(this.gateway.refineQualitative(args), this.aiTimeoutMs);
    } catch (e) {
      console.warn(`[ai:${this.gateway.name}] refineQualitative failed, fallback:`, e);
      return args.qualitativeFromScoreFn;
    }
  }

  private async completeRound(current: CurrentGame, round: RoundNumber): Promise<void> {
    const { score, qualitative: fromScoreFn } = scoreGame(current, this.inputs);
    const snapNow = this.runtime.get();
    let qualitative = fromScoreFn;
    if (this.refineQualitative && snapNow.setup) {
      qualitative = await this.safeRefine({
        setup: snapNow.setup,
        round,
        current,
        inputs: { ...this.inputs },
        score,
        qualitativeFromScoreFn: fromScoreFn,
      });
    }
    this.inputs = {};
    this.runtime.send({ type: "ROUND_COMPLETE", score, qualitative });
  }

  private onState(snap: SessionSnapshot): void {
    if (snap.state === this.lastState) return;
    this.lastState = snap.state;

    this.cancelPending?.();
    this.cancelPending = null;

    switch (snap.state) {
      case "roundLoading":
        // round=1 エントリ時にセッションプランを kick off (並行)
        if (snap.currentRound === 1 && !this.sessionPlanPromise && snap.setup) {
          this.sessionPlanPromise = this.safePlan(snap.setup);
        }
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundLoadingMs,
          async () => {
            await this.emitRoundReady();
          },
        );
        return;
      case "roundPlaying":
        this.inputs = {};
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundPlayingMs,
          async () => {
            const cur = this.runtime.get().currentGame;
            const r = this.runtime.get().currentRound;
            if (!cur || r === null) return;
            await this.completeRound(cur, r);
          },
        );
        return;
      case "roundResult": {
        const round: RoundNumber | null = snap.currentRound;
        // 最終ラウンドなら verdict を並行生成
        if (round === 3 && !this.verdictPromise && snap.setup) {
          this.verdictPromise = this.safeVerdict({
            setup: snap.setup,
            scores: this.runtime.get().scores,
            qualitativeEvals: this.runtime.get().qualitativeEvals,
          });
        }
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundResultMs,
          async () => {
            if (round === null || round === 3) {
              const verdict = this.verdictPromise
                ? await this.verdictPromise
                : await this.safeVerdict({
                    setup: snap.setup!,
                    scores: this.runtime.get().scores,
                    qualitativeEvals: this.runtime.get().qualitativeEvals,
                  });
              this.runtime.send({ type: "SESSION_DONE", verdict });
            } else {
              this.runtime.send({ type: "NEXT_ROUND" });
            }
          },
        );
        return;
      }
      case "waiting":
        // 新セッションに備えキャッシュクリア (RESET 経由でここに来る)
        this.sessionPlanPromise = null;
        this.verdictPromise = null;
        return;
      case "setup":
      case "playerNaming":
      case "totalResult":
        return;
      default: {
        // 将来の新 state を追加したときに TS2322 で気付けるよう never 型で束ねる
        const _exhaustive: never = snap.state;
        return _exhaustive;
      }
    }
  }

  private async emitRoundReady(): Promise<void> {
    const snap = this.runtime.get();
    if (!snap.setup || snap.currentRound === null) return;
    if (!this.sessionPlanPromise) {
      // 念のため (通常は round=1 で張られている)
      this.sessionPlanPromise = this.safePlan(snap.setup);
    }
    const plan = await this.sessionPlanPromise;
    const current = plan.rounds[snap.currentRound - 1];
    this.runtime.send({
      type: "ROUND_READY",
      gameId: current.gameId,
      perPlayerConfigs: current.perPlayerConfigs,
    });
  }
}
```

### Step 2: `orchestrator/mock.ts` を削除

Phase 4 で作った `orchestrator/mock.ts` は全機能が `ai/mock.ts` に移行したので削除する。

```bash
rm packages/server/src/orchestrator/mock.ts
```

### Step 3: `orchestrator.test.ts` を更新

既存の `new Orchestrator(rt, sched)` を `new Orchestrator(rt, sched, undefined, { gateway: new MockAiGateway() })` に (実質同じ挙動なので既存テストは引き続きパス)。

追加テスト:

```ts
import { MockAiGateway } from "../src/ai/mock.js";

describe("Orchestrator with AiGateway injection", () => {
  // ...既存 beforeEach/afterEach...

  it("calls gateway.planSession once at roundLoading round=1", async () => {
    const calls: Array<string> = [];
    const spyGw = new MockAiGateway();
    const original = spyGw.planSession.bind(spyGw);
    spyGw.planSession = async (...a) => {
      calls.push("plan");
      return original(...a);
    };
    orch.stop();
    orch = new Orchestrator(rt, sched, undefined, { gateway: spyGw });
    orch.start();

    rt.send({ type: "START" });
    rt.send({ type: "SETUP_DONE", data: setupData() });
    expect(calls).toEqual(["plan"]); // 即 kick off
    // 9 回回して完了
    for (let i = 0; i < 9; i++) await sched.runAll();
    expect(rt.get().state).toBe("totalResult");
    expect(calls).toEqual(["plan"]); // 複数回呼ばれない
  });

  it("falls back to mock when gateway throws", async () => {
    class BrokenGateway extends MockAiGateway {
      name = "broken";
      async planSession(): Promise<never> {
        throw new Error("boom");
      }
    }
    orch.stop();
    orch = new Orchestrator(rt, sched, undefined, { gateway: new BrokenGateway() });
    orch.start();

    rt.send({ type: "START" });
    rt.send({ type: "SETUP_DONE", data: setupData() });
    for (let i = 0; i < 9; i++) await sched.runAll();
    expect(rt.get().state).toBe("totalResult");
    // Mock fallback で currentGame が埋まっていたはず (3 ラウンド走破が成立している)
    expect(rt.get().scores[3]).not.toBeNull();
  });

  it("uses gateway.generateVerdict for final verdict", async () => {
    class CannedGateway extends MockAiGateway {
      name = "canned";
      async generateVerdict(): Promise<string> {
        return "GEMINI SAYS HELLO";
      }
    }
    orch.stop();
    orch = new Orchestrator(rt, sched, undefined, { gateway: new CannedGateway() });
    orch.start();

    rt.send({ type: "START" });
    rt.send({ type: "SETUP_DONE", data: setupData() });
    for (let i = 0; i < 9; i++) await sched.runAll();
    expect(rt.get().finalVerdict).toBe("GEMINI SAYS HELLO");
  });
});
```

### Step 4: Run tests

Run: `pnpm --filter @app/server test`
Expected: 既存 (Phase 4 完了分) + 新 3 = 計 20+ tests pass (数は Phase 4 実装後の実測に合わせて調整)。

### Step 5: Commit

```bash
git add packages/server/src/orchestrator packages/server/test/orchestrator.test.ts
git rm packages/server/src/orchestrator/mock.ts 2>/dev/null || true
git commit -m "feat(server): Orchestrator driven by AiGateway with parallel session plan + verdict"
```

---

## Task 4: GeminiGateway 実装

**Files:**
- Modify: `packages/server/package.json` (@google/genai 追加)
- Create: `packages/server/src/ai/gemini.ts`
- Create: `packages/server/test/ai-gemini.test.ts` (mock 応答でのユニットテスト)

### Step 1: 依存追加

```bash
cd packages/server && pnpm add @google/genai
```

### Step 2: `packages/server/src/ai/gemini.ts`

`@google/genai` 最新 SDK の API は **実装時に必ず Context7 MCP で確認** する (server の mcp__plugin_context7 を使う)。以下はイメージ:

```ts
import type {
  CurrentGame,
  GameId,
  PartnerQuizConfig,
  PlayerId,
  RoundNumber,
  SetupData,
  SyncAnswerConfig,
  TimingSyncConfig,
} from "@app/shared";
import { GoogleGenAI } from "@google/genai";
import type {
  AiGateway,
  QualitativeRefineArgs,
  SessionPlan,
  VerdictArgs,
} from "./index.js";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

// 型安全のために Gemini 応答の JSON を narrow するユーティリティ
function assertGameId(s: unknown): asserts s is GameId {
  if (s !== "sync-answer" && s !== "partner-quiz" && s !== "timing-sync") {
    throw new Error(`invalid gameId: ${JSON.stringify(s)}`);
  }
}

export class GeminiGateway implements AiGateway {
  readonly name = "gemini";
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async planSession(setup: SetupData): Promise<SessionPlan> {
    const prompt = buildPlanPrompt(setup);
    const res = await this.ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        // responseSchema を指定するのが望ましい (SDK の Type enum を参照)。
        // ここではシンプルにプロンプトで JSON 構造を指示し、パース失敗時は例外。
      },
    });
    const text = res.text ?? "";
    const parsed = JSON.parse(text);
    return normalizePlan(parsed, setup);
  }

  async refineQualitative(args: QualitativeRefineArgs): Promise<string> {
    const prompt = buildRefinePrompt(args);
    const res = await this.ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });
    return (res.text ?? args.qualitativeFromScoreFn).trim().slice(0, 120);
  }

  async generateVerdict(args: VerdictArgs): Promise<string> {
    const prompt = buildVerdictPrompt(args);
    const res = await this.ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });
    return (res.text ?? "").trim().slice(0, 200);
  }
}

// ---- プロンプト構築 ----

function buildPlanPrompt(setup: SetupData): string {
  const { players, relationship } = setup;
  return `あなたは2人ペアで遊ぶアーケードゲームのディレクターです。
プレイヤー: A="${players.A.name}" / B="${players.B.name}"、関係性: "${relationship}"。

以下3種のゲームから3ラウンド分の内容を JSON で決めてください:
- "sync-answer": 同じ質問に2人が4択から同時回答、一致で得点
- "partner-quiz": targetプレイヤーに関する4択クイズを2人が答え、一致で得点
- "timing-sync": 2人同時にタップ、時刻差が小さいほど高得点

応答フォーマット (必ず JSON だけで、それ以外の文字列を含めない):
{
  "rounds": [
    { "gameId": "...", "config": { ... } },
    { "gameId": "...", "config": { ... } },
    { "gameId": "...", "config": { ... } }
  ]
}

config は gameId に応じて以下の shape:
- sync-answer: { "question": string, "choices": [string, string, string, string] }
- partner-quiz: { "target": "A"|"B", "question": string, "choices": [string×4] }  (targetName はサーバ側で補完)
- timing-sync: { "instruction": string }

関係性 "${relationship}" を踏まえ、2人の距離感を探るような質問・指示にしてください。`;
}

function buildRefinePrompt(a: QualitativeRefineArgs): string {
  return `2人は${a.setup.relationship}の関係。
Round ${a.round} のゲームは "${a.current.gameId}"、得点 ${a.score} 点。
scoreFn が提示した感想: 「${a.qualitativeFromScoreFn}」。

この得点と関係性を踏まえ、1〜2文 (120字以内) の煽りコメントを日本語で返してください。
絵文字は使わない。括弧や前置きは書かず、文章のみ。`;
}

function buildVerdictPrompt(a: VerdictArgs): string {
  return `2人は${a.setup.relationship}の関係。3ラウンドの結果:
R1: ${a.scores[1] ?? 0}点 / "${a.qualitativeEvals[1] ?? ""}"
R2: ${a.scores[2] ?? 0}点 / "${a.qualitativeEvals[2] ?? ""}"
R3: ${a.scores[3] ?? 0}点 / "${a.qualitativeEvals[3] ?? ""}"

この2人の相性を1〜2文 (200字以内) の日本語で診断してください。
絵文字や括弧は不可、文章のみ。`;
}

// ---- 応答の narrow ----

function normalizePlan(raw: unknown, setup: SetupData): SessionPlan {
  if (!raw || typeof raw !== "object") throw new Error("plan: not object");
  const rounds = (raw as { rounds?: unknown }).rounds;
  if (!Array.isArray(rounds) || rounds.length !== 3) {
    throw new Error("plan: rounds must be array of 3");
  }
  return {
    rounds: [
      narrowRound(rounds[0], setup),
      narrowRound(rounds[1], setup),
      narrowRound(rounds[2], setup),
    ],
  };
}

function narrowRound(raw: unknown, setup: SetupData): CurrentGame {
  if (!raw || typeof raw !== "object") throw new Error("round: not object");
  const r = raw as Record<string, unknown>;
  assertGameId(r.gameId);
  const config = r.config;
  if (!config || typeof config !== "object") throw new Error("round.config: missing");
  switch (r.gameId) {
    case "sync-answer":
      return {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: narrowSyncAnswer(config),
          B: narrowSyncAnswer(config),
        },
      };
    case "partner-quiz": {
      const pq = narrowPartnerQuiz(config);
      const cfg: PartnerQuizConfig = {
        ...pq,
        targetName: setup.players[pq.target].name,
      };
      return {
        gameId: "partner-quiz",
        perPlayerConfigs: { A: cfg, B: cfg },
      };
    }
    case "timing-sync":
      return {
        gameId: "timing-sync",
        perPlayerConfigs: {
          A: narrowTimingSync(config),
          B: narrowTimingSync(config),
        },
      };
  }
}

function narrowSyncAnswer(c: object): SyncAnswerConfig {
  const r = c as Record<string, unknown>;
  const q = r.question;
  const choices = r.choices;
  if (typeof q !== "string") throw new Error("sync-answer.question: string required");
  if (!Array.isArray(choices) || choices.length !== 4) {
    throw new Error("sync-answer.choices: 4 strings required");
  }
  return {
    question: q,
    choices: choices.map(String) as [string, string, string, string],
  };
}

function narrowPartnerQuiz(c: object): Omit<PartnerQuizConfig, "targetName"> {
  const r = c as Record<string, unknown>;
  const target = r.target;
  if (target !== "A" && target !== "B") throw new Error("partner-quiz.target: A|B");
  const q = r.question;
  const choices = r.choices;
  if (typeof q !== "string") throw new Error("partner-quiz.question: string");
  if (!Array.isArray(choices) || choices.length !== 4) {
    throw new Error("partner-quiz.choices: 4 strings");
  }
  return {
    target: target as PlayerId,
    question: q,
    choices: choices.map(String) as [string, string, string, string],
  };
}

function narrowTimingSync(c: object): TimingSyncConfig {
  const r = c as Record<string, unknown>;
  const instr = r.instruction;
  if (typeof instr !== "string") throw new Error("timing-sync.instruction: string");
  return { instruction: instr };
}
```

> **実装前に必ず Context7 で `@google/genai` の `models.generateContent` の最新 API を確認**。`responseSchema` を使えば JSON 整形の信頼性が上がるので、可能なら narrowing より SDK 側のスキーマ制約を優先する。

### Step 3: `packages/server/test/ai-gemini.test.ts`

実際の Gemini 呼び出しはテストしない (API キーが必要、非決定性)。narrowing と `safeCall` 経路のテストにとどめる:

```ts
import { describe, it, expect } from "vitest";
import { MockAiGateway } from "../src/ai/mock.js";
import type { AiGateway } from "../src/ai/index.js";

describe("AiGateway fallback paths", () => {
  it("MockAiGateway.planSession returns exactly 3 rounds with distinct gameIds", async () => {
    const g: AiGateway = new MockAiGateway();
    const plan = await g.planSession({
      players: { A: { id: "A", name: "a" }, B: { id: "B", name: "b" } },
      relationship: "友達",
    });
    expect(plan.rounds).toHaveLength(3);
    const ids = plan.rounds.map((r) => r.gameId);
    expect(new Set(ids).size).toBe(3); // 重複なし (Phase 4 mock は固定ローテ)
  });

  it("MockAiGateway.refineQualitative is a pass-through", async () => {
    const g: AiGateway = new MockAiGateway();
    const s = "originalは変更されない";
    const out = await g.refineQualitative({
      setup: { players: { A: { id: "A", name: "a" }, B: { id: "B", name: "b" } }, relationship: "友達" },
      round: 1,
      current: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "q", choices: ["a", "b", "c", "d"] },
          B: { question: "q", choices: ["a", "b", "c", "d"] },
        },
      },
      inputs: {},
      score: 50,
      qualitativeFromScoreFn: s,
    });
    expect(out).toBe(s);
  });
});
```

### Step 4: typecheck + test

Run: `pnpm --filter @app/server typecheck && pnpm --filter @app/server test`
Expected: clean & tests pass.

### Step 5: Commit

```bash
git add packages/server/src/ai/gemini.ts packages/server/test/ai-gemini.test.ts packages/server/package.json pnpm-lock.yaml
git commit -m "feat(server): GeminiGateway implementation with JSON narrowing + @google/genai dep"
```

---

## Task 5: buildApp で Gateway 選択 + env template 更新

**Files:**
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/.env.example`

### Step 1: `app.ts` の Orchestrator 生成で Gateway を選ぶ

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { SessionRuntime } from "./session-runtime.js";
import { registerHttpRoutes } from "./http.js";
import { Orchestrator } from "./orchestrator/index.js";
import { MockAiGateway } from "./ai/mock.js";
import { GeminiGateway } from "./ai/gemini.js";
import type { AiGateway } from "./ai/index.js";

export interface BuildAppOptions {
  runtime?: SessionRuntime;
  orchestrator?: Orchestrator | null;
  gateway?: AiGateway; // テストから固定 Gateway を注入する時に使う
}

function selectGateway(): AiGateway {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    console.log("[ai] GEMINI_API_KEY not set, using MockAiGateway");
    return new MockAiGateway();
  }
  console.log("[ai] using GeminiGateway");
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
      : (opts.orchestrator ?? new Orchestrator(runtime, undefined, undefined, {
          gateway,
          refineQualitative,
        }));

  registerHttpRoutes(app);
  app.decorate("sessionRuntime", runtime);
  app.decorate("orchestrator", orchestrator);

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
    orchestrator: Orchestrator | null;
  }
}
```

### Step 2: `.env.example` 末尾に追記

```
# [Phase 5] Gemini API key (Google AI Studio)。未指定なら MockAiGateway を使う。
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

# Round 終了時の qualitative を Gemini でリファインするか。ON にすると
# roundResult 遷移が AI 応答待ちで遅くなる可能性がある。デフォルト false。
AI_REFINE_QUALITATIVE=false
```

### Step 3: Run tests (既存テストが壊れていないことを確認)

Run: `pnpm -r test && pnpm -r typecheck`
Expected: 全 pass。

### Step 4: Commit

```bash
git add packages/server/src/app.ts packages/server/.env.example
git commit -m "feat(server): select AiGateway based on GEMINI_API_KEY presence"
```

---

## Task 6: E2E 手動スモーク + 最終レビュー

### Step 1: Mock モードで全自動進行確認

`.env` に `GEMINI_API_KEY` を入れない状態で:

```bash
pnpm --filter @app/server dev
pnpm --filter @app/web dev
```

3 ブラウザで START → Setup → フル 1 セッション走破。Phase 4 と同一 UX。ログに `[ai] GEMINI_API_KEY not set, using MockAiGateway` が出る。

### Step 2: Gemini モードで走らせる

`.env`:
```
GEMINI_API_KEY=<your key>
GEMINI_MODEL=gemini-2.5-flash
ORCHESTRATOR_ROUND_LOADING_MS=5000
```

起動し、START + Setup 完了。Expected:
- ログ: `[ai] using GeminiGateway`
- Round 1 の question/choices が Gemini 生成文 (関係性を反映)
- Round 3 終了後の最終診断が Gemini 生成文 (単なる `"運命の相手！"` ではなく具体的な文)

Gemini が遅れると roundLoading が伸びる (タイマ 5s + AI 応答) が、UI はフリーズしない (GuideView の hint 表示継続)。

### Step 3: 故意に AI を壊してフォールバック確認

一時的に `.env` の `GEMINI_API_KEY=invalid_key` にして起動。
Expected: Gemini call が 401 で失敗 → `[ai:gemini] planSession failed, fallback:` が出て、mock の応答で完走する。

### Step 4: 最終レビュー dispatch (superpowers:code-reviewer)

特に確認:
- `safePlan` / `safeVerdict` / `safeRefine` がタイムアウト経路も含めて例外を握り潰しているか
- `this.sessionPlanPromise` が RESET で null にリセットされ、次セッションで新規生成されるか
- Gemini 応答の narrowing がスキーマ違反時に例外を投げるか (silent に壊れた config を通さない)
- `GeminiGateway` が API key を error 文字列・ログに含めていないか

### Step 5: レビュー指摘を minor なら持ち越し、critical なら修正コミット。

---

## Self-Review

Phase 5 完了時点で達成されていること:
- Orchestrator が AiGateway 抽象経由で動き、`MockAiGateway` / `GeminiGateway` を差し替え可能。
- Gemini 応答は JSON narrowing で厳格化し、失敗時は mock に silent フォールバック。API キーなしでもハッカソン会場で動作する。
- `Scheduler` の callback が `() => void | Promise<void>` に拡張され、FakeScheduler.runAll も async 化。既存テストは `await sched.runAll()` に追従。
- セッションプランは `roundLoading` round=1 で並行生成、各ラウンドの timer で `await` して ROUND_READY を撃つ。AI 応答遅延は roundLoading の見かけ時間を伸ばすだけで、UI の整合性は保たれる。
- 最終診断は `roundResult` round=3 で並行生成、roundResult timer で `await`。
- qualitative リファインは env OFF デフォルトで、ON にすれば Gemini 文に置き換わる (roundResult 遷移が少し遅れる)。

Phase 6 で着手する範囲 (完了後に `06-midi-bgm.md` を書く):
- `easymidi` でノート PC の MIDI 出力ポートを開く
- 状態遷移フック (runtime.subscribe) から BGM / SE を切替える
- 各シーン (waiting / setup / active.roundPlaying / totalResult) 用のノート列を用意
- `MIDI_PORT` env と、未設定時 / ポート存在しない時の silent no-op fallback
