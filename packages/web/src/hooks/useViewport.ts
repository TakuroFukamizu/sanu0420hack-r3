import { useEffect } from "react";

/**
 * `<meta name="viewport">` を mount 中に上書きし、unmount 時に元に戻す。
 * Player route だけ 1920×540 LG ディスプレイ向けに `width=1920` を指定する用途。
 * intro route はこのフックを使わないので index.html の `width=device-width` が
 * 維持される。
 */
export function useViewport(content: string): void {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute("content");
    meta.setAttribute("content", content);
    return () => {
      if (original !== null) meta.setAttribute("content", original);
    };
  }, [content]);
}
