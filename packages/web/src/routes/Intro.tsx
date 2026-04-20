import { useEffect, useRef, useState } from "react";
import type { ClientEvent, SessionSnapshot, SessionStateName } from "@app/shared";
import { connectIntroSocket, type AppSocket } from "../net/socket.js";
import { StartView } from "../views/intro/StartView.js";
import { SetupView } from "../views/intro/SetupView.js";
import { PlayerNamingWaitView } from "../views/intro/PlayerNamingWaitView.js";
import { GuideView } from "../views/intro/GuideView.js";
import { FinishView } from "../views/intro/FinishView.js";
import { showFinishText, showStartText } from "../fx/textEffects.js";
import { playDrumroll, playFanfare } from "../fx/sounds.js";

export function Intro() {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const socketRef = useRef<AppSocket | null>(null);
  const prevStateRef = useRef<SessionStateName | null>(null);
  // 「ゲーム開始」演出はセッション中 1 度だけ出す。waiting に戻ったらリセット。
  const sessionStartShownRef = useRef(false);

  useEffect(() => {
    const s = connectIntroSocket();
    socketRef.current = s;
    s.on("session:state", setSnap);
    return () => {
      s.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!snap) return;
    const prev = prevStateRef.current;
    const curr = snap.state;
    prevStateRef.current = curr;

    // ゲーム開始時 (セットアップ/ネーミング完了後に初めて roundLoading に入った瞬間)
    if (curr === "roundLoading" && !sessionStartShownRef.current) {
      sessionStartShownRef.current = true;
      showFinishText();
      playFanfare();
    }

    // ゲーム終了時 (roundResult → totalResult 遷移)
    if (prev !== "totalResult" && curr === "totalResult") {
      showStartText();
      playDrumroll(1.2);
    }

    // waiting に戻ったらセッション用フラグをリセット
    if (curr === "waiting") {
      sessionStartShownRef.current = false;
    }
  }, [snap]);

  function trigger(ev: ClientEvent) {
    socketRef.current?.emit("client:event", ev);
  }

  if (!snap) return <main className="loading-screen">connecting...</main>;

  switch (snap.state) {
    case "waiting":
      return <StartView onStart={() => trigger({ type: "START" })} />;
    case "setup":
      return <SetupView onSubmit={(data) => trigger({ type: "SETUP_DONE", data })} />;
    case "playerNaming": {
      if (!snap.setup) return null;
      return <PlayerNamingWaitView setup={snap.setup} />;
    }
    case "roundLoading":
    case "roundPlaying":
    case "roundResult":
      return <GuideView currentRound={snap.currentRound} subState={snap.state} />;
    case "totalResult":
      return (
        <FinishView
          scores={snap.scores}
          verdict={snap.finalVerdict}
          onReset={() => trigger({ type: "RESET" })}
        />
      );
    default: {
      // 新しい state 名が追加されたらここで TS2322 になり気付ける
      const _exhaustive: never = snap.state;
      return _exhaustive;
    }
  }
}
