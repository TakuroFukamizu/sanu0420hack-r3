import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionRuntime } from "../src/session-runtime.js";
import { Orchestrator } from "../src/orchestrator/index.js";
import { FakeScheduler } from "../src/orchestrator/scheduler.js";
import { MockAiGateway } from "../src/ai/mock.js";
import type { SetupData } from "@app/shared";

function setupData(): SetupData {
  return {
    players: {
      A: { id: "A", name: "Alice" },
      B: { id: "B", name: "Bob" },
    },
    relationship: "友達" as const,
  };
}

function completeSetupAndNaming(rt: SessionRuntime) {
  rt.send({ type: "START" });
  rt.send({ type: "SETUP_DONE", data: setupData() });
  rt.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
  rt.send({ type: "PLAYER_NAMED", playerId: "B", name: "さくら" });
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

  it("does not schedule while playerNaming", () => {
    rt.send({ type: "START" });
    rt.send({ type: "SETUP_DONE", data: setupData() });
    expect(rt.get().state).toBe("playerNaming");
    expect(sched.pendingCount).toBe(0);
  });

  it("schedules ROUND_READY when entering roundLoading", async () => {
    completeSetupAndNaming(rt);
    expect(rt.get().state).toBe("roundLoading");
    expect(sched.pendingCount).toBe(1);

    await sched.runAll();
    expect(rt.get().state).toBe("roundPlaying");
  });

  it("runs a full 3-round cycle to totalResult", async () => {
    completeSetupAndNaming(rt);
    // 9 schedule tasks drive the full cycle (see plan for enumeration).
    for (let i = 0; i < 9; i++) {
      expect(sched.pendingCount).toBe(1);
      await sched.runAll();
    }

    const snap = rt.get();
    expect(snap.state).toBe("totalResult");
    expect(snap.scores[1]).not.toBeNull();
    expect(snap.scores[2]).not.toBeNull();
    expect(snap.scores[3]).not.toBeNull();
    expect(snap.qualitativeEvals[1]).toBeTypeOf("string");
    expect(snap.qualitativeEvals[2]).toBeTypeOf("string");
    expect(snap.qualitativeEvals[3]).toBeTypeOf("string");
    expect(Array.isArray(snap.finalVerdict)).toBe(true);
    expect(snap.finalVerdict?.length).toBe(3);
    expect(snap.finalVerdict?.[0]).toBeTypeOf("string");
    expect(sched.pendingCount).toBe(0);
  });

  it("does not schedule additional timers in totalResult or waiting", async () => {
    completeSetupAndNaming(rt);
    for (let i = 0; i < 9; i++) await sched.runAll();
    expect(rt.get().state).toBe("totalResult");
    rt.send({ type: "RESET" });
    expect(rt.get().state).toBe("waiting");
    expect(sched.pendingCount).toBe(0);
  });

  it("stop() cancels pending timers and detaches listener", () => {
    completeSetupAndNaming(rt);
    expect(sched.pendingCount).toBe(1);
    orch.stop();
    expect(sched.pendingCount).toBe(0);

    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["a", "b", "c", "d"] },
          B: { question: "Q", choices: ["a", "b", "c", "d"] },
        },
      },
    });
    expect(sched.pendingCount).toBe(0);
  });

  it("completes a round immediately when both players submit input", async () => {
    completeSetupAndNaming(rt); // -> roundLoading
    await sched.runAll(); // roundLoading timer -> ROUND_READY -> roundPlaying
    expect(rt.get().state).toBe("roundPlaying");
    const current = rt.get().currentGame;
    expect(current?.gameId).toBe("sync-answer");

    // 両者 input: sync-answer の場合は { choice: 0..3 }
    orch.onPlayerInput("A", {
      round: 1,
      gameId: "sync-answer" as const,
      payload: { choice: 0 },
    });
    expect(rt.get().state).toBe("roundPlaying"); // 1人だけではまだ
    orch.onPlayerInput("B", {
      round: 1,
      gameId: "sync-answer" as const,
      payload: { choice: 0 },
    });
    expect(rt.get().state).toBe("roundResult");
    expect(rt.get().scores[1]).toBe(100); // 同じ choice なら 100
    expect(rt.get().qualitativeEvals[1]).toBeTypeOf("string");
    // 旧 timer は cancel されているはずなので pending も 1 本 (roundResult の timer) だけ
    expect(sched.pendingCount).toBe(1);
  });

  it("completes a round with partial input on timeout", async () => {
    completeSetupAndNaming(rt); // -> roundLoading
    await sched.runAll(); // -> roundPlaying
    const current = rt.get().currentGame!;
    orch.onPlayerInput("A", {
      round: 1,
      gameId: "sync-answer" as const,
      payload: { choice: 2 },
    });
    // B が入れないままタイムアップ
    await sched.runAll();
    expect(rt.get().state).toBe("roundResult");
    expect(rt.get().scores[1]).toBe(0); // 片方だけなので scoreFn の fallback
  });

  // Codex review: duplicate-submit edge — same player re-tap must be ignored (first-wins)
  it("ignores duplicate onPlayerInput from the same player (first-wins)", async () => {
    completeSetupAndNaming(rt);
    await sched.runAll(); // -> roundPlaying (sync-answer)
    const current = rt.get().currentGame!;
    orch.onPlayerInput("A", {
      round: 1,
      gameId: "sync-answer" as const,
      payload: { choice: 0 },
    });
    // 2 度目の A は無視されるべき (state は roundPlaying のまま、B を待つ)
    orch.onPlayerInput("A", {
      round: 1,
      gameId: "sync-answer" as const,
      payload: { choice: 3 }, // 変えても反映されない
    });
    expect(rt.get().state).toBe("roundPlaying");
    orch.onPlayerInput("B", {
      round: 1,
      gameId: "sync-answer" as const,
      payload: { choice: 0 }, // A の最初の choice=0 と一致
    });
    expect(rt.get().state).toBe("roundResult");
    expect(rt.get().scores[1]).toBe(100); // first-wins なので一致した
  });

  // Codex review: 早期完了で state が roundPlaying を離れた後に、stale な onPlayerInput が
  // もう片方分を reintroduce して二重 completeRound が走らないこと。completeRound 内の
  // `state !== "roundPlaying"` guard + roundToken bump の両方で defensive。
  it("ignores late onPlayerInput after early completion (state guard)", async () => {
    completeSetupAndNaming(rt);
    await sched.runAll(); // -> roundPlaying
    const current = rt.get().currentGame!;
    orch.onPlayerInput("A", { round: 1, gameId: "sync-answer" as const, payload: { choice: 0 } });
    orch.onPlayerInput("B", { round: 1, gameId: "sync-answer" as const, payload: { choice: 0 } });
    expect(rt.get().state).toBe("roundResult");
    const scoreBefore = rt.get().scores[1];
    // ここで遅延して届いた第三の input (壊れた client / ネット遅延) を流す。
    orch.onPlayerInput("A", { round: 1, gameId: "sync-answer" as const, payload: { choice: 3 } });
    expect(rt.get().state).toBe("roundResult");
    expect(rt.get().scores[1]).toBe(scoreBefore);
  });
});

