# Phase 1 — Foundation 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TypeScript pnpm monorepo を立て、`shared` パッケージに DTO 型と XState 状態マシンを置き、`server` (Fastify + Socket.io) は **単一の singleton SessionRuntime** を持ち、`web` (Vite + React) は `/` (intro) と `/player` (player) の2ルートだけを持つ。3つのブラウザが常時接続し、**intro で STARTボタンを押すと state=setup に遷移し、3画面すべてが自動で次のビューに切り替わる** ところまでをスモークで確認する。

**Architecture:** 状態マシンをサーバ側に一本化。3クライアント (intro / player A / player B) は `/session` namespace に常時接続し、自分の role × 現在の state から描画するビューを選ぶ。URL 遷移は一切行わない。ゲームの進行は `client:event` (intro→server) と `player:input` (player→server) の WS メッセージ + サーバ内オーケストレータで駆動する。

**Tech Stack:** pnpm 9, TypeScript 5.5, Fastify 5, Socket.io 4, XState 5, React 18, Vite 5, Vitest 2.

**受け入れ条件 (Phase完了の定義):**

- `pnpm -r test` がグリーン (shared の XState ユニットテスト + server の REST/WS契約テスト)
- `pnpm -r typecheck` がパス
- `pnpm --filter @app/server dev` + `pnpm --filter @app/web dev` を起動した状態で、ブラウザ3枚を以下に開くと常時接続する:
  1. `http://localhost:5173/` (intro) — "state: waiting" + START ボタンが表示される
  2. `http://localhost:5173/player?id=A` — "state: waiting" の JSON が表示される
  3. `http://localhost:5173/player?id=B` — 同上
- intro の STARTボタンをクリックすると、**3つのウィンドウすべて** が即座に `state: setup` に切り替わる (URL は変わらない)
- README.md の状態遷移図の全遷移 (Waiting→Setup→Active→各Round→Total_Result→Waiting) が XState machine のユニットテストでカバーされている

Phase 2 以降で実装する (本Phaseでは出さない):
- Setup フォーム UI と `SETUP_DONE` 送信
- RoundLoading / RoundPlaying / RoundResult / TotalResult の実ビュー
- AI (Gemini), MIDI, 3つのゲーム本体

---

## File Structure (Phase 1 で作成)

```
package.json
pnpm-workspace.yaml
tsconfig.base.json
.gitignore
.nvmrc
README.md
packages/
├── shared/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── index.ts
│   │   ├── types.ts         # DTO, Role, ClientEvent, PlayerInput, WS event shapes
│   │   └── machine.ts       # XState v5 machine + snapshotToDTO
│   └── test/
│       └── machine.test.ts
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── index.ts
│   │   ├── app.ts              # buildApp(): Fastify + SessionRuntime
│   │   ├── session-runtime.ts  # singleton XState actor wrapper
│   │   ├── http.ts             # /health
│   │   └── ws.ts               # Socket.io /session
│   └── test/
│       ├── app.test.ts
│       ├── session-runtime.test.ts
│       └── ws.test.ts
└── web/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── routes/
        │   ├── Intro.tsx
        │   └── Player.tsx
        └── net/
            └── socket.ts
```

---

