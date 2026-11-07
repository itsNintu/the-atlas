import { setting, databasePath } from "./config.ts";
import { Store } from "./store.ts";
import { App } from "./app.ts";
import { Worker } from "./worker.ts";

const store = new Store(
  databasePath(),
);
const app = new App(store),
  worker = new Worker(store);
const server = Bun.serve({
  hostname: setting("HOST") ?? "127.0.0.1",
  port: Number(setting("PORT") ?? 8787),
  maxRequestBodySize: 1_000_000,
  idleTimeout: 60,
  fetch: (r) => app.fetch(r),
});
let stopping = false;
async function work() {
  let processed = 0;
  while (!stopping) {
    if (setting("WORKER") !== "false") {
      try {
        if (await worker.runOnce()) {
          if (++processed % 16 === 0) await Bun.sleep(1);
          continue;
        }
      } catch {
        console.error(
          JSON.stringify({
            event: "worker_error",
            code: "storage_or_worker_error",
          }),
        );
      }
    }
    await Bun.sleep(50);
  }
}
const loop = work();
console.log(
  JSON.stringify({
    event: "listening",
    url: server.url.toString(),
    api_version: "v1",
    schema_version: 1,
    worker_enabled: setting("WORKER") !== "false",
  }),
);
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop(true);
  await loop;
  store.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
