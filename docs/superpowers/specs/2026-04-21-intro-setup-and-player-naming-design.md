# Intro 設定画面の関係性ボタン化 & プレイヤー名入力をプレイヤー画面へ移設

**Date:** 2026-04-21
**Status:** Approved (design)

## 1. 目的

- intro の設定画面 (`SetupView`) で関係性を4択ボタンから選ぶ UX に変え、1タップで次の状態に進められるようにする。
- プレイヤー A/B の名前入力を intro から外し、**各プレイヤー画面で Round1 開始前に**入力させる。
- プレイヤー画面の名前入力には独自の**平仮名ソフトキーボード** (清音 + 濁点/半濁点 + 小書き + 長音) を表示する。

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

### 新イベント
- `PLAYER_NAMED { playerId: PlayerId; name: string }` — サーバ内部 (ws → runtime) 経由で発火。

### 状態追加
- `playerNaming`（top-level）:
  - `on: { PLAYER_NAMED: { actions: "applyPlayerName" } }`
  - `always: { guard: "bothPlayersNamed", target: "active.roundLoading" }`
- `setup.SETUP_DONE.target` を `playerNaming` に変更。`applySetup` は従来通り `event.data` を `context.setup` に入れる（`players.{A,B}.name` は `""` で入ってくる）。`currentRound` はまだ `null` のまま。
- `applyPlayerName`: `context.setup.players[playerId].name = trimmedName`。`name` は `trim()` 後、最大 16 文字に切り詰める。空文字になったら代入しない（= そのキー押下は無視扱い）。
- `bothPlayersNamed`: `context.setup` が非 null かつ `players.A.name !== "" && players.B.name !== ""`。
- `playerNaming → active.roundLoading` 遷移の `actions` で `currentRound = 1` をセット（新アクション `enterRound1`）。

### RESET
- 既存の `reset` は initialContext を入れるため、player 名もクリアされる。変更不要。

## 5. サーバ変更 (`packages/server/src/ws.ts`)

- `"player:setup"` ハンドラ追加:
  - `socket.data.role !== "player"` なら無視。
  - `socket.data.playerId` が A/B でないなら無視。
  - `runtime.send({ type: "PLAYER_NAMED", playerId, name: payload.name })`。
- 名前のバリデーション（空文字・長すぎ）はマシン側 action でまとめて処理する。

## 6. intro UI 変更

### `SetupView.tsx`
- タイトル「2人の関係性は？」
- 関係性4択ボタン (`カップル` / `気になっている` / `友達` / `親子`) を大型グリッド表示。
- ボタン押下で即座に `SETUP_DONE` 発火 (確認ボタンなし)。`data.players.{A,B}.name` は `""`。
- 名前入力欄・state・バリデーションは削除。

### `Intro.tsx`
- `case "playerNaming"` を追加し、専用の待機ビュー（例: `PlayerNamingWaitView`）を描画。シンプルに「プレイヤーが名前を入力中…」と A/B の入力済みステータス (○/未) を表示。

## 7. プレイヤー UI 変更

### `Player.tsx`
- `case "playerNaming"`:
  - 自分の `snap.setup.players[playerId].name === ""` なら `<NamingView playerId={...} onSubmit={...} />`。
  - 入力済みなら既存の `WaitingView` （または「相手を待っています」テキストに差し替えた小バリエーション）を表示。
- `case "setup"` は従来通り `WaitingView`（intro 操作中）。

### 新規: `NamingView.tsx`
- レイアウト（1920×540 横長）:
  - 上部左: 「Player A のなまえ」 + 入力中テキスト (例: `あきら▊`) 大きく表示。
  - 上部右: 確定ボタン (1文字以上で有効)。
  - 下部: `HiraganaKeyboard` コンポーネント。
- Props: `playerId`, `onSubmit(name: string)`.
- Socket 送信: `socket.emit("player:setup", { name })`。`Player.tsx` 側で socket を渡すか、コールバック経由で emit する。

### 新規: `HiraganaKeyboard.tsx`
- Props: `value: string`, `onChange(next: string)`, `onSubmit()`, `maxLength?: number`.
- キー構成:
  - 清音 5行×10列 (あ行〜わ行 + ん):
    ```
    あ い う え お | や    ゆ    よ    わ を
    か き く け こ | ら り る れ ろ
    さ し す せ そ | ん ー
    た ち つ て と
    な に ぬ ね の
    は ひ ふ へ ほ
    ま み む め も
    ```
    (実際の配置は CSS グリッドで横長に最適化。5×10 grid の空白セルに `ん` `ー` を置く。)
  - 変換キー: `゛` `゜` `小` `←(backspace)` `確定`
  - `゛` / `゜`: 末尾1文字を濁音/半濁音に変換（表を持つ）。該当なしなら無視。
  - `小`: 末尾1文字を小書きに変換（や→ゃ, ゆ→ゅ, よ→ょ, つ→っ, あ→ぁ, い→ぃ, う→ぅ, え→ぇ, お→ぉ）。該当なしなら無視。
  - `←`: 末尾1文字削除。
  - `確定`: 1文字以上で `onSubmit()`。
- タッチ向けに大きめのボタン (最低 44×44 相当, 実際はもっと大きく) を前提。
- すべて dumb component (socket に依存しない) として `views/player/NamingView.tsx` から呼ぶ。

## 8. テスト

### `packages/shared/test/machine.test.ts`
- `SETUP_DONE` → `playerNaming` に遷移するテストを追加。
- `PLAYER_NAMED` を A/B 両方送ると自動で `active.roundLoading` に遷移し `currentRound=1` となるテスト。
- 片方だけ送ると `playerNaming` に留まるテスト。
- 既存の `SETUP_DONE → roundLoading` 期待を書き換え。
- `RESET` で名前もクリアされるテスト（initialContext リセットで済む）。
- `snapshotToDTO` の `flattenValue` が `playerNaming` を正しく返すテストを追加。

### `packages/server/test/ws.test.ts`
- 既存「intro SETUP_DONE → roundLoading broadcast」テストを分割:
  - SETUP_DONE → `playerNaming` broadcast
  - `player:setup` を A/B 両方 → `roundLoading` broadcast
- `player:setup` を intro が送っても無視されるテスト。
- `SetupData` の `players.{A,B}.name` が `""` で送られても受理されるテスト。

### Web 側
- ハッカソン速度優先で軽め。必要なら HiraganaKeyboard の濁点変換ロジックだけ unit test を書く（純粋関数 `applyDakuten` / `applySmall` を切り出す）。

## 9. ドキュメント更新

- `docs/plans/00-overview.md` §1.3 の state→view 対応表に `playerNaming` を追加。
- `docs/README.md` の状態遷移図 / 画面構成にも反映。
- 必要なら `docs/plans/04-*.md` 付近に本変更を補足（Phase 4+ で使う state が増えたため）。

## 10. 非変更 / スコープ外

- Gemini (Phase 5)・MIDI (Phase 6) は今回触らない。
- 関係性の値は将来 Gemini プロンプトに Japanese 文字列で渡す前提だが、現段階では型レベルで列挙しておくのみ。
- プレイヤー画面の URL は変わらない (`?id=A|B` のみ)。

## 11. 受け入れ条件

1. intro `setup` 画面で4ボタン択一 → 即遷移。名前欄は無い。
2. プレイヤー画面で名前入力画面が表示され、平仮名ソフトキーボード (濁点/半濁点/小書き対応) で入力できる。
3. 両プレイヤーが確定ボタンを押すと自動で Round1 に入る。
4. `pnpm -r test` / `pnpm -r typecheck` が緑。
5. `pnpm -r build` が緑。
