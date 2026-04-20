interface Props {
  round: number | null;
}

export function GameView({ round }: Props) {
  return (
    <main className="player-stub">
      <h1>Game — Round {round ?? "?"}</h1>
      <p className="tag">(Phase 4 で実装)</p>
    </main>
  );
}
