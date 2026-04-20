# Phase 4 — Games 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3 で自動進行するタイマ駆動の土台の上に、**3 種類のゲーム本体** (`sync-answer` / `partner-quiz` / `timing-sync`) を実装し、プレイヤーの実入力と実スコア計算でラウンドが完結するようにする。Phase 3 の `mockScore()` / `mockQualitative()` は役割を終え、各ゲームの `scoreFn(configs, inputs)` に置き換わる。ゲーム選択自体とラウンドごとの config 生成はまだサーバ内 mock (Phase 5 で Gemini 化)。

**Architecture:** ゲームは **shared/games レジストリ** に1ゲーム=1モジュールで置く (config 型・input 型・scoreFn)。state machine の `SessionContext` に `currentGame: { gameId, perPlayerConfigs }` を追加し、`ROUND_READY` イベントが payload (`gameId`, `perPlayerConfigs`) を運ぶようにする。`session:state` broadcast がそのまま配信チャネルなので、別の `round:start` WS イベントは追加しない (overview §3.2 の記述は Phase 5+ へ先送り)。Orchestrator はラウンド開始時にプレイヤー入力バッファを張り、**両者入力完了 OR タイムアップ** のどちらか早い方で scoreFn を呼んで `ROUND_COMPLETE` を送る。Phase 3 の `Scheduler` 抽象はそのまま活かす。

**Tech Stack:** Phase 3 と同じ + プレイヤー UI は Chrome 84 対応 (`pointerdown` 優先、`aspect-ratio`/`:has()` 不可、`requestAnimationFrame` OK)。

**受け入れ条件 (Phase完了の定義):**
- `pnpm -r test` グリーン。machine 9 tests と orchestrator 5 tests は **ROUND_READY payload 対応で更新**、server に新規 ws/orchestrator tests を追加。
- `pnpm -r typecheck` / `pnpm --filter @app/web build` クリーン (chrome84 target 維持)。
- 3 ブラウザ常時接続状態で:
  1. START → Setup submit (intro) → Round 1 roundPlaying で **player A/B の画面に game UI が出る** (gameId は固定ローテーション: R1=sync-answer / R2=partner-quiz / R3=timing-sync)。
  2. 両プレイヤーが入力 (選択 or タップ) → **タイムアップを待たずに** roundResult へ遷移し、実スコアが表示される。
  3. 片方だけ入力 → タイムアップで roundResult 遷移、スコアは scoreFn の fallback 値 (概ね 0)。
  4. Round 3 終了 → totalResult に 3 ラウンドの実スコア合計 + 診断が出る。
- `GameView` が `currentGame.gameId` に応じて正しいゲームコンポーネントを dispatch する。
- プレイヤーの入力は `player:input` WS イベントでサーバに届き、orchestrator が受け取る。
- Phase 3 の `mockQualitative()` は **削除** (各 scoreFn が qualitative を返すため)。

Phase 5 で着手する範囲 (本Phaseでは出さない):
- Gemini でラウンドごとの「ゲーム選択 + config 生成」「定性評価再構成」「最終診断」
- 現状 orchestrator/mock.ts の関数を `ai/gemini.ts` に差し替え

---

## File Structure (Phase 4 で作成 / 変更)

```
packages/
├── shared/
│   └── src/
│       ├── games/                     # 新規ディレクトリ
│       │   ├── index.ts               # re-export + GameId 型 + CurrentGame 判別ユニオン
│       │   ├── sync-answer.ts
│       │   ├── partner-quiz.ts
│       │   ├── timing-sync.ts
│       │   └── registry.ts            # gameId → { scoreFn } のマップ
│       ├── types.ts                   # PlayerInput.payload を GameInput union に、CurrentGame を追加
│       ├── machine.ts                 # SessionContext.currentGame + ROUND_READY payload + applyGame action
│       └── index.ts                   # games/ を re-export
├── server/
│   ├── src/
│   │   ├── orchestrator/
│   │   │   ├── index.ts               # inputs buffer + per-player input 受信 + scoreFn 呼出し
│   │   │   └── mock.ts                # pickGameForRound + genPerPlayerConfigs（mockQualitative 削除）
│   │   └── ws.ts                      # player:input を orchestrator.onPlayerInput に forward
│   └── test/
│       ├── orchestrator.test.ts       # payload 対応で更新 + 新規 player-input 完了テスト
│       └── ws.test.ts                 # player:input forward テスト追加
└── web/
    ├── src/
    │   ├── games/                     # 新規 (Phase 2 の空ディレクトリに実体投入)
    │   │   ├── SyncAnswerGame.tsx
    │   │   ├── PartnerQuizGame.tsx
    │   │   └── TimingSyncGame.tsx
    │   ├── views/player/
    │   │   └── GameView.tsx           # stub を dispatcher 本実装に差し替え
    │   ├── routes/Player.tsx          # GameView に playerId/currentGame/onInput を渡す
    │   ├── net/socket.ts              # player:input emit helper (型付け)
    │   └── styles.css                 # .game-* クラス群を追加
```

---

## Task 1: shared/games — レジストリと 3 ゲームモジュール

**Files:**
- Create: `packages/shared/src/games/sync-answer.ts`
- Create: `packages/shared/src/games/partner-quiz.ts`
- Create: `packages/shared/src/games/timing-sync.ts`
- Create: `packages/shared/src/games/registry.ts`
- Create: `packages/shared/src/games/index.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

- [ ] **Step 1: `packages/shared/src/games/sync-answer.ts`**

```ts
import type { PlayerId } from "../types.js";

export interface SyncAnswerConfig {
  question: string;
  choices: [string, string, string, string];
}

export interface SyncAnswerInput {
  choice: 0 | 1 | 2 | 3;
}

export interface GameScore {
  score: number;
  qualitative: string;
}

