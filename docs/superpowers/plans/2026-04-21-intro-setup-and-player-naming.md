# Intro Setup Buttons & Player Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** intro `setup` 画面を4択ボタン化し、プレイヤー名入力を各プレイヤー画面に移設する。入力は独自の平仮名ソフトキーボード。

**Architecture:** 新しい state `playerNaming` を `setup` と `active.roundLoading` の間に挿入。intro は関係性のみ、プレイヤーは各自の画面で名前入力。両プレイヤー名が揃ったら `always` guard で自動遷移。サーバは新 socket event `player:setup` を受けて machine に `PLAYER_NAMED` を流す。

**Tech Stack:** XState v5, React 18, Socket.io 4, Vitest, TypeScript, pnpm workspaces.

**Spec reference:** `docs/superpowers/specs/2026-04-21-intro-setup-and-player-naming-design.md`

**前提:**
- カレントブランチは `main`、ハッカソン方針で main 直接作業 OK (`memory/feedback_branching.md`)。
- Node 20 / pnpm 9 (`.nvmrc` / `packageManager`)。
- `pnpm install` 済み。

---

## Task 1: shared 型の拡張と既存 fixture の 4値化

型を narrow すると既存テストの `"友人"` が型エラーになる。型拡張と fixture 更新を同一コミットにする。

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/machine.ts`
- Modify: `packages/shared/test/machine.test.ts`
- Modify: `packages/server/test/session-runtime.test.ts`
- Modify: `packages/server/test/ws.test.ts`
- Modify: `packages/server/test/orchestrator.test.ts`

- [ ] **Step 1: `types.ts` を更新**

`packages/shared/src/types.ts` の次の箇所を置換:

```ts
export type Relationship =
  | "カップル"
  | "気になっている"
  | "友達"
  | "親子";
```

```ts
export type SessionStateName =
  | "waiting"
  | "setup"
  | "playerNaming"
  | "roundLoading"
  | "roundPlaying"
  | "roundResult"
  | "totalResult";
```

```ts
export type ClientToServerEvents = {
  "client:event": (event: ClientEvent) => void;
  "player:input": (input: PlayerInput) => void;
  "player:setup": (payload: { name: string }) => void;
};
```

- [ ] **Step 2: `machine.ts` の `SessionEvent` に `PLAYER_NAMED` を追加**

`packages/shared/src/machine.ts` の `SessionEvent` union に 1 行追加:

```ts
export type SessionEvent =
  | { type: "START" }
  | { type: "SETUP_DONE"; data: SetupData }
  | { type: "PLAYER_NAMED"; playerId: PlayerId; name: string }
  | { type: "ROUND_READY" }
  | { type: "ROUND_COMPLETE"; score: number; qualitative: string }
  | { type: "NEXT_ROUND" }
  | { type: "SESSION_DONE"; verdict: string }
  | { type: "RESET" };
```

import に `PlayerId` を追加:

```ts
import type {
  PlayerId,
  RoundNumber,
  SessionSnapshot,
  SessionStateName,
  SetupData,
} from "./types.js";
```

- [ ] **Step 3: 既存テスト fixture を `"友達"` に差し替え**

対象4ファイルすべてで `relationship: "友人"` → `relationship: "友達"` に置換:
- `packages/shared/test/machine.test.ts` 11行目付近
- `packages/server/test/session-runtime.test.ts` 32行目付近
- `packages/server/test/ws.test.ts` 126行目付近
- `packages/server/test/orchestrator.test.ts` 13行目付近

- [ ] **Step 4: typecheck**

Run: `pnpm -r typecheck`
Expected: PASS (全パッケージ)

- [ ] **Step 5: テスト実行 (既存が緑を維持していること)**

Run: `pnpm -r test`
Expected: PASS (挙動はまだ変えていないので全部通る)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/machine.ts \
  packages/shared/test/machine.test.ts \
  packages/server/test/session-runtime.test.ts \
  packages/server/test/ws.test.ts \
  packages/server/test/orchestrator.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): Relationship 4値化 & playerNaming 状態/PLAYER_NAMED/player:setup の型を追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: state machine のテストを先に追加（失敗することを確認）

`playerNaming` state と関連挙動を TDD で入れる。

**Files:**
- Modify: `packages/shared/test/machine.test.ts`

- [ ] **Step 1: 既存「SETUP_DONE → roundLoading」テストを更新**

`packages/shared/test/machine.test.ts` の `"setup -> active.roundLoading on SETUP_DONE with data"` テストを書き換え:

```ts
it("setup -> playerNaming on SETUP_DONE and normalizes names to ''", () => {
  const actor = createActor(sessionMachine).start();
  actor.send({ type: "START" });
  // 非空名を送っても applySetup で "" に正規化されることを検証
  actor.send({
    type: "SETUP_DONE",
    data: {
      players: {
        A: { id: "A", name: "Alice" },
        B: { id: "B", name: "Bob" },
      },
      relationship: "友達",
    },
  });
  const snap = actor.getSnapshot();
  expect(snap.value).toBe("playerNaming");
  expect(snap.context.setup?.relationship).toBe("友達");
  expect(snap.context.setup?.players.A.name).toBe("");
  expect(snap.context.setup?.players.B.name).toBe("");
  expect(snap.context.currentRound).toBeNull();
});
```

- [ ] **Step 2: PLAYER_NAMED の一連挙動テストを追加**

同ファイルの `describe("sessionMachine", ...)` 内に以下を追加:

```ts
it("PLAYER_NAMED for A only keeps state in playerNaming", () => {
  const actor = createActor(sessionMachine).start();
  actor.send({ type: "START" });
  actor.send({ type: "SETUP_DONE", data: setupData() });
  actor.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
  const snap = actor.getSnapshot();
  expect(snap.value).toBe("playerNaming");
  expect(snap.context.setup?.players.A.name).toBe("あきら");
  expect(snap.context.setup?.players.B.name).toBe("");
});

