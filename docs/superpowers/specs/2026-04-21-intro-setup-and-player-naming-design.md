# Intro 設定画面の関係性ボタン化 & プレイヤー名入力をプレイヤー画面へ移設

**Date:** 2026-04-21
**Status:** Approved (design, codex-reviewed 2026-04-21)

## 1. 目的

- intro の設定画面 (`SetupView`) で関係性を4択ボタンから選ぶ UX に変え、1タップで次の状態に進められるようにする。
- プレイヤー A/B の名前入力を intro から外し、**各プレイヤー画面で Round1 開始前に**入力させる。
- プレイヤー画面の名前入力には独自の**平仮名ソフトキーボード** (清音 + 長音 + 濁点/半濁点 + 小書き `ゃゅょっ`) を表示する。

## 2. 状態フローの変更

現行:
```
waiting → setup → active.roundLoading → active.roundPlaying → ...
```
（`setup` で intro が A/B 名前 + 関係性を一括入力し、`SETUP_DONE` で `roundLoading` に飛ぶ）

変更後:
```
waiting → setup → playerNaming → active.roundLoading → active.roundPlaying → ...
```

- **`setup`**: intro が関係性だけを選択する。`SETUP_DONE` を関係性のみ積んで発火。
- **`playerNaming` (新規)**: A/B 各プレイヤーが各自の画面で名前を入力する。両方埋まると自動で `active.roundLoading` に遷移。intro 側は「プレイヤー名入力中」待機画面を表示。

## 3. 型変更 (`packages/shared/src/types.ts`)

```ts
export type Relationship = "カップル" | "気になっている" | "友達" | "親子";

export interface PlayerProfile {
  id: PlayerId;
  name: string; // setup 直後は "" で、playerNaming で埋まる
}

export interface SetupData {
  players: Record<PlayerId, PlayerProfile>;
  relationship: Relationship;
}

export type SessionStateName =
  | "waiting"
  | "setup"
  | "playerNaming"  // 追加
  | "roundLoading"
  | "roundPlaying"
  | "roundResult"
  | "totalResult";

export type ClientToServerEvents = {
  "client:event": (event: ClientEvent) => void;
  "player:input": (input: PlayerInput) => void;
  "player:setup": (payload: { name: string }) => void; // 追加
};
```

`ClientEvent` 側は `SETUP_DONE.data: SetupData` を維持するが、`players.A.name` / `players.B.name` は空文字で送る。

## 4. 状態マシン変更 (`packages/shared/src/machine.ts`)

### `SessionEvent` union 拡張 (必須)

```ts
export type SessionEvent =
  | { type: "START" }
  | { type: "SETUP_DONE"; data: SetupData }
  | { type: "PLAYER_NAMED"; playerId: PlayerId; name: string }  // 追加
  | { type: "ROUND_READY" }
  | { type: "ROUND_COMPLETE"; score: number; qualitative: string }
  | { type: "NEXT_ROUND" }
  | { type: "SESSION_DONE"; verdict: string }
  | { type: "RESET" };
```

`runtime.send({ type: "PLAYER_NAMED", ... })` が型的に通らないと build/typecheck が落ちるので union 追加は必須。

### 状態追加
- `playerNaming`（top-level）:
  - `on: { PLAYER_NAMED: { actions: "applyPlayerName" } }`
  - `always: { guard: "bothPlayersNamed", target: "active.roundLoading", actions: "enterRound1" }`
- `setup.SETUP_DONE.target` を `playerNaming` に変更。
- **`applySetup` は `event.data` を取り込む際に `players.A.name` / `players.B.name` を強制的に `""` に正規化する** (重要)。stale な intro や手打ち socket から非空名が送られても、`playerNaming` に入った瞬間に `bothPlayersNamed` が真になり要件 (各プレイヤー画面で入力) を破らないようにする。`currentRound` は `null` のまま。
- `applyPlayerName`: `trimmedName = event.name.trim().slice(0, 16)`。`trimmedName === ""` なら代入しない（= イベント無視）。そうでなければ `context.setup.players[event.playerId].name = trimmedName`。
- `bothPlayersNamed`: `context.setup` が非 null かつ `players.A.name !== "" && players.B.name !== ""`。
- `enterRound1`: `assign({ currentRound: 1 })`。

