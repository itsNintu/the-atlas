import { test, expect } from "bun:test";
import { Store, id, now } from "../src/store.ts";
import { App } from "../src/app.ts";
import { Memory, MemoryWorker, memoryTokens } from "../src/memory.ts";
import {
  type MemoryInference,
  type Decision,
  Inference,
  redact,
  validateDecisions,
} from "../src/inference.ts";
import { ApiError } from "../src/errors.ts";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { schema } from "../src/schema.ts";

// Fault-injection doubles verify deterministic machinery, NOT natural-language quality.
class Double implements MemoryInference {
  decide: (input: any) => Promise<any> = async () => ({
    decisions: [{ kind: "nothing" }],
  });
  async curate(input: any) {
    return this.decide(input);
  }
  async embed(texts: string[]) {
    return {
      vectors: texts.map(() => [1, 0.5]),
      model: "test-double-not-real-inference",
    };
  }
}
const t0 = "2026-01-01T00:00:00.000Z",
  t1 = "2026-02-01T00:00:00.000Z",
  t2 = "2026-03-01T00:00:00.000Z";
const base = (event_id: string, extra: any = {}) => ({
  client_id: "synthetic",
  event_id,
  revision: 1,
  operation: "upsert",
  agent_id: "default",
  thread_id: "thread-a",
  role: "user",
  author_id: "alex",
  occurred_at: t0,
  observed_at: now(),
  content: "Synthetic input, not caller assertions.",
  causal_parent_ids: [],
  evidence_root_ids: [],
  metadata: {},
  ...extra,
});
const decision = (event_id: string, extra: any = {}): Decision => ({
  kind: "assertion",
  scope: "user:alex",
  subject: "Alex",
  predicate: "architecture_detail",
  object: "detailed architecture explanations",
  valid_from: t0,
  valid_to: null,
  importance: 0.9,
  confidence: 0.95,
  evidence_event_ids: [event_id],
  ...extra,
});
function setup(path = ":memory:") {
  const store = new Store(path),
    admin = store.bootstrap("Synthetic memory tests"),
    a = store.authenticate(admin.token),
    d = new Double(),
    memory = new Memory(store, d),
    worker = new MemoryWorker(store, d, 1000),
    app = new App(store);
  app.memory = memory;
  memory.bind(a, a.id, "default");
  const mkAgent = (agent: string) => {
    const p = id("prn");
    store.run(
      "INSERT INTO principals VALUES (?,?,?,?,?,?)",
      p,
      a.workspace_id,
      agent,
      "agent",
      0,
      now(),
    );
    memory.bind(a, p, agent);
    const k = store.issueKey(p);
    return { ...k, actor: store.authenticate(k.token) };
  };
  const builder = mkAgent("builder");
  const call = async (
    path: string,
    body: any,
    token = admin.token,
    key = id("key"),
    method = "POST",
  ) => {
    const r = await app.fetch(
      new Request("http://localhost" + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: method === "GET" ? undefined : JSON.stringify(body),
      }),
    );
    return { status: r.status, ...((await r.json()) as any) };
  };
  const event = (eid: string, extra: any = {}) =>
    memory.event(a, base(eid, extra));
  const recall = (extra: any = {}, actor = builder.actor) =>
    memory.recall(actor, {
      agent_id: actor === a ? "default" : "builder",
      thread_id: "thread-a",
      query: "architecture preference",
      recent_context: [],
      token_budget: 12000,
      valid_at: t2,
      ...extra,
    });
  return {
    store,
    admin,
    a,
    d,
    memory,
    worker,
    app,
    builder,
    call,
    event,
    recall,
  };
}

