/**
 * Orchestrator が各 state に滞在する時間 (ms) の default。
 * 本値はサーバ側 `orchestrator/index.ts` が env (`ORCHESTRATOR_ROUND_LOADING_MS` 等)
 * で上書きして使う。web からも参照可能にしておくが、現状 web は読まない。
 */
export const DEFAULT_ROUND_LOADING_MS = 3000;
export const DEFAULT_ROUND_PLAYING_MS = 5000;
export const DEFAULT_ROUND_RESULT_MS = 8000;

export const ROUND_LOADING_ENV = "ORCHESTRATOR_ROUND_LOADING_MS";
export const ROUND_PLAYING_ENV = "ORCHESTRATOR_ROUND_PLAYING_MS";
export const ROUND_RESULT_ENV = "ORCHESTRATOR_ROUND_RESULT_MS";
