import { useState } from "react";
import type { PlayerId } from "@app/shared";
import { HiraganaKeyboard } from "./HiraganaKeyboard.js";

interface Props {
  playerId: PlayerId;
  onSubmit: (name: string) => void;
}

export function NamingView({ playerId, onSubmit }: Props) {
  const [value, setValue] = useState("");
  return (
    <main className="player-naming">
      <header>
        <span className="pn-title">Player {playerId} のなまえ</span>
        <span className="pn-input">
          {value}
          <span className="pn-cursor">|</span>
        </span>
      </header>
      <HiraganaKeyboard
        value={value}
        onChange={setValue}
        onSubmit={() => {
          const trimmed = value.trim();
          if (trimmed === "") return;
          onSubmit(trimmed);
        }}
      />
    </main>
  );
}
