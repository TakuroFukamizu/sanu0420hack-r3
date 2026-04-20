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
