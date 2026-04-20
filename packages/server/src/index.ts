// dotenv は他の import より前に副作用import して、この後の env 参照より先に .env を
// process.env に流し込む。.env は packages/server/ 直下に置く (pnpm --filter の cwd と
// 一致するため `dotenv/config` がデフォルトで読む)。テンプレートは .env.example を参照。
import "dotenv/config";

import { buildApp } from "./app.js";
import { attachSocketIo } from "./ws.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

await app.ready();
attachSocketIo(app.server, app.sessionRuntime);

app
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => {
    console.log(`server listening on ${addr}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
