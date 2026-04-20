export type ScheduledFn = () => void | Promise<void>;

export interface Scheduler {
  /** fn を ms 後に実行する。返り値は cancel 関数。fn は async でよい。*/
  schedule(ms: number, fn: ScheduledFn): () => void;
}

export const realScheduler: Scheduler = {
  schedule(ms, fn) {
    const t = setTimeout(() => {
      // async 関数から Promise が返っても setTimeout は await しないが、
      // Promise 内エラーは unhandledRejection に流れるので catch しておく。
      Promise.resolve()
        .then(fn)
        .catch((e) => {
          console.error("[scheduler] async task threw:", e);
        });
    }, ms);
    return () => clearTimeout(t);
  },
};

/** テスト用: 予約を手で回す。ms は無視して FIFO で実行する。*/
export class FakeScheduler implements Scheduler {
  private tasks: Array<{ fn: ScheduledFn; cancelled: boolean }> = [];

  schedule(_ms: number, fn: ScheduledFn): () => void {
    const task = { fn, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  }

  /** 予約された (キャンセルされていない) 全タスクを実行する。
   * 実行中に新たに schedule されたタスクは含まれない (次回 runAll で実行)。
   * async task は for-of の中で await される。*/
  async runAll(): Promise<number> {
    const pending = this.tasks.filter((t) => !t.cancelled);
    this.tasks = [];
    for (const t of pending) {
      await t.fn();
    }
    return pending.length;
  }

  get pendingCount(): number {
    return this.tasks.filter((t) => !t.cancelled).length;
  }
}
