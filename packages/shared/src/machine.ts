import { assign, setup } from "xstate";
import type {
  PlayerId,
  RoundNumber,
  SessionSnapshot,
  SessionStateName,
  SetupData,
} from "./types.js";
import type { CurrentGame } from "./games/registry.js";

export interface SessionContext {
  setup: SetupData | null;
  currentRound: RoundNumber | null;
  currentGame: CurrentGame | null;
  scores: Record<RoundNumber, number | null>;
  qualitativeEvals: Record<RoundNumber, string | null>;
  finalVerdict: string[] | null;
}

export type SessionEvent =
  | { type: "START" }
  | { type: "SETUP_DONE"; data: SetupData }
  | { type: "PLAYER_NAMED"; playerId: PlayerId; name: string }
  | { type: "ROUND_READY"; game: CurrentGame }
  | { type: "ROUND_COMPLETE"; score: number; qualitative: string }
  | { type: "NEXT_ROUND" }
  | { type: "SESSION_DONE"; verdict: string[] }
  | { type: "RESET" };

const initialContext: SessionContext = {
  setup: null,
  currentRound: null,
  currentGame: null,
  scores: { 1: null, 2: null, 3: null },
  qualitativeEvals: { 1: null, 2: null, 3: null },
  finalVerdict: null,
};

export const sessionMachine = setup({
  types: {
    context: {} as SessionContext,
    events: {} as SessionEvent,
  },
  actions: {
    applySetup: assign(({ event }) => {
      if (event.type !== "SETUP_DONE") return {};
      // 仕様: 名前は setup では保持せず、playerNaming で埋める。
      // stale / 手打ちクライアントから非空が来ても強制的に "" に正規化する。
      const normalized: SetupData = {
        relationship: event.data.relationship,
        players: {
          A: { id: "A", name: "" },
          B: { id: "B", name: "" },
        },
      };
      return { setup: normalized };
    }),
    applyPlayerName: assign(({ context, event }) => {
      if (event.type !== "PLAYER_NAMED") return {};
      if (!context.setup) return {};
      const trimmed = event.name.trim().slice(0, 16);
      if (trimmed === "") return {};
      const current = context.setup.players[event.playerId];
      return {
        setup: {
          ...context.setup,
          players: {
            ...context.setup.players,
            [event.playerId]: { ...current, name: trimmed },
          },
        },
      };
    }),
    enterRound1: assign({ currentRound: () => 1 as RoundNumber }),
    recordRound: assign(({ context, event }) => {
      if (event.type !== "ROUND_COMPLETE") return {};
      const r = context.currentRound;
      if (!r) return {};
      return {
        scores: { ...context.scores, [r]: event.score },
        qualitativeEvals: { ...context.qualitativeEvals, [r]: event.qualitative },
      };
    }),
    advanceRound: assign(({ context }) => {
      const r = context.currentRound ?? 1;
      const next = Math.min(r + 1, 3) as RoundNumber;
      return { currentRound: next };
    }),
    applyVerdict: assign(({ event }) => {
      if (event.type !== "SESSION_DONE") return {};
      return { finalVerdict: event.verdict };
    }),
    applyGame: assign(({ event }) => {
      if (event.type !== "ROUND_READY") return {};
      return { currentGame: event.game };
    }),
    reset: assign(() => initialContext),
  },
  guards: {
    canAdvanceRound: ({ context }) =>
      context.currentRound !== null && context.currentRound < 3,
    bothPlayersNamed: ({ context }) =>
      !!context.setup &&
      context.setup.players.A.name !== "" &&
      context.setup.players.B.name !== "",
  },
}).createMachine({
  id: "session",
  initial: "waiting",
  context: initialContext,
  states: {
    waiting: {
      on: { START: "setup" },
    },
    setup: {
      on: {
        SETUP_DONE: {
          target: "playerNaming",
          actions: "applySetup",
        },
      },
    },
    playerNaming: {
      on: {
        PLAYER_NAMED: { actions: "applyPlayerName" },
      },
      always: {
        guard: "bothPlayersNamed",
        target: "active.roundLoading",
        actions: "enterRound1",
      },
    },
    active: {
      initial: "roundLoading",
      states: {
        roundLoading: {
          on: {
            ROUND_READY: {
              target: "roundPlaying",
              actions: "applyGame",
            },
          },
        },
        roundPlaying: {
          on: {
            ROUND_COMPLETE: {
              target: "roundResult",
              actions: "recordRound",
            },
          },
        },
        roundResult: {
          on: {
            NEXT_ROUND: {
              guard: "canAdvanceRound",
              target: "roundLoading",
              actions: "advanceRound",
            },
            SESSION_DONE: {
              target: "#session.totalResult",
              actions: "applyVerdict",
            },
          },
        },
      },
    },
    totalResult: {
      on: {
        RESET: {
          target: "waiting",
          actions: "reset",
        },
      },
    },
  },
});

type AnyActorSnapshot = { value: unknown; context: SessionContext };

function flattenValue(value: unknown): SessionStateName {
  if (typeof value === "string") {
    if (value === "waiting") return "waiting";
    if (value === "setup") return "setup";
    if (value === "playerNaming") return "playerNaming";
    if (value === "totalResult") return "totalResult";
  }
  if (value && typeof value === "object" && "active" in value) {
    const inner = (value as { active: string }).active;
    if (inner === "roundLoading") return "roundLoading";
    if (inner === "roundPlaying") return "roundPlaying";
    if (inner === "roundResult") return "roundResult";
  }
  throw new Error(`unknown state value: ${JSON.stringify(value)}`);
}

export function snapshotToDTO(snap: AnyActorSnapshot): SessionSnapshot {
  const ctx = snap.context;
  return {
    state: flattenValue(snap.value),
    currentRound: ctx.currentRound,
    currentGame: ctx.currentGame,
    setup: ctx.setup,
    scores: ctx.scores,
    qualitativeEvals: ctx.qualitativeEvals,
    finalVerdict: ctx.finalVerdict,
  };
}
