import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixture, at } from "./helpers.ts";
import { App } from "../src/app.ts";
import { Memory, MemoryWorker } from "../src/memory.ts";
import { memoryGraph } from "../src/memory-graph.ts";
import { Store, id, now } from "../src/store.ts";
import { Worker } from "../src/worker.ts";
import { DERIVED_PURGE_TABLES, resetDerivedBrain } from "../src/derived-reset.ts";

const inference = (inputs: any[] = [], audits: any[] = []) => ({
  async curate(input: any) { inputs.push(structuredClone(input)); return { decisions: [{ kind: "nothing" as const }] }; },
  async audit(input: any) { audits.push(structuredClone(input)); return { choice: "durable_candidate", confidence: .9, probabilities: { durable_candidate: .9 }, model: "jev-double", elapsed_ms: 1 }; },
  async embed(texts: string[]) { return { vectors: texts.map(() => [1, 0]), model: "reset-double" }; },
});

function nativeEvent(memory: Memory, actor: any, event_id: string, content: string) {
  const receipt = memory.event(actor, {
    client_id: "reset-fixture", event_id, revision: 1, operation: "upsert", agent_id: "builder",
    thread_id: "shared-old-thread", role: "user", author_id: "alex", occurred_at: at,
    observed_at: now(), content, metadata: {},
  });
  return { receipt, source: memory.store.one("SELECT * FROM memory_events WHERE event_id=?", event_id) };
}

function apply(worker: MemoryWorker, source: any, subject: string, object: string) {
  return worker.apply(source, {
    kind: "assertion" as const, scope: "business:alex", subject, predicate: "records", object,
    valid_from: at, valid_to: null, importance: .8, confidence: .9,
    evidence_event_ids: [source.event_id],
  }, [1, 0], "reset-double", ["business:alex"]);
}

