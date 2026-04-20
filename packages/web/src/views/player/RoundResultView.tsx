interface Props {
  round: number | null;
  score: number | null;
}

export function RoundResultView({ round, score }: Props) {
  return (
    <main className="player-stub">
      <h1>Round {round ?? "?"} 結果</h1>
      <p>score: {score ?? "-"}</p>
      <p className="tag">(Phase 3 で実装)</p>
    </main>
  );
}