test("HTTP capture is durable; shared freshness, bindings and revision fences are deterministic", async () => {
  const f = setup();
  const original = base("e1");
  const r = await f.call("/v1/events", original);
  expect(r.status).toBe(200);
  expect(r.data.durable).toBe(true);
  expect(r.data.job_id).toBeTruthy();
  expect(
    f.store.one("SELECT status FROM memory_jobs WHERE id=?", r.data.job_id)
      .status,
  ).toBe("queued");
  const p = await f.recall();
  expect(p.pending_events).toEqual([]);
  expect(p.context).toBe("");
  expect(p.freshness.pending_count).toBe(1);
  expect(
    (await f.call("/v1/events", original, f.admin.token)).data.status,
  ).toBe("duplicate");
  expect(
    (
      await f.call(
        "/v1/events",
        base("e1", { content: "changed same revision" }),
      )
    ).status,
  ).toBe(409);
  expect(
    (await f.call("/v1/events", base("forgery", { agent_id: "builder" })))
      .status,
  ).toBe(403);
  expect(
    (
      await f.call(
        "/v1/events",
        base("e1", { revision: 3, operation: "delete" }),
      )
    ).data.status,
  ).toBe("accepted");
  expect(
    (await f.call("/v1/events", base("e1", { revision: 2 }))).data.status,
  ).toBe("stale");
  expect((await f.recall()).pending_events).toHaveLength(0);
  const deletion = base("delete-grant", { operation: "delete" });
  const deleteKey = id("delete-key");
  expect(
    (await f.call("/v1/events", deletion, f.admin.token, deleteKey)).status,
  ).toBe(200);
  f.store.run(
    "DELETE FROM memory_grants WHERE principal_id=? AND action='delete'",
    f.a.id,
  );
  expect(
    (await f.call("/v1/events", deletion, f.admin.token, deleteKey)).status,
  ).toBe(403);
  expect(
    f.store
      .all("SELECT content FROM memory_events WHERE event_id=?", "e1")
      .every((e) => e.content === null),
  ).toBe(true);
  f.store.close();
});

test("state reversal, current/history, never-true correction and delayed older state do not last-arrival-win", async () => {
  const f = setup();
  f.d.decide = async (i) => ({ decisions: [decision(i.event.event_id)] });
  f.event("old");
  await f.worker.runOnce();
  const old = f.store.one("SELECT * FROM memories");
  f.d.decide = async (i) => ({
    decisions: [
      decision(i.event.event_id, {
        kind: "update",
        object: "concise architecture unless depth requested",
        valid_from: t1,
        change: { type: "state_change", target_ids: [old.id] },
      }),
    ],
  });
  f.event("reversal", { occurred_at: t1 });
  await f.worker.runOnce();
  const current = await f.recall();
  expect(current.memories.map((m: any) => m.object)).toEqual([
    "concise architecture unless depth requested",
  ]);
  const history = await f.recall({ valid_at: "2026-01-15T00:00:00Z" });
  expect(history.memories.map((m: any) => m.object)).toEqual([
    "detailed architecture explanations",
  ]);
  expect(history.memories[0].valid_to).toBe(t1);
  f.d.decide = async (i) => ({
    decisions: [
      decision(i.event.event_id, {
        kind: "update",
        object: "historical middle state",
        valid_from: "2026-01-20T00:00:00Z",
        change: { type: "state_change", target_ids: [old.id] },
      }),
    ],
  });
  f.event("delayed", { occurred_at: "2026-01-20T00:00:00Z" });
  await f.worker.runOnce();
  expect((await f.recall()).memories.map((m: any) => m.object)).toEqual([
    "concise architecture unless depth requested",
  ]);
  const target = f.store.one(
    "SELECT * FROM memories WHERE object=?",
    "concise architecture unless depth requested",
  );
  const cutoff = now();
  await Bun.sleep(2);
  f.d.decide = async (i) => ({
    decisions: [
      decision(i.event.event_id, {
        kind: "update",
        object: "previous concise claim was never true",
        valid_from: t1,
        change: { type: "correction", target_ids: [target.id] },
      }),
    ],
  });
  f.event("correction", { occurred_at: t2 });
  await f.worker.runOnce();
  expect((await f.recall()).memories.some((m: any) => m.id === target.id)).toBe(
    false,
  );
  expect(
    (await f.recall({ recorded_at: cutoff })).memories.some(
      (m: any) => m.id === target.id,
    ),
  ).toBe(true);
  f.store.close();
});

