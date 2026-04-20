interface Props {
  onReset: () => void;
}

export function FinishView({ onReset }: Props) {
  return (
    <main className="intro-finish">
      <h1>Session finished</h1>
      <p>最終診断はプレイヤー画面に表示されています。</p>
      <button onClick={onReset}>もう一度遊ぶ (RESET)</button>
    </main>
  );
}
