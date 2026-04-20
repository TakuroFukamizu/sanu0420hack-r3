import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // LAN 上の LG 端末からも開けるように
    proxy: {
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
      },
      "/api": "http://localhost:3000",
    },
  },
  build: {
    // プレイヤー画面は Chrome 84 (Android 7.1.2) 固定。この target を外すと aspect-ratio や
    // top-level await 等の Chrome 84 未サポート構文が出力に混入する可能性がある。
    // 参考: docs/knowledge/player-display-lg-ld290ejs-fpn1.md
    target: ["chrome84"],
  },
});