## Task 1: Monorepo 初期化

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.nvmrc`

- [ ] **Step 1: `.nvmrc` を作成**

```
20
```

- [ ] **Step 2: `.gitignore` を作成**

```
node_modules
dist
.env
.env.local
*.log
.DS_Store
coverage
.vite
```

- [ ] **Step 3: `package.json` を作成**

```json
{
  "name": "sanu0420hack-r3",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "dev:server": "pnpm --filter @app/server dev",
    "dev:web": "pnpm --filter @app/web dev"
  },
  "devDependencies": {
    "typescript": "5.5.4",
    "vitest": "2.1.1",
    "@types/node": "20.14.10"
  }
}
```

- [ ] **Step 4: `pnpm-workspace.yaml` を作成**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 5: `tsconfig.base.json` を作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 6: root に依存をインストール**

Run: `pnpm install`
Expected: `packages/*` は空でも pnpm がワークスペースを認識する。

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .nvmrc pnpm-lock.yaml
git commit -m "chore: init pnpm monorepo with TS/Vitest"
```

---

## Task 2: `@app/shared` パッケージ初期化

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: `packages/shared/package.json` を作成**

```json
{
  "name": "@app/shared",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "xstate": "5.18.2"
  }
}
```

- [ ] **Step 2: `packages/shared/tsconfig.json` を作成**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

> `rootDir` は明示しない。`test/` を `include` に含める関係で `src/` と `test/` の共通祖先が `./` になる必要があり、`rootDir: "./src"` と併用すると tsc が TS6059 で失敗する。

- [ ] **Step 3: `packages/shared/vitest.config.ts` を作成**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: `packages/shared/src/index.ts` を作成**

```ts
export * from "./types.js";
export * from "./machine.js";
```

- [ ] **Step 5: 依存を解決**

Run: `pnpm install`
Expected: `@app/shared` がワークスペースに検出され xstate が node_modules に入る。

- [ ] **Step 6: Commit**

```bash
git add packages/shared package.json pnpm-lock.yaml
git commit -m "chore(shared): scaffold @app/shared package"
```

---

## Task 3: `shared/types.ts` — DTO / Role / WSイベント型

**Files:**
- Create: `packages/shared/src/types.ts`

- [ ] **Step 1: `packages/shared/src/types.ts` を作成**

```ts
export type PlayerId = "A" | "B";
export type Role = "intro" | "player";
export type RoundNumber = 1 | 2 | 3;

export type Relationship = string; // 自由入力 (例: 友人 / 恋人 / 親子)

export interface PlayerProfile {
  id: PlayerId;
  name: string;
}

export interface SetupData {
  players: Record<PlayerId, PlayerProfile>;
  relationship: Relationship;
}

export type SessionStateName =
  | "waiting"
  | "setup"
  | "roundLoading"
  | "roundPlaying"
  | "roundResult"
  | "totalResult";

export interface SessionSnapshot {
  state: SessionStateName;
  currentRound: RoundNumber | null;
  setup: SetupData | null;
  scores: Record<RoundNumber, number | null>;
  qualitativeEvals: Record<RoundNumber, string | null>;
  finalVerdict: string | null;
}

// Client → Server (intro が引くトリガ)
export type ClientEvent =
  | { type: "START" }
  | { type: "SETUP_DONE"; data: SetupData }
  | { type: "RESET" };

// Client → Server (player がゲーム中に送る入力)
export interface PlayerInput {
  round: RoundNumber;
  gameId: string;
  payload: unknown;
}

export type ClientToServerEvents = {
  "client:event": (event: ClientEvent) => void;
  "player:input": (input: PlayerInput) => void;
};

export type ServerToClientEvents = {
  "session:state": (snapshot: SessionSnapshot) => void;
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): DTO / Role / WS event types"
```

---

## Task 4: `shared/machine.ts` — XState v5 状態マシン + DTO変換

**Files:**
- Create: `packages/shared/src/machine.ts`
- Test: `packages/shared/test/machine.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/shared/test/machine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createActor } from "xstate";
import { sessionMachine, snapshotToDTO } from "../src/machine.js";

function setupData() {
  return {
    players: {
      A: { id: "A" as const, name: "Alice" },
      B: { id: "B" as const, name: "Bob" },
    },
    relationship: "友人",
  };
}

describe("sessionMachine", () => {
  it("starts in waiting", () => {
    const actor = createActor(sessionMachine).start();
    expect(actor.getSnapshot().value).toBe("waiting");
  });

  it("waiting -> setup on START", () => {
    const actor = createActor(sessionMachine).start();
    actor.send({ type: "START" });
    expect(actor.getSnapshot().value).toBe("setup");
  });

  it("setup -> active.roundLoading on SETUP_DONE with data", () => {
    const actor = createActor(sessionMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SETUP_DONE", data: setupData() });
    const snap = actor.getSnapshot();
    expect(snap.value).toEqual({ active: "roundLoading" });
    expect(snap.context.currentRound).toBe(1);
    expect(snap.context.setup?.relationship).toBe("友人");
  });

  it("round cycle: loading -> playing -> result -> next loading", () => {
    const actor = createActor(sessionMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SETUP_DONE", data: setupData() });
    actor.send({ type: "ROUND_READY" });
    expect(actor.getSnapshot().value).toEqual({ active: "roundPlaying" });

    actor.send({ type: "ROUND_COMPLETE", score: 42, qualitative: "good" });
    expect(actor.getSnapshot().value).toEqual({ active: "roundResult" });
    expect(actor.getSnapshot().context.scores[1]).toBe(42);

    actor.send({ type: "NEXT_ROUND" });
    expect(actor.getSnapshot().value).toEqual({ active: "roundLoading" });
    expect(actor.getSnapshot().context.currentRound).toBe(2);
  });

  it("NEXT_ROUND from round 3 is blocked by guard (stays in roundResult)", () => {
    const actor = createActor(sessionMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SETUP_DONE", data: setupData() });
    for (const n of [1, 2]) {
      actor.send({ type: "ROUND_READY" });
      actor.send({ type: "ROUND_COMPLETE", score: n, qualitative: `r${n}` });
      actor.send({ type: "NEXT_ROUND" });
    }
    actor.send({ type: "ROUND_READY" });
    actor.send({ type: "ROUND_COMPLETE", score: 3, qualitative: "r3" });
    expect(actor.getSnapshot().value).toEqual({ active: "roundResult" });
    actor.send({ type: "NEXT_ROUND" }); // guard により無視
    expect(actor.getSnapshot().value).toEqual({ active: "roundResult" });
    expect(actor.getSnapshot().context.currentRound).toBe(3);
  });

  it("SESSION_DONE from roundResult goes to totalResult", () => {
    const actor = createActor(sessionMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SETUP_DONE", data: setupData() });
    for (const n of [1, 2, 3]) {
      actor.send({ type: "ROUND_READY" });
      actor.send({ type: "ROUND_COMPLETE", score: n * 10, qualitative: `r${n}` });
      if (n < 3) actor.send({ type: "NEXT_ROUND" });
    }
    actor.send({ type: "SESSION_DONE", verdict: "運命" });
    expect(actor.getSnapshot().value).toBe("totalResult");
    expect(actor.getSnapshot().context.finalVerdict).toBe("運命");
  });

  it("totalResult -> waiting on RESET (and state resets)", () => {
    const actor = createActor(sessionMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SETUP_DONE", data: setupData() });
    for (const n of [1, 2, 3]) {
      actor.send({ type: "ROUND_READY" });
      actor.send({ type: "ROUND_COMPLETE", score: n, qualitative: `r${n}` });
      if (n < 3) actor.send({ type: "NEXT_ROUND" });
    }
    actor.send({ type: "SESSION_DONE", verdict: "ok" });
    actor.send({ type: "RESET" });
    expect(actor.getSnapshot().value).toBe("waiting");
    expect(actor.getSnapshot().context.scores).toEqual({ 1: null, 2: null, 3: null });
    expect(actor.getSnapshot().context.setup).toBeNull();
  });
});

describe("snapshotToDTO", () => {
  it("flattens nested active state into flat state name", () => {
    const actor = createActor(sessionMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SETUP_DONE", data: setupData() });
    const dto = snapshotToDTO(actor.getSnapshot());
    expect(dto.state).toBe("roundLoading");
    expect(dto.currentRound).toBe(1);
    expect(dto.setup?.players.A.name).toBe("Alice");
  });

  it("flattens top-level states (waiting, setup, totalResult)", () => {
    const actor = createActor(sessionMachine).start();
    expect(snapshotToDTO(actor.getSnapshot()).state).toBe("waiting");
    actor.send({ type: "START" });
    expect(snapshotToDTO(actor.getSnapshot()).state).toBe("setup");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @app/shared test`
Expected: FAIL — `machine.ts` がまだ存在しない。

- [ ] **Step 3: `packages/shared/src/machine.ts` を実装**

```ts
import { assign, setup } from "xstate";
import type {
  RoundNumber,
  SessionSnapshot,
  SessionStateName,
  SetupData,
} from "./types.js";

export interface SessionContext {
  setup: SetupData | null;
  currentRound: RoundNumber | null;
  scores: Record<RoundNumber, number | null>;
  qualitativeEvals: Record<RoundNumber, string | null>;
  finalVerdict: string | null;
}

export type SessionEvent =
  | { type: "START" }
  | { type: "SETUP_DONE"; data: SetupData }
  | { type: "ROUND_READY" }
  | { type: "ROUND_COMPLETE"; score: number; qualitative: string }
  | { type: "NEXT_ROUND" }
  | { type: "SESSION_DONE"; verdict: string }
  | { type: "RESET" };

const initialContext: SessionContext = {
  setup: null,
  currentRound: null,
  scores: { 1: null, 2: null, 3: null },
  qualitativeEvals: { 1: null, 2: null, 3: null },
  finalVerdict: null,
};

export const sessionMachine = setup({
  types: {
    context: {} as SessionContext,
    events: {} as SessionEvent,
  },
  actions: {
    applySetup: assign(({ event }) => {
      if (event.type !== "SETUP_DONE") return {};
      return { setup: event.data, currentRound: 1 as RoundNumber };
    }),
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
  },
}).createMachine({
  id: "session",
  initial: "waiting",
  context: initialContext,
  states: {
    waiting: {
      on: { START: "setup" },
    },
    setup: {
      on: {
        SETUP_DONE: {
          target: "active.roundLoading",
          actions: "applySetup",
        },
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
});

type AnyActorSnapshot = { value: unknown; context: SessionContext };

function flattenValue(value: unknown): SessionStateName {
  if (typeof value === "string") {
    if (value === "waiting") return "waiting";
    if (value === "setup") return "setup";
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

export function snapshotToDTO(snap: AnyActorSnapshot): SessionSnapshot {
  const ctx = snap.context;
  return {
    state: flattenValue(snap.value),
    currentRound: ctx.currentRound,
    setup: ctx.setup,
    scores: ctx.scores,
    qualitativeEvals: ctx.qualitativeEvals,
    finalVerdict: ctx.finalVerdict,
  };
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `pnpm --filter @app/shared test`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/machine.ts packages/shared/test/machine.test.ts
git commit -m "feat(shared): session XState machine + snapshotToDTO"
```

---

## Task 5: `@app/server` パッケージ初期化 + `/health`

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/vitest.config.ts`
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/http.ts`
- Create: `packages/server/src/index.ts`
- Test: `packages/server/test/app.test.ts`

- [ ] **Step 1: `packages/server/package.json` を作成**

```json
{
  "name": "@app/server",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@app/shared": "workspace:*",
    "fastify": "5.0.0",
    "socket.io": "4.7.5",
    "xstate": "5.18.2"
  },
  "devDependencies": {
    "tsx": "4.19.1",
    "socket.io-client": "4.7.5"
  }
}
```

> `xstate` は `@app/shared` の machine 型に依存するだけでなく、`session-runtime.ts` が `createActor`, `Actor` 型を **直接 `from "xstate"` で import** するため、server 側にも明示的に入れる (pnpm は `@app/shared` の依存を自動で再エクスポートしない)。バージョンは shared と揃える。

- [ ] **Step 2: `packages/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

> shared と同じ理由で `rootDir` は明示しない (TS6059 回避)。

- [ ] **Step 3: `packages/server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 10000,
  },
});
```

- [ ] **Step 4: 依存インストール**

Run: `pnpm install`
Expected: deps がインストールされる。

- [ ] **Step 5: 失敗するテストを書く**

`packages/server/test/app.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

let app: ReturnType<typeof buildApp>;
afterEach(async () => {
  if (app) await app.close();
});

describe("server app", () => {
  it("GET /health returns ok", async () => {
    app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `pnpm --filter @app/server test`
Expected: FAIL — `app.ts` が存在しない。

- [ ] **Step 7: `packages/server/src/http.ts` を実装**

```ts
import type { FastifyInstance } from "fastify";

export function registerHttpRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({ status: "ok" }));
}
```

- [ ] **Step 8: `packages/server/src/app.ts` を実装 (SessionRuntime は Task 6 で差し替え)**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { registerHttpRoutes } from "./http.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerHttpRoutes(app);
  return app;
}
```

- [ ] **Step 9: `packages/server/src/index.ts` を実装**

```ts
import { buildApp } from "./app.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

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

- [ ] **Step 10: テストがパスすることを確認**

Run: `pnpm --filter @app/server test`
Expected: PASS.

- [ ] **Step 11: 手動動作確認**

Run: `pnpm --filter @app/server dev`
別ターミナル: `curl http://localhost:3000/health`
Expected: `{"status":"ok"}`。Ctrl+C で停止。

- [ ] **Step 12: Commit**

```bash
git add packages/server package.json pnpm-lock.yaml
git commit -m "feat(server): Fastify skeleton with /health"
```

---

## Task 6: `SessionRuntime` — XState actor の singleton wrapper

**Files:**
- Create: `packages/server/src/session-runtime.ts`
- Test: `packages/server/test/session-runtime.test.ts`
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/server/test/session-runtime.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionRuntime } from "../src/session-runtime.js";

describe("SessionRuntime", () => {
  let rt: SessionRuntime;
  beforeEach(() => {
    rt = new SessionRuntime();
  });
  afterEach(() => {
    rt.stop();
  });

  it("starts in waiting", () => {
    expect(rt.get().state).toBe("waiting");
    expect(rt.get().currentRound).toBeNull();
  });

  it("send(START) transitions to setup and returns new snapshot", () => {
    const after = rt.send({ type: "START" });
    expect(after.state).toBe("setup");
    expect(rt.get().state).toBe("setup");
  });

  it("subscribe fires immediately with current state, then on each transition", () => {
    const received: string[] = [];
    const unsub = rt.subscribe((s) => received.push(s.state));
    rt.send({ type: "START" });
    rt.send({
      type: "SETUP_DONE",
      data: {
        players: { A: { id: "A", name: "a" }, B: { id: "B", name: "b" } },
        relationship: "友人",
      },
    });
    unsub();
    expect(received[0]).toBe("waiting");
    expect(received).toContain("setup");
    expect(received).toContain("roundLoading");
  });

  it("unsubscribe stops delivering updates", () => {
    const received: string[] = [];
    const unsub = rt.subscribe((s) => received.push(s.state));
    unsub();
    rt.send({ type: "START" });
    expect(received).toEqual(["waiting"]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @app/server test session-runtime`
Expected: FAIL — `session-runtime.ts` が存在しない。

- [ ] **Step 3: `packages/server/src/session-runtime.ts` を実装**

```ts
import { createActor, type Actor } from "xstate";
import {
  sessionMachine,
  snapshotToDTO,
  type SessionEvent,
} from "@app/shared";
import type { SessionSnapshot } from "@app/shared";

export type SessionListener = (snapshot: SessionSnapshot) => void;

export class SessionRuntime {
  private actor: Actor<typeof sessionMachine>;

  constructor() {
    this.actor = createActor(sessionMachine);
    this.actor.start();
  }

  get(): SessionSnapshot {
    return snapshotToDTO(this.actor.getSnapshot());
  }

  send(event: SessionEvent): SessionSnapshot {
    this.actor.send(event);
    return this.get();
  }

  subscribe(listener: SessionListener): () => void {
    // XState v5 の actor.subscribe は登録時に現在値を即時発火しない。
    // 「subscribe するとまず現在の state を受け取る」という本ラッパの契約 (テストが
    // この挙動を要求) を満たすため、ここで同期的に一度 listener を呼んでから actor に
    // subscribe する。
    listener(this.get());
    const sub = this.actor.subscribe((snap) => {
      listener(snapshotToDTO(snap));
    });
    return () => sub.unsubscribe();
  }

  stop(): void {
    this.actor.stop();
  }
}
```

- [ ] **Step 4: `packages/server/src/app.ts` を更新して SessionRuntime を Fastify に持たせる**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { SessionRuntime } from "./session-runtime.js";
import { registerHttpRoutes } from "./http.js";

export interface BuildAppOptions {
  runtime?: SessionRuntime;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const runtime = opts.runtime ?? new SessionRuntime();

  registerHttpRoutes(app);
  app.decorate("sessionRuntime", runtime);

  app.addHook("onClose", async () => {
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

- [ ] **Step 5: 既存 `app.test.ts` の `afterEach` をそのまま活かしつつ全テスト実行**

Run: `pnpm --filter @app/server test`
Expected: すべて PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/session-runtime.ts packages/server/src/app.ts packages/server/test/session-runtime.test.ts
git commit -m "feat(server): singleton SessionRuntime wrapping XState actor"
```

---

## Task 7: Socket.io `/session` — role 検査 + `client:event` + 状態broadcast

**Files:**
- Create: `packages/server/src/ws.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/test/ws.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/server/test/ws.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { buildApp } from "../src/app.js";
import { attachSocketIo } from "../src/ws.js";

let address: string;
let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  app = buildApp();
  await app.ready();
  attachSocketIo(app.server, app.sessionRuntime);
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  const { port } = app.server.address() as AddressInfo;
  address = `http://localhost:${port}`;
});

afterEach(async () => {
  await app.close();
});

function connectClient(role: string, id?: string): ClientSocket {
  const query: Record<string, string> = { role };
  if (id) query.id = id;
  return ioClient(`${address}/session`, {
    query,
    transports: ["websocket"],
    forceNew: true,
  });
}

function nextState(socket: ClientSocket, predicate?: (s: { state: string }) => boolean): Promise<{ state: string }> {
  return new Promise((resolve) => {
    const onState = (s: { state: string }) => {
      if (!predicate || predicate(s)) {
        socket.off("session:state", onState);
        resolve(s);
      }
    };
    socket.on("session:state", onState);
  });
}

describe("Socket.io /session", () => {
  it("intro client receives initial state=waiting on connect", async () => {
    const intro = connectClient("intro");
    const snap = await nextState(intro);
    expect(snap.state).toBe("waiting");
    intro.close();
  });

  it("player A receives initial state on connect", async () => {
    const p = connectClient("player", "A");
    const snap = await nextState(p);
    expect(snap.state).toBe("waiting");
    p.close();
  });

  it("intro 'client:event' START broadcasts state=setup to all connected clients", async () => {
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

    intro.close();
    playerA.close();
    playerB.close();
  });

  it("player 'client:event' is ignored (not authorized)", async () => {
    const playerA = connectClient("player", "A");
    await nextState(playerA);

    playerA.emit("client:event", { type: "START" });
    await new Promise((r) => setTimeout(r, 100));

    // 別 intro で現状取得
    const intro = connectClient("intro");
    const snap = await nextState(intro);
    expect(snap.state).toBe("waiting");

    playerA.close();
    intro.close();
  });

  it("rejects connection with unknown role", async () => {
    const bad = ioClient(`${address}/session`, {
      query: { role: "spectator" },
      transports: ["websocket"],
      forceNew: true,
    });
    const outcome = await new Promise<string>((resolve) => {
      bad.once("disconnect", () => resolve("disconnected"));
      bad.once("connect_error", () => resolve("connect_error"));
      setTimeout(() => resolve("timeout"), 1000);
    });
    expect(outcome === "disconnected" || outcome === "connect_error").toBe(true);
    bad.close();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @app/server test ws`
Expected: FAIL — `ws.ts` が存在しない。

- [ ] **Step 3: `packages/server/src/ws.ts` を実装**

```ts
import type { Server as HttpServer } from "node:http";
import { Server as IOServer } from "socket.io";
import type { SessionRuntime } from "./session-runtime.js";
import type {
  ClientEvent,
  ClientToServerEvents,
  PlayerId,
  PlayerInput,
  Role,
  ServerToClientEvents,
} from "@app/shared";

function isValidRole(r: unknown): r is Role {
  return r === "intro" || r === "player";
}
function isValidPlayerId(x: unknown): x is PlayerId {
  return x === "A" || x === "B";
}

export function attachSocketIo(
  httpServer: HttpServer,
  runtime: SessionRuntime,
): IOServer {
  const io = new IOServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    { cors: { origin: true, credentials: true } },
  );

  const nsp = io.of("/session");

  // グローバル購読。actor が遷移するたびに接続中の全 socket にbroadcast。
  // subscribe は登録時に現在値を即時発火するが、起動直後はまだ socket が無いので
  // broadcast 先が空。以降は遷移のみで発火する。
  runtime.subscribe((snap) => {
    nsp.emit("session:state", snap);
  });

  nsp.on("connection", (socket) => {
    const { role, id } = socket.handshake.query as {
      role?: string;
      id?: string;
    };

    if (!isValidRole(role)) {
      socket.disconnect(true);
      return;
    }
    if (role === "player" && !isValidPlayerId(id)) {
      socket.disconnect(true);
      return;
    }

    socket.data.role = role;
    socket.data.playerId = role === "player" ? (id as PlayerId) : null;

    // この socket にだけ現在の state を配る (遷移待ちを避けるため)
    socket.emit("session:state", runtime.get());

    socket.on("client:event", (ev: ClientEvent) => {
      if (socket.data.role !== "intro") return; // intro のみ許可
      runtime.send(ev);
    });

    socket.on("player:input", (_input: PlayerInput) => {
      if (socket.data.role !== "player") return;
      // Phase 4 で実装 (オーケストレータへ委譲)
    });
  });

  return io;
}
```

- [ ] **Step 4: `packages/server/src/index.ts` を更新して Socket.io を繋ぐ**

```ts
import { buildApp } from "./app.js";
import { attachSocketIo } from "./ws.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

await app.ready();
attachSocketIo(app.server, app.sessionRuntime);

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

- [ ] **Step 5: テストがパスすることを確認**

Run: `pnpm --filter @app/server test`
Expected: 全 PASS (app / session-runtime / ws)。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/ws.ts packages/server/src/index.ts packages/server/test/ws.test.ts
git commit -m "feat(server): Socket.io /session namespace with role auth + client:event"
```

---

## Task 8: `@app/web` パッケージ初期化 (Vite + React + Router)

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`

- [ ] **Step 1: `packages/web/package.json`**

```json
{
  "name": "@app/web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@app/shared": "workspace:*",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "react-router-dom": "6.26.2",
    "socket.io-client": "4.7.5"
  },
  "devDependencies": {
    "@types/react": "18.3.10",
    "@types/react-dom": "18.3.0",
    "@vitejs/plugin-react": "4.3.1",
    "vite": "5.4.8"
  }
}
```

- [ ] **Step 2: `packages/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "outDir": "./dist",
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `packages/web/vite.config.ts`** (開発時は server を `3000` で立てて proxy する)

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // LAN 上の他端末から繋げるようにしておく (プレイヤー画面がLG上で開く想定)
    proxy: {
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
      },
      "/api": "http://localhost:3000",
    },
  },
});
```

- [ ] **Step 4: `packages/web/index.html`**

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pair Arcade</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: `packages/web/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 6: `packages/web/src/App.tsx` (2ルートのみ)**

```tsx
import { Route, Routes } from "react-router-dom";
import { Intro } from "./routes/Intro.js";
import { Player } from "./routes/Player.js";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Intro />} />
      <Route path="/player" element={<Player />} />
    </Routes>
  );
}
```

- [ ] **Step 7: 依存インストール**

Run: `pnpm install`

- [ ] **Step 8: Commit**

```bash
git add packages/web package.json pnpm-lock.yaml
git commit -m "chore(web): scaffold @app/web with Vite + React + Router"
```

---

## Task 9: Socket クライアント + Intro / Player ルート (state投影)

**Files:**
- Create: `packages/web/src/net/socket.ts`
- Create: `packages/web/src/routes/Intro.tsx`
- Create: `packages/web/src/routes/Player.tsx`

- [ ] **Step 1: `packages/web/src/net/socket.ts`**

```ts
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  PlayerId,
  ServerToClientEvents,
} from "@app/shared";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectIntroSocket(): AppSocket {
  return io("/session", {
    query: { role: "intro" },
    transports: ["websocket"],
    forceNew: true,
  });
}

export function connectPlayerSocket(id: PlayerId): AppSocket {
  return io("/session", {
    query: { role: "player", id },
    transports: ["websocket"],
    forceNew: true,
  });
}
```

- [ ] **Step 2: `packages/web/src/routes/Intro.tsx`** — state投影 + Start ボタン

```tsx
import { useEffect, useRef, useState } from "react";
import type { ClientEvent, SessionSnapshot } from "@app/shared";
import { connectIntroSocket, type AppSocket } from "../net/socket.js";

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

  if (!snap) {
    return (
      <main style={{ padding: 32, fontFamily: "sans-serif" }}>
        <p>connecting to server...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1>Pair Arcade — Intro</h1>
      <p>
        state: <code>{snap.state}</code>
      </p>
      {snap.state === "waiting" && (
        <button onClick={() => trigger({ type: "START" })} style={{ fontSize: 24, padding: "12px 24px" }}>
          START
        </button>
      )}
      {snap.state === "setup" && (
        <section>
          <h2>Setup</h2>
          <p>Setup フォームは Phase 2 で実装。今は <code>SETUP_DONE</code> のモックボタンのみ。</p>
          <button
            onClick={() =>
              trigger({
                type: "SETUP_DONE",
                data: {
                  players: {
                    A: { id: "A", name: "PlayerA" },
                    B: { id: "B", name: "PlayerB" },
                  },
                  relationship: "友人",
                },
              })
            }
          >
            SETUP_DONE (mock)
          </button>
        </section>
      )}
      {(snap.state === "roundLoading" ||
        snap.state === "roundPlaying" ||
        snap.state === "roundResult") && (
        <section>
          <h2>Guide</h2>
          <p>プレイヤーはプレイヤー画面の前へ移動してください。</p>
          <p>Round: {snap.currentRound}</p>
          <p>実装は Phase 2〜 で拡張。</p>
        </section>
      )}
      {snap.state === "totalResult" && (
        <section>
          <h2>Finish</h2>
          <p>最終結果はプレイヤー画面に表示中。</p>
          <button onClick={() => trigger({ type: "RESET" })}>RESET</button>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 3: `packages/web/src/routes/Player.tsx`** — state投影

```tsx
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { PlayerId, SessionSnapshot } from "@app/shared";
import { connectPlayerSocket } from "../net/socket.js";

export function Player() {
  const [params] = useSearchParams();
  const rawId = params.get("id");
  const playerId: PlayerId | null = rawId === "A" || rawId === "B" ? rawId : null;

  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!playerId) {
      setErr("?id=A or ?id=B が必要です");
      return;
    }
    const s = connectPlayerSocket(playerId);
    s.on("session:state", setSnap);
    s.on("connect_error", (e) => setErr(String(e)));
    return () => {
      s.close();
    };
  }, [playerId]);

  if (err) return <main style={{ padding: 32, color: "red" }}>{err}</main>;
  if (!snap) return <main style={{ padding: 32 }}>connecting...</main>;

  return (
    <main style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1>Player {playerId}</h1>
      <p>
        state: <code>{snap.state}</code>
      </p>
      <p>current round: {snap.currentRound ?? "-"}</p>
      {snap.state === "waiting" && <p>スタート待ち…</p>}
      {snap.state === "setup" && <p>セットアップ中…</p>}
      {snap.state === "roundLoading" && <p>Round {snap.currentRound} 準備中…</p>}
      {snap.state === "roundPlaying" && <p>Round {snap.currentRound} プレイ中 (ゲーム本体は Phase 4)</p>}
      {snap.state === "roundResult" && (
        <p>
          Round {snap.currentRound} 終了。score =
          {snap.currentRound ? snap.scores[snap.currentRound] : "-"}
        </p>
      )}
      {snap.state === "totalResult" && <p>最終結果: {snap.finalVerdict}</p>}
      <details style={{ marginTop: 32 }}>
        <summary>debug snapshot</summary>
        <pre>{JSON.stringify(snap, null, 2)}</pre>
      </details>
    </main>
  );
}
```

- [ ] **Step 4: 型チェック**

Run: `pnpm --filter @app/web typecheck`
Expected: エラーなし。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): Intro/Player routes projecting server state"
```

---

## Task 10: 3画面スモーク (サーバドリブン遷移確認) + root README

**Files:**
- Create: `README.md` (root)

- [ ] **Step 1: 全テスト + 型チェック**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: どちらもパス。

- [ ] **Step 2: Server と Web を並行で起動**

ターミナル1: `pnpm --filter @app/server dev`
ターミナル2: `pnpm --filter @app/web dev`

Expected:
- server: `server listening on http://0.0.0.0:3000`
- web: `Local:   http://localhost:5173/`

- [ ] **Step 3: 3つのブラウザウィンドウ (同一マシンで可) で開いて接続確認**

1. ウィンドウ1 (intro): `http://localhost:5173/` を開く → "state: waiting" と START ボタン
2. ウィンドウ2 (player A): `http://localhost:5173/player?id=A` を開く → "state: waiting"
3. ウィンドウ3 (player B): `http://localhost:5173/player?id=B` を開く → "state: waiting"

Expected: 3画面とも connecting...→waiting に切り替わる。URL は変化しない。

- [ ] **Step 4: Start → Setup 遷移を確認 (intro 操作 → 全画面追従)**

ウィンドウ1 の **START** をクリック。
Expected: 100ms 以内に:
- ウィンドウ1: "state: setup" に切り替わり、SETUP_DONE(mock) ボタンが出る
- ウィンドウ2: "state: setup" / "セットアップ中…" に切り替わる
- ウィンドウ3: 同上

どのブラウザも URL は変わっていない (`/`, `/player?id=A`, `/player?id=B`)。

- [ ] **Step 5: Setup → Guide 遷移を確認 (intro 操作 → player が自動で Loading)**

ウィンドウ1 の **SETUP_DONE (mock)** をクリック。
Expected:
- ウィンドウ1: "state: roundLoading" / Guide セクション ("プレイヤー画面の前へ移動してください")
- ウィンドウ2: "state: roundLoading" / "Round 1 準備中…"
- ウィンドウ3: 同上

これでユーザ要件「ガイド画面に到達した際にプレイヤー画面側では自動でラウンド開始画面に遷移する」がサーバドリブンで動いていることが確認できる。

- [ ] **Step 6: ブラウザを閉じて再接続 (接続永続性の確認)**

ウィンドウ2 を閉じてから、同じURL (`/player?id=A`) で再度開く。
Expected: 直近の state (`roundLoading`) を即座に受信して表示。

(※ Phase 1 では orchestrator が無いので `roundLoading` のまま停滞する。これは Phase 3 で解消。)

- [ ] **Step 7: `README.md` (root) を作成**

```markdown
# sanu0420hack-r3 — Pair Arcade

2人1組でプレイするアーケードゲーム。仕様: [docs/README.md](./docs/README.md)、
実装計画インデックス: [docs/plans/00-overview.md](./docs/plans/00-overview.md)。

## Prerequisites
- Node 20 (`.nvmrc`)
- pnpm 9

## Setup
```bash
pnpm install
```

## Dev (2ペインで起動)
```bash
pnpm --filter @app/server dev
pnpm --filter @app/web dev
```

3つのブラウザで開きっぱなしにする:
- ノートPC (intro): http://localhost:5173/
- LGディスプレイ A: http://<host>:5173/player?id=A
- LGディスプレイ B: http://<host>:5173/player?id=B

すべての画面遷移はサーバの XState 状態マシンが駆動するため、プレイヤーは
intro 画面で STARTボタン / Setup送信 を押すだけでよい。プレイヤー画面は
`session:state` 受信に従って自動で描画を切り替える。

## Test
```bash
pnpm -r test
```
```

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs: add root README with dev instructions"
```

---

## Self-Review (本計画の最終確認)

Phase 1 完了時点で達成されていること:

- README.md の状態遷移図の全遷移が XState machine のユニットテストで走る (Task 4)
- サーバ側に単一 SessionRuntime、Socket.io `/session` が role 検査を行い、intro のみ `client:event` を受理する (Task 6, 7)
- 3画面 (intro / player A / player B) が常時接続し、サーバの state 変化を `session:state` で受けて投影する (Task 8, 9)
- ユーザ要件 "intro の Start→Setup→Guide は intro での手動操作で進むが、Guide 到達時にプレイヤー画面は自動で Round Loading へ遷移する" が、Task 10 Step 4/5 の手動スモークで視認できる

Phase 2 で着手する範囲 (本Phase完了後に詳細計画 `02-intro-setup.md` を書く):
- Setup フォーム本体 (名前2つと関係性)
- Guide 画面の `PLAYER_URL_A/B` 表示 + QR
- intro 各ビューをファイル分割 (`views/intro/StartView.tsx` など)
- player の各ビューのビジュアル (背景だけ動くStartライクな画面、Loading アニメ等)
