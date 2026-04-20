import { useEffect, useRef, useState } from "react";
import type { ClientEvent, SessionSnapshot } from "@app/shared";
import { connectIntroSocket, type AppSocket } from "../net/socket.js";
import { StartView } from "../views/intro/StartView.js";
import { SetupView } from "../views/intro/SetupView.js";
import { GuideView } from "../views/intro/GuideView.js";
import { FinishView } from "../views/intro/FinishView.js";

export function Intro() {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const socketRef = useRef<AppSocket | null>(null);

  useEffect(() => {
    const s = connectIntroSocket();
    socketRef.current = s;
    s.on("session:state", setSnap);
    return () => {
      s.close();
      socketRef.current = null;
    };
  }, []);

  function trigger(ev: ClientEvent) {
    socketRef.current?.emit("client:event", ev);
  }

  if (!snap) return <main className="loading-screen">connecting...</main>;

  switch (snap.state) {
    case "waiting":
      return <StartView onStart={() => trigger({ type: "START" })} />;
    case "setup":
      return <SetupView onSubmit={(data) => trigger({ type: "SETUP_DONE", data })} />;
    case "roundLoading":
    case "roundPlaying":
    case "roundResult":
      return <GuideView currentRound={snap.currentRound} subState={snap.state} />;
    case "totalResult":
      return <FinishView onReset={() => trigger({ type: "RESET" })} />;
    default: {
      // 新しい state 名が追加されたらここで TS2322 になり気付ける
      const _exhaustive: never = snap.state;
      return _exhaustive;
    }
  }
}
