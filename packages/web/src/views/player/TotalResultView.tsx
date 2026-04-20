interface Props {
  verdict: string | null;
}

export function TotalResultView({ verdict }: Props) {
  return (
    <main className="player-stub">
      <h1>最終診断</h1>
      <p>{verdict ?? "(準備中)"}</p>
      <p className="tag">(Phase 3 で実装)</p>
    </main>
  );
}