test("compatible additions, conflicts, entity aliases and private hypotheses stay scoped", async () => {
  const f = setup();
  f.d.decide = async (i) => ({
    decisions: [
      decision(i.event.event_id),
      decision(i.event.event_id, {
        predicate: "normal_updates",
        object: "short ordinary updates",
      }),
    ],
  });
  f.event("prefs");
  await f.worker.runOnce();
  expect((await f.recall()).memories).toHaveLength(2);
  const target = f.store.one(
    "SELECT id FROM memories WHERE predicate=?",
    "architecture_detail",
  );
  f.d.decide = async (i) => ({
    decisions: [
      decision(i.event.event_id, {
        kind: "update",
        subject: "Alexander",
        object: "ambiguous conflicting preference",
        entity_aliases: [{ canonical: "Alex", aliases: ["Alexander"] }],
        change: { type: "conflict", target_ids: [target.id] },
      }),
    ],
  });
  f.event("conflict");
  await f.worker.runOnce();
  const r = await f.recall();
  expect(r.memories.filter((m: any) => m.conflict)).toHaveLength(2);
  expect(
    new Set(
      f.store.all("SELECT subject_id FROM memories").map((m) => m.subject_id),
    ).size,
  ).toBe(1);
  f.d.decide = async (i) => ({
    decisions: [
      decision(i.event.event_id, {
        kind: "hypothesis",
        scope: "agent:default",
        object: "Agent speculation only",
      }),
    ],
  });
  f.event("private", { role: "assistant", author_id: "default" });
  await f.worker.runOnce();
  expect(
    (await f.recall()).memories.some(
      (m: any) => m.object === "Agent speculation only",
    ),
  ).toBe(false);
  expect(
    (await f.recall({}, f.a)).memories.some(
      (m: any) => m.object === "Agent speculation only",
    ),
  ).toBe(true);
  f.store.close();
});

test("edit/delete repair removes derived vectors/versions/pending, retains independent support and undo changes", async () => {
  const f = setup();
  f.d.decide = async (i) => ({ decisions: [decision(i.event.event_id)] });
  f.event("source1");
  await f.worker.runOnce();
  f.event("source2");
  await f.worker.runOnce();
  const parent = f.store.one("SELECT * FROM memories");
  expect(f.memory.support(parent)).toHaveLength(2);
  f.d.decide = async (i) => ({
    decisions: [
      decision(i.event.event_id, {
        predicate: "summary",
        object: "Derived architectural summary",
        derived_from: [parent.id],
      }),
    ],
  });
  f.event("derive");
  await f.worker.runOnce();
  const derived = f.store.one("SELECT * FROM memories WHERE derived=1");
  expect(derived).toBeTruthy();
  expect(
    f.store.one("SELECT * FROM memory_lineage WHERE child_id=?", derived.id)
      .parent_version,
  ).toBe(1);
  f.event("source1", { revision: 2, operation: "delete" });
  expect(
    f.store.one("SELECT * FROM memories WHERE id=?", parent.id),
  ).toBeTruthy();
  expect(
    f.store.one("SELECT * FROM memories WHERE id=?", derived.id),
  ).toBeNull();
  expect(
    f.store.one(
      "SELECT snapshot_json FROM memory_versions WHERE memory_id=?",
      derived.id,
    ).snapshot_json,
  ).toBeNull();
  f.event("source2", { revision: 2, operation: "delete" });
  expect(f.store.all("SELECT * FROM memories")).toHaveLength(0);
  expect((await f.recall()).context).not.toContain("detailed architecture");
  f.store.close();
});

test("retrieval is not utility or evidence; explicit outcome-linked feedback reinforces only selected IDs", async () => {
  const f = setup();
  f.d.decide = async (i) => ({ decisions: [decision(i.event.event_id)] });
  f.event("pref");
  await f.worker.runOnce();
  const r = await f.recall();
  const mid = r.memories[0].id;
  expect(
    f.store.one("SELECT use_count FROM memories WHERE id=?", mid).use_count,
  ).toBe(0);
  expect(() =>
    f.memory.feedback(f.builder.actor, {
      agent_id: "builder",
      recall_id: r.recall_id,
      used_memory_ids: [mid],
      outcome_event_id: "absent",
    }),
  ).toThrow();
  f.memory.event(
    f.builder.actor,
    base("answer", {
      agent_id: "builder",
      role: "assistant",
      author_id: "builder",
    }),
  );
  expect(
    f.memory.feedback(f.builder.actor, {
      agent_id: "builder",
      recall_id: r.recall_id,
      used_memory_ids: [mid],
      outcome_event_id: "answer",
    }).evidence_added,
  ).toBe(false);
  expect(
    f.store.one("SELECT use_count FROM memories WHERE id=?", mid).use_count,
  ).toBe(1);
  expect(f.memory.support({ id: mid })).toHaveLength(1);
  f.memory.event(
    f.builder.actor,
    base("answer", {
      agent_id: "builder",
      role: "assistant",
      author_id: "builder",
      revision: 2,
      operation: "delete",
    }),
  );
  expect(
    f.store.one("SELECT use_count,last_used_at FROM memories WHERE id=?", mid),
  ).toEqual({ use_count: 0, last_used_at: null });
  f.store.close();
});

