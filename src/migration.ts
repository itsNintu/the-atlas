import { createHash, timingSafeEqual } from "node:crypto";
import { canonical, hash, now, type Store } from "./store.ts";
import { ApiError, fail } from "./errors.ts";

// Ordinary row tables only. FTS5 shadow tables are rebuilt, and vector buckets
// are deterministically recreated by Store.run while memories are imported.
export const MIGRATION_TABLES = [
  "workspaces", "principals", "credentials", "projects", "spaces", "grants",
  "sources", "revisions", "jobs", "facts", "supports", "idempotency", "audit",
  "memory_bindings", "memory_grants", "memory_events", "memory_roots", "memory_heads",
  "memory_jobs", "memory_entities", "memory_aliases", "memories", "memory_supports",
  "memory_lineage", "memory_changes", "memory_change_invalidations", "memory_versions",
  "memory_recalls", "memory_feedback", "memory_scoped_aliases", "memory_alias_sources",
  "memory_entity_targets", "memory_entity_equivalences",
  "memory_entity_equivalence_invalidations", "memory_reconciliations",
  "memory_admission_reviews", "memory_admission_demotions", "memory_reprocess_requests",
  "memory_reconsider_requests", "memory_event_admissions", "memory_jev_routes",
  "memory_chunk_progress", "memory_curation_metrics", "memory_conversation_focus",
  "memory_schedule_clock", "memory_thread_schedule", "memory_provider_holds",
  "derived_brain_reset_state", "derived_brain_reset_receipts", "memory_index_meta",
] as const;

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const PREEXISTING = new Set([
  "memory_conversation_focus", "memory_schedule_clock",
  "derived_brain_reset_state", "memory_index_meta",
]);
const SINGLETON_UPSERT = new Set([
  "memory_conversation_focus", "memory_schedule_clock", "derived_brain_reset_state",
]);

export function migrationAuthorized(request: Request, token: string | undefined) {
  if (!token) fail(404, "not_found", "Route not found");
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(token).digest();
  if (a.length !== b.length || !timingSafeEqual(a, b))
    fail(401, "unauthorized", "Valid migration credential required");
}

export function migrationManifest(store: Store) {
  const tables: Record<string, unknown> = {};
  for (const table of MIGRATION_TABLES) {
    const info = store.all(`PRAGMA table_info(${quote(table)})`);
    const keys = info.filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk).map((column) => column.name);
    let identity_sha256: string | null = null;
    if (keys.length) {
      const digest = createHash("sha256");
      const selected = keys.map(quote).join(",");
      for (const row of store.all(
        `SELECT ${selected} FROM ${quote(table)} ORDER BY ${keys.map((key) => quote(key)).join(",")}`,
      )) digest.update(canonical(row)).update("\n");
      identity_sha256 = digest.digest("hex");
    } else {
      const digest = createHash("sha256");
      for (const row of store.all(`SELECT * FROM ${quote(table)} ORDER BY rowid`))
        digest.update(canonical(row)).update("\n");
      identity_sha256 = digest.digest("hex");
    }
    tables[table] = {
      count: store.one(`SELECT COUNT(*) AS n FROM ${quote(table)}`).n,
      identity_sha256,
    };
  }
  return {
    format: "atlas-migration-manifest-v1",
    tables,
    derived: {
      memory_search: store.one("SELECT COUNT(*) AS n FROM memory_search").n,
    },
    reset: store.one("SELECT epoch,reset_id,reset_at FROM derived_brain_reset_state WHERE singleton=1"),
    nonterminal_current: store.one(`SELECT COUNT(*) AS n FROM memory_jobs j
      WHERE j.status IN ('queued','running','retry')
      AND j.reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1)`).n,
    affected_session_events: store.one(
      "SELECT COUNT(*) AS n FROM memory_events WHERE thread_id=?",
      "20261110_114330_3ae9e980",
    ).n,
  };
}

