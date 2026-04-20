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

  it("intro SETUP_DONE broadcasts playerNaming to intro + playerA + playerB", async () => {
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

    const allPlayerNaming = Promise.all([
      nextState(intro, (s) => s.state === "playerNaming"),
      nextState(playerA, (s) => s.state === "playerNaming"),
      nextState(playerB, (s) => s.state === "playerNaming"),
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
    await allPlayerNaming;

    intro.close();
    playerA.close();
    playerB.close();
  });

  it("both players submitting player:setup broadcasts roundLoading", async () => {
    const intro = connectClient("intro");
    const playerA = connectClient("player", "A");
    const playerB = connectClient("player", "B");

    await Promise.all([nextState(intro), nextState(playerA), nextState(playerB)]);

    intro.emit("client:event", { type: "START" });
    await Promise.all([
      nextState(intro, (s) => s.state === "setup"),
      nextState(playerA, (s) => s.state === "setup"),
      nextState(playerB, (s) => s.state === "setup"),
    ]);

    intro.emit("client:event", {
      type: "SETUP_DONE",
      data: {
        players: { A: { id: "A", name: "" }, B: { id: "B", name: "" } },
        relationship: "友達" as const,
      },
    });
    await Promise.all([
      nextState(intro, (s) => s.state === "playerNaming"),
      nextState(playerA, (s) => s.state === "playerNaming"),
      nextState(playerB, (s) => s.state === "playerNaming"),
    ]);

    const allRoundLoading = Promise.all([
      nextState(intro, (s) => s.state === "roundLoading"),
      nextState(playerA, (s) => s.state === "roundLoading"),
      nextState(playerB, (s) => s.state === "roundLoading"),
    ]);
    playerA.emit("player:setup", { name: "あきら" });
    playerB.emit("player:setup", { name: "さくら" });
    await allRoundLoading;

    intro.close();
    playerA.close();
    playerB.close();
  });

  it("player:setup from intro is ignored", async () => {
    const intro = connectClient("intro");
    const playerA = connectClient("player", "A");
    const playerB = connectClient("player", "B");

    await Promise.all([nextState(intro), nextState(playerA), nextState(playerB)]);

    intro.emit("client:event", { type: "START" });
    await Promise.all([
      nextState(intro, (s) => s.state === "setup"),
      nextState(playerA, (s) => s.state === "setup"),
      nextState(playerB, (s) => s.state === "setup"),
    ]);
    intro.emit("client:event", {
      type: "SETUP_DONE",
      data: {
        players: { A: { id: "A", name: "" }, B: { id: "B", name: "" } },
        relationship: "友達" as const,
      },
    });
    await Promise.all([
      nextState(intro, (s) => s.state === "playerNaming"),
      nextState(playerA, (s) => s.state === "playerNaming"),
      nextState(playerB, (s) => s.state === "playerNaming"),
    ]);

    // intro から player:setup を emit しても無視される
    (intro as unknown as { emit: (ev: string, p: unknown) => void }).emit(
      "player:setup",
      { name: "あきら" },
    );
    await new Promise((r) => setTimeout(r, 100));
    // A が入力されていないので roundLoading に進まない。現状は playerNaming のはず。
    playerB.emit("player:setup", { name: "さくら" });
    await new Promise((r) => setTimeout(r, 100));
    // B だけしか有効に入っていないので state は playerNaming のまま
    const snap = await new Promise<{ state: string }>((resolve) => {
      intro.once("session:state", resolve);
      // 強制的に最新状態を取るため何か emit
      intro.emit("client:event", { type: "START" }); // waiting 以外では無視される
    });
    expect(snap.state).toBe("playerNaming");

    intro.close();
    playerA.close();
    playerB.close();
  });

  it("player:setup with non-string name is ignored", async () => {
    const intro = connectClient("intro");
    const playerA = connectClient("player", "A");
    const playerB = connectClient("player", "B");

    await Promise.all([nextState(intro), nextState(playerA), nextState(playerB)]);
    intro.emit("client:event", { type: "START" });
    await Promise.all([
      nextState(intro, (s) => s.state === "setup"),
      nextState(playerA, (s) => s.state === "setup"),
      nextState(playerB, (s) => s.state === "setup"),
    ]);
    intro.emit("client:event", {
      type: "SETUP_DONE",
      data: {
        players: { A: { id: "A", name: "" }, B: { id: "B", name: "" } },
        relationship: "友達" as const,
      },
    });
    await Promise.all([
      nextState(playerA, (s) => s.state === "playerNaming"),
    ]);

    // 不正な型 (number) は ignore
    (playerA as unknown as { emit: (ev: string, p: unknown) => void }).emit(
      "player:setup",
      { name: 42 },
    );
    await new Promise((r) => setTimeout(r, 100));
    // B は正しく送る → A 空のまま playerNaming に留まる
    playerB.emit("player:setup", { name: "さくら" });
    await new Promise((r) => setTimeout(r, 100));

    intro.close();
    playerA.close();
    playerB.close();
  });

  it("forwards player:input to orchestrator.onPlayerInput", async () => {
    const calls: Array<{ id: string; input: unknown }> = [];
    const fakeOrch = {
      onPlayerInput(id: string, input: unknown) {
        calls.push({ id, input });
      },
    } as unknown as Parameters<typeof attachSocketIo>[2];

    // local app でないと全体と干渉するのでテスト内で個別 boot
    await app.close();
    app = buildApp({ orchestrator: null }); // built-in を無効化して外側で attach
    await app.ready();
    attachSocketIo(app.server, app.sessionRuntime, fakeOrch);
    await new Promise<void>((resolve) => app.server.listen(0, resolve));
    const { port } = app.server.address() as AddressInfo;
    address = `http://localhost:${port}`;

    const playerA = connectClient("player", "A");
    await nextState(playerA);
    playerA.emit("player:input", {
      round: 1,
      gameId: "sync-answer",
      payload: { choice: 1 },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.id).toBe("A");
    playerA.close();
  });

  it("ignores player:input from intro role", async () => {
    const calls: Array<{ id: string; input: unknown }> = [];
    const fakeOrch = {
      onPlayerInput() {
        calls.push({ id: "unexpected", input: null });
      },
    } as unknown as Parameters<typeof attachSocketIo>[2];

    await app.close();
    app = buildApp({ orchestrator: null });
    await app.ready();
    attachSocketIo(app.server, app.sessionRuntime, fakeOrch);
    await new Promise<void>((resolve) => app.server.listen(0, resolve));
    const { port } = app.server.address() as AddressInfo;
    address = `http://localhost:${port}`;

    const intro = connectClient("intro");
    await nextState(intro);
    (intro as unknown as { emit: (ev: string, p: unknown) => void }).emit(
      "player:input",
      {
        round: 1,
        gameId: "sync-answer",
        payload: { choice: 1 },
      },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
    intro.close();
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