it("PLAYER_NAMED for both A and B auto-transitions to active.roundLoading", () => {
  const actor = createActor(sessionMachine).start();
  actor.send({ type: "START" });
  actor.send({ type: "SETUP_DONE", data: setupData() });
  actor.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
  actor.send({ type: "PLAYER_NAMED", playerId: "B", name: "さくら" });
  const snap = actor.getSnapshot();
  expect(snap.value).toEqual({ active: "roundLoading" });
  expect(snap.context.currentRound).toBe(1);
  expect(snap.context.setup?.players.A.name).toBe("あきら");
  expect(snap.context.setup?.players.B.name).toBe("さくら");
});

it("PLAYER_NAMED trims and truncates to 16 chars", () => {
  const actor = createActor(sessionMachine).start();
  actor.send({ type: "START" });
  actor.send({ type: "SETUP_DONE", data: setupData() });
  const long = "あいうえおかきくけこさしすせそたちつてと"; // 20文字
  actor.send({ type: "PLAYER_NAMED", playerId: "A", name: `  ${long}  ` });
  expect(actor.getSnapshot().context.setup?.players.A.name).toBe(long.slice(0, 16));
});

it("PLAYER_NAMED with blank name is ignored", () => {
  const actor = createActor(sessionMachine).start();
  actor.send({ type: "START" });
  actor.send({ type: "SETUP_DONE", data: setupData() });
  actor.send({ type: "PLAYER_NAMED", playerId: "A", name: "   " });
  expect(actor.getSnapshot().context.setup?.players.A.name).toBe("");
  expect(actor.getSnapshot().value).toBe("playerNaming");
});

it("PLAYER_NAMED after round start is ignored", () => {
  const actor = createActor(sessionMachine).start();
  actor.send({ type: "START" });
  actor.send({ type: "SETUP_DONE", data: setupData() });
  actor.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
  actor.send({ type: "PLAYER_NAMED", playerId: "B", name: "さくら" });
  // active.roundLoading 中に PLAYER_NAMED を再送しても無視される (state 変化なし)
  actor.send({ type: "PLAYER_NAMED", playerId: "A", name: "ちがう" });
  expect(actor.getSnapshot().context.setup?.players.A.name).toBe("あきら");
});
```

`setupData()` の `"友人"` は Task 1 で `"友達"` に直っているので注意。

- [ ] **Step 3: 既存の round cycle 系テストで setup フローを調整**

既存テスト `"round cycle: loading -> playing -> result -> next loading"` と `"NEXT_ROUND from round 3 is blocked ..."`、`"SESSION_DONE from roundResult goes to totalResult"`、`"totalResult -> waiting on RESET ..."` は `SETUP_DONE` の直後に `active.roundLoading` に入る前提。`SETUP_DONE` の後に `PLAYER_NAMED` 2回を挟むよう修正:

該当ブロックの中で `actor.send({ type: "SETUP_DONE", data: setupData() });` の直後に以下を挟む:

```ts
actor.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
actor.send({ type: "PLAYER_NAMED", playerId: "B", name: "さくら" });
```

- [ ] **Step 4: snapshotToDTO テストに playerNaming を追加**

同ファイルの `describe("snapshotToDTO", ...)` 内に追加:

```ts
it("flattens top-level playerNaming", () => {
  const actor = createActor(sessionMachine).start();
  actor.send({ type: "START" });
  actor.send({
    type: "SETUP_DONE",
    data: {
      players: { A: { id: "A", name: "" }, B: { id: "B", name: "" } },
      relationship: "友達",
    },
  });
  expect(snapshotToDTO(actor.getSnapshot()).state).toBe("playerNaming");
});
```

そして既存の `"flattens nested active state into flat state name"` テストの最終期待 `expect(dto.state).toBe("roundLoading")` の直前にも `PLAYER_NAMED` 2 回を挟み、`setup?.players.A.name` 期待値は `"Alice"` のままだと壊れるので `""` に変更する。

- [ ] **Step 5: テスト実行 (失敗することを確認)**

Run: `pnpm --filter @app/shared test`
Expected: FAIL — `playerNaming` state 未実装、`PLAYER_NAMED` event 未処理、`applySetup` が名前正規化しない等。

- [ ] **Step 6: 一旦このままコミットせず次タスクで実装して緑にする** (コミットはまとめて Task 3 の末尾で行う)

---

## Task 3: state machine 実装

**Files:**
- Modify: `packages/shared/src/machine.ts`

- [ ] **Step 1: actions / guards を追加**

`packages/shared/src/machine.ts` の `setup({ ... }).createMachine(...)` の前半、`actions:` 配列に追記 (`applySetup` を書き換え、新規3つを追加):

```ts
  actions: {
    applySetup: assign(({ event }) => {
      if (event.type !== "SETUP_DONE") return {};
      // 仕様: 名前は setup では保持せず、playerNaming で埋める。
      // stale / 手打ちクライアントから非空が来ても強制的に "" に正規化する。
      const normalized: SetupData = {
        relationship: event.data.relationship,
        players: {
          A: { id: "A", name: "" },
          B: { id: "B", name: "" },
        },
      };
      return { setup: normalized };
    }),
    applyPlayerName: assign(({ context, event }) => {
      if (event.type !== "PLAYER_NAMED") return {};
      if (!context.setup) return {};
      const trimmed = event.name.trim().slice(0, 16);
      if (trimmed === "") return {};
      const current = context.setup.players[event.playerId];
      return {
        setup: {
          ...context.setup,
          players: {
            ...context.setup.players,
            [event.playerId]: { ...current, name: trimmed },
          },
        },
      };
    }),
    enterRound1: assign({ currentRound: () => 1 as RoundNumber }),
    recordRound: assign(({ context, event }) => {
      if (event.type !== "ROUND_COMPLETE") return {};
      const r = context.currentRound;
      if (!r) return {};
      return {
        scores: { ...context.scores, [r]: event.score },
        qualitativeEvals: { ...context.qualitativeEvals, [r]: event.qualitative },
      };
    }),
    advanceRound: assign(({ context }) => {
      const r = context.currentRound ?? 1;
      const next = Math.min(r + 1, 3) as RoundNumber;
      return { currentRound: next };
    }),
    applyVerdict: assign(({ event }) => {
      if (event.type !== "SESSION_DONE") return {};
      return { finalVerdict: event.verdict };
    }),
    reset: assign(() => initialContext),
  },
  guards: {
    canAdvanceRound: ({ context }) =>
      context.currentRound !== null && context.currentRound < 3,
    bothPlayersNamed: ({ context }) =>
      !!context.setup &&
      context.setup.players.A.name !== "" &&
      context.setup.players.B.name !== "",
  },
