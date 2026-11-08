import { test, expect } from "bun:test";
import { App } from "../src/app.ts";
import { Store, now } from "../src/store.ts";
import { Memory, MemoryWorker, memoryTokens } from "../src/memory.ts";
import { type MemoryInference } from "../src/inference.ts";

const at = "2026-01-01T00:00:00.000Z";
const detail = Array.from({ length: 240 }, (_, i) => `detail-${i % 31}`).join(" ");
function fixture() {
  const store = new Store(":memory:");
  const owner = store.bootstrap("Synthetic responsiveness regression");
  const actor = store.authenticate(owner.token);
  const inputs: any[] = [];
  const inference: MemoryInference = {
    curate: async (input) => {
      inputs.push(structuredClone(input));
      return { decisions: [{ kind: "nothing" }] };
    },
    embed: async () => { await Bun.sleep(5); return { vectors: [], model: "disabled-test-double" }; },
  };
  const memory = new Memory(store, inference);
  const worker = new MemoryWorker(store, inference);
  memory.bind(actor, actor.id, "default");
  const app = new App(store);
  app.memory = memory;
  const event = (event_id: string, extra: any = {}) => memory.event(actor, {
    client_id: "synthetic", event_id, revision: 1, operation: "upsert",
    agent_id: "default", thread_id: event_id, role: "user", author_id: "alex",
    occurred_at: at, observed_at: now(), content: detail,
    causal_parent_ids: [], evidence_root_ids: [], metadata: {}, ...extra,
  });
  const seed = (count = 96) => {
    event("seed");
    const e = store.one("SELECT * FROM memory_events WHERE event_id='seed'");
    for (let i = 0; i < count; i++) worker.apply(e, {
      kind: "assertion", scope: "agent:default", subject: `Synthetic ${i}`,
      predicate: "detail", object: detail.slice(0, 1600), valid_from: at,
      valid_to: null, importance: 0.5, confidence: 0.5,
      evidence_event_ids: ["seed"],
    }, undefined, "disabled-test-double", ["agent:default"]);
    store.run("UPDATE memory_jobs SET status='succeeded' WHERE event_pk=?", e.id);
    store.run("UPDATE memory_events SET status='processed' WHERE id=?", e.id);
  };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: r => app.fetch(r) });
  const probe = async () => {
    const start = performance.now();
    const responses = await Promise.all([
      fetch(new URL("/healthz", server.url)),
      fetch(new URL("/v1/memory/jobs?agent_id=default", server.url), {
        headers: { Authorization: `Bearer ${owner.token}` },
      }),
    ]);
    const bodies = await Promise.all(responses.map(r => r.json()));
    return { elapsed: performance.now() - start, statuses: responses.map(r => r.status), bodies };
  };
  const recall = () => memory.recall(actor, {
    agent_id: "default", thread_id: "recall", query: "detail", token_budget: 2000,
  });
  const close = async () => { await server.stop(true); store.close(); };
  return { store, actor, inputs, memory, worker, event, seed, probe, recall, close };
}

test("health and authenticated jobs respond during four long curation preflights with a queued backlog", async () => {
  const f = fixture();
  try {
    f.seed();
    for (let i = 0; i < 580; i++) f.event(`queued-${i}`);
    const probe = f.probe().then(result => ({ ...result, completedPreflights: f.inputs.length }));
    let finished = false;
    const work = Promise.all(Array.from({ length: 4 }, () => f.worker.runOnce())).finally(() => { finished = true; });
    const response = await probe;
    const samples = [response.elapsed];
    while (!finished) {
      const sample = await f.probe();
      expect(sample.statuses).toEqual([200, 200]);
      samples.push(sample.elapsed);
      await Bun.sleep(50);
    }
    await work;
    expect(response.statuses).toEqual([200, 200]);
    expect(response.completedPreflights).toBeLessThan(4);
    expect(Math.max(...samples)).toBeLessThan(2000);
    expect(samples.length).toBeGreaterThan(0);
    expect(f.inputs).toHaveLength(4);
    for (const input of f.inputs) {
      expect(input.candidates.length).toBeGreaterThan(0);
      expect(input.candidates.length).toBeLessThan(96);
      expect(memoryTokens(JSON.stringify(input))).toBeLessThanOrEqual(4096);
      expect(input.event.content).toBe(detail);
    }
    expect(f.store.one("SELECT COUNT(*) n FROM memory_events").n).toBe(581);
    expect(f.store.one("SELECT COUNT(*) n FROM memory_jobs WHERE status='queued'").n).toBe(576);
    console.log(JSON.stringify({ regression: "curation-http", max_http_ms: Math.round(Math.max(...samples)), probes: samples.length, preflights_at_response: response.completedPreflights }));
  } finally { await f.close(); }
}, 120000);

