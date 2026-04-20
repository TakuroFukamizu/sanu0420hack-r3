import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  GameInput,
  PlayerId,
  PlayerInput,
  RoundNumber,
  ServerToClientEvents,
} from "@app/shared";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** GameInput 判別ユニオンを round と一緒に `player:input` で送る helper。
 * `...game` で広げることで `gameId + payload` のペアが discriminated union として保たれる
 * (個別にフィールド代入すると union が解け、PlayerInput に代入できなくなる)。*/
export function emitPlayerInput(
  socket: AppSocket,
  round: RoundNumber,
  game: GameInput,
): void {
  const payload: PlayerInput = { round, ...game };
  socket.emit("player:input", payload);
}

export function connectIntroSocket(): AppSocket {
  return io("/session", {
    query: { role: "intro" },
    transports: ["websocket"],
    forceNew: true,
  });
}

export function connectPlayerSocket(id: PlayerId): AppSocket {
  return io("/session", {
    query: { role: "player", id },
    transports: ["websocket"],
    forceNew: true,
  });
}
