import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { PlayerId, SessionSnapshot } from "@app/shared";
import { connectPlayerSocket } from "../net/socket.js";

export function Player() {
  const [params] = useSearchParams();
  const rawId = params.get("id");
  const playerId: PlayerId | null = rawId === "A" || rawId === "B" ? rawId : null;

  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!playerId) {
      setErr("?id=A or ?id=B が必要です");
      return;
    }
    const s = connectPlayerSocket(playerId);
    s.on("session:state", setSnap);
    s.on("connect_error", (e) => setErr(String(e)));
    return () => {
      s.close();
    };
  }, [playerId]);

  if (err) return <main style={{ padding: 32, color: "red" }}>{err}</main>;
  if (!snap) return <main style={{ padding: 32 }}>connecting...</main>;

  return (
    <main style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1>Player {playerId}</h1>
      <p>
        state: <code>{snap.state}</code>
      </p>
      <p>current round: {snap.currentRound ?? "-"}</p>
      {snap.state === "waiting" && <p>スタート待ち…</p>}
      {snap.state === "setup" && <p>セットアップ中…</p>}
      {snap.state === "roundLoading" && <p>Round {snap.currentRound} 準備中…</p>}
      {snap.state === "roundPlaying" && <p>Round {snap.currentRound} プレイ中 (ゲーム本体は Phase 4)</p>}
      {snap.state === "roundResult" && (
        <p>
          Round {snap.currentRound} 終了。score =
          {snap.currentRound ? snap.scores[snap.currentRound] : "-"}
        </p>
      )}
      {snap.state === "totalResult" && <p>最終結果: {snap.finalVerdict}</p>}
      <details style={{ marginTop: 32 }}>
        <summary>debug snapshot</summary>
        <pre>{JSON.stringify(snap, null, 2)}</pre>
      </details>
    </main>
  );
}
