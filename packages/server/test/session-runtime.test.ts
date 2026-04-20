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
        relationship: "友達" as const,
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
