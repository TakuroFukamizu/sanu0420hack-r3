import type { PlayerUrls } from "@app/shared";

export async function fetchPlayerUrls(): Promise<PlayerUrls> {
  const res = await fetch("/api/player-urls");
  if (!res.ok) throw new Error(`fetchPlayerUrls failed: ${res.status}`);
  return (await res.json()) as PlayerUrls;
}