test("clean slate physically purges all derived projections, preserves custody, fences old work and admits only new generation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-derived-reset-"));
  const path = join(dir, "fixture.sqlite");
  const f = await fixture(path);
  try {
    const actor = f.store.authenticate(f.owner.token);
    const inputs: any[] = [], audits: any[] = [];
    const inf = inference(inputs, audits);
    const memory = new Memory(f.store, inf), native = new MemoryWorker(f.store, inf);
    memory.bind(actor, actor.id, "builder");

    const completedLegacy = (await f.ingest("CompletedOldFact")).body;
    expect(await f.worker.runOnce()).toBe(true);
    const queuedLegacy = (await f.ingest("QueuedOldFact")).body;
    const failedLegacy = (await f.ingest("FailedOldFact")).body;
    f.store.run("UPDATE jobs SET status='failed',error_code='old_failure' WHERE id=?", failedLegacy.job_id);

    const old1 = nativeEvent(memory, actor, "old-one", "PRE_RESET_PRIVATE_CONTEXT Atlas old project Alex");
    const old2 = nativeEvent(memory, actor, "old-two", "Second old graph entity Target");
    const first = apply(native, old1.source, "Atlas old project", "Alex");
    const second = apply(native, old2.source, "Second old graph entity", "Target");
    for (const old of [old1, old2]) {
      f.store.run("UPDATE memory_jobs SET status='succeeded',completed_at=? WHERE id=?", now(), old.receipt.job_id);
      f.store.run("UPDATE memory_events SET status='processed',processed_at=? WHERE id=?", now(), old.source.id);
    }
    const queued = nativeEvent(memory, actor, "old-queued", "OLD_BACKLOG_MUST_NOT_REPLAY");
    const failed = nativeEvent(memory, actor, "old-failed", "OLD_FAILED_MUST_NOT_RETRY");
    f.store.run("UPDATE memory_jobs SET status='failed',error_code='old_failure' WHERE id=?", failed.receipt.job_id);

    f.store.run("INSERT INTO memory_aliases VALUES (?,?,?)", actor.workspace_id, "old alias", f.store.one("SELECT subject_id FROM memories WHERE id=?", first).subject_id);
    f.store.run("INSERT INTO memory_lineage VALUES (?,?,?)", second, first, 1);
    f.store.run("INSERT INTO memory_entity_targets VALUES (?,?)", first, f.store.one("SELECT subject_id FROM memories WHERE id=?", second).subject_id);
    f.store.run("INSERT INTO memory_entity_equivalences VALUES (?,?,?,?,?,?)", actor.workspace_id, "business:alex", f.store.one("SELECT subject_id FROM memories WHERE id=?", first).subject_id, f.store.one("SELECT subject_id FROM memories WHERE id=?", second).subject_id, old2.source.id, now());
    f.store.run("INSERT INTO memory_event_admissions VALUES (?,?,?,?,?,?,?,?)", old1.receipt.job_id, old1.source.id, "durable_candidate", "old-jev", .9, "old-proof", 1, now());
    f.store.run("INSERT INTO memory_jev_routes VALUES (?,?,?,?,?,?,?,?,?,?,?)", id("jevroute"), old1.receipt.job_id, old1.source.id, "graph_area", "area_0", "area_0", "old-jev", .9, "old-proof", 1, now());
    f.store.run("INSERT INTO memory_reconciliations VALUES (?,?,?,?,?)", old1.receipt.job_id, old1.source.id, first, "{}", now());
    f.store.run("INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)", id("change"), old1.source.id, first, null, "conflict", at, now());
    const change = f.store.one("SELECT id FROM memory_changes WHERE target_id=?", first);
    f.store.run("INSERT INTO memory_change_invalidations VALUES (?,?,?,?,?,?)", change.id, old1.receipt.job_id, actor.id, "old_repair", "old-proof", now());
    f.store.run("INSERT INTO memory_recalls VALUES (?,?,?,?,?,?)", "recall_old", actor.id, "builder", "shared-old-thread", JSON.stringify([first]), now());
    f.store.run("INSERT INTO memory_feedback VALUES (?,?,?,?)", "recall_old", old1.source.id, JSON.stringify([first]), now());
    f.store.run("INSERT INTO memory_curation_metrics VALUES (?,?,?,?,?,?,?,?,?,?,?)", old1.receipt.job_id, old1.source.id, 0, 10, 10, 10, 1, 1, 1, 1, now());
    f.store.run("INSERT INTO memory_chunk_progress VALUES (?,?)", queued.source.id, 10);
    f.store.run("UPDATE memory_schedule_clock SET sequence=77 WHERE singleton=1");
    f.store.run("INSERT INTO memory_thread_schedule VALUES (?,?,?,?)", actor.workspace_id, "builder", "shared-old-thread", 77);
    f.store.run("UPDATE memory_conversation_focus SET workspace_id=?,agent_id='builder',thread_id='shared-old-thread',remaining=20 WHERE singleton=1", actor.workspace_id);
    for (const provider of ["luna", "jev"])
      f.store.run("INSERT INTO memory_provider_holds VALUES (?,?,?,?,?,?,?,?,?)", provider, "old_hold", 429, "provider_capacity", 1, now(), now(), "stale-probe", 9999999999999);

    const review = memory.reviewAdmission(actor, "builder", old1.receipt.job_id, first, 1, "session_local_owner_correction");
    expect(review.demoted).toBe(true);
    const reprocess = memory.reprocess(actor, "builder", old1.receipt.job_id, 1, "old_reprocess");
    expect(reprocess.status).toBe("queued");
    const nonterminalMemoryBefore = f.store.one("SELECT COUNT(*) AS n FROM memory_jobs WHERE status IN ('queued','running','retry')").n;

    expect(f.store.one("SELECT COUNT(*) n FROM memories").n).toBe(2);
    expect(f.store.one("SELECT COUNT(*) n FROM memory_search").n).toBe(2);
    expect(f.store.one("SELECT COUNT(*) n FROM facts").n).toBe(1);
    for (const table of DERIVED_PURGE_TABLES)
      expect(f.store.one(`SELECT COUNT(*) AS n FROM "${table}"`).n, table).toBeGreaterThan(0);

    const preservedTables = [
      "workspaces", "principals", "credentials", "projects", "spaces", "grants", "sources", "revisions",
      "idempotency", "audit", "memory_bindings", "memory_grants", "memory_events", "memory_roots", "memory_heads",
      "memory_reprocess_requests", "memory_reconsider_requests", "memory_curation_metrics",
    ];
    const snapshots = Object.fromEntries(preservedTables.map(table => [table, f.store.all(`SELECT * FROM "${table}" ORDER BY rowid`)]));
    const terminalLegacy = f.store.all("SELECT * FROM jobs WHERE status IN ('succeeded','failed') ORDER BY rowid");
    const terminalNative = f.store.all("SELECT * FROM memory_jobs WHERE status IN ('succeeded','failed','skipped') ORDER BY rowid");
    const holds = f.store.all("SELECT provider,reason,upstream_status,upstream_category,hold_until,created_at,updated_at FROM memory_provider_holds ORDER BY provider");

    expect(() => resetDerivedBrain(f.store, "wrong")).toThrow("RESET_DERIVED_BRAIN");
    expect(f.store.one("SELECT COUNT(*) n FROM memories").n).toBe(2);
    const reset = resetDerivedBrain(f.store, "RESET_DERIVED_BRAIN");
    expect(reset.epoch).toBe(1);
    expect(reset.cancelled_jobs).toBe(1);
    expect(reset.cancelled_memory_jobs).toBe(nonterminalMemoryBefore);
    expect(reset.quick_check).toBe("ok");
    for (const table of DERIVED_PURGE_TABLES) {
      expect(reset.after[table], table).toBe(0);
      expect(f.store.one(`SELECT COUNT(*) AS n FROM "${table}"`).n, table).toBe(0);
    }
    expect(f.store.one("SELECT COUNT(*) n FROM memory_search").n).toBe(0);
    for (const table of preservedTables)
      expect(f.store.all(`SELECT * FROM "${table}" ORDER BY rowid`), table).toEqual(snapshots[table]);
    expect(f.store.all("SELECT * FROM jobs WHERE status IN ('succeeded','failed') ORDER BY rowid")).toEqual(terminalLegacy);
    expect(f.store.all("SELECT * FROM memory_jobs WHERE status IN ('succeeded','failed','skipped') ORDER BY rowid")).toEqual(terminalNative);
    expect(f.store.one("SELECT status,error_code FROM jobs WHERE id=?", queuedLegacy.job_id)).toEqual({ status: "cancelled", error_code: "derived_brain_reset" });
    expect(f.store.one("SELECT status,error_code FROM memory_jobs WHERE id=?", queued.receipt.job_id)).toEqual({ status: "cancelled", error_code: "derived_brain_reset" });
    expect(f.store.all("SELECT provider,reason,upstream_status,upstream_category,hold_until,created_at,updated_at FROM memory_provider_holds ORDER BY provider")).toEqual(holds);
    expect(f.store.one("SELECT COUNT(*) n FROM memory_provider_holds WHERE probe_token IS NOT NULL OR probe_until IS NOT NULL").n).toBe(0);
    expect(f.store.one("SELECT sequence FROM memory_schedule_clock WHERE singleton=1").sequence).toBe(0);
    expect(f.store.one("SELECT COUNT(*) n FROM memory_thread_schedule").n).toBe(0);
    expect(f.store.one("SELECT remaining FROM memory_conversation_focus WHERE singleton=1").remaining).toBe(0);

    expect(() => memory.retry(actor, "builder", failed.receipt.job_id)).toThrow("Pre-reset evidence");
    expect(() => memory.reprocess(actor, "builder", reprocess.job_id, 1, "old_reprocess")).toThrow("Pre-reset evidence");
    expect(() => memory.reviewAdmission(actor, "builder", reprocess.job_id, first, 1, "session_local_owner_correction")).toThrow("Pre-reset evidence");
    const oldRetry = await f.call("POST", `/v1/jobs/${failedLegacy.job_id}/retry`, {});
    expect(oldRetry.status).toBe(409);
    expect(oldRetry.body.error.code).toBe("job_reset_fenced");

    const recall = await memory.recall(actor, { agent_id: "builder", thread_id: "new-read", query: "Atlas old project", token_budget: 500 });
    expect(recall.memories).toEqual([]);
    expect(recall.context).toBe("");
    expect(recall.freshness.pending_count).toBe(0);
    expect(recall.freshness.capture_only_count).toBe(0);
    const graph = memoryGraph(memory, actor, { agent_id: "builder", query: "", include_history: true, limit: 100 });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.changes).toEqual([]);
    expect(graph.processing.jobs).toEqual([]);
    expect((await f.context()).body.facts).toEqual([]);

    const freshLegacy = (await f.ingest("FreshNewFact")).body;
    expect(await f.worker.runOnce()).toBe(true); // only the new-generation source
    expect(f.store.one("SELECT status FROM jobs WHERE id=?", freshLegacy.job_id).status).toBe("succeeded");
    expect((await f.context()).body.facts.map((x: any) => x.object)).toEqual(["FreshNewFact"]);
    expect(await f.worker.runOnce()).toBe(false);
    expect(f.store.one("SELECT reset_epoch FROM jobs WHERE id=?", freshLegacy.job_id).reset_epoch).toBe(1);
    expect(f.store.one("SELECT reset_epoch FROM jobs WHERE id=?", completedLegacy.job_id).reset_epoch).toBe(0);
    f.store.close();

    const reopened = new Store(path);
    try {
      const forbidden = async () => { throw new Error("old provider/backlog was called"); };
      const oldWorker = new Worker(reopened, { extract: forbidden, embed: forbidden, embedding_model: "forbidden" } as any);
      expect(await oldWorker.runOnce()).toBe(false);
      const newInputs: any[] = [], newAudits: any[] = [];
      const newInf = { ...inference(newInputs, newAudits), resolveEntities: forbidden, reconcile: forbidden, routeGraphArea: forbidden, auditRelationship: forbidden } as any;
      const newMemory = new Memory(reopened, newInf), newNative = new MemoryWorker(reopened, newInf);
      const fresh = nativeEvent(newMemory, actor, "fresh-native", "Only genuinely new conversation content");
      expect(fresh.source.reset_epoch).toBe(1);
      expect(await newNative.runOnce()).toBe(true);
      expect(newAudits).toHaveLength(1);
      expect(newAudits[0].previous).toEqual([]);
      expect(newInputs).toHaveLength(1);
      expect(newInputs[0].recent_events).toEqual([]);
      expect(JSON.stringify(newAudits[0])).not.toContain("PRE_RESET_PRIVATE_CONTEXT");
      expect(JSON.stringify(newInputs[0])).not.toContain("OLD_BACKLOG_MUST_NOT_REPLAY");
      expect(reopened.one("SELECT status FROM memory_jobs WHERE id=?", fresh.receipt.job_id).status).toBe("succeeded");
      expect(reopened.one("SELECT COUNT(*) n FROM memories").n).toBe(0); // deterministic noise double; no synthetic production-style seed
      expect(reopened.all("SELECT * FROM memory_events WHERE reset_epoch=0 ORDER BY rowid")).toEqual(snapshots.memory_events);
      expect(reopened.one("PRAGMA foreign_key_check") ?? undefined).toBeUndefined();
      expect(reopened.one("PRAGMA quick_check").quick_check).toBe("ok");
    } finally { reopened.close(); }
  } finally {
    try { f.store.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("CLI reset requires an explicit existing database and exact confirmation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-reset-cli-"));
  const path = join(dir, "existing.sqlite"), missing = join(dir, "missing.sqlite");
  const run = async (db: string, confirm: string) => {
    const child = Bun.spawn({
      cmd: [process.execPath, "src/cli.ts", "reset-derived-brain", "--db", db, "--confirm", confirm],
      cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit_code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, exit_code };
  };
  try {
    const absent = await run(missing, "RESET_DERIVED_BRAIN");
    expect(absent.exit_code).toBe(1);
    expect(existsSync(missing)).toBe(false);
    const store = new Store(path);
    store.bootstrap("Synthetic CLI reset");
    store.close();
    const rejected = await run(path, "wrong");
    expect(rejected.exit_code).toBe(1);
    let reopened = new Store(path);
    expect(reopened.one("SELECT epoch FROM derived_brain_reset_state WHERE singleton=1").epoch).toBe(0);
    reopened.close();
    const accepted = await run(path, "RESET_DERIVED_BRAIN");
    expect(accepted.exit_code, accepted.stdout + accepted.stderr).toBe(0);
    const receipt = JSON.parse(accepted.stdout);
    expect(receipt.epoch).toBe(1);
    expect(receipt.quick_check).toBe("ok");
    expect(receipt.raw_history_preserved).toBe(true);
    reopened = new Store(path);
    expect(reopened.one("SELECT COUNT(*) n FROM memories").n).toBe(0);
    expect(reopened.one("SELECT COUNT(*) n FROM workspaces").n).toBe(1);
    reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reset is atomic and refuses an unclassified future artifact", async () => {
  const store = new Store(":memory:");
  try {
    const boot = store.bootstrap("Synthetic reset rollback"), actor = store.authenticate(boot.token);
    const memory = new Memory(store, inference()), worker = new MemoryWorker(store, inference());
    memory.bind(actor, actor.id, "builder");
    const old = nativeEvent(memory, actor, "rollback-old", "old content");
    apply(worker, old.source, "Rollback", "old graph");
    const beforeJobs = store.all("SELECT * FROM memory_jobs ORDER BY rowid");
    store.db.exec("CREATE TRIGGER abort_reset BEFORE DELETE ON memory_supports BEGIN SELECT RAISE(ABORT,'injected reset failure'); END");
    expect(() => resetDerivedBrain(store, "RESET_DERIVED_BRAIN")).toThrow("injected reset failure");
    expect(store.all("SELECT * FROM memory_jobs ORDER BY rowid")).toEqual(beforeJobs);
    expect(store.one("SELECT COUNT(*) n FROM memories").n).toBe(1);
    expect(store.one("SELECT epoch FROM derived_brain_reset_state WHERE singleton=1").epoch).toBe(0);
    store.db.exec("DROP TRIGGER abort_reset; CREATE TABLE future_unclassified_brain(value TEXT)");
    expect(() => resetDerivedBrain(store, "RESET_DERIVED_BRAIN")).toThrow("unclassified database tables");
    expect(store.one("SELECT COUNT(*) n FROM memories").n).toBe(1);
  } finally { store.close(); }
});
