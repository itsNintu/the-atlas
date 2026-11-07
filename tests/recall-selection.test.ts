import { test, expect } from "bun:test";
import { Store, now } from "../src/store.ts";
import { Memory, MemoryWorker, memoryTokens } from "../src/memory.ts";

// Synthetic deterministic extraction/embedding double: packing, not model quality.
const at = "2026-01-01T00:00:00.000Z";
const detail = Array.from({ length: 400 }, (_, i) => `unrelated-${i % 31}`).join(" ");
function fixture() {
  const store = new Store(":memory:");
  const owner = store.bootstrap("Synthetic mixed recall selection");
  const actor = store.authenticate(owner.token);
  const inference = {
    async embed() { return { vectors: [[1, 0]], model: "selection-double" }; },
    async curate() { throw Error("No model calls in selection regression"); },
  };
  const memory = new Memory(store, inference);
  const worker = new MemoryWorker(store, inference);
  memory.bind(actor, actor.id, "builder");
  const event = (event_id: string, content: string, role = "user") => memory.event(actor, {
    client_id: "synthetic", event_id, revision: 1, operation: "upsert",
    agent_id: "builder", thread_id: "selection-fixture", role,
    author_id: role === "user" ? "alex" : "synthetic-tool",
    occurred_at: at, observed_at: now(), content, causal_parent_ids: [], evidence_root_ids: [], metadata: {},
  });
  const seed = (event_id: string, scope: string, subject: string, object: string, role: string, vector = [1, 0]) => {
    event(event_id, object, role);
    const e = store.one("SELECT * FROM memory_events WHERE event_id=?", event_id);
    worker.apply(e, {
      kind: "assertion", scope, subject, predicate: "fixture observation", object,
      valid_from: at, valid_to: null, importance: 0.8, confidence: 0.8,
      evidence_event_ids: [event_id],
    }, vector, "selection-double", [scope]);
    store.run("UPDATE memory_events SET status='processed' WHERE id=?", e.id);
    store.run("UPDATE memory_jobs SET status='succeeded' WHERE event_pk=?", e.id);
    return store.one("SELECT id FROM memories WHERE subject=?", subject).id;
  };
  const recall = (budget: number) => memory.recall(actor, {
    agent_id: "builder", thread_id: "fresh-selection", query: "P01 communication rule attribution status and Lantern Cobalt dated receipt",
    recent_context: [], token_budget: budget,
  });
  return { store, memory, event, seed, recall };
}

test("busy pending intake cannot enter or starve relevant own/shared processed recall", async () => {
  const f = fixture();
  try {
    const shared = f.seed("shared-source", "user:alex", "P01 communication rule attribution status",
      "Synthetic native_probe originally said short progress and detailed architecture. Attribution to actual Alex withdrawn; history retained, no opposite preference.", "user");
    const own = f.seed("own-source", "agent:builder", "Lantern Cobalt dated receipt",
      "Synthetic tool cobalt-check-001 at 2026-01-01T00:00:00.000Z reported fixture ready; synthetic=true actual_deployment=false. Not continuing health.", "tool");
    for (let i = 0; i < 40; i++) f.seed(`distractor-${i}`, "agent:builder", `Unrelated ${i}`, `Synthetic unrelated durable record ${i}`, "tool", [0, 1]);
    for (let i = 0; i < 942; i++) f.event(`backlog-${i}`, detail, "tool");
    f.event("newest-correction", "CORRECTION P01 communication: synthetic fixture attribution only, not an actual Alex preference or evidence of opposite preference.");
    f.store.run("UPDATE memory_events SET accepted_at=? WHERE event_id='newest-correction'", now());
    for (const budget of [2000, 99744]) {
      const r = await f.recall(budget);
      expect(r.memories.map((m: any) => m.id)).toContain(shared);
      expect(r.memories.map((m: any) => m.id)).toContain(own);
      expect(r.pending_events).toEqual([]);
      expect(r.context).not.toContain("PENDING");
      for (const [id, scope, source] of [[shared, "user:alex", "shared-source"], [own, "agent:builder", "own-source"]]) {
        const m = r.memories.find((m: any) => m.id === id);
        expect(m.scope).toBe(scope);
        expect(m.evidence_roots).toHaveLength(1);
        expect(m.supports).toHaveLength(1);
        expect(m.supports[0].event_id).toBe(source);
      }
      expect(r.context).toContain("synthetic=true actual_deployment=false");
      expect(r.context).toContain("untrusted attributed data");
      expect(r.tokens_used).toBe(memoryTokens(r.context));
      expect(r.tokens_used).toBeLessThanOrEqual(budget);
      expect(r.freshness.pending_count).toBe(943);
      expect(r.freshness.pending_included + r.freshness.pending_omitted).toBe(943);
      expect(r.freshness.pending_omitted).toBeGreaterThan(0);
      expect(new Set(r.pending_events.map((e: any) => e.event_id)).size).toBe(r.pending_events.length);
      const pendingTimes = r.pending_events.map((e: any) => e.accepted_at);
      expect(pendingTimes).toEqual([...pendingTimes].sort().reverse());
      console.log(JSON.stringify({ regression: "mixed-selection", budget, tokens: r.tokens_used, memories: r.memories.length, pending: r.pending_events.length, omitted: r.freshness.pending_omitted }));
    }
    expect(f.store.one("SELECT COUNT(*) n FROM memory_events").n).toBe(985);
    expect(f.store.one("SELECT COUNT(*) n FROM memory_jobs WHERE status='queued'").n).toBe(943);
  } finally { f.store.close(); }
}, 30000);

test("large pending intake does not displace an indivisible processed record", async () => {
  const f = fixture();
  try {
    const id = f.seed("large-source", "agent:builder", "P01 communication rule", detail.slice(0, 1600), "tool");
    f.event("large-newest-correction", "CORRECTION synthetic fixture only: " + detail);
    const r = await f.recall(1000);
    expect(r.memories.map((m: any) => m.id)).toContain(id);
    expect(r.pending_events).toEqual([]);
    expect(r.context).not.toContain("CORRECTION");
    expect(r.tokens_used).toBe(memoryTokens(r.context));
    expect(r.tokens_used).toBeLessThanOrEqual(1000);
  } finally { f.store.close(); }
});

test("semantic-only evidence cannot be starved by a large pending backlog", async () => {
  const f = fixture();
  try {
    const id = f.seed("semantic-source", "agent:builder", "unmatched-entity", "Synthetic semantic-only context-qualified evidence.", "tool");
    for (let i = 0; i < 383; i++) f.event(`pending-${i}`, detail, "tool");
    const r = await f.recall(2000);
    const m = r.memories.find((m: any) => m.id === id);
    expect(m).toBeDefined();
    expect(m.lexical).toBe(0);
    expect(m.semantic).toBe(1);
    expect(r.pending_events).toEqual([]);
    expect(r.tokens_used).toBe(memoryTokens(r.context));
    expect(r.tokens_used).toBeLessThanOrEqual(2000);
  } finally { f.store.close(); }
}, 30000);
