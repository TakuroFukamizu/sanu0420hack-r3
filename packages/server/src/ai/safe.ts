/** 指定の Promise を ms でタイムアウトさせる。失敗時は reject。
 *  Orchestrator の safePlan/safeVerdict/safeRefine から使う。*/
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`timeout after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