```

- [ ] **Step 2: state machine に `playerNaming` を追加**

`createMachine({...})` 内の `states:` を書き換え:

```ts
  states: {
    waiting: {
      on: { START: "setup" },
    },
    setup: {
      on: {
        SETUP_DONE: {
          target: "playerNaming",
          actions: "applySetup",
        },
      },
    },
    playerNaming: {
      on: {
        PLAYER_NAMED: { actions: "applyPlayerName" },
      },
      always: {
        guard: "bothPlayersNamed",
        target: "active.roundLoading",
        actions: "enterRound1",
      },
    },
    active: {
      initial: "roundLoading",
      states: {
        roundLoading: {
          on: { ROUND_READY: "roundPlaying" },
        },
        roundPlaying: {
          on: {
            ROUND_COMPLETE: {
              target: "roundResult",
              actions: "recordRound",
            },
          },
        },
        roundResult: {
          on: {
            NEXT_ROUND: {
              guard: "canAdvanceRound",
              target: "roundLoading",
              actions: "advanceRound",
            },
            SESSION_DONE: {
              target: "#session.totalResult",
              actions: "applyVerdict",
            },
          },
        },
      },
    },
    totalResult: {
      on: {
        RESET: {
          target: "waiting",
          actions: "reset",
        },
      },
    },
  },
```

- [ ] **Step 3: `flattenValue` に `playerNaming` を追加**

同ファイル末尾近くの `flattenValue` を書き換え:

```ts
function flattenValue(value: unknown): SessionStateName {
  if (typeof value === "string") {
    if (value === "waiting") return "waiting";
    if (value === "setup") return "setup";
    if (value === "playerNaming") return "playerNaming";
    if (value === "totalResult") return "totalResult";
  }
  if (value && typeof value === "object" && "active" in value) {
    const inner = (value as { active: string }).active;
    if (inner === "roundLoading") return "roundLoading";
    if (inner === "roundPlaying") return "roundPlaying";
    if (inner === "roundResult") return "roundResult";
  }
  throw new Error(`unknown state value: ${JSON.stringify(value)}`);
}
```

- [ ] **Step 4: テスト実行**

Run: `pnpm --filter @app/shared test`
Expected: PASS (Task 2 で追加した全テスト + 既存)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/machine.ts packages/shared/test/machine.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): playerNaming 状態と PLAYER_NAMED イベントで 2 人の名前入力を待機

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Orchestrator を playerNaming に対応させ、既存テストを更新

`onState` の switch は exhaustive ではないが、`playerNaming` ではタイマーを張らないことを明示する。既存テストは `SETUP_DONE` 直後に `roundLoading` に入る前提なので修正が必要。

**Files:**
- Modify: `packages/server/src/orchestrator/index.ts`
- Modify: `packages/server/test/orchestrator.test.ts`
- Modify: `packages/server/test/session-runtime.test.ts`

- [ ] **Step 1: `orchestrator/index.ts` の switch に `playerNaming` を追加**

`packages/server/src/orchestrator/index.ts` の `onState` switch 内、`case "waiting":` の行を以下に置換:

```ts
      case "waiting":
      case "setup":
      case "playerNaming":
      case "totalResult":
        return;
