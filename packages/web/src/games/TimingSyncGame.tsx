import { useState } from "react";
import type { TimingSyncConfig, TimingSyncInput } from "@app/shared";

interface Props {
  config: TimingSyncConfig;
  onSubmit: (input: TimingSyncInput) => void;
}

export function TimingSyncGame({ config, onSubmit }: Props) {
  const [tapped, setTapped] = useState<boolean>(false);

  function handleTap() {
    if (tapped) return;
    setTapped(true);
    onSubmit({ tapTime: Date.now() });
  }

  return (
    <main className="game timing-sync">
      <p className="game-prompt">{config.instruction}</p>
      <button
        type="button"
        className={`tap-button ${tapped ? "tapped" : ""}`}
        disabled={tapped}
        onPointerDown={handleTap}
      >
        {tapped ? "タップ完了" : "TAP!"}
      </button>
      {tapped && <p className="game-wait">相方の操作を待っています…</p>}
    </main>
  );
}
