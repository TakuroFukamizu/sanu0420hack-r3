// index_effect.html からポートした全画面オーバーレイ演出。
// React の外で DOM を直接操作する。呼び出し先はイベントハンドラや useEffect から
// 関数を叩くだけで動く。StrictMode で再マウントされても副作用が重ならないよう
// 既存のエフェクト要素は先にクリアする。

import { unlockAudio } from "./sounds.js";

const LAYER_ID = "fx-text-layer";
const LOGO_BTN_ID = "fx-internal-start-btn";

function getOrCreateLayer(): HTMLDivElement {
  let layer = document.getElementById(LAYER_ID) as HTMLDivElement | null;
  if (!layer) {
    layer = document.createElement("div");
    layer.id = LAYER_ID;
    layer.className = "fx-text-layer";
    document.body.appendChild(layer);
  }
  return layer;
}

function spawnPopText(extraClasses: string[], text: string, lifeMs: number): void {
  const layer = getOrCreateLayer();
  const el = document.createElement("div");
  el.className = ["pop-text", ...extraClasses].join(" ");
  el.innerText = text;
  layer.appendChild(el);
  window.setTimeout(() => {
    el.remove();
  }, lifeMs);
}

/**
 * アプリ起動時のロゴ演出。「二人の距離」がドロップインし、
 * 0.1s 後に内部スタートボタンをポップインさせる。
 * onStart は内部ボタンが押されたときの呼び出し元コールバック。
 * フェードアウト演出は showLogoSequence 側で処理してから onStart を呼ぶ。
 */
export function showLogoSequence(onStart: () => void): void {
  const layer = getOrCreateLayer();

  // 既存のロゴ・ボタンをクリア (StrictMode 二重マウント対策)
  layer.querySelectorAll(".logo-title").forEach((n) => n.remove());
  const prevBtn = document.getElementById(LOGO_BTN_ID);
  if (prevBtn) prevBtn.remove();

  // ロゴテキスト
  const textEl = document.createElement("div");
  textEl.className = "pop-text logo-title animate-logo-in";
  textEl.innerText = "二人の距離";
  layer.appendChild(textEl);

  // 内部スタートボタン
  const btn = document.createElement("button");
  btn.id = LOGO_BTN_ID;
  btn.className = "internal-start-btn";
  btn.type = "button";
  btn.innerText = "スタートボタン";
  layer.appendChild(btn);

  window.setTimeout(() => {
    btn.classList.add("show");
  }, 100);

  btn.addEventListener(
    "click",
    () => {
      // 初回ユーザジェスチャの間に AudioContext を resume しておく。
      // 後続の playFanfare/playDrumroll はタイマー or socket 経由で呼ばれるため、
      // ここで先に unlock しないと Chrome autoplay policy で無音になることがある。
      try {
        unlockAudio();
      } catch {
        // Web Audio 非対応環境 (古い WebView 等) では何もしない
      }
      // 文字を左へ、ボタンをフェードアウト
      textEl.classList.remove("animate-logo-in");
      textEl.classList.add("animate-logo-out");
      btn.classList.remove("show");
      btn.classList.add("hide");
      window.setTimeout(() => {
        textEl.remove();
        btn.remove();
      }, 600);
      onStart();
    },
    { once: true },
  );
}

/** 「レッツスタート！」を上から落としてセンターで止め、最後に拡大フェードアウト。 */
export function showFinishText(): void {
  spawnPopText(["animate-finish"], "レッツスタート！", 1300);
}

/** 「終了」を左から中央にスライドインし、右に抜けていく。 */
export function showStartText(): void {
  spawnPopText(["animate-start"], "終了", 1300);
}

/** 「開始」を画面中央にズームイン→フェードアウト。 */
export function showBeginText(): void {
  spawnPopText(["animate-begin"], "開始", 1300);
}
