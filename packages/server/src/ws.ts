import type { Server as HttpServer } from "node:http";
import { Server as IOServer } from "socket.io";
import type { SessionRuntime } from "./session-runtime.js";
import type {
  ClientEvent,
  ClientToServerEvents,
  PlayerId,
  PlayerInput,
  Role,
  ServerToClientEvents,
} from "@app/shared";

function isValidRole(r: unknown): r is Role {
  return r === "intro" || r === "player";
}
function isValidPlayerId(x: unknown): x is PlayerId {
  return x === "A" || x === "B";
}

export function attachSocketIo(
  httpServer: HttpServer,
  runtime: SessionRuntime,
): IOServer {
  const io = new IOServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    { cors: { origin: true, credentials: true } },
  );

  const nsp = io.of("/session");

  // グローバル購読。actor が遷移するたびに接続中の全 socket にbroadcast。
  // subscribe は登録時に現在値を即時発火するが、起動直後はまだ socket が無いので
  // broadcast 先が空。以降は遷移のみで発火する。
  runtime.subscribe((snap) => {
    nsp.emit("session:state", snap);
  });

  nsp.on("connection", (socket) => {
    const { role, id } = socket.handshake.query as {
      role?: string;
      id?: string;
    };

    if (!isValidRole(role)) {
      socket.disconnect(true);
      return;
    }
    if (role === "player" && !isValidPlayerId(id)) {
      socket.disconnect(true);
      return;
    }

    socket.data.role = role;
    socket.data.playerId = role === "player" ? (id as PlayerId) : null;

    // この socket にだけ現在の state を配る (遷移待ちを避けるため)
    socket.emit("session:state", runtime.get());

    socket.on("client:event", (ev: ClientEvent) => {
      if (socket.data.role !== "intro") return; // intro のみ許可
      runtime.send(ev);
    });

    socket.on("player:input", (_input: PlayerInput) => {
      if (socket.data.role !== "player") return;
      // Phase 4 で実装 (オーケストレータへ委譲)
    });
  });

  return io;
}