export function ensureMigrationTables(store: Store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS atlas_migration_batches(
    table_name TEXT NOT NULL,batch_id TEXT NOT NULL,batch_sha256 TEXT NOT NULL,
    row_count INTEGER NOT NULL,applied_at TEXT NOT NULL,
    PRIMARY KEY(table_name,batch_id));`);
}

export function importMigrationBatch(store: Store, body: any) {
  const table = String(body.table ?? "");
  const batchId = String(body.batch_id ?? "");
  if (!(MIGRATION_TABLES as readonly string[]).includes(table))
    fail(400, "invalid_migration_table", "Unknown migration table");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(batchId))
    fail(400, "invalid_migration_batch", "Invalid migration batch identity");
  const columns = body.columns, rows = body.rows;
  if (!Array.isArray(columns) || !columns.length || columns.some((c: any) => typeof c !== "string") ||
      !Array.isArray(rows) || rows.length > 500)
    fail(400, "invalid_migration_batch", "Invalid columns or row batch");
  const actualColumns = store.all(`PRAGMA table_info(${quote(table)})`).map((c) => c.name);
  if (canonical(columns) !== canonical(actualColumns))
    fail(400, "migration_schema_mismatch", "Source and destination columns differ");
  if (rows.some((row: any) => !Array.isArray(row) || row.length !== columns.length))
    fail(400, "invalid_migration_row", "Migration row shape mismatch");
  const batchSha256 = hash(canonical({ table, columns, rows }));
  if (body.batch_sha256 !== batchSha256)
    fail(400, "migration_batch_hash", "Migration batch digest mismatch");
  ensureMigrationTables(store);
  return store.transaction(() => {
    const previous = store.one(
      "SELECT * FROM atlas_migration_batches WHERE table_name=? AND batch_id=?",
      table, batchId,
    );
    if (previous) {
      if (previous.batch_sha256 !== batchSha256 || previous.row_count !== rows.length)
        fail(409, "migration_batch_conflict", "Migration batch identity was reused");
      // Replayed singleton batches still repair destination initialization
      // defaults; ordinary row batches remain pure idempotent replays.
      if (!SINGLETON_UPSERT.has(table))
        return { table, batch_id: batchId, rows: rows.length, idempotent_replay: true };
    }
    if (rows.length) {
      const conflict = SINGLETON_UPSERT.has(table)
        ? ` ON CONFLICT DO UPDATE SET ${columns.map((column) => `${quote(column)}=excluded.${quote(column)}`).join(",")}`
        : PREEXISTING.has(table) ? " ON CONFLICT DO NOTHING" : "";
      const sql = `INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})${conflict}`;
      for (const row of rows) store.run(sql, ...row);
    }
    if (!previous)
      store.run(
        "INSERT INTO atlas_migration_batches VALUES(?,?,?,?,?)",
        table, batchId, batchSha256, rows.length, now(),
      );
    return { table, batch_id: batchId, rows: rows.length, idempotent_replay: !!previous };
  });
}

export function finalizeMigration(store: Store, expected: any) {
  store.db.exec("INSERT INTO memory_search(memory_search) VALUES('rebuild')");
  const violations = store.all("PRAGMA foreign_key_check");
  if (violations.length) fail(500, "migration_foreign_key_violation", "Migrated foreign keys are invalid");
  const quickCheck = store.one("PRAGMA quick_check");
  if (Object.values(quickCheck)[0] !== "ok")
    fail(500, "migration_integrity_failed", "Migrated SQLite quick check failed");
  const actual = migrationManifest(store);
  if (expected?.tables && canonical(expected.tables) !== canonical(actual.tables))
    throw new ApiError(409, "migration_reconciliation_mismatch", "Counts or key digests differ from the stopped source", false, {
      expected: expected.tables, actual: actual.tables,
    });
  for (const field of ["reset", "nonterminal_current", "affected_session_events"] as const)
    if (expected?.[field] !== undefined && canonical(expected[field]) !== canonical(actual[field]))
      throw new ApiError(409, "migration_reconciliation_mismatch", `${field} differs from the stopped source`, false, {
        expected: expected[field], actual: actual[field],
      });
  store.run("DROP TABLE IF EXISTS atlas_migration_batches");
  return { ...actual, quick_check: "ok", foreign_key_violations: 0 };
}
