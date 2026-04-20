import type { RoundNumber } from "@app/shared";

interface Props {
  scores: Record<RoundNumber, number | null>;
  verdict: string | null;
}

function sumScores(scores: Record<RoundNumber, number | null>): number {
  return (scores[1] ?? 0) + (scores[2] ?? 0) + (scores[3] ?? 0);
}

export function TotalResultView({ scores, verdict }: Props) {
  const total = sumScores(scores);
  const rounds: RoundNumber[] = [1, 2, 3];

  return (
    <main className="player-total-result">
      <h1>最終診断</h1>
      <p className="verdict">{verdict ?? "(準備中)"}</p>
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
    </main>
  );
}