export function scoreSyncAnswer(
  configs: Record<PlayerId, SyncAnswerConfig>,
  inputs: Partial<Record<PlayerId, SyncAnswerInput>>,
): GameScore {
  const a = inputs.A?.choice;
  const b = inputs.B?.choice;
  if (a === undefined || b === undefined) {
    return { score: 0, qualitative: "操作が間に合いませんでした…" };
  }
  const match = a === b;
  return {
    score: match ? 100 : 0,
    qualitative: match
      ? "2人の意見がシンクロしました！"
      : "意見が分かれましたね…",
  };
}
```

- [ ] **Step 2: `packages/shared/src/games/partner-quiz.ts`**

```ts
import type { PlayerId } from "../types.js";
import type { GameScore } from "./sync-answer.js";

export interface PartnerQuizConfig {
  /** クイズ対象のプレイヤー (その人の趣向を問うクイズ) */
  target: PlayerId;
  /** 表示用に target の名前を含める (Setup から取得) */
  targetName: string;
  question: string;
  choices: [string, string, string, string];
}

export interface PartnerQuizInput {
  choice: 0 | 1 | 2 | 3;
}

export function scorePartnerQuiz(
  configs: Record<PlayerId, PartnerQuizConfig>,
  inputs: Partial<Record<PlayerId, PartnerQuizInput>>,
): GameScore {
  // A と B の config は同一 (target を両者が共有している前提)
  const target = configs.A.target;
  const other: PlayerId = target === "A" ? "B" : "A";
  const targetChoice = inputs[target]?.choice;
  const otherChoice = inputs[other]?.choice;
  if (targetChoice === undefined || otherChoice === undefined) {
    return { score: 0, qualitative: "どちらかが回答できませんでした…" };
  }
  const match = targetChoice === otherChoice;
  return {
    score: match ? 100 : 0,
    qualitative: match
      ? "相方のことをよく知っていますね！"
      : "相方のことをまだ分かりきれていないかも？",
  };
}
```

- [ ] **Step 3: `packages/shared/src/games/timing-sync.ts`**

```ts
import type { PlayerId } from "../types.js";
import type { GameScore } from "./sync-answer.js";

export interface TimingSyncConfig {
  instruction: string;
}

export interface TimingSyncInput {
  /** クライアント側の `Date.now()` タップ時刻 */
  tapTime: number;
}

export function scoreTimingSync(
  configs: Record<PlayerId, TimingSyncConfig>,
  inputs: Partial<Record<PlayerId, TimingSyncInput>>,
): GameScore {
  const a = inputs.A?.tapTime;
  const b = inputs.B?.tapTime;
  if (a === undefined || b === undefined) {
    return { score: 0, qualitative: "どちらかが操作できませんでした…" };
  }
  const diffMs = Math.abs(a - b);
  // 10ms ずれるごとに 1 pt 減点、0 下限。
  const score = Math.max(0, 100 - Math.floor(diffMs / 10));
  const qualitative =
    diffMs < 200
      ? "2人の息がぴったりでした！"
      : diffMs < 500
        ? "ほぼ同じタイミングでした。"
        : "タイミングが少しずれましたね。";
  return { score, qualitative };
}
```

- [ ] **Step 4: `packages/shared/src/games/registry.ts`**

```ts
import type { PlayerId } from "../types.js";
import {
  scoreSyncAnswer,
  type GameScore,
  type SyncAnswerConfig,
  type SyncAnswerInput,
} from "./sync-answer.js";
import {
  scorePartnerQuiz,
  type PartnerQuizConfig,
  type PartnerQuizInput,
} from "./partner-quiz.js";
import {
  scoreTimingSync,
  type TimingSyncConfig,
  type TimingSyncInput,
} from "./timing-sync.js";

export type GameId = "sync-answer" | "partner-quiz" | "timing-sync";

export type CurrentGame =
  | { gameId: "sync-answer"; perPlayerConfigs: Record<PlayerId, SyncAnswerConfig> }
  | { gameId: "partner-quiz"; perPlayerConfigs: Record<PlayerId, PartnerQuizConfig> }
  | { gameId: "timing-sync"; perPlayerConfigs: Record<PlayerId, TimingSyncConfig> };

export type GameInput =
  | { gameId: "sync-answer"; payload: SyncAnswerInput }
  | { gameId: "partner-quiz"; payload: PartnerQuizInput }
  | { gameId: "timing-sync"; payload: TimingSyncInput };

/**
 * gameId ごとの scoreFn をランタイム統一形で呼べるようにしたラッパ。
 * 呼び出し側 (Orchestrator) は CurrentGame とプレイヤ入力 (payload の記録) を渡すだけ。
 */
export function scoreGame(
  current: CurrentGame,
  inputs: Partial<Record<PlayerId, unknown>>,
): GameScore {
  switch (current.gameId) {
    case "sync-answer":
      return scoreSyncAnswer(
        current.perPlayerConfigs,
        inputs as Partial<Record<PlayerId, SyncAnswerInput>>,
      );
    case "partner-quiz":
      return scorePartnerQuiz(
        current.perPlayerConfigs,
        inputs as Partial<Record<PlayerId, PartnerQuizInput>>,
      );
    case "timing-sync":
      return scoreTimingSync(
        current.perPlayerConfigs,
        inputs as Partial<Record<PlayerId, TimingSyncInput>>,
      );
  }
}

export const GAME_IDS: readonly GameId[] = ["sync-answer", "partner-quiz", "timing-sync"] as const;
```

- [ ] **Step 5: `packages/shared/src/games/index.ts`**

```ts
export * from "./sync-answer.js";
export * from "./partner-quiz.js";
export * from "./timing-sync.js";
export * from "./registry.js";
```

- [ ] **Step 6: `packages/shared/src/index.ts` に追記**

```ts
export * from "./types.js";
export * from "./machine.js";
export * from "./round-durations.js";
export * from "./games/index.js";
```

- [ ] **Step 7: 型チェック**

Run: `pnpm --filter @app/shared typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/games packages/shared/src/index.ts
git commit -m "feat(shared): game registry — sync-answer / partner-quiz / timing-sync"
```

---

## Task 2: shared/machine — `currentGame` context + `ROUND_READY` payload

**Files:**
- Modify: `packages/shared/src/types.ts` (`SessionSnapshot` に `currentGame` 追加)
- Modify: `packages/shared/src/machine.ts` (`SessionContext.currentGame` + `applyGame` action + event payload)
- Modify: `packages/shared/test/machine.test.ts` (既存 9 tests を新 API に追従)

- [ ] **Step 1: `types.ts` 末尾に追記 (既存は触らない)**

末尾に:

```ts
import type { CurrentGame } from "./games/registry.js";

