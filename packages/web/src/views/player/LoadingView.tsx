interface Props {
  round: number | null;
}

export function LoadingView({ round }: Props) {
  return (
    <main className="player-loading">
      <h1>Round {round ?? 1}</h1>
      <p className="pulse">準備中…</p>
    </main>
  );
}
