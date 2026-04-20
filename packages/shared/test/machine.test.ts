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

  it("round cycle: loading -> playing -> result -> next loading", () => {
    const actor = createActor(sessionMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SETUP_DONE", data: setupData() });
    actor.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
    actor.send({ type: "PLAYER_NAMED", playerId: "B", name: "さくら" });
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
    actor.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
    actor.send({ type: "PLAYER_NAMED", playerId: "B", name: "さくら" });
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
    actor.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
    actor.send({ type: "PLAYER_NAMED", playerId: "B", name: "さくら" });
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
    actor.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
    actor.send({ type: "PLAYER_NAMED", playerId: "B", name: "さくら" });
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
    actor.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
    actor.send({ type: "PLAYER_NAMED", playerId: "B", name: "さくら" });
    const dto = snapshotToDTO(actor.getSnapshot());
    expect(dto.state).toBe("roundLoading");
    expect(dto.currentRound).toBe(1);
    expect(dto.setup?.players.A.name).toBe("あきら");
  });

  it("flattens top-level states (waiting, setup, totalResult)", () => {
    const actor = createActor(sessionMachine).start();
    expect(snapshotToDTO(actor.getSnapshot()).state).toBe("waiting");
    actor.send({ type: "START" });
    expect(snapshotToDTO(actor.getSnapshot()).state).toBe("setup");
  });

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
});