### `PLAYER_NAMED` の扱い (playerNaming 以外)

- `playerNaming` 以外の状態では `PLAYER_NAMED` はトップレベル / 各状態に定義しない。XState の既定動作でイベントは無視される。
- 再接続・二重送信対応: `playerNaming` 中に同じプレイヤーから複数回 `PLAYER_NAMED` が来たら**最後の値で上書き**する。既に Round1 以降に入っている場合は何もしない (無視)。

### RESET
- 既存の `reset` は initialContext を入れるため、player 名もクリアされる。変更不要。

## 5. サーバ変更 (`packages/server/src/ws.ts`)

- `"player:setup"` ハンドラ追加:
  - `socket.data.role !== "player"` なら無視。
  - `socket.data.playerId` が A/B でないなら無視。
  - `runtime.send({ type: "PLAYER_NAMED", playerId, name: payload.name })`。
- 名前のバリデーション（空文字・長すぎ）はマシン側 `applyPlayerName` でまとめて処理する。

## 6. intro UI 変更

### `SetupView.tsx`
- タイトル「2人の関係性は？」
- 関係性4択ボタン (`カップル` / `気になっている` / `友達` / `親子`) を大型グリッド表示。
- ボタン押下で即座に `SETUP_DONE` 発火 (確認ボタンなし)。送信する `SetupData.players.{A,B}.name` は `""`。
- 名前入力欄・state・バリデーションは削除。

### `Intro.tsx`
- `case "playerNaming"` を追加し、専用の待機ビュー（例: `PlayerNamingWaitView`）を描画。「プレイヤーが名前を入力中…」と A/B の入力済みステータス (○/未) を表示。`snap.setup` は non-null 前提 (§ 7.null ガード参照)。

## 7. プレイヤー UI 変更

### `Player.tsx`
- `case "playerNaming"`:
  - `snap.setup` が null のケースは実装上来ない想定だが、TypeScript 的には `SessionSnapshot.setup: SetupData | null` のままなので、narrow するヘルパ (例: `if (!snap.setup) return null;`) を 1 箇所に置く。`SessionSnapshot` 型自体は変更しない (他 state との整合優先)。
  - 自分の `snap.setup.players[playerId].name === ""` なら `<NamingView playerId onSubmit />`。
  - 入力済みなら既存の `WaitingView` または簡易の「相手を待っています」文言で描画。
- `case "setup"` は従来通り `WaitingView`（intro 操作中）。

### 新規: `NamingView.tsx`
- レイアウト（1920×540 横長）:
  - 上部: 「Player A のなまえ」 + 入力中テキスト (例: `あきら▊`) 大きく表示。
  - 下部: `HiraganaKeyboard` コンポーネント。キーボード内の `確定` キーから `onSubmit(name)` を上げる（画面上の「確定ボタン」重複は廃止）。
- Props: `playerId`, `onSubmit(name: string)`.
- Socket 送信: `Player.tsx` 側で `socket.emit("player:setup", { name })` を呼ぶコールバックを渡す。`NamingView` は socket 非依存。

### 新規: `HiraganaKeyboard.tsx`
- Props: `value: string`, `onChange(next: string)`, `onSubmit()`, `maxLength?: number`.
- キー構成:
  - 清音 行列: `あ行〜わ行 + ん + ー` (計 48 キー相当)。
    ```
    あ い う え お
    か き く け こ
    さ し す せ そ
    た ち つ て と
    な に ぬ ね の
    は ひ ふ へ ほ
    ま み む め も
    や    ゆ    よ
    ら り る れ ろ
    わ        を
    ん ー
    ```
    1920×540 向けに CSS Grid で横長に再配置し、1〜2 行に均せる範囲で折り返す（実装時に微調整可。7行/11行どちらでも UX が壊れなければ OK）。
  - 変換キー: `゛` `゜` `小` `←(backspace)` `確定`。
  - `゛` / `゜`: 末尾1文字を濁音/半濁音に変換（テーブル）。該当なしなら no-op。
  - `小`: 末尾1文字を小書きに変換。**対象は `ゃ ゅ ょ っ` のみ** (や→ゃ, ゆ→ゅ, よ→ょ, つ→っ)。他は no-op。
  - `←`: 末尾1文字削除。
  - `確定`: 1文字以上で `onSubmit()`。
