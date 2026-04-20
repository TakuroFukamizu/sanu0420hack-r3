# プレイヤー画面向けデバイス仕様: LG LD290EJS-FPN1

プレイヤー画面のフロントエンド実装で採用できる WebAPI / CSS を判断するための基礎資料。
ハードウェア仕様は LG Display の公式スペックシート、ブラウザ仕様はユーザー指定の
`Chrome 84.0.4147.125` / `Android 7.1.2` を前提にしている。

## 1. パネル仕様（LD290EJS-FPN1）

| 項目 | 値 |
| --- | --- |
| パネルサイズ | 29.0" 対角（有効表示 28.6"） |
| 解像度 | **1920 × 540 px**（RGB Horizontal Stripe） |
| アスペクト比 | 約 **3.56 : 1**（横長ストレッチバー） |
| 表示面積 | 698.4 × 196.43 mm |
| ピクセルピッチ | 約 0.364 mm（約 **70 DPI** 相当） |
| 表示色数 | 16.7M（8bit） |
| 輝度 | 500 cd/m²（typ.） |
| コントラスト | 1000:1（typ.） |
| 視野角 | 89° / 89° / 89° / 89°（CR ≥ 10） |
| パネルタイプ | IPS（Normally Black, Transmissive, WLED） |
| 応答速度 / リフレッシュレート | 60Hz |
| タッチ | In-cell タッチ（マルチタッチ対応） |
| 動作温度 | 0 〜 45℃ |

### レイアウト上の含意

- **論理解像度 1920×540** を基準にレイアウト設計する。CSS では
  `viewport = 1920×540`（`<meta name="viewport" content="width=1920">`）を前提にする。
- 物理的に **横長・低DPI** のため、フォントは 24px 以上、見出しは 48px 以上を推奨。
  通常のスマホ・PC 想定のコンポーネント（16px 基準）はそのまま使うと視認性が低い。
- 縦方向のピクセル数が **540px** しかない。縦スクロール UI は原則使わず、
  1画面完結のレイアウト（flex / grid を横方向に広げる）を前提にする。
- 2台横並びではなく、**1台に1人が対面する** 形で設置する想定（docs/README.md）。
  2画面のうちどちらが「右側 / 左側」かはサーバから配信時に指示する。

## 2. 組込みソフトウェア仕様

LD290EJS-FPN1 は Android OS 内蔵モデル。本プロジェクトでは以下を前提とする。

| 項目 | 値 |
| --- | --- |
| OS | **Android 7.1.2 (Nougat, API level 25)** |
| ブラウザ | **Chrome 84.0.4147.125**（2020年7月リリース相当） |
| JS エンジン | V8 8.4 系 |
| レンダリングエンジン | Blink（Chromium 84） |
| 入力 | Micro HDMI（映像出力/デイジーチェーン用）/ Micro USB ×2 / Bluetooth |
| 電源 | AC 100-240V → 12V / 3A |

> ⚠️ Chrome 84 は 2020 年 7 月リリース。2026 年時点でサポート終了済み。
> caniuse.com などで機能判定する際は **"Chrome 84" 行で ✅ になっているもののみ** を採用する。

## 3. 使用可否の判断基準（CSS）

### ✅ 利用可（Chrome 84 時点でサポート済み）

| 機能 | 備考 |
| --- | --- |
| Flexbox | `gap` も **Chrome 84 で解禁**。flex で `gap` を使う場合は問題なし |
| CSS Grid | `grid-template-*`, `gap`, `minmax()`, `auto-fill/auto-fit` すべて可 |
| CSS Variables（カスタムプロパティ） | 完全対応 |
| CSS transforms / 3D transforms | `translate3d` 等 GPU 合成を積極的に使ってよい |
| CSS animations / transitions | 完全対応。`will-change` で合成ヒントも有効 |
| Web Animations API | Chrome 84 で `animation.ready` / `animation.finished` が Promise 化 |
| `clip-path` | basic-shape / URL 参照どちらも可 |
| `backdrop-filter` | Chrome 76 から。フルスクリーンでの多用はGPU負荷に注意 |
| `position: sticky` | 対応 |
| `object-fit` / `object-position` | 対応 |
| `@supports` | 対応。フォールバック分岐は必ず `@supports` で行う |
| `revert` 値 | **Chrome 84 で解禁**（それ以前は `unset` を使う必要があった） |
| CSS カウンター / `::before` / `::after` | 対応 |

### ❌ 利用不可（Chrome 84 では未サポート）

