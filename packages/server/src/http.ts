import type { FastifyInstance } from "fastify";
import type { PlayerUrls } from "@app/shared";

function readPlayerUrl(envKey: string): string | null {
  const v = process.env[envKey];
  return v && v.trim().length > 0 ? v : null;
}

export function registerHttpRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/player-urls", async (): Promise<PlayerUrls> => ({
    A: readPlayerUrl("PLAYER_URL_A"),
    B: readPlayerUrl("PLAYER_URL_B"),
  }));
}