test("budget includes framing and pending; fading does not erase dormant truth; retention never erases failed/pending work", async () => {
  const f = setup();
  f.d.decide = async (i) => ({ decisions: [decision(i.event.event_id)] });
  f.event("pref");
  await f.worker.runOnce();
  f.store.run(
    "UPDATE memories SET recorded_from=?",
    "2000-01-01T00:00:00.000Z",
  );
  expect((await f.recall()).memories).toHaveLength(1);
  f.event("pending", { content: "🌎".repeat(1000) });
  for (const token_budget of [0, 1, 100, 500, 2000]) {
    const r = await f.recall({ token_budget });
    expect(r.tokens_used).toBeLessThanOrEqual(token_budget);
    expect(memoryTokens(r.context)).toBe(r.tokens_used);
  }
  f.store.run("UPDATE memory_events SET accepted_at=?", "2000-01-01T00:00:00Z");
  f.memory.retain();
  expect(
    f.store.one("SELECT content FROM memory_events WHERE event_id=?", "pending")
      .content,
  ).toBeTruthy();
  expect(
    f.store.one("SELECT content FROM memory_events WHERE event_id=?", "pref")
      .content,
  ).toBeNull();
  f.store.close();
});

test("in-flight forget, credential revocation, scope violations and transient retries are fenced", async () => {
  const f = setup();
  let release: () => void = () => {};
  const wait = new Promise<void>((r) => (release = r));
  f.d.decide = async (i) => {
    await wait;
    return { decisions: [decision(i.event.event_id)] };
  };
  f.event("race");
  const running = f.worker.runOnce();
  await Bun.sleep(5);
  f.event("race", { revision: 2, operation: "delete" });
  release();
  await running;
  expect(f.store.all("SELECT * FROM memories")).toHaveLength(0);
  f.d.decide = async (i) => ({
    decisions: [decision(i.event.event_id, { scope: "agent:builder" })],
  });
  f.event("bad-scope");
  await f.worker.runOnce();
  expect(
    f.store.one(
      "SELECT error_code FROM memory_jobs WHERE event_pk=(SELECT id FROM memory_events WHERE event_id=?)",
      "bad-scope",
    ).error_code,
  ).toBe("curator_scope_violation");
  f.store.run(
    "UPDATE memory_jobs SET available_at=? WHERE status='retry'",
    Date.now() + 999999,
  );
  f.d.decide = async () => {
    throw new ApiError(503, "synthetic_transient", "fault injection", true);
  };
  f.event("retry");
  await f.worker.runOnce();
  expect(
    f.store.one(
      "SELECT status FROM memory_jobs WHERE event_pk=(SELECT id FROM memory_events WHERE event_id=?)",
      "retry",
    ).status,
  ).toBe("retry");
  f.store.run(
    "UPDATE memory_jobs SET available_at=? WHERE status='retry'",
    Date.now() + 999999,
  );
  f.d.decide = async (i) => {
    f.store.run(
      "UPDATE credentials SET revoked_at=? WHERE id=?",
      now(),
      f.admin.credential_id,
    );
    return { decisions: [decision(i.event.event_id)] };
  };
  f.event("revoke");
  await f.worker.runOnce();
  expect(f.store.all("SELECT * FROM memories")).toHaveLength(0);
  f.store.close();
});

test("recall rechecks authorization and forget after semantic await", async () => {
  const f = setup();
  f.d.decide = async (i) => ({ decisions: [decision(i.event.event_id)] });
  f.event("before");
  await f.worker.runOnce();
  f.d.embed = async () => {
    f.event("before", { revision: 2, operation: "delete" });
    return { vectors: [[1, 0.5]], model: "test-double-not-real-inference" };
  };
  expect((await f.recall()).memories).toHaveLength(0);
  f.d.embed = async () => {
    f.store.run(
      "UPDATE credentials SET revoked_at=? WHERE id=?",
      now(),
      f.builder.credential_id,
    );
    return { vectors: [[1, 0.5]], model: "test-double-not-real-inference" };
  };
  await expect(f.recall()).rejects.toThrow();
  f.store.close();
});