describe("Orchestrator with AiGateway injection", () => {
  let rt: SessionRuntime;
  let sched: FakeScheduler;
  let orch: Orchestrator;

  beforeEach(() => {
    rt = new SessionRuntime();
    sched = new FakeScheduler();
  });

  afterEach(() => {
    orch.stop();
    rt.stop();
  });

  it("calls gateway.planSession once at roundLoading round=1", async () => {
    const calls: string[] = [];
    const spyGw = new MockAiGateway();
    const original = spyGw.planSession.bind(spyGw);
    spyGw.planSession = async (setup) => {
      calls.push("plan");
      return original(setup);
    };
    orch = new Orchestrator(rt, sched, undefined, { gateway: spyGw });
    orch.start();

    completeSetupAndNaming(rt);
    // completeSetupAndNaming で active.roundLoading (round=1) 入りしているので
    // この時点で planSession は kick off 済み。
    expect(calls).toEqual(["plan"]);

    // 9 回回して完了 (全 3 ラウンド走破)。途中で planSession が再度呼ばれないことを確認。
    for (let i = 0; i < 9; i++) await sched.runAll();
    expect(rt.get().state).toBe("totalResult");
    expect(calls).toEqual(["plan"]);
  });

  it("falls back to mock when gateway throws", async () => {
    class BrokenGateway extends MockAiGateway {
      readonly name: string = "broken";
      async planSession(): Promise<never> {
        throw new Error("boom");
      }
      async generateVerdict(): Promise<never> {
        throw new Error("boom-verdict");
      }
    }
    orch = new Orchestrator(rt, sched, undefined, {
      gateway: new BrokenGateway(),
      aiTimeoutMs: 100,
    });
    orch.start();

    completeSetupAndNaming(rt);
    for (let i = 0; i < 9; i++) await sched.runAll();
    expect(rt.get().state).toBe("totalResult");
    // mock fallback で currentGame が埋まり、3 ラウンド走破できている。
    expect(rt.get().scores[3]).not.toBeNull();
    expect(Array.isArray(rt.get().finalVerdict)).toBe(true);
    expect(rt.get().finalVerdict?.length).toBe(3);
  });

  it("uses gateway.generateVerdict for final verdict", async () => {
    class CannedGateway extends MockAiGateway {
      readonly name: string = "canned";
      async generateVerdict(): Promise<string[]> {
        return ["GEMINI SAYS HELLO", "PAGE TWO", "PAGE THREE"];
      }
    }
    orch = new Orchestrator(rt, sched, undefined, {
      gateway: new CannedGateway(),
    });
    orch.start();

    completeSetupAndNaming(rt);
    for (let i = 0; i < 9; i++) await sched.runAll();
    expect(rt.get().state).toBe("totalResult");
    expect(rt.get().finalVerdict).toEqual([
      "GEMINI SAYS HELLO",
      "PAGE TWO",
      "PAGE THREE",
    ]);
  });
});
