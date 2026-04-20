const DAKUTEN_MAP: Record<string, string> = {
  か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご",
  さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ",
  た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど",
  は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ",
};

const HANDAKUTEN_MAP: Record<string, string> = {
  は: "ぱ", ひ: "ぴ", ふ: "ぷ", へ: "ぺ", ほ: "ぽ",
};

const SMALL_MAP: Record<string, string> = {
  や: "ゃ", ゆ: "ゅ", よ: "ょ", つ: "っ",
};

function replaceLastChar(input: string, map: Record<string, string>): string {
  if (input.length === 0) return input;
  const last = input[input.length - 1];
  const mapped = map[last];
  if (!mapped) return input;
  return input.slice(0, -1) + mapped;
}

export function applyDakuten(input: string): string {
  return replaceLastChar(input, DAKUTEN_MAP);
}

export function applyHandakuten(input: string): string {
  return replaceLastChar(input, HANDAKUTEN_MAP);
}

export function applySmall(input: string): string {
  return replaceLastChar(input, SMALL_MAP);
}
