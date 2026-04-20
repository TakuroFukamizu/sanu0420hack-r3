import { useState } from "react";
import type { PlayerId, PartnerQuizConfig, PartnerQuizInput } from "@app/shared";

interface Props {
  playerId: PlayerId;
  config: PartnerQuizConfig;
  onSubmit: (input: PartnerQuizInput) => void;
}

export function PartnerQuizGame({ playerId, config, onSubmit }: Props) {
  const [picked, setPicked] = useState<number | null>(null);

  function handlePick(i: 0 | 1 | 2 | 3) {
    if (picked !== null) return;
    setPicked(i);
    onSubmit({ choice: i });
  }

  const heading =
    config.target === playerId
      ? `あなた自身の「${config.question}」を選んでください`
      : `${config.targetName} の「${config.question}」を当ててください`;

  return (
    <main className="game partner-quiz">
      <p className="game-prompt">{heading}</p>
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
