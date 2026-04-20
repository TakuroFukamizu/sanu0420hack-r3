import { useState } from "react";
import type { RoundNumber } from "@app/shared";

interface Props {
  scores: Record<RoundNumber, number | null>;
  verdict: string[] | null;
  onFinish: () => void;
}

const TOTAL_PAGES = 4;

function sumScores(scores: Record<RoundNumber, number | null>): number {
  return (scores[1] ?? 0) + (scores[2] ?? 0) + (scores[3] ?? 0);
}

function verdictLine(verdict: string[] | null, index: number): string {
  return verdict?.[index] ?? "(準備中)";
}

export function TotalResultView({ scores, verdict, onFinish }: Props) {
  const [page, setPage] = useState(0);

  if (page < TOTAL_PAGES - 1) {
    return (
      <main className="player-total-result verdict-page">
        <div className="verdict-body">
          <div className="verdict-index">#{page + 1}</div>
          <p className="verdict-text">{verdictLine(verdict, page)}</p>
        </div>
        <button
          type="button"
          className="page-next"
          aria-label="次のページ"
          onClick={() => setPage((p) => Math.min(p + 1, TOTAL_PAGES - 1))}
        >
          <span aria-hidden="true">›</span>
        </button>
      </main>
    );
  }

  const total = sumScores(scores);
  const rounds: RoundNumber[] = [1, 2, 3];
  return (
    <main className="player-total-result score-page">
      <h1>スコア</h1>
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
      <button type="button" className="finish-button" onClick={onFinish}>
        終了
      </button>
    </main>
  );
}