export type { CurrentGame };
```

そして `SessionSnapshot` を以下で**置換**:

```ts
export interface SessionSnapshot {
  state: SessionStateName;
  currentRound: RoundNumber | null;
  currentGame: CurrentGame | null;
  setup: SetupData | null;
  scores: Record<RoundNumber, number | null>;
  qualitativeEvals: Record<RoundNumber, string | null>;
  finalVerdict: string | null;
}
```

> `PlayerInput` の payload は **既存の `unknown` のまま**。詳細化は Task 4 (orchestrator 側で `GameInput` に narrow) で行う。

- [ ] **Step 2: `machine.ts` を更新**

(a) `SessionContext` に `currentGame` を追加。`initialContext` も合わせて更新:

```ts
import type { CurrentGame } from "./games/registry.js";
import type { PlayerId } from "./types.js";

export interface SessionContext {
  setup: SetupData | null;
  currentRound: RoundNumber | null;
  currentGame: CurrentGame | null;
  scores: Record<RoundNumber, number | null>;
  qualitativeEvals: Record<RoundNumber, string | null>;
  finalVerdict: string | null;
}

const initialContext: SessionContext = {
  setup: null,
  currentRound: null,
  currentGame: null,
  scores: { 1: null, 2: null, 3: null },
  qualitativeEvals: { 1: null, 2: null, 3: null },
  finalVerdict: null,
};
```

(b) `SessionEvent` の `ROUND_READY` を payload 付きに変更:

```ts
export type SessionEvent =
  | { type: "START" }
  | { type: "SETUP_DONE"; data: SetupData }
  | {
      type: "ROUND_READY";
      gameId: CurrentGame["gameId"];
      perPlayerConfigs: CurrentGame["perPlayerConfigs"];
    }
  | { type: "ROUND_COMPLETE"; score: number; qualitative: string }
  | { type: "NEXT_ROUND" }
  | { type: "SESSION_DONE"; verdict: string }
  | { type: "RESET" };
```

> TypeScript 的には `CurrentGame` の `gameId` + `perPlayerConfigs` の関係が discriminated union なので、上のように ROUND_READY の `gameId` と `perPlayerConfigs` を並列で書くと type check が緩くなる (「sync-answer のくせに partner-quiz の config」を通してしまう)。**実用優先** でこのまま進める (ユーザ入力ではなく orchestrator が組み立てるので誤ったペアにならない)。厳密化したい場合は `{ type: "ROUND_READY"; game: CurrentGame }` のように 1 ペアにまとめて event を作る代替案がある。

(c) `actions` に `applyGame` を追加し、`roundLoading → roundPlaying` 遷移で実行:

```ts
  actions: {
    applySetup: assign(({ event }) => {
      if (event.type !== "SETUP_DONE") return {};
      return { setup: event.data, currentRound: 1 as RoundNumber };
    }),
    applyGame: assign(({ event }) => {
      if (event.type !== "ROUND_READY") return {};
      return {
        currentGame: {
          gameId: event.gameId,
          perPlayerConfigs: event.perPlayerConfigs,
        } as CurrentGame,
      };
    }),
    recordRound: assign(({ context, event }) => { /* 既存のまま */ }),
    // ...残り既存のまま
  },
```

(d) `roundLoading` の `on: { ROUND_READY: "roundPlaying" }` を **action 付き** に変更:

```ts
roundLoading: {
  on: {
    ROUND_READY: {
      target: "roundPlaying",
      actions: "applyGame",
    },
  },
},
```

(e) `snapshotToDTO` を更新して `currentGame` を含める:

```ts
export function snapshotToDTO(snap: AnyActorSnapshot): SessionSnapshot {
  const ctx = snap.context;
  return {
    state: flattenValue(snap.value),
    currentRound: ctx.currentRound,
    currentGame: ctx.currentGame,
    setup: ctx.setup,
    scores: ctx.scores,
    qualitativeEvals: ctx.qualitativeEvals,
    finalVerdict: ctx.finalVerdict,
  };
}
```

- [ ] **Step 3: 既存 machine.test.ts を新 API に追従**

`ROUND_READY` を送っている箇所を全て payload 付きに変える。ヘルパを追加:

```ts
import type { CurrentGame } from "../src/index.js";