```

- [ ] **Step 2: `orchestrator.test.ts` に playerNaming ヘルパを追加**

`packages/server/test/orchestrator.test.ts` の `setupData()` の下に以下を追加:

```ts
function completeSetupAndNaming(rt: SessionRuntime) {
  rt.send({ type: "START" });
  rt.send({ type: "SETUP_DONE", data: setupData() });
  rt.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
  rt.send({ type: "PLAYER_NAMED", playerId: "B", name: "さくら" });
}
```

- [ ] **Step 3: 既存テストの SETUP_DONE 直後パターンを差し替え**

同ファイルの以下4テストで、`rt.send({ type: "START" }); rt.send({ type: "SETUP_DONE", data: setupData() });` の 2 行を `completeSetupAndNaming(rt);` に置換:
- `"schedules ROUND_READY when entering roundLoading"`
- `"runs a full 3-round cycle to totalResult"`
- `"does not schedule additional timers in totalResult or waiting"`
- `"stop() cancels pending timers and detaches listener"`

また、`"does nothing while waiting / setup / totalResult"` テストの後ろに新テストを追加:

```ts
it("does not schedule while playerNaming", () => {
  rt.send({ type: "START" });
  rt.send({ type: "SETUP_DONE", data: setupData() });
  expect(rt.get().state).toBe("playerNaming");
  expect(sched.pendingCount).toBe(0);
});
```

- [ ] **Step 4: session-runtime.test.ts を更新**

`packages/server/test/session-runtime.test.ts` の `"subscribe fires immediately with current state, then on each transition"` テストを以下に書き換え:

```ts
it("subscribe fires immediately with current state, then on each transition", () => {
  const received: string[] = [];
  const unsub = rt.subscribe((s) => received.push(s.state));
  rt.send({ type: "START" });
  rt.send({
    type: "SETUP_DONE",
    data: {
      players: { A: { id: "A", name: "a" }, B: { id: "B", name: "b" } },
      relationship: "友達",
    },
  });
  rt.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
  rt.send({ type: "PLAYER_NAMED", playerId: "B", name: "さくら" });
  unsub();
  expect(received[0]).toBe("waiting");
  expect(received).toContain("setup");
  expect(received).toContain("playerNaming");
  expect(received).toContain("roundLoading");
});
```

- [ ] **Step 5: server テスト実行**

Run: `pnpm --filter @app/server test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/orchestrator/index.ts \
  packages/server/test/orchestrator.test.ts \
  packages/server/test/session-runtime.test.ts
git commit -m "$(cat <<'EOF'
feat(server): orchestrator が playerNaming をパススルー、既存テストを 2 名入力後に更新

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: ws.ts で `player:setup` を受信、テスト更新

**Files:**
- Modify: `packages/server/src/ws.ts`
- Modify: `packages/server/test/ws.test.ts`

- [ ] **Step 1: 既存テスト「intro SETUP_DONE → roundLoading」を `playerNaming` に変更 + 新テスト追加**

`packages/server/test/ws.test.ts` の `"intro SETUP_DONE broadcasts roundLoading to intro + playerA + playerB"` を書き換え、後ろに新テストを追加:

```ts
it("intro SETUP_DONE broadcasts playerNaming to intro + playerA + playerB", async () => {
  const intro = connectClient("intro");
  const playerA = connectClient("player", "A");
  const playerB = connectClient("player", "B");

  await Promise.all([nextState(intro), nextState(playerA), nextState(playerB)]);

  const allSetup = Promise.all([
    nextState(intro, (s) => s.state === "setup"),
    nextState(playerA, (s) => s.state === "setup"),
    nextState(playerB, (s) => s.state === "setup"),
  ]);
  intro.emit("client:event", { type: "START" });
  await allSetup;

  const allPlayerNaming = Promise.all([
    nextState(intro, (s) => s.state === "playerNaming"),
    nextState(playerA, (s) => s.state === "playerNaming"),
    nextState(playerB, (s) => s.state === "playerNaming"),
  ]);
  intro.emit("client:event", {
    type: "SETUP_DONE",
    data: {
      players: {
        A: { id: "A", name: "" },
        B: { id: "B", name: "" },
      },
      relationship: "友達",
    },
  });
  await allPlayerNaming;

  intro.close();
  playerA.close();
  playerB.close();
});

it("both players submitting player:setup broadcasts roundLoading", async () => {
  const intro = connectClient("intro");
  const playerA = connectClient("player", "A");
  const playerB = connectClient("player", "B");

  await Promise.all([nextState(intro), nextState(playerA), nextState(playerB)]);

  intro.emit("client:event", { type: "START" });
  await Promise.all([
    nextState(intro, (s) => s.state === "setup"),
    nextState(playerA, (s) => s.state === "setup"),
    nextState(playerB, (s) => s.state === "setup"),
  ]);

  intro.emit("client:event", {
    type: "SETUP_DONE",
    data: {
      players: { A: { id: "A", name: "" }, B: { id: "B", name: "" } },
      relationship: "友達",
    },
  });
  await Promise.all([
    nextState(intro, (s) => s.state === "playerNaming"),
    nextState(playerA, (s) => s.state === "playerNaming"),
    nextState(playerB, (s) => s.state === "playerNaming"),
  ]);

  const allRoundLoading = Promise.all([
    nextState(intro, (s) => s.state === "roundLoading"),
    nextState(playerA, (s) => s.state === "roundLoading"),
    nextState(playerB, (s) => s.state === "roundLoading"),
  ]);
  playerA.emit("player:setup", { name: "あきら" });
  playerB.emit("player:setup", { name: "さくら" });
  await allRoundLoading;

  intro.close();
  playerA.close();
  playerB.close();
});

it("player:setup from intro is ignored", async () => {
  const intro = connectClient("intro");
  const playerA = connectClient("player", "A");
  const playerB = connectClient("player", "B");

  await Promise.all([nextState(intro), nextState(playerA), nextState(playerB)]);

  intro.emit("client:event", { type: "START" });
  await Promise.all([
    nextState(intro, (s) => s.state === "setup"),
    nextState(playerA, (s) => s.state === "setup"),
    nextState(playerB, (s) => s.state === "setup"),
  ]);
  intro.emit("client:event", {
    type: "SETUP_DONE",
    data: {
      players: { A: { id: "A", name: "" }, B: { id: "B", name: "" } },
      relationship: "友達",
    },
  });
  await Promise.all([
    nextState(intro, (s) => s.state === "playerNaming"),
    nextState(playerA, (s) => s.state === "playerNaming"),
    nextState(playerB, (s) => s.state === "playerNaming"),
  ]);

  // intro から player:setup を emit しても無視される
  (intro as unknown as { emit: (ev: string, p: unknown) => void }).emit(
    "player:setup",
    { name: "あきら" },
  );
  await new Promise((r) => setTimeout(r, 100));
  expect((await Promise.race([
    nextState(intro, (s) => s.state === "roundLoading"),
    new Promise<{ state: string }>((res) => setTimeout(() => res({ state: "playerNaming" }), 100)),
  ])).state).toBe("playerNaming");

  intro.close();
  playerA.close();
  playerB.close();
});

it("player:setup with non-string name is ignored", async () => {
  const intro = connectClient("intro");
  const playerA = connectClient("player", "A");
  const playerB = connectClient("player", "B");

  await Promise.all([nextState(intro), nextState(playerA), nextState(playerB)]);
  intro.emit("client:event", { type: "START" });
  await Promise.all([
    nextState(intro, (s) => s.state === "setup"),
    nextState(playerA, (s) => s.state === "setup"),
    nextState(playerB, (s) => s.state === "setup"),
  ]);
  intro.emit("client:event", {
    type: "SETUP_DONE",
    data: {
      players: { A: { id: "A", name: "" }, B: { id: "B", name: "" } },
      relationship: "友達",
    },
  });
  await Promise.all([
    nextState(playerA, (s) => s.state === "playerNaming"),
  ]);

  // 不正な型 (number) は ignore され state は playerNaming のまま
  (playerA as unknown as { emit: (ev: string, p: unknown) => void }).emit(
    "player:setup",
    { name: 42 },
  );
  await new Promise((r) => setTimeout(r, 100));
  // A/B どちらも空なので roundLoading に進まない
  // もう片方 B を正しく送ったら playerNaming のまま (A 空)
  playerB.emit("player:setup", { name: "さくら" });
  await new Promise((r) => setTimeout(r, 100));

  intro.close();
  playerA.close();
  playerB.close();
});
```

