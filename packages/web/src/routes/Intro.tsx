import { useEffect, useRef, useState } from "react";
import type { ClientEvent, SessionSnapshot } from "@app/shared";
import { connectIntroSocket, type AppSocket } from "../net/socket.js";

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

  if (!snap) {
    return (
      <main style={{ padding: 32, fontFamily: "sans-serif" }}>
        <p>connecting to server...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1>Pair Arcade — Intro</h1>
      <p>
        state: <code>{snap.state}</code>
      </p>
      {snap.state === "waiting" && (
        <button
          onClick={() => trigger({ type: "START" })}
          style={{ fontSize: 24, padding: "12px 24px" }}
        >
          START
        </button>
      )}
      {snap.state === "setup" && (
        <section>
          <h2>Setup</h2>
          <p>Setup フォームは Phase 2 で実装。今は SETUP_DONE のモックボタンのみ。</p>
          <button
            onClick={() =>
              trigger({
                type: "SETUP_DONE",
                data: {
                  players: {
                    A: { id: "A", name: "PlayerA" },
                    B: { id: "B", name: "PlayerB" },
                  },
                  relationship: "友人",
                },
              })
            }
          >
            SETUP_DONE (mock)
          </button>
        </section>
      )}
      {(snap.state === "roundLoading" ||
        snap.state === "roundPlaying" ||
        snap.state === "roundResult") && (
        <section>
          <h2>Guide</h2>
          <p>プレイヤーはプレイヤー画面の前へ移動してください。</p>
          <p>Round: {snap.currentRound}</p>
          <p>実装は Phase 2〜 で拡張。</p>
        </section>
      )}
      {snap.state === "totalResult" && (
        <section>
          <h2>Finish</h2>
          <p>最終結果はプレイヤー画面に表示中。</p>
          <button onClick={() => trigger({ type: "RESET" })}>RESET</button>
        </section>
      )}
    </main>
  );
}