| 機能 | 導入版 | 代替 |
| --- | --- | --- |
| `aspect-ratio` プロパティ | Chrome 88 | padding-top hack（`padding-top: 28.125%` 等） |
| `:has()` 親セレクタ | Chrome 105 | JS で class 付与、または兄弟セレクタ |
| CSS Nesting | Chrome 112 | PostCSS / Sass でビルド時に展開 |
| Container Queries (`@container`) | Chrome 105 | メディアクエリ＋JS の ResizeObserver で代替 |
| `subgrid` | Chrome 117 | 親の grid-template-* を子にも合わせて定義 |
| Cascade Layers (`@layer`) | Chrome 99 | 詳細度設計で回避 |
| `color-mix()` / `color-contrast()` | Chrome 111+ | プリプロセッサで事前計算 |
| `accent-color` | Chrome 93 | 対応しないため、チェックボックス等は自作 |
| `inset` ショートハンド | Chrome 87 | `top/right/bottom/left` を個別に指定 |
| 論理プロパティ（`inline-size`, `block-size`） | 一部のみ Chrome 87+ | 物理プロパティ（width/height）を使う |
| View Transitions API | Chrome 111 | 独自のトランジション実装 |
| Scroll-driven Animations | Chrome 115 | IntersectionObserver + JS |
| `text-wrap: balance` | Chrome 114 | 手動改行 / `<br>` |

### CSS を書く際の設計指針

- **PostCSS + autoprefixer** を使う場合は `browserslist` に
  `"Chrome >= 84", "Android >= 7"`（または `last 2 Chrome versions, not dead` ではなく明示指定）を
  記述し、未サポート機能が出力に混入しないようにする。
- Tailwind CSS v3 系を使う場合 `future.hoverOnlyWhenSupported` など Chrome 100 系以降を前提とした
  機能もあるため、コンフィグは最小限にとどめる（あるいは Tailwind v2 系を検討）。
- `@supports` で機能検出し、**未サポート時は degrade しても成立するデザイン** にする。

## 4. 使用可否の判断基準（JavaScript / WebAPI）

### ✅ 利用可（Chrome 84 で使える）

**言語機能 (ES)**
- ES2015 〜 ES2020 はほぼ全て対応
- `?.`（Optional chaining）、`??`（Nullish coalescing）: Chrome 80+
- `BigInt`、`globalThis`、`Promise.allSettled`、`String.prototype.matchAll`
- dynamic `import()`、`import.meta`
- Public class fields: Chrome 72+ / Private class fields (`#name`): Chrome 74+

**DOM / UI**
- Pointer Events / Touch Events（**タッチ対応必須**）
- IntersectionObserver / ResizeObserver
- Fullscreen API
- Page Visibility API（`visibilitychange`）
- Fetch API / AbortController
- `requestAnimationFrame` / `requestIdleCallback`

**通信・永続化**
- WebSocket（バイナリも可）
- Service Worker / Cache API（※Android WebView 版では動作しないケースあり。要実機検証）
- IndexedDB、LocalStorage、SessionStorage
- BroadcastChannel

**メディア**
- Canvas 2D / WebGL / WebGL 2
- Web Audio API（AudioWorklet 含む）
- HTMLVideoElement / HTMLAudioElement（H.264, WebM/VP9 デコード可）
- MediaStream / getUserMedia（カメラ・マイク）
- WebRTC（1:1 通信可）

**その他（Chrome 84 で新規 / 強化）**
- **Wake Lock API**（`navigator.wakeLock.request('screen')`）: 画面スリープ防止。
  アーケード用途では積極的に使う。
- Web Animations API の拡張
- Content Indexing API

### ❌ 利用不可（Chrome 84 では使えない / 代替が必要）

| 機能 | 導入版 | 代替 |
| --- | --- | --- |
| `Array.prototype.at()` | Chrome 92 | `arr[arr.length - 1]` 等 |
| `Object.hasOwn()` | Chrome 93 | `Object.prototype.hasOwnProperty.call()` |
| Error `cause` オプション | Chrome 93 | カスタムエラークラスで代替 |
| `structuredClone()` | Chrome 98 | `JSON.parse(JSON.stringify(...))` または MessageChannel hack |
| Top-level `await` | Chrome 89 | `async` 関数で IIFE |
| `String.prototype.replaceAll` | Chrome 85 | 正規表現の `g` フラグ |
| `Promise.any` | Chrome 85 | Polyfill |
| File System Access API | Chrome 86 | ファイル保存が必要ならサーバ経由 |
| WebCodecs | Chrome 94 | Canvas + WebGL で代替 |
| WebTransport | Chrome 97 | WebSocket / WebRTC DataChannel |
| WebGPU | Chrome 113 | WebGL 2 |
| Web Serial / Web HID | Chrome 89 | 用途なければ不要 |
| Scheduler API (`scheduler.postTask`) | Chrome 94 | `setTimeout(fn, 0)` / `requestIdleCallback` |

