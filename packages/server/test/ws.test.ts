import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { buildApp } from "../src/app.js";
import { attachSocketIo } from "../src/ws.js";

let address: string;
let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  app = buildApp();
  await app.ready();
  attachSocketIo(app.server, app.sessionRuntime);
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  const { port } = app.server.address() as AddressInfo;
  address = `http://localhost:${port}`;
});

afterEach(async () => {
  await app.close();
});

function connectClient(role: string, id?: string): ClientSocket {
  const query: Record<string, string> = { role };
  if (id) query.id = id;
  return ioClient(`${address}/session`, {
    query,
    transports: ["websocket"],
    forceNew: true,
  });
}

function nextState(
  socket: ClientSocket,
  predicate?: (s: { state: string }) => boolean,
): Promise<{ state: string }> {
  return new Promise((resolve) => {
    const onState = (s: { state: string }) => {
      if (!predicate || predicate(s)) {
        socket.off("session:state", onState);
        resolve(s);
      }
    };
    socket.on("session:state", onState);
  });
}

describe("Socket.io /session", () => {
  it("intro client receives initial state=waiting on connect", async () => {
    const intro = connectClient("intro");
    const snap = await nextState(intro);
    expect(snap.state).toBe("waiting");
    intro.close();
  });

  it("player A receives initial state on connect", async () => {
    const p = connectClient("player", "A");
    const snap = await nextState(p);
    expect(snap.state).toBe("waiting");
    p.close();
  });

  it("intro 'client:event' START broadcasts state=setup to all connected clients", async () => {
    const intro = connectClient("intro");
    const playerA = connectClient("player", "A");
    const playerB = connectClient("player", "B");

    await Promise.all([nextState(intro), nextState(playerA), nextState(playerB)]);

    const allSetup = Promise.all([
      nextState(intro, (s) => s.state === "setup"),
      nextState(playerA, (s) => s.state === "setup"),
      nextState(playerB, (s) => s.state === "setup"),
    ]);

    intro.emit("client:event", { type: "START" });
    await allSetup;

    intro.close();
    playerA.close();
    playerB.close();
  });

  it("player 'client:event' is ignored (not authorized)", async () => {
    const playerA = connectClient("player", "A");
    await nextState(playerA);

    playerA.emit("client:event", { type: "START" });
    await new Promise((r) => setTimeout(r, 100));

    const intro = connectClient("intro");
    const snap = await nextState(intro);
    expect(snap.state).toBe("waiting");

    playerA.close();
    intro.close();
  });

  it("intro SETUP_DONE broadcasts roundLoading to intro + playerA + playerB", async () => {
    const intro = connectClient("intro");
    const playerA = connectClient("player", "A");
    const playerB = connectClient("player", "B");

    await Promise.all([nextState(intro), nextState(playerA), nextState(playerB)]);

    const allSetup = Promise.all([
      nextState(intro, (s) => s.state === "setup"),
      nextState(playerA, (s) => s.state === "setup"),
      nextState(playerB, (s) => s.state === "setup"),
    ]);
    intro.emit("client:event", { type: "START" });
    await allSetup;

    const allRoundLoading = Promise.all([
      nextState(intro, (s) => s.state === "roundLoading"),
      nextState(playerA, (s) => s.state === "roundLoading"),
      nextState(playerB, (s) => s.state === "roundLoading"),
    ]);
    intro.emit("client:event", {
      type: "SETUP_DONE",
      data: {
        players: {
          A: { id: "A", name: "Alice" },
          B: { id: "B", name: "Bob" },
        },
        relationship: "友達" as const,
      },
    });
    await allRoundLoading;

    intro.close();
    playerA.close();
    playerB.close();
  });

  it("rejects connection with unknown role", async () => {
    const bad = ioClient(`${address}/session`, {
      query: { role: "spectator" },
      transports: ["websocket"],
      forceNew: true,
    });
    const outcome = await new Promise<string>((resolve) => {
      bad.once("disconnect", () => resolve("disconnected"));
      bad.once("connect_error", () => resolve("connect_error"));
      setTimeout(() => resolve("timeout"), 1000);
    });
    expect(outcome === "disconnected" || outcome === "connect_error").toBe(true);
    bad.close();
  });
});
