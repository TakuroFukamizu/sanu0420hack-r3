import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  PlayerId,
  ServerToClientEvents,
} from "@app/shared";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

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
