import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SetupData } from "@app/shared";
import {
  GeminiProxyGateway,
  extractJsonText,
} from "../src/ai/gemini-proxy.js";
import type { AiGateway } from "../src/ai/index.js";

function setupData(): SetupData {
  return {
    players: {
      A: { id: "A", name: "あきら" },
      B: { id: "B", name: "ひろみ" },
    },
    relationship: "友達",
  };
}

describe("extractJsonText", () => {
  it("parses raw JSON string", () => {
    const out = extractJsonText('{"foo":1}');
    expect(out).toBe('{"foo":1}');
  });

  it("strips ```json ... ``` fence", () => {
    const text = "```json\n{\"foo\":1}\n```";
    expect(extractJsonText(text)).toBe('{"foo":1}');
  });

  it("strips plain ``` ... ``` fence (no language tag)", () => {
    const text = "```\n{\"foo\":1}\n```";
    expect(extractJsonText(text)).toBe('{"foo":1}');
  });

  it("falls back to the first { ... last } substring", () => {
    const text = 'ここがJSONです:\n{"foo":1}\nここまで。';
    expect(extractJsonText(text)).toBe('{"foo":1}');
  });

  it("throws when no JSON-shaped content is present", () => {
    expect(() => extractJsonText("just text")).toThrow(/json/i);
  });
});

describe("GeminiProxyGateway construction", () => {
  it("implements AiGateway with name 'gemini-proxy'", () => {
    const gw: AiGateway = new GeminiProxyGateway("https://proxy.example/");
    expect(gw.name).toBe("gemini-proxy");
  });

  it("throws when url is empty", () => {
    expect(() => new GeminiProxyGateway("")).toThrow(/url/i);
  });
});

describe("GeminiProxyGateway end-to-end (mocked fetch)", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    // vi.stubGlobal で各テストごとに差し替える
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("planSession POSTs {mode:'text', prompt} and narrows response", async () => {
    const rawJson = JSON.stringify({
      rounds: [
        {
          gameId: "sync-answer",
          config: {
            question: "一緒に行きたいのは？",
            choices: ["海", "山", "街", "家"],
          },
        },
        {
          gameId: "partner-quiz",
          config: {
            target: "A",
            question: "あきらの好物は？",
            choices: ["寿司", "焼肉", "ラーメン", "カレー"],
          },
        },
        {
          gameId: "timing-sync",
          config: { instruction: "同時にタップ！" },
        },
      ],
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://proxy.example/");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body.mode).toBe("text");
      expect(typeof body.prompt).toBe("string");
      expect(body.prompt.length).toBeGreaterThan(0);
      return new Response(
        JSON.stringify({ mode: "text", text: rawJson }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const gw = new GeminiProxyGateway("https://proxy.example/");
    const plan = await gw.planSession(setupData());
    expect(plan.rounds).toHaveLength(3);
    expect(plan.rounds[0].gameId).toBe("sync-answer");
    expect(plan.rounds[1].gameId).toBe("partner-quiz");
    expect(plan.rounds[2].gameId).toBe("timing-sync");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("planSession tolerates markdown-fenced JSON from the proxy", async () => {
    const rawJson = JSON.stringify({
      rounds: [
        {
          gameId: "timing-sync",
          config: { instruction: "tap!" },
        },
        {
          gameId: "timing-sync",
          config: { instruction: "tap!" },
        },
        {
          gameId: "timing-sync",
          config: { instruction: "tap!" },
        },
      ],
    });
    const fenced = "```json\n" + rawJson + "\n```";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ mode: "text", text: fenced }), {
            status: 200,
          }),
      ),
    );

    const gw = new GeminiProxyGateway("https://proxy.example/");
    const plan = await gw.planSession(setupData());
    expect(plan.rounds).toHaveLength(3);
  });

  it("planSession throws when the proxy returns non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const gw = new GeminiProxyGateway("https://proxy.example/");
    await expect(gw.planSession(setupData())).rejects.toThrow(/500/);
  });

  it("refineQualitative returns trimmed plain text from the proxy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ mode: "text", text: "  息ぴったり!  " }),
            { status: 200 },
          ),
      ),
    );
    const gw = new GeminiProxyGateway("https://proxy.example/");
    const out = await gw.refineQualitative({
      setup: setupData(),
      round: 1,
      current: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "q", choices: ["a", "b", "c", "d"] },
          B: { question: "q", choices: ["a", "b", "c", "d"] },
        },
      },
      inputs: {},
      score: 80,
      qualitativeFromScoreFn: "デフォルトの感想",
    });
    expect(out).toBe("息ぴったり!");
  });

  it("refineQualitative falls back to qualitativeFromScoreFn when text is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ mode: "text", text: "" }), {
            status: 200,
          }),
      ),
    );
    const gw = new GeminiProxyGateway("https://proxy.example/");
    const out = await gw.refineQualitative({
      setup: setupData(),
      round: 1,
      current: {
        gameId: "sync-answer",
        perPlayerConfigs: {
          A: { question: "q", choices: ["a", "b", "c", "d"] },
          B: { question: "q", choices: ["a", "b", "c", "d"] },
        },
      },
      inputs: {},
      score: 80,
      qualitativeFromScoreFn: "フォールバック",
    });
    expect(out).toBe("フォールバック");
  });

  it("generateVerdict narrows the JSON response to 3 strings", async () => {
    const rawJson = JSON.stringify({
      verdicts: ["観点1", "観点2", "観点3"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ mode: "text", text: rawJson }), {
            status: 200,
          }),
      ),
    );
    const gw = new GeminiProxyGateway("https://proxy.example/");
    const out = await gw.generateVerdict({
      setup: setupData(),
      scores: { 1: 80, 2: 80, 3: 80 },
      qualitativeEvals: { 1: "a", 2: "b", 3: "c" },
    });
    expect(out).toEqual(["観点1", "観点2", "観点3"]);
  });
});