### ビルドツール設定の指針

- **Vite / esbuild**: `build.target = ['chrome84']` を明示する。
  デフォルト (`modules` 等) は Chrome 87 以降を対象にしており、nullish assignment (`??=`) などが
  未トランスパイルのまま出力されるリスクがある。
- **TypeScript**: `compilerOptions.target = "ES2019"` 推奨。
  ES2020 を使う場合も OK だが、`lib` に未サポート API を含めないよう注意。
- **polyfill**: `core-js@3` を `usage` モードで導入し、browserslist に合わせて必要分だけ注入する。
  `replaceAll`, `Promise.any`, `Array.at`, `structuredClone` 等は自動補填可能。
- **React**: React 18 は Chrome 84 でも動作する（公式の最低要件は明記されていないが、
  ES2015 相当の環境で動作）。React 19 も現時点で Chrome 84 で動く想定だが要実機確認。
- **アニメーション**: GSAP / Framer Motion は Chrome 84 で動作実績あり。
  View Transitions API に依存するライブラリは避ける。

## 5. 実装上の注意点（プレイヤー画面固有）

### 画面設計
- **キャンバスサイズは 1920×540 固定**。メディアクエリで PC/スマホ向けのレイアウトを
  切り替える必要はない（専用端末）。`vh` / `vw` を使う際は 540px/1920px 基準で単位計算する。
- `devicePixelRatio` は通常 1.0。画像は **原寸（等倍）で用意** する（Retina 対応不要）。
- 背景を動かす演出（docs/README.md のスタート画面）は `transform: translate3d()` +
  `will-change: transform` で GPU レイヤに載せる。

### 入力
- **タッチ第一**。`click` ではなく `pointerdown` / `pointerup` で設計し、300ms 遅延を避ける。
- マウス/キーボードは Micro USB 経由で接続可だが、運用上は使わない想定。
- 長押しでコンテキストメニュー・テキスト選択が発生しないよう `user-select: none`,
  `-webkit-touch-callout: none`, `touch-action: manipulation` を全画面に当てる。

### サウンド・映像
- **自動再生ポリシー**に注意。Chrome 84 では「ユーザー操作なしのミュート解除再生」は
  ブロックされる。BGM はノート PC 側（サーバ / MIDI 音源）で鳴らす前提なので、
  プレイヤー画面の音は SE のみ。初回タップ後に AudioContext を resume する。
- 動画を使う場合は **H.264 (MP4) を第一選択**（VP9 も可だがデコード負荷高）。

### 省電力・ロック防止
- アーケード用途なので **常時点灯**。ページ読み込み後に
  `navigator.wakeLock.request('screen')` を呼び、`visibilitychange` で再取得する。
- `visibilitychange` で `hidden` になった場合、WebSocket を保持したまま再開できるよう
  `navigator.wakeLock` のリリース・再取得ハンドリングを入れる。

### フォント
- Android 7.1.2 標準フォントは Roboto / Noto Sans CJK JP。
- カスタムフォントを使う場合は **WOFF2** を `font-display: swap` でロード。
  必要な字形を絞り込む（サブセット化）ことで初期表示を改善する。

### デバッグ
- USB デバッグで **Chrome DevTools Remote** を使う（`chrome://inspect`）。
- ただし 実機 Chrome が 84 系なので、DevTools 側も互換性のある版を使う。
  新しすぎる DevTools だとプロトコル互換で動作しないことがある。
- BrowserStack や CrossBrowserTesting には Chrome 84 / Android 7 のプロファイルが
  残っていないケースが多いので、**実機での動作確認を最優先** にする。

## 6. 参考リンク

- [LG Display LD290EJS-FPN1 Spec Sheet (PDF)](https://crystal-display.com/wp-content/uploads/2021/06/LD290EJS-FPN1-Spec-Sheet.pdf)
- [LG LD290EJS-FPN1 User Manual](https://manuals.plus/m/a0f0fbb803649ec0fcfbf6e3d8f3f1f572ce4403c43d79cbf74aa6f63f056345)
- [Taiwan Screen - LD290EJS-FPN1 Specification](https://www.twscreen.com/en/lcdpanel/23113/lgdisplay/ld290ejs-fpn1/29/1920x540)
- [New in Chrome 84 - Chrome for Developers](https://developer.chrome.com/blog/new-in-chrome-84)
- [Deprecations and removals in Chrome 84](https://developer.chrome.com/blog/chrome-84-deps-rems)
- [caniuse.com（Chrome 84 のフィルタで機能判定を行う）](https://caniuse.com/)
