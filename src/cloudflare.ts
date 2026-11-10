import { DurableObject } from "cloudflare:workers";
import { App } from "./app.ts";
import { Store } from "./store.ts";
import { DurableObjectSQLite } from "./sqlite.ts";
import { Worker as SourceWorker } from "./worker.ts";
import { MemoryWorker } from "./memory.ts";
import { ApiError } from "./errors.ts";
import { setting, sleep } from "./config.ts";
import {
  migrationAuthorized, migrationManifest, importMigrationBatch, finalizeMigration,
} from "./migration.ts";
import indexHtml from "../ui/index.html";
import brainHtml from "../ui/brain.html";
import uiJs from "../ui/ui.js";
import brainJs from "../ui/brain.js";
import styleCss from "../ui/style.css";
import brainCss from "../ui/brain.css";
import brandCss from "../ui/brand.css";
import brandSvg from "../ui/brand/creator-labs-white.svg";
import spaceGrotesk from "../ui/brand/SpaceGrotesk-variable.ttf";
import plexRegular from "../ui/brand/IBMPlexMono-Regular.ttf";
import plexMedium from "../ui/brand/IBMPlexMono-Medium.ttf";

const assets: Record<string, any> = {
  "index.html": indexHtml, "brain.html": brainHtml, "ui.js": uiJs, "brain.js": brainJs,
  "style.css": styleCss, "brain.css": brainCss, "brand.css": brandCss,
  "brand/creator-labs-white.svg": brandSvg,
  "brand/SpaceGrotesk-variable.ttf": spaceGrotesk,
  "brand/IBMPlexMono-Regular.ttf": plexRegular,
  "brand/IBMPlexMono-Medium.ttf": plexMedium,
};

type AtlasEnvironment = Record<string, any> & {
  ATLAS_DURABLE_OBJECT: DurableObjectNamespace<AtlasDurableObject>;
};

function configureEnvironment(env: AtlasEnvironment) {
  for (const [key, value] of Object.entries(env))
    if (typeof value === "string") process.env[key] = value;
  process.env.THE_ATLAS_WORKER = env.THE_ATLAS_WORKER ?? "true";
}

export class AtlasDurableObject extends DurableObject<AtlasEnvironment> {
  store: Store;
  app: App;
  sourceWorker: SourceWorker;
  memoryWorker: MemoryWorker;

  constructor(ctx: DurableObjectState, env: AtlasEnvironment) {
    super(ctx, env);
    configureEnvironment(env);
    this.store = new Store("cloudflare-durable-object", new DurableObjectSQLite(ctx.storage));
    this.app = new App(this.store, undefined, assets);
    this.sourceWorker = new SourceWorker(this.store);
    this.memoryWorker = new MemoryWorker(this.store);
    if (!setting("MIGRATION_TOKEN")) ctx.blockConcurrencyWhile(async () => {
      const pending = this.store.one(`SELECT COUNT(*) AS n FROM memory_jobs
        WHERE status IN ('queued','running','retry')`);
      if (pending.n) await this.ensureAlarm(10);
    });
  }

