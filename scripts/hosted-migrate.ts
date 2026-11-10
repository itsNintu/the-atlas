import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { Store, canonical, hash } from "../src/store.ts";
import { MIGRATION_TABLES, migrationManifest } from "../src/migration.ts";

const args = process.argv.slice(2);
const [snapshot, output] = args.filter((argument) => !argument.startsWith("--"));
const finalizeOnly = args.includes("--finalize-only");
const singletonRepair = args.includes("--resume-singletons");
const base = (process.env.THE_ATLAS_HOSTED_URL ?? "https://atlas.creator.gg").replace(/\/$/, "");
const token = process.env.THE_ATLAS_MIGRATION_TOKEN;
if (!snapshot || !output || !token)
  throw Error("Usage: THE_ATLAS_MIGRATION_TOKEN=... THE_ATLAS_HOSTED_URL=... bun scripts/hosted-migrate.ts STOPPED_SNAPSHOT RECEIPT_JSON");
if (!isAbsolute(snapshot) || !snapshot.endsWith(".sqlite"))
  throw Error("Migration requires an explicit absolute path to a stopped .sqlite snapshot");

const store = new Store(snapshot);
const expected = migrationManifest(store);
const fileHash = createHash("sha256");
for await (const chunk of createReadStream(snapshot)) fileHash.update(chunk);
const source_snapshot_sha256 = fileHash.digest("hex");

async function call(path: string, body?: unknown, attempt = 0): Promise<any> {
  let response: Response;
  try {
    response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      return call(path, body, attempt + 1);
    }
    throw error;
  }
  const result = await response.json() as any;
  if (!response.ok) {
    if (response.status >= 500 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      return call(path, body, attempt + 1);
    }
    throw Error(`Hosted migration ${path} failed ${response.status}: ${result?.error?.code ?? "unknown"} ${JSON.stringify(result?.error?.details ?? {})}`);
  }
  return result;
}

const batches: any[] = [];
const tables = finalizeOnly ? [] : singletonRepair ? [
  "memory_conversation_focus", "memory_schedule_clock", "derived_brain_reset_state", "memory_index_meta",
] : MIGRATION_TABLES;
for (const table of tables) {
  const columns = store.all(`PRAGMA table_info("${table}")`).map((column) => column.name);
  let after = 0;
  while (true) {
    const selected = store.all(
      `SELECT rowid AS __atlas_migration_rowid,* FROM "${table}" WHERE rowid>? ORDER BY rowid LIMIT 100`,
      after,
    );
    if (!selected.length) break;
    after = selected.at(-1).__atlas_migration_rowid;
    const rows = selected.map((row) => columns.map((column) => row[column]));
    const first = selected[0].__atlas_migration_rowid;
    const batch = {
      table, batch_id: `${first}-${after}`, columns, rows,
      batch_sha256: hash(canonical({ table, columns, rows })),
    };
    const result = await call("/internal/migration/v1/batch", batch);
    batches.push({ table, batch_id: batch.batch_id, rows: rows.length, batch_sha256: batch.batch_sha256, idempotent_replay: result.idempotent_replay });
    console.log(JSON.stringify({ event: "migration_batch", table, rows: rows.length, complete: batches.length }));
  }
}

console.log(JSON.stringify({ event: "migration_reembed_start" }));
const reembed = await call("/internal/migration/v1/reembed", {});
const hosted = await call("/internal/migration/v1/finalize", { expected });
const receipt = {
  format: "atlas-hosted-cutover-receipt-v1",
  captured_at: new Date().toISOString(),
  endpoint: base,
  source_snapshot_sha256,
  source: expected,
  hosted,
  reembed,
  batches,
  raw_content_included: false,
  credentials_included: false,
};
await mkdir(dirname(output), { recursive: true });
await Bun.write(output, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ event: "migration_complete", output, tables: Object.keys(expected.tables).length, batches: batches.length, reembed }));
store.close();
