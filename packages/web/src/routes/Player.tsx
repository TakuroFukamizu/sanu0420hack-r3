import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { PlayerId, SessionSnapshot } from "@app/shared";
import { connectPlayerSocket } from "../net/socket.js";
import { useViewport } from "../hooks/useViewport.js";
import { WaitingView } from "../views/player/WaitingView.js";
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

  useEffect(() => {
    if (!playerId) {
      setErr("?id=A または ?id=B のクエリが必要です");
      return;
    }
    const s = connectPlayerSocket(playerId);
    s.on("session:state", setSnap);
    s.on("connect_error", (e) => setErr(String(e)));
    return () => {
      s.close();
    };
  }, [playerId]);

  if (err) return <main className="error-screen">{err}</main>;
  if (!snap || !playerId) return <main className="loading-screen">connecting...</main>;

  switch (snap.state) {
    case "waiting":
    case "setup":
      return <WaitingView playerId={playerId} />;
    case "roundLoading":
      return <LoadingView round={snap.currentRound} />;
    case "roundPlaying":
      return <GameView round={snap.currentRound} />;
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
