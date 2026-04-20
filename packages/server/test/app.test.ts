import { describe, it, expect, afterEach, vi } from "vitest";
import { buildApp } from "../src/app.js";

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
