import type { RoundNumber } from "@app/shared";

interface Props {
  scores: Record<RoundNumber, number | null>;
  verdict: string[] | null;
  onReset: () => void;
}

const VERDICT_SLOTS = [0, 1, 2] as const;

function sumScores(scores: Record<RoundNumber, number | null>): number {
  return (scores[1] ?? 0) + (scores[2] ?? 0) + (scores[3] ?? 0);
}

export function FinishView({ scores, verdict, onReset }: Props) {
  const rounds: RoundNumber[] = [1, 2, 3];
  const total = sumScores(scores);

  return (
    <main className="intro-finish">
      <h1>最終診断</h1>
      <ol className="verdict-list">
        {VERDICT_SLOTS.map((i) => (
          <li key={i}>
            <span className="index">#{i + 1}</span>
            <span className="text">{verdict?.[i] ?? "(準備中)"}</span>
          </li>
        ))}
      </ol>
      <div className="score-grid">
        {rounds.map((r) => (
          <div key={r} className="round-cell">
            <div className="round-label">Round {r}</div>
            <div className="round-score">{scores[r] ?? "-"}</div>
          </div>
        ))}
        <div className="round-cell total">
          <div className="round-label">合計</div>
          <div className="round-score">{total}</div>
        </div>
      </div>
      <button type="button" className="finish-button" onClick={onReset}>
        終了
      </button>
    </main>
  );
}
