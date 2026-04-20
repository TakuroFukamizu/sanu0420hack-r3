import type { SessionSnapshot, SessionStateName } from "@app/shared";
import type { SessionRuntime } from "../session-runtime.js";
import type { Scheduler } from "../orchestrator/scheduler.js";
import { realScheduler } from "../orchestrator/scheduler.js";
import type { MidiOutput } from "./output.js";
import { scenesByState, type Scene, type SceneNote } from "./scenes.js";

type HeldKey = `${number}:${number}`; // `${channel}:${note}`

export class MidiController {
  private unsubscribe: (() => void) | null = null;
  private pendingCancels: Array<() => void> = [];
  private heldNotes = new Set<HeldKey>();
  private lastScene: SessionStateName | null = null;
  /**
   * scene を切り替えるたびに +1 する世代番号。scheduler に積まれた stale callback
   * は、自分の gen が現行 gen と一致しない場合すぐに return することで無視される。
   */
  private activeLoopGen = 0;
  private stopped = false;

  constructor(
    private runtime: SessionRuntime,
    private output: MidiOutput,
    private scheduler: Scheduler = realScheduler,
  ) {}

  start(): void {
    if (this.unsubscribe || this.stopped) return;
    this.unsubscribe = this.runtime.subscribe((snap) => this.onState(snap));
    // SessionRuntime.subscribe は登録直後に現在 snapshot を同期で listener に流すので、
    // この時点で現在 state の scene が発火済み。
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.extinguish();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.output.close();
  }

  private onState(snap: SessionSnapshot): void {
    if (this.stopped) return;
    const next = snap.state;
    if (next === this.lastScene) return;
    this.lastScene = next;
    const scene = scenesByState[next];
    this.playScene(scene);
  }

  private playScene(scene: Scene): void {
    this.extinguish();
    this.activeLoopGen += 1;
    const gen = this.activeLoopGen;
    if (scene.program) {
      this.output.send({
        type: "programchange",
        channel: scene.program.channel,
        number: scene.program.number,
      });
    }
    for (const n of scene.notes) {
      this.scheduleNoteOn(n, gen);
    }
    if (scene.loopPeriodMs && scene.loopPeriodMs > 0) {
      this.scheduleLoop(scene, gen);
    }
  }

  private scheduleNoteOn(n: SceneNote, gen: number): void {
    const cancelOn = this.scheduler.schedule(n.offsetMs, () => {
      if (gen !== this.activeLoopGen || this.stopped) return;
      const key: HeldKey = `${n.channel}:${n.note}`;
      this.heldNotes.add(key);
      this.output.send({
        type: "noteon",
        note: n.note,
        velocity: n.velocity,
        channel: n.channel,
      });
      const cancelOff = this.scheduler.schedule(n.durationMs, () => {
        if (gen !== this.activeLoopGen || this.stopped) return;
        if (this.heldNotes.delete(key)) {
          this.output.send({
            type: "noteoff",
            note: n.note,
            velocity: 0,
            channel: n.channel,
          });
        }
      });
      this.pendingCancels.push(cancelOff);
    });
    this.pendingCancels.push(cancelOn);
  }

  private scheduleLoop(scene: Scene, gen: number): void {
    const cancel = this.scheduler.schedule(scene.loopPeriodMs!, () => {
      if (gen !== this.activeLoopGen || this.stopped) return;
      // 同一 scene を再発火。scene が切り替わっていれば gen 不一致で no-op。
      this.playScene(scene);
    });
    this.pendingCancels.push(cancel);
  }

  /** 現在鳴っている全ノートを noteoff、pending timer を全 cancel。*/
  private extinguish(): void {
    for (const cancel of this.pendingCancels) cancel();
    this.pendingCancels = [];
    for (const key of this.heldNotes) {
      const [channelStr, noteStr] = key.split(":");
      const channel = Number(channelStr);
      const note = Number(noteStr);
      this.output.send({ type: "noteoff", note, velocity: 0, channel });
    }
    this.heldNotes.clear();
  }
}