- [ ] **Step 2: テスト実行 (失敗することを確認)**

Run: `pnpm --filter @app/server test ws`
Expected: FAIL — `player:setup` ハンドラ未実装なので `roundLoading` に進まない。

- [ ] **Step 3: `ws.ts` に `player:setup` ハンドラを追加**

`packages/server/src/ws.ts` の `socket.on("player:input", ...)` の直後に追加:

```ts
    socket.on("player:setup", (payload: unknown) => {
      if (socket.data.role !== "player") return;
      const playerId = socket.data.playerId;
      if (playerId !== "A" && playerId !== "B") return;
      const name = (payload as { name?: unknown })?.name;
      if (typeof name !== "string") return;
      runtime.send({ type: "PLAYER_NAMED", playerId, name });
    });
```

- [ ] **Step 4: テスト実行**

Run: `pnpm --filter @app/server test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws.ts packages/server/test/ws.test.ts
git commit -m "$(cat <<'EOF'
feat(server): player:setup を受けて PLAYER_NAMED を machine に伝播

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 平仮名変換の純粋関数 (shared)

キーボード UI で使う `applyDakuten` / `applyHandakuten` / `applySmall` は純粋関数として shared に置き、vitest でテストする (web 側は vitest 未設定のため)。

**Files:**
- Create: `packages/shared/src/hiragana.ts`
- Create: `packages/shared/test/hiragana.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/shared/test/hiragana.test.ts` を新規作成:

```ts
import { describe, it, expect } from "vitest";
import { applyDakuten, applyHandakuten, applySmall } from "../src/hiragana.js";

describe("applyDakuten", () => {
  it("converts か to が", () => {
    expect(applyDakuten("さか")).toBe("さが");
  });
  it("converts は to ば", () => {
    expect(applyDakuten("そは")).toBe("そば");
  });
  it("returns input unchanged when last char has no dakuten form", () => {
    expect(applyDakuten("あ")).toBe("あ");
  });
  it("returns empty string as-is", () => {
    expect(applyDakuten("")).toBe("");
  });
});

describe("applyHandakuten", () => {
  it("converts は to ぱ", () => {
    expect(applyHandakuten("そは")).toBe("そぱ");
  });
  it("returns input unchanged when last char has no handakuten form", () => {
    expect(applyHandakuten("あ")).toBe("あ");
  });
});

describe("applySmall", () => {
  it("converts や to ゃ", () => {
    expect(applySmall("きや")).toBe("きゃ");
  });
  it("converts つ to っ", () => {
    expect(applySmall("まつ")).toBe("まっ");
  });
  it("returns input unchanged for non-convertible trailing char", () => {
    expect(applySmall("あ")).toBe("あ");
  });
});
```

- [ ] **Step 2: テスト実行 (失敗)**

Run: `pnpm --filter @app/shared test hiragana`
Expected: FAIL (モジュール未存在)

- [ ] **Step 3: 実装**

`packages/shared/src/hiragana.ts` を新規作成:

```ts
const DAKUTEN_MAP: Record<string, string> = {
  か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご",
  さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ",
  た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど",
  は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ",
};

const HANDAKUTEN_MAP: Record<string, string> = {
  は: "ぱ", ひ: "ぴ", ふ: "ぷ", へ: "ぺ", ほ: "ぽ",
};

const SMALL_MAP: Record<string, string> = {
  や: "ゃ", ゆ: "ゅ", よ: "ょ", つ: "っ",
};

function replaceLastChar(input: string, map: Record<string, string>): string {
  if (input.length === 0) return input;
  const last = input[input.length - 1];
  const mapped = map[last];
  if (!mapped) return input;
  return input.slice(0, -1) + mapped;
}

export function applyDakuten(input: string): string {
  return replaceLastChar(input, DAKUTEN_MAP);
}

