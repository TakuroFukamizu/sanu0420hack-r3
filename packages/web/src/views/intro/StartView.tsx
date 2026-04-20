import { useEffect } from "react";
import { showLogoSequence } from "../../fx/textEffects.js";

interface Props {
  onStart: () => void;
}

export function StartView({ onStart }: Props) {
  useEffect(() => {
    showLogoSequence(onStart);
    // showLogoSequence 側で 600ms のフェードアウト後に DOM をクリーンアップしている。
    // StrictMode の再マウントにも耐えるよう、再実行時に古い要素は getOrCreateLayer() 内で消している。
  }, [onStart]);

  // レイヤは #fx-text-layer (body 直下) で描画するため、背景だけ提供する。
  return (
    <main className="intro-start">
      <div className="bg-pan" />
    </main>
  );
}
