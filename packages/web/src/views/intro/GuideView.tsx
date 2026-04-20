import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PlayerUrls, SessionStateName } from "@app/shared";
import { fetchPlayerUrls } from "../../net/api.js";

type GuideSubState = Extract<
  SessionStateName,
  "roundLoading" | "roundPlaying" | "roundResult"
>;

interface Props {
  currentRound: number | null;
  subState: GuideSubState;
}

function fallbackUrls(): PlayerUrls {
  if (typeof window === "undefined") return { A: null, B: null };
  const origin = window.location.origin;
  return {
    A: `${origin}/player?id=A`,
    B: `${origin}/player?id=B`,
  };
}

export function GuideView({ currentRound, subState }: Props) {
  const [urls, setUrls] = useState<PlayerUrls | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fb = fallbackUrls();
      try {
        const server = await fetchPlayerUrls();
        if (cancelled) return;
        setUrls({
          A: server.A ?? fb.A,
          B: server.B ?? fb.B,
        });
      } catch (e) {
        // LG 実機では DevTools が使いにくいので、失敗は console に残してフォールバック
        console.warn("fetchPlayerUrls failed, falling back to window.location.origin:", e);
        if (!cancelled) setUrls(fb);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="intro-guide">
      <h1>プレイヤー画面の前に移動してください</h1>
      <p className="hint">
        {subState === "roundLoading" && `Round ${currentRound ?? 1} ゲーム選出中…`}
        {subState === "roundPlaying" && `Round ${currentRound ?? 1} プレイ中…`}
        {subState === "roundResult" && `Round ${currentRound ?? 1} 結果表示中…`}
      </p>
      <div className="url-grid">
        <div className="card">
          <h2>Player A</h2>
          <p className="placement">← 左の LG ディスプレイへ</p>
          <div className="qr-wrap">
            {urls?.A ? (
              <QRCodeSVG value={urls.A} size={192} />
            ) : (
              <p>(URL未取得)</p>
            )}
          </div>
          <code>{urls?.A ?? "—"}</code>
        </div>
        <div className="card">
          <h2>Player B</h2>
          <p className="placement">右の LG ディスプレイへ →</p>
          <div className="qr-wrap">
            {urls?.B ? (
              <QRCodeSVG value={urls.B} size={192} />
            ) : (
              <p>(URL未取得)</p>
            )}
          </div>
          <code>{urls?.B ?? "—"}</code>
        </div>
      </div>
    </main>
  );
}