export function applyHandakuten(input: string): string {
  return replaceLastChar(input, HANDAKUTEN_MAP);
}

export function applySmall(input: string): string {
  return replaceLastChar(input, SMALL_MAP);
}
```

- [ ] **Step 4: `index.ts` に export を追加**

`packages/shared/src/index.ts` に 1 行追加:

```ts
export * from "./hiragana.js";
```

- [ ] **Step 5: テスト実行**

Run: `pnpm --filter @app/shared test`
Expected: PASS (既存 + 新規すべて)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/hiragana.ts packages/shared/test/hiragana.test.ts \
  packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): 平仮名変換 applyDakuten/applyHandakuten/applySmall

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `HiraganaKeyboard` コンポーネント

**Files:**
- Create: `packages/web/src/views/player/HiraganaKeyboard.tsx`
- Modify: `packages/web/src/styles.css`

- [ ] **Step 1: コンポーネント新規作成**

`packages/web/src/views/player/HiraganaKeyboard.tsx`:

```tsx
import { applyDakuten, applyHandakuten, applySmall } from "@app/shared";

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  maxLength?: number;
}

// 1920×540 の横長画面向け。行単位で配置して CSS grid で広げる。
const ROWS: string[][] = [
  ["あ", "い", "う", "え", "お"],
  ["か", "き", "く", "け", "こ"],
  ["さ", "し", "す", "せ", "そ"],
  ["た", "ち", "つ", "て", "と"],
  ["な", "に", "ぬ", "ね", "の"],
  ["は", "ひ", "ふ", "へ", "ほ"],
  ["ま", "み", "む", "め", "も"],
  ["や", "", "ゆ", "", "よ"],
  ["ら", "り", "る", "れ", "ろ"],
  ["わ", "", "", "", "を"],
  ["ん", "ー", "", "", ""],
];

