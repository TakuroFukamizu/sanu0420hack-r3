import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionRuntime } from "../src/session-runtime.js";
import { FakeScheduler } from "../src/orchestrator/scheduler.js";
import {
  FakeMidiOutput,
  MidiController,
  scenesByState,
} from "../src/midi/index.js";

describe("MidiController", () => {
  let runtime: SessionRuntime;
  let output: FakeMidiOutput;
  let scheduler: FakeScheduler;
  let controller: MidiController;

  beforeEach(() => {
    runtime = new SessionRuntime();
    output = new FakeMidiOutput();
    scheduler = new FakeScheduler();
    controller = new MidiController(runtime, output, scheduler);
  });

  afterEach(() => {
    controller.stop();
    runtime.stop();
  });

  it("fires the current state's scene synchronously on start() (waiting)", async () => {
    controller.start();
    // subscribe() は登録直後に現在 snapshot を listener に流す → programchange 即送信。
    // noteon は offsetMs 後のためまだ scheduler 内。
    expect(output.messages).toHaveLength(1);
    expect(output.messages[0]).toEqual({
      type: "programchange",
      channel: 0,
      number: scenesByState.waiting.program!.number,
    });
    await scheduler.runAll();
    const noteons = output.messages.filter((m) => m.type === "noteon");
    expect(noteons).toHaveLength(scenesByState.waiting.notes.length);
  });

  it("extinguishes held notes with noteoff before the next scene's programchange", async () => {
    controller.start();
    await scheduler.runAll(); // waiting scene の noteon を全部発火 (held に積まれる)

    const noteonCount = output.messages.filter((m) => m.type === "noteon").length;
    expect(noteonCount).toBe(scenesByState.waiting.notes.length);

    runtime.send({ type: "START" });

    // 遷移時点で同期的に出る: [...(held 分の noteoff), new programchange]
    const afterStart = output.messages.slice(noteonCount + 1);
    const firstPc = afterStart.findIndex((m) => m.type === "programchange");
    expect(firstPc).toBeGreaterThan(0); // 先に noteoff が少なくとも 1 つある
    for (let i = 0; i < firstPc; i++) {
      expect(afterStart[i]!.type).toBe("noteoff");
    }
    expect(afterStart[firstPc]).toMatchObject({
      type: "programchange",
      number: scenesByState.setup.program!.number,
    });
  });

  it("stop() emits noteoff for all held notes, closes output, and is idempotent", async () => {
    controller.start();
    await scheduler.runAll();

    const beforeStop = output.messages.length;
    controller.stop();

    const after = output.messages.slice(beforeStop);
    expect(after.every((m) => m.type === "noteoff")).toBe(true);
    expect(after).toHaveLength(scenesByState.waiting.notes.length);
    expect(output.closed).toBe(true);

    const lenAfterFirstStop = output.messages.length;
    controller.stop();
    expect(output.messages).toHaveLength(lenAfterFirstStop);
  });

  it("ignores state events after stop()", async () => {
    controller.start();
    await scheduler.runAll();
    controller.stop();

    const before = output.messages.length;
    runtime.send({ type: "START" });
    expect(output.messages).toHaveLength(before);
  });

  it("stale scheduled callbacks from the previous scene are no-op after scene change", async () => {
    controller.start();
    await scheduler.runAll(); // waiting scene の noteon を発火 → noteoff を scheduler に積む

    // この時点で scheduler には waiting scene の noteoff タスクが積まれている。
    // setup に遷移 → extinguish で pendingCancels がキャンセルされる + 手動で noteoff 送信。
    runtime.send({ type: "START" });

    const messagesBeforeDrain = output.messages.length;
    // 残った scheduler タスクを drain: waiting の noteoff 再発火は gen 不一致で no-op、
    // setup の noteon 3 発だけが新たに追加される。
    await scheduler.runAll();

    const added = output.messages.slice(messagesBeforeDrain);
    // setup 側 noteon が 3 発出ていること (stale waiting の noteoff 再発火は無い)。
    expect(added.every((m) => m.type === "noteon")).toBe(true);
    expect(added).toHaveLength(scenesByState.setup.notes.length);
  });
});
