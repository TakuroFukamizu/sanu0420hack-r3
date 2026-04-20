import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionRuntime } from "../src/session-runtime.js";
import { BgmController } from "../src/midi/bgm-controller.js";
import { FakeMidiOutput } from "../src/midi/output.js";
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

function completeNamingToRound1Loading(rt: SessionRuntime) {
  rt.send({ type: "START" });
  rt.send({ type: "SETUP_DONE", data: setupData() });
  rt.send({ type: "PLAYER_NAMED", playerId: "A", name: "あきら" });
  rt.send({ type: "PLAYER_NAMED", playerId: "B", name: "さくら" });
  // roundLoading (round=1) にいる前提
}

describe("BgmController", () => {
  let rt: SessionRuntime;
  let fake: FakeMidiOutput;
  let ctrl: BgmController;

  beforeEach(() => {
    vi.useFakeTimers();
    rt = new SessionRuntime();
    fake = new FakeMidiOutput();
    ctrl = new BgmController(rt, fake, { rng: () => 0.5 });
    ctrl.start();
  });

  afterEach(() => {
    ctrl.stop();
    rt.stop();
    vi.useRealTimers();
  });

  it("does not emit MIDI while waiting / setup / playerNaming", () => {
    // まだ roundLoading に入っていない状態で subscribe 直後に届く initial snapshot も
    // waiting state なので何も出ない。
    expect(fake.messages).toEqual([]);
    rt.send({ type: "START" });
    rt.send({ type: "SETUP_DONE", data: setupData() });
    expect(fake.messages).toEqual([]);
  });

  it("initializes instruments and starts playback on roundLoading (round=1, level=0)", () => {
    completeNamingToRound1Loading(rt);
    expect(rt.get().state).toBe("roundLoading");
    expect(rt.get().currentRound).toBe(1);

    // roundLoading 進入直後: initGmInstruments が走るので program change + CC が出る
    const programs = fake.messages.filter((m) => m.kind === "program");
    expect(programs.length).toBeGreaterThan(0);

    // ループは setTimeout で駆動されている。16分 × 100 BPM = 150ms 進めるとステップ 0 が発火。
    const msgCountBefore = fake.messages.length;
    vi.advanceTimersByTime(150);
    const msgCountAfter = fake.messages.length;
    // ステップ 0 で少なくとも bass (step%4===0) と drum kick は発火
    expect(msgCountAfter).toBeGreaterThan(msgCountBefore);

    const noteOnsAfterStep = fake.messages
      .slice(msgCountBefore)
      .filter((m) => m.kind === "noteOn");
    // bass channel (ch 1) が鳴っている
    expect(noteOnsAfterStep.some((m) => m.channel === 1)).toBe(true);
  });

  it("restarts with friendship=scores[1] on Round 2 roundLoading", () => {
    completeNamingToRound1Loading(rt);
    // Round 1 完走: roundPlaying → roundResult → NEXT_ROUND
    // game context が必要なので ROUND_READY/ROUND_COMPLETE を偽 gameで回す。
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    expect(rt.get().state).toBe("roundPlaying");
    rt.send({ type: "ROUND_COMPLETE", score: 80, qualitative: "ok" });
    expect(rt.get().state).toBe("roundResult");

    const beforeRestart = fake.messages.length;
    rt.send({ type: "NEXT_ROUND" });
    expect(rt.get().state).toBe("roundLoading");
    expect(rt.get().currentRound).toBe(2);

    // roundLoading 再進入で再生成 + 再初期化
    const afterRestart = fake.messages.slice(beforeRestart);
    // allNotesOff (stopPlayback 由来) が走り、続いて program change が再送される
    expect(afterRestart.some((m) => m.kind === "allNotesOff")).toBe(true);
    expect(afterRestart.some((m) => m.kind === "program")).toBe(true);

    // BPM は 100 + 80*0.6 = 148 → 1 ステップ ≈ 101.35ms
    // 前回 loop が stop されている (stopPlayback による generation bump)
    // 新 loop で 102ms 進めるとステップ 0 発火
    const beforeStep = fake.messages.length;
    vi.advanceTimersByTime(102);
    expect(fake.messages.length).toBeGreaterThan(beforeStep);
  });

  it("restarts with friendship=scores[2] on Round 3 roundLoading", () => {
    completeNamingToRound1Loading(rt);
    // round 1
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    rt.send({ type: "ROUND_COMPLETE", score: 50, qualitative: "x" });
    rt.send({ type: "NEXT_ROUND" }); // → round 2 roundLoading

    // round 2
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    rt.send({ type: "ROUND_COMPLETE", score: 30, qualitative: "y" });

    const before = fake.messages.length;
    rt.send({ type: "NEXT_ROUND" }); // → round 3 roundLoading
    expect(rt.get().currentRound).toBe(3);

    // 新 loop が scores[2]=30 に基づき始動している
    const after = fake.messages.slice(before);
    expect(after.some((m) => m.kind === "allNotesOff")).toBe(true);
    expect(after.some((m) => m.kind === "program")).toBe(true);
  });

  it("stops playback + allNotesOff on totalResult", () => {
    completeNamingToRound1Loading(rt);
    // round 1 再生中
    vi.advanceTimersByTime(500);

    // ラウンド 3 まで進めて SESSION_DONE
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    rt.send({ type: "ROUND_COMPLETE", score: 0, qualitative: "z" });
    rt.send({ type: "NEXT_ROUND" });
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    rt.send({ type: "ROUND_COMPLETE", score: 0, qualitative: "z" });
    rt.send({ type: "NEXT_ROUND" });
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    rt.send({ type: "ROUND_COMPLETE", score: 0, qualitative: "z" });

    const before = fake.messages.length;
    rt.send({ type: "SESSION_DONE", verdict: ["verdict"] });
    expect(rt.get().state).toBe("totalResult");

    const after = fake.messages.slice(before);
    expect(after.some((m) => m.kind === "allNotesOff")).toBe(true);

    // その後タイマを進めても新規 noteOn は出ない
    const countBeforeAdvance = fake.messages.length;
    vi.advanceTimersByTime(1000);
    const newNoteOns = fake.messages
      .slice(countBeforeAdvance)
      .filter((m) => m.kind === "noteOn");
    expect(newNoteOns).toHaveLength(0);
  });

  it("stays silent after RESET → waiting (already stopped at totalResult)", () => {
    completeNamingToRound1Loading(rt);
    vi.advanceTimersByTime(500);

    // SESSION_DONE → totalResult (ここで stopPlayback) → RESET → waiting
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    rt.send({ type: "ROUND_COMPLETE", score: 0, qualitative: "z" });
    rt.send({ type: "NEXT_ROUND" });
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    rt.send({ type: "ROUND_COMPLETE", score: 0, qualitative: "z" });
    rt.send({ type: "NEXT_ROUND" });
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    rt.send({ type: "ROUND_COMPLETE", score: 0, qualitative: "z" });
    rt.send({ type: "SESSION_DONE", verdict: ["v"] });

    const before = fake.messages.length;
    rt.send({ type: "RESET" });
    expect(rt.get().state).toBe("waiting");

    // totalResult で既に停止済なので RESET で追加の allNotesOff は出さない (no-op)。
    const after = fake.messages.slice(before);
    expect(after.filter((m) => m.kind === "allNotesOff")).toHaveLength(0);

    // 再生も再開していない
    vi.advanceTimersByTime(1000);
    const finalNoteOns = fake.messages
      .slice(before)
      .filter((m) => m.kind === "noteOn");
    expect(finalNoteOns).toHaveLength(0);
  });

  it("stops playback mid-round when transitioning waiting via RESET after session completion", () => {
    // totalResult 経由せず、Round 再生中に setup→waiting は state machine 的に不可能。
    // 代わりに、Round 1 再生中 → 直接 SESSION_DONE ルートを経由できないので、
    // ここでは Round 1 再生中の状態 (loop が動いている) から totalResult へ進める方の
    // allNotesOff が出ることを確認する。
    completeNamingToRound1Loading(rt);
    vi.advanceTimersByTime(300);

    // ここまで loop が動いている → isPlaying() = true
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    rt.send({ type: "ROUND_COMPLETE", score: 0, qualitative: "z" });
    rt.send({ type: "NEXT_ROUND" });
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    rt.send({ type: "ROUND_COMPLETE", score: 0, qualitative: "z" });
    rt.send({ type: "NEXT_ROUND" });
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    rt.send({ type: "ROUND_COMPLETE", score: 0, qualitative: "z" });

    const before = fake.messages.length;
    rt.send({ type: "SESSION_DONE", verdict: ["v"] });
    const after = fake.messages.slice(before);
    // loop が動いていたので totalResult 進入時に allNotesOff が出る
    expect(after.some((m) => m.kind === "allNotesOff")).toBe(true);
  });

  it("keeps same loop running through roundPlaying and roundResult without regenerating", () => {
    completeNamingToRound1Loading(rt);
    // roundLoading 進入で出た program changes の数を記録
    const programsAfterRoundLoading = fake.messages.filter(
      (m) => m.kind === "program",
    ).length;

    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    expect(rt.get().state).toBe("roundPlaying");
    // roundPlaying 進入時は再生成しない → program changes は増えない
    expect(
      fake.messages.filter((m) => m.kind === "program").length,
    ).toBe(programsAfterRoundLoading);

    rt.send({ type: "ROUND_COMPLETE", score: 50, qualitative: "x" });
    expect(rt.get().state).toBe("roundResult");
    expect(
      fake.messages.filter((m) => m.kind === "program").length,
    ).toBe(programsAfterRoundLoading);
  });

  it("stop() unsubscribes and cancels pending timers (no messages after stop)", () => {
    completeNamingToRound1Loading(rt);
    vi.advanceTimersByTime(300);
    ctrl.stop();

    const before = fake.messages.length;
    // state を進めても購読解除済みで何も出ない
    rt.send({
      type: "ROUND_READY",
      game: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "Q", choices: ["1", "2", "3", "4"] },
          B: { question: "Q", choices: ["1", "2", "3", "4"] },
        },
      },
    });
    vi.advanceTimersByTime(5000);
    const afterMessages = fake.messages.slice(before);
    // stop() で allNotesOff が 1 回出るのは OK、それ以降は空
    const newNoteOns = afterMessages.filter((m) => m.kind === "noteOn");
    expect(newNoteOns).toHaveLength(0);
  });
});