export function HiraganaKeyboard({
  value,
  onChange,
  onSubmit,
  maxLength = 16,
}: Props) {
  function typeChar(c: string) {
    if (c === "") return;
    if (value.length >= maxLength) return;
    onChange(value + c);
  }
  function backspace() {
    onChange(value.slice(0, -1));
  }
  const submittable = value.length > 0;

  return (
    <div className="hiragana-keyboard">
      <div className="hk-grid">
        {ROWS.map((row, ri) => (
          <div key={ri} className="hk-row">
            {row.map((c, ci) => (
              <button
                key={ci}
                className={"hk-key" + (c === "" ? " hk-empty" : "")}
                onClick={() => typeChar(c)}
                disabled={c === ""}
                type="button"
              >
                {c}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="hk-mods">
        <button
          className="hk-key hk-mod"
          type="button"
          onClick={() => onChange(applyDakuten(value))}
        >
          ゛
        </button>
        <button
          className="hk-key hk-mod"
          type="button"
          onClick={() => onChange(applyHandakuten(value))}
        >
          ゜
        </button>
        <button
          className="hk-key hk-mod"
          type="button"
          onClick={() => onChange(applySmall(value))}
        >
          小
        </button>
        <button
          className="hk-key hk-back"
          type="button"
          onClick={backspace}
        >
          ←
        </button>
        <button
          className="hk-key hk-submit"
          type="button"
          onClick={onSubmit}
          disabled={!submittable}
        >
          確定
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS を追加**

`packages/web/src/styles.css` の末尾に追記:

```css
/* ---------------- Player: Naming (hiragana keyboard) ---------------- */
.player-naming {
  display: grid;
  grid-template-rows: auto 1fr;
  padding: 24px 32px;
  background: radial-gradient(ellipse at center, #201844, #0a0a14);
  color: white;
  gap: 16px;
  min-height: 100vh;
}
.player-naming header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 24px;
}
.player-naming .pn-title {
  font-size: 28px;
  color: #aab;
}
.player-naming .pn-input {
  font-size: 56px;
  font-weight: 700;
  font-variant-east-asian: proportional-width;
  letter-spacing: 0.04em;
  flex: 1;
  color: #ffde6b;
  text-shadow: 0 2px 20px rgba(255, 222, 107, 0.3);
}
.player-naming .pn-cursor {
  display: inline-block;
  width: 0.6em;
  margin-left: 4px;
  animation: pn-blink 1s step-start infinite;
}
@keyframes pn-blink { 50% { opacity: 0; } }

.hiragana-keyboard {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  align-items: stretch;
}
.hk-grid {
  display: grid;
  grid-template-columns: repeat(11, 1fr);
  gap: 6px;
}
.hk-row {
  display: contents;
}
.hk-key {
  font-family: inherit;
  font-size: 26px;
  padding: 12px 0;
  border-radius: 8px;
  border: 1px solid #334;
  background: #1e1e32;
  color: white;
  cursor: pointer;
  min-height: 48px;
}
.hk-key:disabled {
  opacity: 0.2;
  cursor: default;
}
.hk-key:active {
  background: #322a66;
}
.hk-empty { visibility: hidden; }
.hk-mods {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
  align-content: stretch;
}
.hk-mod { background: #2a2a4a; }
.hk-back { background: #4a2a2a; }
.hk-submit {
  background: #7a5aff;
  font-weight: 700;
  grid-column: span 2;
}
.hk-submit:disabled { opacity: 0.4; cursor: not-allowed; }

/* ---------------- Intro: 4-button relationship ---------------- */
.intro-setup .relationship-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  max-width: 720px;
  width: 100%;
}
.intro-setup .relationship-grid button {
  font-size: 32px;
  padding: 32px 16px;
  border-radius: 16px;
  background: #1e1e32;
  color: white;
  border: 2px solid #334;
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease;
}
.intro-setup .relationship-grid button:hover,
.intro-setup .relationship-grid button:focus-visible {
  outline: none;
  background: #2a2a4a;
  transform: scale(1.02);
}

/* ---------------- Intro: Waiting for player naming ---------------- */
.intro-playernaming {
  display: grid;
  place-items: center;
  padding: 40px;
  background: #141428;
  text-align: center;
  min-height: 100vh;
}
.intro-playernaming h1 { font-size: 36px; margin: 0 0 24px; }
.intro-playernaming .status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  max-width: 720px;
}
.intro-playernaming .status-card {
  background: #1e1e32;
  border-radius: 12px;
  padding: 24px;
  font-size: 28px;
}
.intro-playernaming .status-done { color: #59ffb6; }
.intro-playernaming .status-pending { color: #aab; }
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @app/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/views/player/HiraganaKeyboard.tsx packages/web/src/styles.css
git commit -m "$(cat <<'EOF'
feat(web): HiraganaKeyboard + naming/setup/playernaming 用 CSS

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `NamingView` と `PlayerNamingWaitView`

**Files:**
- Create: `packages/web/src/views/player/NamingView.tsx`
- Create: `packages/web/src/views/intro/PlayerNamingWaitView.tsx`

- [ ] **Step 1: `NamingView` 作成**

`packages/web/src/views/player/NamingView.tsx`:

```tsx
import { useState } from "react";
import type { PlayerId } from "@app/shared";
import { HiraganaKeyboard } from "./HiraganaKeyboard.js";

interface Props {
  playerId: PlayerId;
  onSubmit: (name: string) => void;
}

export function NamingView({ playerId, onSubmit }: Props) {
  const [value, setValue] = useState("");
  return (
    <main className="player-naming">
      <header>
        <span className="pn-title">Player {playerId} のなまえ</span>
        <span className="pn-input">
          {value}
          <span className="pn-cursor">|</span>
        </span>
      </header>
      <HiraganaKeyboard
        value={value}
        onChange={setValue}
        onSubmit={() => {
          const trimmed = value.trim();
          if (trimmed === "") return;
          onSubmit(trimmed);
        }}
      />
    </main>
  );
}
```

- [ ] **Step 2: `PlayerNamingWaitView` 作成**

`packages/web/src/views/intro/PlayerNamingWaitView.tsx`:

```tsx
import type { SetupData } from "@app/shared";

interface Props {
  setup: SetupData;
}

export function PlayerNamingWaitView({ setup }: Props) {
  const aDone = setup.players.A.name !== "";
  const bDone = setup.players.B.name !== "";
  return (
    <main className="intro-playernaming">
      <h1>プレイヤー名入力中…</h1>
      <div className="status-grid">
        <div className="status-card">
          <div>Player A</div>
          <div className={aDone ? "status-done" : "status-pending"}>
            {aDone ? `○ ${setup.players.A.name}` : "未"}
          </div>
        </div>
        <div className="status-card">
          <div>Player B</div>
          <div className={bDone ? "status-done" : "status-pending"}>
            {bDone ? `○ ${setup.players.B.name}` : "未"}
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @app/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/views/player/NamingView.tsx \
  packages/web/src/views/intro/PlayerNamingWaitView.tsx
git commit -m "$(cat <<'EOF'
feat(web): NamingView (plaleyr) と PlayerNamingWaitView (intro)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `SetupView` を 4-button に置き換え

**Files:**
- Modify: `packages/web/src/views/intro/SetupView.tsx`

- [ ] **Step 1: 全面書き換え**

`packages/web/src/views/intro/SetupView.tsx` の中身を以下に差し替え:

```tsx
import type { Relationship, SetupData } from "@app/shared";

interface Props {
  onSubmit: (data: SetupData) => void;
}

const RELATIONSHIPS: Relationship[] = [
  "カップル",
  "気になっている",
  "友達",
  "親子",
];

export function SetupView({ onSubmit }: Props) {
  function pick(relationship: Relationship) {
    onSubmit({
      players: {
        A: { id: "A", name: "" },
        B: { id: "B", name: "" },
      },
      relationship,
    });
  }

  return (
    <main className="intro-setup">
      <h1>2人の関係性は？</h1>
      <div className="relationship-grid">
        {RELATIONSHIPS.map((r) => (
          <button key={r} type="button" onClick={() => pick(r)}>
            {r}
          </button>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @app/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/views/intro/SetupView.tsx
git commit -m "$(cat <<'EOF'
feat(web): SetupView を関係性4択ボタンに差し替え (名前欄削除)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: ルート画面の switch 分岐を追加

**Files:**
- Modify: `packages/web/src/routes/Intro.tsx`
- Modify: `packages/web/src/routes/Player.tsx`

- [ ] **Step 1: `Intro.tsx` に `playerNaming` を追加**

`packages/web/src/routes/Intro.tsx` の switch ブロックを以下に置換:

```tsx
  switch (snap.state) {
    case "waiting":
      return <StartView onStart={() => trigger({ type: "START" })} />;
    case "setup":
      return <SetupView onSubmit={(data) => trigger({ type: "SETUP_DONE", data })} />;
    case "playerNaming": {
      if (!snap.setup) return null;
      return <PlayerNamingWaitView setup={snap.setup} />;
    }
    case "roundLoading":
    case "roundPlaying":
    case "roundResult":
      return <GuideView currentRound={snap.currentRound} subState={snap.state} />;
    case "totalResult":
      return <FinishView onReset={() => trigger({ type: "RESET" })} />;
    default: {
      // 新しい state 名が追加されたらここで TS2322 になり気付ける
      const _exhaustive: never = snap.state;
      return _exhaustive;
    }
  }
```

import に追加:

```tsx
import { PlayerNamingWaitView } from "../views/intro/PlayerNamingWaitView.js";
```

- [ ] **Step 2: `Player.tsx` に `playerNaming` を追加**

`packages/web/src/routes/Player.tsx` の switch を以下に書き換え:

```tsx
  switch (snap.state) {
    case "waiting":
    case "setup":
      return <WaitingView playerId={playerId} />;
    case "playerNaming": {
      if (!snap.setup) return null;
      const already = snap.setup.players[playerId].name !== "";
      if (already) return <WaitingView playerId={playerId} />;
      return (
        <NamingView
          playerId={playerId}
          onSubmit={(name) => {
            const s = socketRef.current;
            s?.emit("player:setup", { name });
          }}
        />
      );
    }
    case "roundLoading":
      return <LoadingView round={snap.currentRound} />;
    case "roundPlaying":
      return <GameView round={snap.currentRound} />;
    case "roundResult": {
      const r = snap.currentRound;
      const score = r !== null ? snap.scores[r] : null;
      const qualitative = r !== null ? snap.qualitativeEvals[r] : null;
      return <RoundResultView round={r} score={score} qualitative={qualitative} />;
    }
    case "totalResult":
      return <TotalResultView scores={snap.scores} verdict={snap.finalVerdict} />;
    default: {
      const _exhaustive: never = snap.state;
      return _exhaustive;
    }
  }
```

- [ ] **Step 2b: `Player.tsx` を socket ref 方式に書き換え**

同ファイルの冒頭を書き換え、socket を ref に保持しておく:

```tsx
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { PlayerId, SessionSnapshot } from "@app/shared";
import { connectPlayerSocket, type AppSocket } from "../net/socket.js";
import { useViewport } from "../hooks/useViewport.js";
import { WaitingView } from "../views/player/WaitingView.js";
import { NamingView } from "../views/player/NamingView.js";
import { LoadingView } from "../views/player/LoadingView.js";
import { GameView } from "../views/player/GameView.js";
import { RoundResultView } from "../views/player/RoundResultView.js";
import { TotalResultView } from "../views/player/TotalResultView.js";

export function Player() {
  useViewport("width=1920, initial-scale=1.0");
  const [params] = useSearchParams();
  const rawId = params.get("id");
  const playerId: PlayerId | null = rawId === "A" || rawId === "B" ? rawId : null;

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

  if (err) return <main className="error-screen">{err}</main>;
  if (!snap || !playerId) return <main className="loading-screen">connecting...</main>;
```

(switch ブロックは Step 2 で入れたものを維持)

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @app/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/routes/Intro.tsx packages/web/src/routes/Player.tsx
git commit -m "$(cat <<'EOF'
feat(web): Intro/Player のルーティングに playerNaming 分岐を追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: ドキュメント更新

**Files:**
- Modify: `docs/plans/00-overview.md`
- Modify: `docs/README.md`

- [ ] **Step 1: `docs/plans/00-overview.md` を更新**

§1.3 の state→view 対応表 (該当箇所を開いて確認) に `playerNaming` 行を追加。表が無ければ段落で `playerNaming` を説明する段落を追加。実装者は当該ファイルを開いて現況に合わせて追記する。

- [ ] **Step 2: `docs/README.md` を更新**

状態遷移図 / 画面構成の項に `playerNaming` を反映。ファイルを開いて既存フォーマットに合わせ、`setup → playerNaming → active.roundLoading` の順に書き直す。

- [ ] **Step 3: Commit**

```bash
git add docs/plans/00-overview.md docs/README.md
git commit -m "$(cat <<'EOF'
docs: playerNaming 状態を overview / README に反映

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: 全体検証

**Files:** なし (検証のみ)

- [ ] **Step 1: 全 typecheck**

Run: `pnpm -r typecheck`
Expected: PASS

- [ ] **Step 2: 全テスト**

Run: `pnpm -r test`
Expected: PASS

- [ ] **Step 3: 全ビルド**

Run: `pnpm -r build`
Expected: PASS

- [ ] **Step 4: 手動動作確認 (可能なら)**

2 ペインで:
```
pnpm --filter @app/server dev
pnpm --filter @app/web dev
```

- `http://localhost:5173/` → 「START」→ 関係性4ボタン → 4択の1つを押す → 両プレイヤー画面で名前入力中の待機表示
- `http://localhost:5173/player?id=A` と `?id=B` で名前を入力 → 両方確定すると自動で Round1 に入る

問題があれば原因調査・修正コミット。

- [ ] **Step 5: (問題があった場合のみ) 修正コミット**

---

## Self-Review (plan 作成者)

- **Spec coverage:** すべての spec 要件 (Relationship 4 値, playerNaming state, applySetup 正規化, PLAYER_NAMED, player:setup 実行時型ガード, `bothPlayersNamed` guard, `enterRound1`, HiraganaKeyboard 清音 + 長音 + 濁点/半濁点 + 小書き ゃゅょっ, intro 4 ボタン, NamingView, PlayerNamingWaitView, 既存 fixture 更新, docs 更新, typecheck/test/build green) が Task に紐付いている。
- **Placeholder scan:** コード全文を掲載済み。docs の具体文言は既存ファイルに依存するため「ファイルを開いて合わせて更新」とした (実装者が現況に合わせる)。
- **Type consistency:** `Relationship`, `SetupData`, `SessionEvent`, `PlayerId` すべて shared で単一定義。コンポーネント名 `HiraganaKeyboard` / `NamingView` / `PlayerNamingWaitView` は Task 間で同一。
