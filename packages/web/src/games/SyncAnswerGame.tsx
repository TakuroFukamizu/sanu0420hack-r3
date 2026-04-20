import { useState } from "react";
import type { SyncAnswerConfig, SyncAnswerInput } from "@app/shared";

interface Props {
  config: SyncAnswerConfig;
  onSubmit: (input: SyncAnswerInput) => void;
}

export function SyncAnswerGame({ config, onSubmit }: Props) {
  const [picked, setPicked] = useState<number | null>(null);

  function handlePick(i: 0 | 1 | 2 | 3) {
    if (picked !== null) return;
    setPicked(i);
    onSubmit({ choice: i });
  }

  return (
    <main className="game sync-answer">
      <p className="game-question">{config.question}</p>
      <div className="choices">
        {config.choices.map((c, i) => (
          <button
            key={i}
            type="button"
            className={`choice ${picked === i ? "picked" : ""}`}
            disabled={picked !== null}
            onPointerDown={() => handlePick(i as 0 | 1 | 2 | 3)}
          >
            {c}
          </button>
        ))}
      </div>
      {picked !== null && (
        <p className="game-wait">相方の回答を待っています…</p>
      )}
    </main>
  );
}
