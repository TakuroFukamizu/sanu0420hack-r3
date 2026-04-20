import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { PlayerId, SessionSnapshot } from "@app/shared";
import { connectPlayerSocket, emitPlayerInput, type AppSocket } from "../net/socket.js";
import { useViewport } from "../hooks/useViewport.js";
import { WaitingView } from "../views/player/WaitingView.js";
import { NamingView } from "../views/player/NamingView.js";
import { LoadingView } from "../views/player/LoadingView.js";
import { GameView } from "../views/player/GameView.js";
import { RoundResultView } from "../views/player/RoundResultView.js";
import { TotalResultView } from "../views/player/TotalResultView.js";

export function Player() {
  useViewport("width=1920, initial-scale=1.0");
  const [params] = useSearchParams();
  const rawId = params.get("id");
  const playerId: PlayerId | null = rawId === "A" || rawId === "B" ? rawId : null;

  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const socketRef = useRef<AppSocket | null>(null);

  useEffect(() => {
    if (!playerId) {
      setErr("?id=A または ?id=B のクエリが必要です");
      return;
    }
    const s = connectPlayerSocket(playerId);
    socketRef.current = s;
    s.on("session:state", setSnap);
    s.on("connect_error", (e) => setErr(String(e)));
    return () => {
      s.close();
      socketRef.current = null;
    };
  }, [playerId]);

  if (err) return <main className="error-screen">{err}</main>;
  if (!snap || !playerId) return <main className="loading-screen">connecting...</main>;

  switch (snap.state) {
    case "waiting":
    case "setup":
      return <WaitingView playerId={playerId} />;
    case "playerNaming": {
      if (!snap.setup) return null;
      const already = snap.setup.players[playerId].name !== "";
      if (already) return <WaitingView playerId={playerId} />;
      return (
        <NamingView
          playerId={playerId}
          onSubmit={(name) => {
            const s = socketRef.current;
            s?.emit("player:setup", { name });
          }}
        />
      );
    }
    case "roundLoading":
      return <LoadingView round={snap.currentRound} />;
    case "roundPlaying": {
      const r = snap.currentRound;
      return (
        <GameView
          playerId={playerId}
          round={r}
          currentGame={snap.currentGame}
          onSyncAnswer={(choice) => {
            const s = socketRef.current;
            if (r === null || !s) return;
            emitPlayerInput(s, r, { gameId: "sync-answer", payload: { choice } });
          }}
          onPartnerQuiz={(choice) => {
            const s = socketRef.current;
            if (r === null || !s) return;
            emitPlayerInput(s, r, { gameId: "partner-quiz", payload: { choice } });
          }}
          onTimingSync={(tapTime) => {
            const s = socketRef.current;
            if (r === null || !s) return;
            emitPlayerInput(s, r, { gameId: "timing-sync", payload: { tapTime } });
          }}
        />
      );
    }
    case "roundResult": {
      const r = snap.currentRound;
      const score = r !== null ? snap.scores[r] : null;
      const qualitative = r !== null ? snap.qualitativeEvals[r] : null;
      return <RoundResultView round={r} score={score} qualitative={qualitative} />;
    }
    case "totalResult":
      return <TotalResultView scores={snap.scores} verdict={snap.finalVerdict} />;
    default: {
      const _exhaustive: never = snap.state;
      return _exhaustive;
    }
  }
}
