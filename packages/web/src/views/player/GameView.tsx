import type { CurrentGame, PlayerId, RoundNumber } from "@app/shared";
import { SyncAnswerGame } from "../../games/SyncAnswerGame.js";
import { PartnerQuizGame } from "../../games/PartnerQuizGame.js";
import { TimingSyncGame } from "../../games/TimingSyncGame.js";

interface Props {
  playerId: PlayerId;
  round: RoundNumber | null;
  currentGame: CurrentGame | null;
  onSyncAnswer: (choice: 0 | 1 | 2 | 3) => void;
  onPartnerQuiz: (choice: 0 | 1 | 2 | 3) => void;
  onTimingSync: (tapTime: number) => void;
}

export function GameView({
  playerId,
  round,
  currentGame,
  onSyncAnswer,
  onPartnerQuiz,
  onTimingSync,
}: Props) {
  if (!currentGame || round === null) {
    return (
      <main className="player-stub">
        <h1>Round 準備中…</h1>
      </main>
    );
  }

  switch (currentGame.gameId) {
    case "sync-answer":
      return (
        <SyncAnswerGame
          config={currentGame.perPlayerConfigs[playerId]}
          onSubmit={(i) => onSyncAnswer(i.choice)}
        />
      );
    case "partner-quiz":
      return (
        <PartnerQuizGame
          playerId={playerId}
          config={currentGame.perPlayerConfigs[playerId]}
          onSubmit={(i) => onPartnerQuiz(i.choice)}
        />
      );
    case "timing-sync":
      return (
        <TimingSyncGame
          config={currentGame.perPlayerConfigs[playerId]}
          onSubmit={(i) => onTimingSync(i.tapTime)}
        />
      );
  }
}
