import { describe, it, expect } from "vitest";
import { createActor } from "xstate";
import { sessionMachine, snapshotToDTO } from "../src/machine.js";

function setupData() {
  return {
    players: {
      A: { id: "A" as const, name: "Alice" },
      B: { id: "B" as const, name: "Bob" },
    },
    relationship: "友達" as const,
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
    expect(snap.context.setup?.relationship).toBe("友達");
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
