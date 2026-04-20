import type { CurrentGame } from "./games/registry.js";

export type { CurrentGame };

export type PlayerId = "A" | "B";
export type Role = "intro" | "player";
export type RoundNumber = 1 | 2 | 3;

export type Relationship = "カップル" | "気になっている" | "友達" | "親子";

export interface PlayerProfile {
  id: PlayerId;
  name: string;
}

export interface SetupData {
  players: Record<PlayerId, PlayerProfile>;
  relationship: Relationship;
}

export type SessionStateName =
  | "waiting"
  | "setup"
  | "playerNaming"
  | "roundLoading"
  | "roundPlaying"
  | "roundResult"
  | "totalResult";

export interface SessionSnapshot {
  state: SessionStateName;
  currentRound: RoundNumber | null;
  currentGame: CurrentGame | null;
  setup: SetupData | null;
  scores: Record<RoundNumber, number | null>;
  qualitativeEvals: Record<RoundNumber, string | null>;
  finalVerdict: string | null;
}

// Client → Server (intro が引くトリガ)
export type ClientEvent =
  | { type: "START" }
  | { type: "SETUP_DONE"; data: SetupData }
  | { type: "RESET" };

// Client → Server (player がゲーム中に送る入力)
export interface PlayerInput {
  round: RoundNumber;
  gameId: string;
  payload: unknown;
}

export type ClientToServerEvents = {
  "client:event": (event: ClientEvent) => void;
  "player:input": (input: PlayerInput) => void;
  "player:setup": (payload: { name: string }) => void;
};

export type ServerToClientEvents = {
  "session:state": (snapshot: SessionSnapshot) => void;
};

export interface PlayerUrls {
  A: string | null;
  B: string | null;
}
