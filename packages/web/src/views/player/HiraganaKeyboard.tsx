import { applyDakuten, applyHandakuten, applySmall } from "@app/shared";

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  maxLength?: number;
}

// 1920×540 の横長画面向け。行単位で配置して CSS grid で広げる。
const ROWS: string[][] = [
  ["あ", "い", "う", "え", "お"],
  ["か", "き", "く", "け", "こ"],
  ["さ", "し", "す", "せ", "そ"],
  ["た", "ち", "つ", "て", "と"],
  ["な", "に", "ぬ", "ね", "の"],
  ["は", "ひ", "ふ", "へ", "ほ"],
  ["ま", "み", "む", "め", "も"],
  ["や", "", "ゆ", "", "よ"],
  ["ら", "り", "る", "れ", "ろ"],
  ["わ", "", "", "", "を"],
  ["ん", "ー", "", "", ""],
];

export function HiraganaKeyboard({
  value,
  onChange,
  onSubmit,
  maxLength = 16,
}: Props) {
  function typeChar(c: string) {
    if (c === "") return;
    if (value.length >= maxLength) return;
    onChange(value + c);
  }
  function backspace() {
    onChange(value.slice(0, -1));
  }
  const submittable = value.length > 0;

  return (
    <div className="hiragana-keyboard">
      <div className="hk-grid">
        {ROWS.map((row, ri) => (
          <div key={ri} className="hk-row">
            {row.map((c, ci) => (
              <button
                key={ci}
                className={"hk-key" + (c === "" ? " hk-empty" : "")}
                onClick={() => typeChar(c)}
                disabled={c === ""}
                type="button"
              >
                {c}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="hk-mods">
        <button
          className="hk-key hk-mod"
          type="button"
          onClick={() => onChange(applyDakuten(value))}
        >
          ゛
        </button>
        <button
          className="hk-key hk-mod"
          type="button"
          onClick={() => onChange(applyHandakuten(value))}
        >
          ゜
        </button>
        <button
          className="hk-key hk-mod"
          type="button"
          onClick={() => onChange(applySmall(value))}
        >
          小
        </button>
        <button
          className="hk-key hk-back"
          type="button"
          onClick={backspace}
        >
          ←
        </button>
        <button
          className="hk-key hk-submit"
          type="button"
          onClick={onSubmit}
          disabled={!submittable}
        >
          確定
        </button>
      </div>
    </div>
  );
}
