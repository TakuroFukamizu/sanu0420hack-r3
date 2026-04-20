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
    // 9 schedule tasks drive the full cycle (see plan for enumeration).
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
    expect(sched.pendingCount).toBe(0);
  });

  it("does not schedule additional timers in totalResult or waiting", () => {
    rt.send({ type: "START" });
    rt.send({ type: "SETUP_DONE", data: setupData() });
    for (let i = 0; i < 9; i++) sched.runAll();
    expect(rt.get().state).toBe("totalResult");
    rt.send({ type: "RESET" });
    expect(rt.get().state).toBe("waiting");
    expect(sched.pendingCount).toBe(0);
  });

  it("stop() cancels pending timers and detaches listener", () => {
    rt.send({ type: "START" });
    rt.send({ type: "SETUP_DONE", data: setupData() });
    expect(sched.pendingCount).toBe(1);
    orch.stop();
    expect(sched.pendingCount).toBe(0);

    rt.send({ type: "ROUND_READY" });
    expect(sched.pendingCount).toBe(0);
  });
});
