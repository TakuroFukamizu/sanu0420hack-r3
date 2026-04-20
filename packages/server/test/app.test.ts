import { describe, it, expect, afterEach, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { MockAiGateway } from "../src/ai/mock.js";
import { GeminiGateway } from "../src/ai/gemini.js";
import { GeminiProxyGateway } from "../src/ai/gemini-proxy.js";
import { Orchestrator } from "../src/orchestrator/index.js";

let app: ReturnType<typeof buildApp>;
afterEach(async () => {
  if (app) await app.close();
});

describe("server app", () => {
  it("GET /health returns ok", async () => {
    app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("GET /api/player-urls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns env-configured URLs when PLAYER_URL_A/B are set", async () => {
    vi.stubEnv("PLAYER_URL_A", "http://10.0.0.1:5173/player?id=A");
    vi.stubEnv("PLAYER_URL_B", "http://10.0.0.1:5173/player?id=B");
    const localApp = buildApp();
    try {
      const res = await localApp.inject({ method: "GET", url: "/api/player-urls" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        A: "http://10.0.0.1:5173/player?id=A",
        B: "http://10.0.0.1:5173/player?id=B",
      });
    } finally {
      await localApp.close();
    }
  });

  it("returns {A: null, B: null} when env is unset (empty string treated as unset)", async () => {
    vi.stubEnv("PLAYER_URL_A", "");
    vi.stubEnv("PLAYER_URL_B", "");
    const localApp = buildApp();
    try {
      const res = await localApp.inject({ method: "GET", url: "/api/player-urls" });
      expect(res.json()).toEqual({ A: null, B: null });
    } finally {
      await localApp.close();
    }
  });
});

describe("buildApp gateway selection (env)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Orchestrator が保持する gateway 参照を外から読むヘルパ
  function gatewayOf(app: ReturnType<typeof buildApp>): unknown {
    const orch = app.orchestrator as Orchestrator | null;
    // @ts-expect-error — テストのみ private フィールドを覗く
    return orch?.gateway;
  }

  it("uses GeminiProxyGateway when GEMINI_PROXY_URL is set", async () => {
    vi.stubEnv("GEMINI_PROXY_URL", "https://proxy.example/");
    vi.stubEnv("GEMINI_API_KEY", "");
    const localApp = buildApp();
    try {
      expect(gatewayOf(localApp)).toBeInstanceOf(GeminiProxyGateway);
    } finally {
      await localApp.close();
    }
  });

  it("prefers proxy over direct key when both are set", async () => {
    vi.stubEnv("GEMINI_PROXY_URL", "https://proxy.example/");
    vi.stubEnv("GEMINI_API_KEY", "sk-whatever");
    const localApp = buildApp();
    try {
      expect(gatewayOf(localApp)).toBeInstanceOf(GeminiProxyGateway);
    } finally {
      await localApp.close();
    }
  });

  it("uses GeminiGateway when only GEMINI_API_KEY is set", async () => {
    vi.stubEnv("GEMINI_PROXY_URL", "");
    vi.stubEnv("GEMINI_API_KEY", "sk-whatever");
    const localApp = buildApp();
    try {
      expect(gatewayOf(localApp)).toBeInstanceOf(GeminiGateway);
    } finally {
      await localApp.close();
    }
  });

  it("falls back to MockAiGateway when neither env is set", async () => {
    vi.stubEnv("GEMINI_PROXY_URL", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    const localApp = buildApp();
    try {
      expect(gatewayOf(localApp)).toBeInstanceOf(MockAiGateway);
    } finally {
      await localApp.close();
    }
  });
});