function mockSyncAnswerEvent() {
  return {
    type: "ROUND_READY" as const,
    gameId: "sync-answer" as const,
    perPlayerConfigs: {
      A: { question: "Q", choices: ["a", "b", "c", "d"] as [string, string, string, string] },
      B: { question: "Q", choices: ["a", "b", "c", "d"] as [string, string, string, string] },
    },
  };
}
```

そして `actor.send({ type: "ROUND_READY" })` を **すべて** `actor.send(mockSyncAnswerEvent())` に置換。対象は以下のテスト:

- `"round cycle: loading -> playing -> result -> next loading"`
- `"NEXT_ROUND from round 3 is blocked by guard (stays in roundResult)"`
- `"SESSION_DONE from roundResult goes to totalResult"`
- `"totalResult -> waiting on RESET (and state resets)"`

加えて、新規テストを追加:

```ts
describe("applyGame action", () => {
  it("assigns currentGame on ROUND_READY", () => {
    const actor = createActor(sessionMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SETUP_DONE", data: setupData() });
    expect(actor.getSnapshot().context.currentGame).toBeNull();
    actor.send(mockSyncAnswerEvent());
    const g = actor.getSnapshot().context.currentGame;
    expect(g?.gameId).toBe("sync-answer");
    expect(g?.perPlayerConfigs.A.question).toBe("Q");
  });

  it("RESET clears currentGame", () => {
    const actor = createActor(sessionMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SETUP_DONE", data: setupData() });
    actor.send(mockSyncAnswerEvent());
    actor.send({ type: "ROUND_COMPLETE", score: 50, qualitative: "x" });
    for (const n of [2, 3]) {
      actor.send({ type: "NEXT_ROUND" });
      actor.send(mockSyncAnswerEvent());
      actor.send({ type: "ROUND_COMPLETE", score: n, qualitative: "x" });
    }
    actor.send({ type: "SESSION_DONE", verdict: "ok" });
    actor.send({ type: "RESET" });
    expect(actor.getSnapshot().context.currentGame).toBeNull();
  });
});

describe("snapshotToDTO currentGame passthrough", () => {
  it("reflects currentGame in DTO after ROUND_READY", () => {
    const actor = createActor(sessionMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SETUP_DONE", data: setupData() });
    actor.send(mockSyncAnswerEvent());
    const dto = snapshotToDTO(actor.getSnapshot());
    expect(dto.currentGame?.gameId).toBe("sync-answer");
  });
});
```

- [ ] **Step 4: `pnpm --filter @app/shared test` で 11+ tests がグリーン**

Expected: 既存 9 tests 全部 pass + 新規 3 tests 追加 (計 12 passing)。

- [ ] **Step 5: 型チェック**

Run: `pnpm --filter @app/shared typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/machine.ts packages/shared/test/machine.test.ts
git commit -m "feat(shared): currentGame context + ROUND_READY payload + applyGame"
```

---

## Task 3: server/orchestrator — 入力バッファ + scoreFn 駆動 + mock 更新

**Files:**
- Modify: `packages/server/src/orchestrator/index.ts`
- Modify: `packages/server/src/orchestrator/mock.ts` (mockQualitative 削除 + pickGameForRound / genPerPlayerConfigs 追加)
- Modify: `packages/server/test/orchestrator.test.ts` (既存 5 tests + 新規 player-input 完了テスト 2)

### Step 1: `packages/server/src/orchestrator/mock.ts` を全置換

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

export function mockVerdict(
  scores: Record<RoundNumber, number | null>,
): string {
  const total = (scores[1] ?? 0) + (scores[2] ?? 0) + (scores[3] ?? 0);
  if (total >= 250) return "運命の相手！";
  if (total >= 200) return "とても相性が良いです";
  if (total >= 150) return "悪くない関係ですね";
  return "まだまだこれから！";
}

/** Phase 4 固定ローテーション: R1=sync-answer, R2=partner-quiz, R3=timing-sync。
 * Phase 5 で Gemini に「関係性から 3 ゲーム選んで」と依頼する形に置き換わる。*/
export function pickGameForRound(round: RoundNumber): GameId {
  switch (round) {
    case 1:
      return "sync-answer";
    case 2:
      return "partner-quiz";
    case 3:
      return "timing-sync";
  }
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

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function genPerPlayerConfigs(
  gameId: GameId,
  setup: SetupData,
): CurrentGame {
  switch (gameId) {
    case "sync-answer": {
      const q = pick(syncAnswerPool);
      const cfg: SyncAnswerConfig = { question: q.question, choices: q.choices };
      return {
        gameId: "sync-answer",
        perPlayerConfigs: { A: cfg, B: cfg },
      };
    }
    case "partner-quiz": {
      const q = pick(partnerQuizPool);
      const target: PlayerId = Math.random() < 0.5 ? "A" : "B";
      const targetName = setup.players[target].name;
      const cfg: PartnerQuizConfig = {
        target,
        targetName,
        question: q.question,
        choices: q.choices,
      };
      return {
        gameId: "partner-quiz",
        perPlayerConfigs: { A: cfg, B: cfg },
      };
    }
    case "timing-sync": {
      const cfg: TimingSyncConfig = { instruction: "2人同時にタップ！" };
      return {
        gameId: "timing-sync",
        perPlayerConfigs: { A: cfg, B: cfg },
      };
    }
  }
}
```

> Phase 3 の `mockScore()` / `mockQualitative()` を削除し (scoreFn が両方返す)、`pickGameForRound` / `genPerPlayerConfigs` / `mockVerdict` の 3 関数に絞る。

### Step 2: `packages/server/src/orchestrator/index.ts` を更新

主な変更点: (a) onState で roundLoading 発火時に game を決める、(b) roundPlaying 開始時に inputs バッファをクリア、(c) `onPlayerInput` メソッド追加、(d) 完了時は `scoreGame(registry)` を呼ぶ。

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
import { realScheduler, type Scheduler } from "./scheduler.js";
import {
  genPerPlayerConfigs,
  mockVerdict,
  pickGameForRound,
} from "./mock.js";

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

  /** 現在ラウンドのプレイヤー入力 payload を蓄積する。roundPlaying エントリ時にクリア。*/
  private inputs: Partial<Record<PlayerId, unknown>> = {};

  constructor(
    private runtime: SessionRuntime,
    private scheduler: Scheduler = realScheduler,
    private durations: OrchestratorDurations = durationsFromEnv(),
  ) {}

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
  }

  /** ws.ts から forward される。roundPlaying 以外は無視。両者揃ったら即 complete。*/
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
      this.completeRound(snap.currentGame);
    }
  }

  private completeRound(current: CurrentGame): void {
    const { score, qualitative } = scoreGame(current, this.inputs);
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
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundLoadingMs,
          () => this.emitRoundReady(),
        );
        return;
      case "roundPlaying":
        // ROUND_READY 側で currentGame が context にセットされている前提
        this.inputs = {};
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundPlayingMs,
          () => {
            const cur = this.runtime.get().currentGame;
            if (!cur) return;
            this.completeRound(cur);
          },
        );
        return;
      case "roundResult": {
        const round: RoundNumber | null = snap.currentRound;
        this.cancelPending = this.scheduler.schedule(
          this.durations.roundResultMs,
          () => {
            if (round === null || round === 3) {
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
        return;
    }
  }

  private emitRoundReady(): void {
    const snap = this.runtime.get();
    if (!snap.setup || snap.currentRound === null) return;
    const gameId = pickGameForRound(snap.currentRound);
    const game = genPerPlayerConfigs(gameId, snap.setup);
    this.runtime.send({
      type: "ROUND_READY",
      gameId: game.gameId,
      perPlayerConfigs: game.perPlayerConfigs,
    });
  }
}
```

### Step 3: `orchestrator.test.ts` を更新

既存 5 tests の `full cycle` や assertion を以下の通り調整:

(a) `setupData()` はそのまま。

(b) すべての `rt.send({ type: "SETUP_DONE", data: setupData() })` 後の `sched.runAll()` の振る舞いは、ROUND_READY の payload が orchestrator 内で組み立てられる関係で既存と互換 — テスト側では変化なし。

(c) 新規テスト追加: 両プレイヤー入力揃えばタイマ待たずに roundResult に遷移。

```ts
it("completes a round immediately when both players submit input", () => {
  rt.send({ type: "START" });
  rt.send({ type: "SETUP_DONE", data: setupData() });
  sched.runAll(); // roundLoading timer -> ROUND_READY -> roundPlaying
  expect(rt.get().state).toBe("roundPlaying");
  const current = rt.get().currentGame;
  expect(current?.gameId).toBe("sync-answer");

  // 両者 input: sync-answer の場合は { choice: 0..3 }
  orch.onPlayerInput("A", {
    round: 1,
    gameId: current!.gameId,
    payload: { choice: 0 },
  });
  expect(rt.get().state).toBe("roundPlaying"); // 1人だけではまだ
  orch.onPlayerInput("B", {
    round: 1,
    gameId: current!.gameId,
    payload: { choice: 0 },
  });
  expect(rt.get().state).toBe("roundResult");
  expect(rt.get().scores[1]).toBe(100); // 同じ choice なら 100
  expect(rt.get().qualitativeEvals[1]).toBeTypeOf("string");
  // 旧 timer は cancel されているはずなので pending も 1 本 (roundResult の timer) だけ
  expect(sched.pendingCount).toBe(1);
});

it("completes a round with partial input on timeout", () => {
  rt.send({ type: "START" });
  rt.send({ type: "SETUP_DONE", data: setupData() });
  sched.runAll(); // -> roundPlaying
  const current = rt.get().currentGame!;
  orch.onPlayerInput("A", {
    round: 1,
    gameId: current.gameId,
    payload: { choice: 2 },
  });
  // B が入れないままタイムアップ
  sched.runAll();
  expect(rt.get().state).toBe("roundResult");
  expect(rt.get().scores[1]).toBe(0); // 片方だけなので scoreFn の fallback
});
```

(d) 既存テスト `"runs a full 3-round cycle to totalResult"` の内部ループ回数は **9 のまま**:
- roundLoading → roundPlaying (1 schedule, 内部で ROUND_READY 発火)
- roundPlaying → roundResult (1 schedule)
- roundResult → roundLoading (1 schedule)
- × 3 ラウンド (9 schedule) 最後は SESSION_DONE で totalResult

`scores[1..3] !== null` の assertion は、`sync-answer` の 100 or 0 を両方とも片方 input で 0 が返る形に落ち着く (両者とも input なし → 0、qualitative "操作が間に合いませんでした…")。現状の machine は `ROUND_COMPLETE` の score を context に assign するので、`scores[1..3]` に数値 0 が入り `toBeNull()` ではなく **non-null** として assertion されている — そのまま通る。

### Step 4: `pnpm --filter @app/server test orchestrator` で 7 tests pass

Run `pnpm --filter @app/server test orchestrator`
Expected: 既存 5 + 新規 2 = 7 pass.

### Step 5: 型チェック

Run: `pnpm --filter @app/server typecheck`
Expected: clean.

### Step 6: Commit

```bash
git add packages/server/src/orchestrator packages/server/test/orchestrator.test.ts
git commit -m "feat(server): Orchestrator handles player:input + game-specific scoring"
```

---

## Task 4: server/ws — `player:input` を Orchestrator に forward

**Files:**
- Modify: `packages/server/src/ws.ts`
- Modify: `packages/server/test/ws.test.ts` (forward 契約テスト追加)

### Step 1: `ws.ts` の attachSocketIo シグネチャに orchestrator を追加

```ts
import type { Orchestrator } from "./orchestrator/index.js";

export function attachSocketIo(
  httpServer: HttpServer,
  runtime: SessionRuntime,
  orchestrator: Orchestrator | null = null,
): AttachedIo {
  // ...既存のまま、nsp.on("connection", (socket) => { ... }) 内の player:input ハンドラを差し替え:

    socket.on("player:input", (input: PlayerInput) => {
      if (socket.data.role !== "player") return;
      const id = socket.data.playerId as PlayerId | null;
      if (!id) return;
      orchestrator?.onPlayerInput(id, input);
    });
  // ...
}
```

### Step 2: `app.ts` は既に orchestrator を保持している。`index.ts` で attachSocketIo に渡す

`packages/server/src/index.ts`:

```ts
await app.ready();
attachSocketIo(app.server, app.sessionRuntime, app.orchestrator);
```

もし app.ts に `app.decorate("orchestrator", ...)` が無ければ追加する:

`packages/server/src/app.ts` の `buildApp` 内:

```ts
  app.decorate("sessionRuntime", runtime);
  app.decorate("orchestrator", orchestrator); // 追加

  // ...

declare module "fastify" {
  interface FastifyInstance {
    sessionRuntime: SessionRuntime;
    orchestrator: Orchestrator | null; // 追加
  }
}
```

### Step 3: `ws.test.ts` に forward 契約テストを追加

既存 describe 末尾 (rejects...の前) に:

```ts
it("forwards player:input to orchestrator.onPlayerInput", async () => {
  // テスト専用 Orchestrator モック
  const calls: Array<{ id: string; input: unknown }> = [];
  const fakeOrch = {
    onPlayerInput(id: string, input: unknown) {
      calls.push({ id, input });
    },
  } as unknown as Parameters<typeof attachSocketIo>[2];

  // local app でないと全体と干渉するのでテスト内で個別 boot
  await app.close();
  app = buildApp({ orchestrator: null }); // built-in を無効化して外側で attach
  await app.ready();
  attachSocketIo(app.server, app.sessionRuntime, fakeOrch);
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  const { port } = app.server.address() as import("node:net").AddressInfo;
  address = `http://localhost:${port}`;

  const playerA = connectClient("player", "A");
  await nextState(playerA);
  playerA.emit("player:input", {
    round: 1,
    gameId: "sync-answer",
    payload: { choice: 1 },
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(calls).toHaveLength(1);
  expect(calls[0].id).toBe("A");
  playerA.close();
});

it("ignores player:input from intro role", async () => {
  const calls: Array<{ id: string; input: unknown }> = [];
  const fakeOrch = {
    onPlayerInput() {
      calls.push({ id: "unexpected", input: null });
    },
  } as unknown as Parameters<typeof attachSocketIo>[2];

  await app.close();
  app = buildApp({ orchestrator: null });
  await app.ready();
  attachSocketIo(app.server, app.sessionRuntime, fakeOrch);
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  const { port } = app.server.address() as import("node:net").AddressInfo;
  address = `http://localhost:${port}`;

  const intro = connectClient("intro");
  await nextState(intro);
  intro.emit("player:input" as "client:event", {
    round: 1,
    gameId: "sync-answer",
    payload: { choice: 1 },
  } as unknown as import("@app/shared").ClientEvent);
  await new Promise((r) => setTimeout(r, 50));
  expect(calls).toHaveLength(0);
  intro.close();
});
```

> intro からの player:input emit は `ClientToServerEvents` 型的には弾かれるが、テストで無理矢理キャストして「壊れた client が送ってきた場合」の防御を確認する。

### Step 4: Run tests

Run: `pnpm --filter @app/server test ws`
Expected: 既存 6 + 新規 2 = 8 pass.

### Step 5: Commit

```bash
git add packages/server/src/ws.ts packages/server/src/app.ts packages/server/src/index.ts packages/server/test/ws.test.ts
git commit -m "feat(server): WS forwards player:input to Orchestrator.onPlayerInput"
```

---

## Task 5: web/games — 3 ゲームコンポーネント本体

**Files:**
- Create: `packages/web/src/games/SyncAnswerGame.tsx`
- Create: `packages/web/src/games/PartnerQuizGame.tsx`
- Create: `packages/web/src/games/TimingSyncGame.tsx`
- Modify: `packages/web/src/styles.css` (ゲーム UI クラス群)

共通の型:
```ts
import type {
  PlayerId,
  SyncAnswerConfig,
  SyncAnswerInput,
  PartnerQuizConfig,
  PartnerQuizInput,
  TimingSyncConfig,
  TimingSyncInput,
} from "@app/shared";
```

### Step 1: `packages/web/src/games/SyncAnswerGame.tsx`

```tsx
import { useState } from "react";
import type { SyncAnswerConfig, SyncAnswerInput } from "@app/shared";

interface Props {
  config: SyncAnswerConfig;
  onSubmit: (input: SyncAnswerInput) => void;
}

export function SyncAnswerGame({ config, onSubmit }: Props) {
  const [picked, setPicked] = useState<number | null>(null);

  function handlePick(i: 0 | 1 | 2 | 3) {
    if (picked !== null) return;
    setPicked(i);
    onSubmit({ choice: i });
  }

  return (
    <main className="game sync-answer">
      <p className="game-question">{config.question}</p>
      <div className="choices">
        {config.choices.map((c, i) => (
          <button
            key={i}
            type="button"
            className={`choice ${picked === i ? "picked" : ""}`}
            disabled={picked !== null}
            onPointerDown={() => handlePick(i as 0 | 1 | 2 | 3)}
          >
            {c}
          </button>
        ))}
      </div>
      {picked !== null && (
        <p className="game-wait">相方の回答を待っています…</p>
      )}
    </main>
  );
}
```

### Step 2: `packages/web/src/games/PartnerQuizGame.tsx`

```tsx
import { useState } from "react";
import type { PlayerId, PartnerQuizConfig, PartnerQuizInput } from "@app/shared";

interface Props {
  playerId: PlayerId;
  config: PartnerQuizConfig;
  onSubmit: (input: PartnerQuizInput) => void;
}

export function PartnerQuizGame({ playerId, config, onSubmit }: Props) {
  const [picked, setPicked] = useState<number | null>(null);

  function handlePick(i: 0 | 1 | 2 | 3) {
    if (picked !== null) return;
    setPicked(i);
    onSubmit({ choice: i });
  }

  const heading =
    config.target === playerId
      ? `あなた自身の「${config.question}」を選んでください`
      : `${config.targetName} の「${config.question}」を当ててください`;

  return (
    <main className="game partner-quiz">
      <p className="game-prompt">{heading}</p>
      <div className="choices">
        {config.choices.map((c, i) => (
          <button
            key={i}
            type="button"
            className={`choice ${picked === i ? "picked" : ""}`}
            disabled={picked !== null}
            onPointerDown={() => handlePick(i as 0 | 1 | 2 | 3)}
          >
            {c}
          </button>
        ))}
      </div>
      {picked !== null && (
        <p className="game-wait">相方の回答を待っています…</p>
      )}
    </main>
  );
}
```

### Step 3: `packages/web/src/games/TimingSyncGame.tsx`

```tsx
import { useState } from "react";
import type { TimingSyncConfig, TimingSyncInput } from "@app/shared";

interface Props {
  config: TimingSyncConfig;
  onSubmit: (input: TimingSyncInput) => void;
}

export function TimingSyncGame({ config, onSubmit }: Props) {
  const [tapped, setTapped] = useState<boolean>(false);

  function handleTap() {
    if (tapped) return;
    setTapped(true);
    onSubmit({ tapTime: Date.now() });
  }

  return (
    <main className="game timing-sync">
      <p className="game-prompt">{config.instruction}</p>
      <button
        type="button"
        className={`tap-button ${tapped ? "tapped" : ""}`}
        disabled={tapped}
        onPointerDown={handleTap}
      >
        {tapped ? "タップ完了" : "TAP!"}
      </button>
      {tapped && <p className="game-wait">相方の操作を待っています…</p>}
    </main>
  );
}
```

### Step 4: `styles.css` 末尾に追記

```css
/* ---------------- Game (Phase 4 共通) ---------------- */
.game {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 32px;
  padding: 40px;
  min-height: 100vh;
  background: linear-gradient(180deg, #141428, #0a0a14);
  color: white;
  text-align: center;
}
.game-question,
.game-prompt {
  font-size: clamp(28px, 4vw, 48px);
  margin: 0;
  max-width: 1400px;
  line-height: 1.4;
}
.game-wait {
  color: #9ae;
  font-size: 20px;
  animation: pulse 1.2s ease-in-out infinite;
}
.choices {
  display: grid;
  grid-template-columns: repeat(2, minmax(200px, 1fr));
  gap: 24px;
  width: 100%;
  max-width: 900px;
}
.choice {
  font-size: clamp(24px, 3vw, 36px);
  padding: 24px 16px;
  border-radius: 16px;
  border: 2px solid #334;
  background: #1e1e32;
  color: white;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-touch-callout: none;
  transition: transform 120ms ease, background 120ms ease;
}
.choice:active { transform: scale(0.97); }
.choice.picked {
  background: #7a5aff;
  border-color: #ffde6b;
}
.choice:disabled:not(.picked) { opacity: 0.5; }

.tap-button {
  font-size: clamp(48px, 8vw, 96px);
  padding: 32px 96px;
  border-radius: 999px;
  background: #ff7a59;
  color: white;
  border: none;
  cursor: pointer;
  box-shadow: 0 8px 40px rgba(255, 122, 89, 0.4);
  touch-action: manipulation;
  user-select: none;
  -webkit-touch-callout: none;
  transition: transform 80ms ease;
}
.tap-button:active { transform: scale(0.93); }
.tap-button.tapped { background: #555; box-shadow: none; }
```

### Step 5: typecheck + build

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web build`
Expected: clean.

### Step 6: Commit

```bash
git add packages/web/src/games packages/web/src/styles.css
git commit -m "feat(web): 3 game components (sync-answer / partner-quiz / timing-sync)"
```

---

## Task 6: web/GameView dispatch + Player.tsx wiring

**Files:**
- Modify: `packages/web/src/views/player/GameView.tsx`
- Modify: `packages/web/src/routes/Player.tsx`
- Modify: `packages/web/src/net/socket.ts` (type-safe player:input helper)

### Step 1: `packages/web/src/net/socket.ts` に emit helper を追加

既存の connect* 関数の後に:

```ts
import type { GameInput, PlayerId, PlayerInput, RoundNumber } from "@app/shared";

/** GameInput の discriminated union を受け取り、round と共に player:input を発射する helper。*/
export function emitPlayerInput(
  socket: AppSocket,
  round: RoundNumber,
  game: GameInput,
): void {
  const payload: PlayerInput = {
    round,
    gameId: game.gameId,
    payload: game.payload,
  };
  socket.emit("player:input", payload);
}
```

### Step 2: `GameView.tsx` を dispatcher に置換

```tsx
import type { CurrentGame, PlayerId, RoundNumber } from "@app/shared";
import { SyncAnswerGame } from "../../games/SyncAnswerGame.js";
import { PartnerQuizGame } from "../../games/PartnerQuizGame.js";
import { TimingSyncGame } from "../../games/TimingSyncGame.js";

interface Props {
  playerId: PlayerId;
  round: RoundNumber | null;
  currentGame: CurrentGame | null;
  onSyncAnswer: (choice: 0 | 1 | 2 | 3) => void;
  onPartnerQuiz: (choice: 0 | 1 | 2 | 3) => void;
  onTimingSync: (tapTime: number) => void;
}

export function GameView({
  playerId,
  round,
  currentGame,
  onSyncAnswer,
  onPartnerQuiz,
  onTimingSync,
}: Props) {
  if (!currentGame || round === null) {
    return (
      <main className="player-stub">
        <h1>Round 準備中…</h1>
      </main>
    );
  }

  switch (currentGame.gameId) {
    case "sync-answer":
      return (
        <SyncAnswerGame
          config={currentGame.perPlayerConfigs[playerId]}
          onSubmit={(i) => onSyncAnswer(i.choice)}
        />
      );
    case "partner-quiz":
      return (
        <PartnerQuizGame
          playerId={playerId}
          config={currentGame.perPlayerConfigs[playerId]}
          onSubmit={(i) => onPartnerQuiz(i.choice)}
        />
      );
    case "timing-sync":
      return (
        <TimingSyncGame
          config={currentGame.perPlayerConfigs[playerId]}
          onSubmit={(i) => onTimingSync(i.tapTime)}
        />
      );
  }
}
```

> Props を callback に分けているのは、Player.tsx から socket emit をまとめやすくするため。

### Step 3: `Player.tsx` を更新して GameView に新 props を渡す

`case "roundPlaying"` 部分を以下に差し替え:

```tsx
case "roundPlaying": {
  const r = snap.currentRound;
  return (
    <GameView
      playerId={playerId}
      round={r}
      currentGame={snap.currentGame}
      onSyncAnswer={(choice) =>
        r !== null &&
        socketRef.current &&
        emitPlayerInput(socketRef.current, r, {
          gameId: "sync-answer",
          payload: { choice },
        })
      }
      onPartnerQuiz={(choice) =>
        r !== null &&
        socketRef.current &&
        emitPlayerInput(socketRef.current, r, {
          gameId: "partner-quiz",
          payload: { choice },
        })
      }
      onTimingSync={(tapTime) =>
        r !== null &&
        socketRef.current &&
        emitPlayerInput(socketRef.current, r, {
          gameId: "timing-sync",
          payload: { tapTime },
        })
      }
    />
  );
}
```

そして `socketRef` を保持する変更を併せて加える (Intro.tsx と同様の useRef パターン)。現状の Player.tsx は socket をローカル変数で握って close だけしているので、useRef に切り替え、かつ emit でも使えるようにする。

既存の useEffect 部分を差し替え:

```tsx
import { useEffect, useRef, useState } from "react";
// ... 既存 imports ...
import { type AppSocket, connectPlayerSocket, emitPlayerInput } from "../net/socket.js";

export function Player() {
  useViewport("width=1920, initial-scale=1.0");
  // ...既存の useSearchParams / playerId 判定...

  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const socketRef = useRef<AppSocket | null>(null);

  useEffect(() => {
    if (!playerId) {
      setErr("?id=A または ?id=B のクエリが必要です");
      return;
    }
    const s = connectPlayerSocket(playerId);
    socketRef.current = s;
    s.on("session:state", setSnap);
    s.on("connect_error", (e) => setErr(String(e)));
    return () => {
      s.close();
      socketRef.current = null;
    };
  }, [playerId]);

  // ... 既存の switch (snap.state) ...
}
```

### Step 4: typecheck + build

Run: `pnpm --filter @app/web typecheck && pnpm --filter @app/web build`
Expected: clean.

### Step 5: Commit

```bash
git add packages/web/src/views/player/GameView.tsx packages/web/src/routes/Player.tsx packages/web/src/net/socket.ts
git commit -m "feat(web): GameView dispatches by gameId + Player wires player:input"
```

---

## Task 7: E2E 手動スモーク + 最終レビュー

### Step 1: 全テスト + 型チェック

Run: `pnpm -r test && pnpm -r typecheck`
Expected: machine 12 + orchestrator 7 + ws 8 + app 3 + session-runtime 4 = **34 tests** pass, typecheck clean.

### Step 2: short-duration で起動

`packages/server/.env` に:

```
ORCHESTRATOR_ROUND_LOADING_MS=1000
ORCHESTRATOR_ROUND_PLAYING_MS=15000
ORCHESTRATOR_ROUND_RESULT_MS=3000
```

ターミナル1: `pnpm --filter @app/server dev`
ターミナル2: `pnpm --filter @app/web dev`

### Step 3: 3 ブラウザで確認

1. intro (`/`), player A (`/player?id=A`), player B (`/player?id=B`) を開く。
2. intro で START → Setup フォーム 3 項目埋めて送信。
3. **1s 後**: player A/B に **sync-answer** (同じ質問と 4 択) が出る。intro は Guide "Round 1 プレイ中…"。
4. 2 人が **同じ選択肢** をタップ → 即 roundResult (score=100 + "シンクロしました")。
5. **3s 後**: Round 2 roundLoading → (1s 後) **partner-quiz**。intro "Round 2 ゲーム選出中…" → "Round 2 プレイ中…"。
6. player A が回答、player B が 15s 以内に回答しない → タイムアップで roundResult (score=0)。
7. Round 3 = **timing-sync**: 2 人がほぼ同時にタップ → 高スコア。
8. 全部終わると totalResult に 3 ラウンドの実スコア + 診断が出る。
9. intro の **RESET** で waiting に戻り、再度最初から。

### Step 4: 最終レビュー dispatch

Phase 1/2/3 と同じく `superpowers:code-reviewer` subagent を投げる。確認点:
- shared/games: 3 ゲームの scoreFn が欠落入力を fallback 0 で扱えているか
- machine: `applyGame` は `ROUND_READY` の payload を過不足なく context に載せるか
- orchestrator: `onPlayerInput` の guard (`state !== "roundPlaying"`, gameId mismatch, round mismatch) が十分か
- ws: `player:input` を intro 送信で拒否するガードの動作
- web: GameView のフォールバック (currentGame が null / playerId が target でない時の partner-quiz 表示)、Chrome 84 対応 (`pointerdown`, `touch-action: manipulation`, `user-select: none`, 新 .game スタイルに禁則 CSS なし)

### Step 5: レビュー指摘が critical なら修正コミット、minor なら Phase 5 に持ち越し可。

---

## Self-Review (本計画の最終確認)

Phase 4 完了時点で達成されていること:
- ゲーム 3 種の UI + scoring ロジック + 選択抽選 mock が機能し、ラウンドが **プレイヤー入力駆動** でも **タイムアップ駆動** でも完結する。
- `SessionContext.currentGame` + `session:state` broadcast で各プレイヤーに config が届き、`GameView` が `gameId` で正しいコンポーネントを dispatch する。
- `player:input` が server まで届き、`Orchestrator.onPlayerInput` に forward → scoreFn (`scoreGame`) を呼んで `ROUND_COMPLETE` を emit する。
- Phase 3 の `mockQualitative()` は使われなくなった (各 scoreFn が qualitative を返す)。Phase 5 の `ai/gemini.ts` は現在の orchestrator/mock.ts の `pickGameForRound` / `genPerPlayerConfigs` / `mockVerdict` と scoreFn の "qualitative 生成" を差し替える対象。

Phase 5 で着手する範囲 (完了後に `05-ai-gemini.md` を書く):
- `@google/genai` を server に追加、`GEMINI_API_KEY` env
- `ai/gemini.ts`:
  - `selectGamesForRelationship(setup): GameId[]` (3 ラウンド分)
  - `generatePerPlayerConfigs(gameId, setup): CurrentGame` (mock を置き換え)
  - `refineQualitative(gameId, inputs, score): string` (scoreFn の qualitative 上書き、オプショナル)
  - `generateVerdict(snap): string` (mockVerdict を置き換え)
- Orchestrator が mock ではなく AI を呼ぶよう差し替え (関数 signature は互換なので hot-swap)
- AI 応答の JSON schema を固定、失敗時フォールバックを mock に戻す

Phase 6 で MIDI BGM、そして hackathon 用のデモ調整。