test("schema1 upgrade preserves saved credentials/facts; on-disk pending and lease recover", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-memory-test-"));
  const path = join(dir, "db.sqlite");
  try {
    const db = new Database(path);
    db.exec(schema);
    db.exec("PRAGMA user_version=1");
    db.close();
    let f = setup(path);
    const token = f.admin.token;
    const keyHash = f.store.one(
      "SELECT token_hash FROM credentials WHERE id=?",
      f.admin.credential_id,
    ).token_hash;
    f.event("disk");
    const job = f.worker.claim();
    expect(job).toBeTruthy();
    f.store.run("UPDATE memory_jobs SET lease_until=0 WHERE id=?", job.id);
    f.store.close();
    const store = new Store(path);
    expect(store.one("PRAGMA user_version").user_version).toBe(2);
    expect(store.authenticate(token).id).toBe(f.a.id);
    expect(
      store.one(
        "SELECT token_hash FROM credentials WHERE id=?",
        f.admin.credential_id,
      ).token_hash,
    ).toBe(keyHash);
    const d = new Double();
    d.decide = async (i) => ({ decisions: [decision(i.event.event_id)] });
    const worker = new MemoryWorker(store, d);
    await worker.runOnce();
    expect(
      store.one("SELECT status FROM memory_jobs WHERE id=?", job.id).status,
    ).toBe("succeeded");
    expect(store.all("SELECT * FROM memories")).toHaveLength(1);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("provider schema failures are safe retryable failures and recognized JSON/assignment secrets redact", () => {
  for (const raw of [
    null,
    { decisions: [{ kind: "assertion" }] },
    { decisions: [{ kind: "update", entity_aliases: [null] }] },
  ]) {
    try {
      validateDecisions(raw);
      throw Error("should fail");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(503);
      expect((e as ApiError).retryable).toBe(true);
    }
  }
  expect(redact("password=secret-value")).not.toContain("secret-value");
  const red = redact(
    JSON.stringify({
      password: "secret-value",
      api_key: "another-secret",
      nested: { access_token: "access-secret" },
    }),
  );
  expect(red).not.toContain("secret-value");
  expect(() => JSON.parse(red)).not.toThrow();
});

test("command adapter enforces identity/JSON/output timeout without shell", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-inference-test-"));
  const file = join(dir, "double.js");
  const previous = process.env.THE_ATLAS_INFERENCE_COMMAND,
    timeout = process.env.THE_ATLAS_INFERENCE_TIMEOUT_MS;
  try {
    writeFileSync(
      file,
      `const r=await new Response(Bun.stdin.stream()).json();console.log(JSON.stringify({protocol:r.protocol,request_id:r.request_id,output:{decisions:[{kind:'nothing'}]}}));`,
    );
    process.env.THE_ATLAS_INFERENCE_COMMAND = JSON.stringify([
      process.execPath,
      file,
    ]);
    process.env.THE_ATLAS_INFERENCE_TIMEOUT_MS = "1000";
    expect((await new Inference().curate({})).decisions).toEqual([
      { kind: "nothing" },
    ]);
    writeFileSync(
      file,
      `process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,
    );
    process.env.THE_ATLAS_INFERENCE_TIMEOUT_MS = "100";
    const started = Date.now();
    await expect(new Inference().curate({})).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
    writeFileSync(file, `console.log('null');`);
    process.env.THE_ATLAS_INFERENCE_TIMEOUT_MS = "1000";
    await expect(new Inference().curate({})).rejects.toThrow();
  } finally {
    if (previous === undefined) delete process.env.THE_ATLAS_INFERENCE_COMMAND;
    else process.env.THE_ATLAS_INFERENCE_COMMAND = previous;
    if (timeout === undefined)
      delete process.env.THE_ATLAS_INFERENCE_TIMEOUT_MS;
    else process.env.THE_ATLAS_INFERENCE_TIMEOUT_MS = timeout;
    rmSync(dir, { recursive: true, force: true });
  }
});
