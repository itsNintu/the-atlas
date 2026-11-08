import { setting, databasePath } from "./config.ts";
import { Store } from "./store.ts";
import { App } from "./app.ts";
import { Worker } from "./worker.ts";
import { MemoryWorker } from "./memory.ts";
import { SCHEMA_VERSION } from "./schema.ts";

const store = new Store(databasePath());
const app = new App(store),
  worker = new Worker(store),
  memoryWorker = new MemoryWorker(store);
const server = Bun.serve({
  hostname: setting("HOST") ?? "127.0.0.1",
  port: Number(setting("PORT") ?? 8787),
  maxRequestBodySize: 1_000_000,
  idleTimeout: 60,
  fetch: (r) => app.fetch(r),
});
let stopping = false;
async function work(runOnce: () => Promise<boolean>) {
  let processed = 0;
  while (!stopping) {
    if (setting("WORKER") !== "false") {
      try {
        if (await runOnce()) {
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
const concurrency = Number(setting("MEMORY_WORKERS") ?? 1);
const memoryConcurrency =
  Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 1;
const loop = Promise.all([
  work(() => worker.runOnce()),
  ...Array.from({ length: memoryConcurrency }, () =>
    work(() => memoryWorker.runOnce()),
  ),
]);
console.log(
  JSON.stringify({
    event: "listening",
    url: server.url.toString(),
    api_version: "v1",
    schema_version: SCHEMA_VERSION,
    worker_enabled: setting("WORKER") !== "false",
  }),
);
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop(true);
  await loop;
  if (memoryWorker.inference.close) await memoryWorker.inference.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