  async ensureAlarm(delay = 25) {
    if (process.env.THE_ATLAS_WORKER === "false" || setting("MIGRATION_TOKEN")) return;
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  async pump() {
    if (setting("MIGRATION_TOKEN")) return { worked: false, maintenance: true };
    if (process.env.THE_ATLAS_WORKER === "false") return { worked: false };
    let worked = false;
    // Bound each invocation. Another alarm/cron continues durable leases; no
    // permanent process, localhost service, or second SQLite writer is needed.
    for (let i = 0; i < 2; i++) {
      const source = await this.sourceWorker.runOnce();
      const memory = await this.memoryWorker.runOnce();
      worked ||= source || memory;
      if (!source && !memory) break;
    }
    await this.ensureAlarm(worked ? 25 : 5000);
    return { worked };
  }

  async runScheduled() {
    return this.pump();
  }

  async reembedMemories() {
    const model = process.env.THE_ATLAS_EMBEDDING_MODEL ?? "text-embedding-3-small";
    let updated = 0;
    while (true) {
      const rows = this.store.all(
        "SELECT id,subject,predicate,object FROM memories WHERE embedding_model<>? OR embedding_json IS NULL ORDER BY id LIMIT 24",
        model,
      );
      if (!rows.length) break;
      const embedded = await this.memoryWorker.inference.embed(
        rows.map((row) => `${row.subject} ${row.predicate} ${row.object}`),
      );
      if (embedded.model !== model || embedded.vectors.length !== rows.length)
        throw new ApiError(503, "invalid_embedding", "Hosted embedding model/count mismatch", true);
      this.store.transaction(() => {
        rows.forEach((row, index) => this.store.run(
          "UPDATE memories SET embedding_json=?,embedding_model=? WHERE id=?",
          JSON.stringify(embedded.vectors[index]), embedded.model, row.id,
        ));
      });
      updated += rows.length;
    }
    return { updated, model };
  }

  async alarm() {
    await this.pump();
  }

  private migrationError(error: unknown) {
    const e = error instanceof ApiError
      ? error
      : new ApiError(500, "internal_error", "Migration operation failed", false);
    return Response.json({
      error: { code: e.code, message: e.message, retryable: e.retryable, details: e.details },
    }, { status: e.status, headers: { "Cache-Control": "no-store" } });
  }

  async fetch(request: Request): Promise<Response> {
    configureEnvironment(this.env);
    const url = new URL(request.url);
    if (url.pathname.startsWith("/internal/operations/v1/")) {
      try {
        migrationAuthorized(request, this.env.THE_ATLAS_OPERATIONS_TOKEN);
        if (request.method === "GET" && url.pathname.endsWith("/manifest"))
          return Response.json(migrationManifest(this.store), { headers: { "Cache-Control": "no-store" } });
        if (request.method === "POST" && url.pathname.endsWith("/restart")) {
          await request.json();
          await this.ensureAlarm(10);
          this.ctx.waitUntil((async () => { await sleep(250); this.ctx.abort(); })());
          return Response.json({ restart_scheduled: true, mechanism: "DurableObjectState.abort" });
        }
        throw new ApiError(404, "not_found", "Route not found", false);
      } catch (error) {
        return this.migrationError(error);
      }
    }
    if (url.pathname.startsWith("/internal/migration/v1/")) {
      try {
        migrationAuthorized(request, this.env.THE_ATLAS_MIGRATION_TOKEN);
        if (request.method === "GET" && url.pathname.endsWith("/manifest"))
          return Response.json(migrationManifest(this.store), { headers: { "Cache-Control": "no-store" } });
        if (request.method === "POST" && url.pathname.endsWith("/batch")) {
          if (Number(request.headers.get("content-length")) > 25_000_000)
            throw new ApiError(413, "payload_too_large", "Migration batch exceeds 25 MB", false);
          return Response.json(importMigrationBatch(this.store, await request.json()));
        }
        if (request.method === "POST" && url.pathname.endsWith("/network-probe")) {
          await request.json();
          try {
            const response = await fetch("https://api.openai.com/v1/models", {
              redirect: "manual", signal: AbortSignal.timeout(20_000),
            });
            await response.body?.cancel();
            return Response.json({ network: "ok", status: response.status });
          } catch (error) {
            return Response.json({ network: "failed", error: String(error), cause: String((error as any)?.cause ?? "") }, { status: 503 });
          }
        }
        if (request.method === "POST" && url.pathname.endsWith("/reembed")) {
          await request.json();
          return Response.json(await this.reembedMemories());
        }
        if (request.method === "POST" && url.pathname.endsWith("/finalize")) {
          const body = await request.json() as any;
          const result = finalizeMigration(this.store, body.expected);
          await this.ensureAlarm(10);
          return Response.json(result);
        }
        if (request.method === "POST" && url.pathname.endsWith("/reset")) {
          const body = await request.json() as any;
          if (body.confirm !== "RESET_INCOMPLETE_HOSTED_MIGRATION")
            throw new ApiError(409, "migration_reset_confirmation", "Explicit incomplete-migration reset confirmation required", false);
          await this.ctx.storage.deleteAlarm();
          await this.ctx.storage.deleteAll();
          return Response.json({ reset_complete: true, durable_source_snapshot_untouched: true });
        }
        if (request.method === "POST" && url.pathname.endsWith("/restart")) {
          // DurableObjectState.abort() is Cloudflare's supported in-place reset;
          // SQLite storage and the already-scheduled alarm survive eviction.
          await this.ensureAlarm(10);
          this.ctx.waitUntil((async () => { await sleep(250); this.ctx.abort(); })());
          return Response.json({ restart_scheduled: true, mechanism: "DurableObjectState.abort" });
        }
        throw new ApiError(404, "not_found", "Route not found", false);
      } catch (error) {
        return this.migrationError(error);
      }
    }
    const response = await this.app.fetch(request);
    if (!["GET", "HEAD"].includes(request.method) && url.pathname.startsWith("/v1/"))
      this.ctx.waitUntil(this.ensureAlarm(10));
    return response;
  }
}

function singleton(env: AtlasEnvironment) {
  return env.ATLAS_DURABLE_OBJECT.get(env.ATLAS_DURABLE_OBJECT.idFromName("atlas-production-v1"));
}

export default {
  fetch(request: Request, env: AtlasEnvironment) {
    return singleton(env).fetch(request);
  },
  async scheduled(_event: unknown, env: AtlasEnvironment) {
    await singleton(env).runScheduled();
  },
};
