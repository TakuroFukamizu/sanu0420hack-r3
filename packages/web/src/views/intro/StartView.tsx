interface Props {
  onStart: () => void;
}

export function StartView({ onStart }: Props) {
  return (
    <main className="intro-start">
      <div className="bg-pan" />
      <div className="content">
        <h1>Pair Arcade</h1>
        <button className="start-button" onClick={onStart} autoFocus>
          START
        </button>
      </div>
    </main>
  );
}