test("health and authenticated jobs respond while recall packs 230 pending excerpts with exact tokens", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 230; i++) f.event(`pending-${i}`);
    let completed = false;
    const probe = f.probe().then(result => ({ ...result, completed }));
    const work = f.recall().then(result => { completed = true; return result; });
    const response = await probe;
    const samples = [response.elapsed];
    while (!completed) {
      const sample = await f.probe();
      expect(sample.statuses).toEqual([200, 200]);
      samples.push(sample.elapsed);
      await Bun.sleep(50);
    }
    const result = await work;
    expect(response.statuses).toEqual([200, 200]);
    expect(typeof response.completed).toBe("boolean");
    expect(Math.max(...samples)).toBeLessThan(2000);
    expect(samples.length).toBeGreaterThan(0);
    expect(result.tokens_used).toBe(memoryTokens(result.context));
    expect(result.tokens_used).toBeLessThanOrEqual(2000);
    expect(result.pending_events).toEqual([]);
    expect(result.freshness.pending_count).toBe(230);
    console.log(JSON.stringify({ regression: "recall-http", max_http_ms: Math.round(Math.max(...samples)), probes: samples.length, tokens: result.tokens_used }));
  } finally { await f.close(); }
}, 120000);

test("forget during packing cannot reach the curator with cached support", async () => {
  const f = fixture();
  try {
    f.seed(24);
    const receipt = f.event("to-process");
    const mutation = new Promise<void>(resolve => setTimeout(() => {
      f.event("seed", { revision: 2, operation: "delete" });
      resolve();
    }, 1));
    await f.worker.runOnce();
    await mutation;
    expect(f.inputs).toHaveLength(0);
    expect(f.store.one("SELECT error_code FROM memory_jobs WHERE id=?", receipt.job_id).error_code).toBe("curation_context_changed");
  } finally { await f.close(); }
});

test("forget of a packed pending event fails closed without a recall receipt", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 40; i++) f.event(`pending-${i}`);
    const newest = f.memory.events(f.actor, "default")[0];
    const mutation = new Promise<void>(resolve => setTimeout(() => {
      f.event(newest.event_id, { revision: 2, operation: "delete" });
      resolve();
    }, 1));
    const result = await f.recall();
    await mutation;
    expect(result.context).toBe("");
    expect(result.pending_events).toEqual([]);
  } finally { await f.close(); }
}, 10000);

test("credential revocation during packing blocks returned context", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 40; i++) f.event(`pending-${i}`);
    const mutation = new Promise<void>(resolve => setTimeout(() => {
      f.store.run("UPDATE credentials SET revoked_at=? WHERE id=?", now(), f.actor.credential_id);
      resolve();
    }, 1));
    await expect(f.recall()).rejects.toMatchObject({ code: "unauthorized" });
    await mutation;
    expect(f.store.one("SELECT COUNT(*) n FROM memory_recalls").n).toBe(0);
  } finally { await f.close(); }
}, 10000);

test("unrelated capture and unused grant removal do not invalidate packed context", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 40; i++) f.event(`pending-${i}`);
    const mutation = new Promise<void>(resolve => setTimeout(() => {
      f.event("unrelated", { role: "inter_agent", author_id: "agent:other" });
      f.store.run("DELETE FROM memory_grants WHERE principal_id=? AND scope='business:alex' AND action='read'", f.actor.id);
      resolve();
    }, 1));
    const result = await f.recall();
    await mutation;
    expect(result.pending_events).toEqual([]);
    expect(result.tokens_used).toBeLessThanOrEqual(2000);
  } finally { await f.close(); }
}, 10000);

test("mutable usage feedback does not invalidate selected memory evidence", async () => {
  const f = fixture();
  try {
    f.seed(24);
    const mutation = new Promise<void>(resolve => setTimeout(() => {
      f.store.run("UPDATE memories SET use_count=use_count+1,last_used_at=?", now());
      resolve();
    }, 1));
    const result = await f.recall();
    await mutation;
    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.tokens_used).toBeLessThanOrEqual(2000);
  } finally { await f.close(); }
});

test("forget during recall packing cannot return selected belief text", async () => {
  const f = fixture();
  try {
    f.seed(24);
    const mutation = new Promise<void>(resolve => setTimeout(() => {
      f.event("seed", { revision: 2, operation: "delete" });
      resolve();
    }, 1));
    const result = await f.recall();
    await mutation;
    expect(result.memories).toEqual([]);
    expect(result.context).toBe("");
  } finally { await f.close(); }
});
