export interface Scheduler {
  /** fn を ms 後に実行する。返り値は cancel 関数。*/
  schedule(ms: number, fn: () => void): () => void;
}

export const realScheduler: Scheduler = {
  schedule(ms, fn) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

/** テスト用: 予約を手で回す。ms は無視して FIFO で実行する。*/
export class FakeScheduler implements Scheduler {
  private tasks: Array<{ fn: () => void; cancelled: boolean }> = [];

  schedule(_ms: number, fn: () => void): () => void {
    const task = { fn, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  }

  /** 予約された (キャンセルされていない) 全タスクを実行する。
   * 実行中に新たに schedule されたタスクは含まれない (次回 runAll で実行)。*/
  runAll(): number {
    const pending = this.tasks.filter((t) => !t.cancelled);
    this.tasks = [];
    pending.forEach((t) => t.fn());
    return pending.length;
  }

  get pendingCount(): number {
    return this.tasks.filter((t) => !t.cancelled).length;
  }
}
