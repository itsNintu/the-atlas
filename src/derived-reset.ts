import { canonical, hash, id, now, type Store } from "./store.ts";
import { fail } from "./errors.ts";
import { currentResetEpoch } from "./reset-state.ts";

export const DERIVED_RESET_CONFIRMATION = "RESET_DERIVED_BRAIN";

// Explicit, scope-independent physical deletion. Raw events/revisions, account
// configuration and non-content operational receipts are deliberately absent.
export const DERIVED_PURGE_TABLES = [
  "memory_feedback",
  "memory_recalls",
  "memory_admission_demotions",
  "memory_admission_reviews",
  "memory_change_invalidations",
  "memory_reconciliations",
  "memory_event_admissions",
  "memory_jev_routes",
  "memory_lineage",
  "memory_entity_targets",
  "memory_supports",
  "memory_changes",
  "memory_entity_equivalence_invalidations",
  "memory_entity_equivalences",
  "memory_alias_sources",
  "memory_versions",
  "memory_vector_buckets",
  "memory_chunk_progress",
  "memories",
  "memory_scoped_aliases",
  "memory_aliases",
  "memory_entities",
  "supports",
  "facts",
] as const;

export const DERIVED_PRESERVED_TABLES = [
  "workspaces",
  "principals",
  "credentials",
  "projects",
  "spaces",
  "grants",
  "sources",
  "revisions",
  "jobs",
  "idempotency",
  "audit",
  "memory_bindings",
  "memory_grants",
  "memory_events",
  "memory_roots",
  "memory_heads",
  "memory_jobs",
  "memory_provider_holds",
  "memory_curation_metrics",
  "memory_reprocess_requests",
  "memory_reconsider_requests",
  "memory_schedule_clock",
  "memory_thread_schedule",
  "memory_conversation_focus",
  "memory_index_meta",
  "derived_brain_reset_state",
  "derived_brain_reset_receipts",
] as const;

const KNOWN = new Set<string>([
  ...DERIVED_PURGE_TABLES,
  ...DERIVED_PRESERVED_TABLES,
  "memory_search",
]);
const COUNTED = [...new Set<string>([
  ...DERIVED_PURGE_TABLES,
  ...DERIVED_PRESERVED_TABLES,
  "memory_search",
])].sort();

function counts(store: Store) {
  return Object.fromEntries(
    COUNTED.map((table) => [
      table,
      store.one(`SELECT COUNT(*) AS n FROM "${table}"`).n as number,
    ]),
  ) as Record<string, number>;
}

function assertManifest(store: Store) {
  const actual = store.all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  ).map((row) => row.name as string);
  const unknown = actual.filter(
    (name) => !KNOWN.has(name) && !/^memory_search_(?:data|idx|docsize|config)$/.test(name),
  );
  if (unknown.length) {
    fail(
      500,
      "reset_manifest_incomplete",
      `Reset refuses unclassified database tables: ${unknown.sort().join(",")}`,
    );
  }
}

/** Offline local-operator clean slate. The caller must stop every Atlas writer
 * and take the stopped full DB/configuration custody backup before invocation. */
export function resetDerivedBrain(store: Store, confirmation: string) {
  if (confirmation !== DERIVED_RESET_CONFIRMATION) {
    fail(
      400,
      "reset_confirmation_required",
      `Pass --confirm ${DERIVED_RESET_CONFIRMATION} after the stopped custody backup`,
    );
  }
  assertManifest(store);
  const result = store.transaction(() => {
    assertManifest(store);
    const previousEpoch = currentResetEpoch(store);
    const epoch = previousEpoch + 1;
    const reset_id = id("brainreset");
    const reset_at = now();
    const before = counts(store);
    const cancelled_jobs = store.run(
      "UPDATE jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,error_code='derived_brain_reset',completed_at=? WHERE reset_epoch=? AND status IN ('queued','running','retry')",
      reset_at,
      previousEpoch,
    ).changes;
    const cancelled_memory_jobs = store.run(
      "UPDATE memory_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,error_code='derived_brain_reset',completed_at=? WHERE reset_epoch=? AND status IN ('queued','running','retry')",
      reset_at,
      previousEpoch,
    ).changes;

    for (const table of DERIVED_PURGE_TABLES) {
      store.run(`DELETE FROM "${table}"`);
    }
    // FTS5 external-content shadow tables are maintained through their supported
    // rebuild command; ordinary DELETE from the virtual table is not a rebuild.
    store.db.exec("INSERT INTO memory_search(memory_search) VALUES('rebuild')");
    store.run("DELETE FROM memory_index_meta");
    store.run("INSERT INTO memory_index_meta VALUES(1)");
    store.run("UPDATE memory_schedule_clock SET sequence=0 WHERE singleton=1");
    store.run("DELETE FROM memory_thread_schedule");
    store.run(
      "UPDATE memory_conversation_focus SET workspace_id='',agent_id='',thread_id='',remaining=0 WHERE singleton=1",
    );
    // Capacity/payment holds are live provider protections, not brain content.
    // Only stale single-flight probe leases are reset.
    const cleared_provider_probes = store.run(
      "UPDATE memory_provider_holds SET probe_token=NULL,probe_until=NULL WHERE probe_token IS NOT NULL OR probe_until IS NOT NULL",
    ).changes;

    store.run(
      "INSERT INTO derived_brain_reset_receipts(epoch,reset_id,reset_at,before_json,after_json) VALUES(?,?,?,?,?)",
      epoch,
      reset_id,
      reset_at,
      JSON.stringify(before),
      "{}",
    );
    store.run(
      "UPDATE derived_brain_reset_state SET epoch=?,reset_id=?,reset_at=? WHERE singleton=1",
      epoch,
      reset_id,
      reset_at,
    );
    const after = counts(store);
    store.run(
      "UPDATE derived_brain_reset_receipts SET after_json=? WHERE epoch=?",
      JSON.stringify(after),
      epoch,
    );

    for (const table of [...DERIVED_PURGE_TABLES, "memory_search"]) {
      if (after[table] !== 0) {
        fail(500, "reset_verification_failed", `${table} was not emptied`);
      }
    }
    const eligible = store.one(
      "SELECT (SELECT COUNT(*) FROM jobs WHERE reset_epoch=? AND status IN ('queued','running','retry')) AS legacy,(SELECT COUNT(*) FROM memory_jobs WHERE reset_epoch=? AND status IN ('queued','running','retry')) AS memory",
      previousEpoch,
      previousEpoch,
    );
    if (eligible.legacy || eligible.memory) {
      fail(500, "reset_verification_failed", "Pre-reset nonterminal work remains");
    }
    const violations = store.all("PRAGMA foreign_key_check");
    if (violations.length) {
      fail(500, "reset_foreign_key_violation", "Reset would leave invalid references");
    }
    return {
      reset_id,
      reset_at,
      epoch,
      cancelled_jobs,
      cancelled_memory_jobs,
      cleared_provider_probes,
      before,
      after,
      receipt_sha256: hash(canonical({ reset_id, reset_at, epoch, before, after })),
    };
  });
  const quick_check = store.one("PRAGMA quick_check").quick_check;
  if (quick_check !== "ok") {
    fail(500, "reset_integrity_failed", "Database quick_check failed after reset");
  }
  return { ...result, quick_check };
}