- タッチ向けに大きめのボタン (最低 44×44px 相当、実際はもっと大きく)。
- `applyDakuten` / `applyHandakuten` / `applySmall` は純粋関数として module 内に分離し、unit test 可能にする。

## 8. テスト

### `packages/shared/test/machine.test.ts`
- `SETUP_DONE` → `playerNaming` に遷移するテストを追加。
- `applySetup` 後、`context.setup.players.{A,B}.name` は必ず `""` であるテスト (非空名を送っても正規化される)。
- `PLAYER_NAMED` を A/B 両方送ると自動で `active.roundLoading` に遷移し `currentRound=1` となるテスト。
- 片方だけ送ると `playerNaming` に留まるテスト。
- `PLAYER_NAMED` の `name` 空文字 / 前後空白 / 17文字以上を送った時の挙動テスト。
- 既存の `SETUP_DONE → roundLoading` 期待を書き換え。
- `RESET` で名前もクリアされるテスト。
- `snapshotToDTO` の `flattenValue` が `playerNaming` を正しく返すテスト。

### `packages/server/test/ws.test.ts`
- 既存「intro SETUP_DONE → roundLoading broadcast」テストを分割:
  - SETUP_DONE → `playerNaming` broadcast
  - `player:setup` を A/B 両方 → `roundLoading` broadcast
- `player:setup` を intro が送っても無視されるテスト。
- `SetupData.players.{A,B}.name` が `""` で送られても受理されるテスト。

### 既存テスト fixture の更新 (重要)

`Relationship` を 4 値に narrow するため、既存テストで使われている `relationship: "友人"` を 4 値のいずれか (例: `"友達"`) に差し替える:
- `packages/shared/test/machine.test.ts` (setupData fixture)
- `packages/server/test/ws.test.ts`
- `packages/server/test/session-runtime.test.ts`
- `packages/server/test/orchestrator.test.ts`

### Web 側
- `HiraganaKeyboard` の `applyDakuten` / `applyHandakuten` / `applySmall` 純粋関数の unit test。
- `Player.tsx` の `playerNaming` 分岐テスト (自分は `NamingView` / 相手待ちは待機ビュー) を軽く 1 本。今回 UX 変更の本体なので優先度高め。

## 9. ドキュメント更新

- `docs/plans/00-overview.md` §1.3 の state→view 対応表に `playerNaming` を追加。
- `docs/README.md` の状態遷移図 / 画面構成にも反映。
- 必要なら `docs/plans/04-*.md` 付近に本変更を補足（Phase 4+ で使う state が増えたため）。

## 10. 非変更 / スコープ外

- Gemini (Phase 5)・MIDI (Phase 6) は今回触らない。
- 関係性の値は将来 Gemini プロンプトに Japanese 文字列で渡す前提だが、現段階では型レベルで列挙しておくのみ。
- プレイヤー画面の URL は変わらない (`?id=A|B` のみ)。
- `SessionSnapshot.setup` の型 (`SetupData | null`) は変更しない。`playerNaming` 中の non-null 保証は UI 側の narrow で担保する。

## 11. 受け入れ条件

1. intro `setup` 画面で4ボタン択一 → 即遷移。名前欄は無い。
2. プレイヤー画面で名前入力画面が表示され、平仮名ソフトキーボード (清音 + 長音 + 濁点 + 半濁点 + 小書き `ゃゅょっ`) で入力できる。
3. 両プレイヤーが確定キーを押すと自動で Round1 に入る。
4. `pnpm -r test` / `pnpm -r typecheck` が緑。
5. `pnpm -r build` が緑。
