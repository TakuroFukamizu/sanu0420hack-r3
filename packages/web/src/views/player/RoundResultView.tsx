import { useEffect, useState } from "react";

interface Props {
  round: number | null;
  score: number | null;
  qualitative: string | null;
}

export function RoundResultView({ round, score, qualitative }: Props) {
  const target = score ?? 0;
  const [displayed, setDisplayed] = useState(0);
  useEffect(() => {
    setDisplayed(0);
    if (target === 0) return;
    const start = performance.now();
    const duration = 800;
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      setDisplayed(Math.round(target * t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return (
    <main className="player-round-result">
      <h1>Round {round ?? "?"} 結果</h1>
      <div className="score" aria-live="polite">
        <span className="score-value">{displayed}</span>
        <span className="score-unit">pt</span>
      </div>
      {qualitative && <p className="qualitative">{qualitative}</p>}
    </main>
  );
}
