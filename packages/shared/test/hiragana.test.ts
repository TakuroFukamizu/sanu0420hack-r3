import { describe, it, expect } from "vitest";
import { applyDakuten, applyHandakuten, applySmall } from "../src/hiragana.js";

describe("applyDakuten", () => {
  it("converts か to が", () => {
    expect(applyDakuten("さか")).toBe("さが");
  });
  it("converts は to ば", () => {
    expect(applyDakuten("そは")).toBe("そば");
  });
  it("returns input unchanged when last char has no dakuten form", () => {
    expect(applyDakuten("あ")).toBe("あ");
  });
  it("returns empty string as-is", () => {
    expect(applyDakuten("")).toBe("");
  });
});

describe("applyHandakuten", () => {
  it("converts は to ぱ", () => {
    expect(applyHandakuten("そは")).toBe("そぱ");
  });
  it("returns input unchanged when last char has no handakuten form", () => {
    expect(applyHandakuten("あ")).toBe("あ");
  });
});

describe("applySmall", () => {
  it("converts や to ゃ", () => {
    expect(applySmall("きや")).toBe("きゃ");
  });
  it("converts つ to っ", () => {
    expect(applySmall("まつ")).toBe("まっ");
  });
  it("returns input unchanged for non-convertible trailing char", () => {
    expect(applySmall("あ")).toBe("あ");
  });
});
