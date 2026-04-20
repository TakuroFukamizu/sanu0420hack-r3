import type { Server as HttpServer } from "node:http";
import { Server as IOServer } from "socket.io";
import type { SessionRuntime } from "./session-runtime.js";
import type { Orchestrator } from "./orchestrator/index.js";
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

export interface AttachedIo {
  io: IOServer;
  /** runtime→broadcast の購読を解除し、Socket.io サーバを閉じる */
  close: () => Promise<void>;
}

export function attachSocketIo(
  httpServer: HttpServer,
  runtime: SessionRuntime,
  orchestrator: Orchestrator | null = null,
): AttachedIo {
  const io = new IOServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    { cors: { origin: true, credentials: true } },
  );

  const nsp = io.of("/session");

  // グローバル購読。actor が遷移するたびに接続中の全 socket に broadcast する。
  // 本関数は 1 runtime につき 1 回だけ呼ばれる前提。ホットリロードや二重呼び出しで
  // 登録がリークしないよう、返り値の close() で unsubscribe + io.close() を行える。
  const unsubscribe = runtime.subscribe((snap) => {
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

    // この socket にだけ現在の state を配る (遷移待ちを避けるため)。
    // 接続直後 〜 ここまでに actor が遷移した場合、broadcast と本 emit の 2 通が
    // 届くことがある。どちらも最新 snapshot で冪等なのでクライアントは後勝ちで
    // 上書きしておけば良い (Phase 2+ で orchestrator がタイマ遷移を撃ち始めると
    // 目にする可能性が上がる)。
    socket.emit("session:state", runtime.get());

    socket.on("client:event", (ev: ClientEvent) => {
      if (socket.data.role === "intro") {
        runtime.send(ev);
        return;
      }
      // player は最終結果画面の「終了」ボタン用に RESET だけ許可。
      // START / SETUP_DONE など他の制御イベントは無視する。
      if (socket.data.role === "player" && ev.type === "RESET") {
        runtime.send(ev);
      }
    });

    socket.on("player:input", (input: PlayerInput) => {
      if (socket.data.role !== "player") return;
      const id = socket.data.playerId as PlayerId | null;
      if (!id) return;
      orchestrator?.onPlayerInput(id, input);
    });

    socket.on("player:setup", (payload: unknown) => {
      if (socket.data.role !== "player") return;
      const playerId = socket.data.playerId;
      if (playerId !== "A" && playerId !== "B") return;
      const name = (payload as { name?: unknown })?.name;
      if (typeof name !== "string") return;
      runtime.send({ type: "PLAYER_NAMED", playerId, name });
    });
  });

  return {
    io,
    close: async () => {
      unsubscribe();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
