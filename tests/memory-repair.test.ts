import { test, expect } from "bun:test";
import { Store, id, now, hash } from "../src/store.ts";
import { Memory, MemoryWorker } from "../src/memory.ts";
import { type MemoryInference } from "../src/inference.ts";
import { Database } from "bun:sqlite";
import { schema } from "../src/schema.ts";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const jan = "2026-01-01T00:00:00.000Z",
  feb = "2026-02-01T00:00:00.000Z",
  mar = "2026-03-01T00:00:00.000Z";
function fixture() {
  const s = new Store(":memory:"),
    owner = s.bootstrap("Synthetic repair regression"),
    a = s.authenticate(owner.token);
  let decide: (i: any) => Promise<any> = async () => ({
    decisions: [{ kind: "nothing" }],
  });
  const inference: MemoryInference = {
    curate: (i) => decide(i),
    embed: async (texts) => ({
      vectors: texts.map(() => [1, 0.5]),
      model: "fault-injection-double",
    }),
  };
  const m = new Memory(s, inference),
    w = new MemoryWorker(s, inference);
  m.bind(a, a.id, "default");
  const principal = id("prn");
  s.run(
    "INSERT INTO principals VALUES (?,?,?,?,?,?)",
    principal,
    a.workspace_id,
    "builder",
    "agent",
    0,
    now(),
  );
  m.bind(a, principal, "builder");
  const b = s.authenticate(s.issueKey(principal).token);
  const event = (eid: string, extra: any = {}, actor = a) =>
    m.event(actor, {
      client_id: "synthetic",
      event_id: eid,
      revision: 1,
      operation: "upsert",
      agent_id: actor === a ? "default" : "builder",
      thread_id: "repair-regression",
      role: "user",
      author_id: "alex",
      occurred_at: jan,
      observed_at: now(),
      content: "Synthetic independent input",
      causal_parent_ids: [],
      evidence_root_ids: [],
      metadata: {},
      ...extra,
    });
  const d = (eid: string, extra: any = {}) => ({
    kind: "assertion",
    scope: "business:alex",
    subject: "Lantern",
    predicate: "state",
    object: "A",
    valid_from: jan,
    valid_to: null,
    importance: 0.8,
    confidence: 0.9,
    evidence_event_ids: [eid],
    ...extra,
  });
  const recall = (actor = b) =>
    m.recall(actor, {
      agent_id: actor === a ? "default" : "builder",
      thread_id: "fresh",
      query: "Lantern state",
      recent_context: [],
      token_budget: 4000,
      valid_at: "2026-04-01T00:00:00Z",
    });
  return {
    s,
    a,
    b,
    m,
    w,
    event,
    d,
    recall,
    set: (fn: typeof decide) => {
      decide = fn;
    },
  };
}

test("forget root repairs echoes and pending retells but not independent later tool observations", async () => {
  const f = fixture();
  f.set(async (i) => ({ decisions: [f.d(i.event.event_id)] }));
  f.event("root");
  await f.w.runOnce();
  f.event("echo", {
    role: "assistant",
    author_id: "default",
    causal_parent_ids: ["root"],
  });
  await f.w.runOnce();
  const roots = f.m
    .support(f.s.one("SELECT * FROM memories"))
    .flatMap((s) => s.evidence_root_ids);
  expect(new Set(roots).size).toBe(1);
  f.event("pending-echo", {
    role: "inter_agent",
    author_id: "default",
    evidence_root_ids: ["root"],
  });
  f.set(async (i) => ({
    decisions: [
      f.d(i.event.event_id, {
        object: "verified independent success",
        valid_from: mar,
      }),
    ],
  }));
  f.event("verified", {
    role: "tool",
    author_id: "runtime-check",
    occurred_at: mar,
    causal_parent_ids: ["root"],
  });
  // Process pending retell then independent tool; both remain bounded ordinary jobs.
  await f.w.runOnce();
  await f.w.runOnce();
  f.event("root", { revision: 2, operation: "delete" });
  const r = await f.recall();
  expect(r.memories.every((m: any) => m.object !== "A")).toBe(true);
  expect(
    r.memories.some((m: any) => m.object === "verified independent success"),
  ).toBe(true);
  expect(
    f.s.one(
      "SELECT content FROM memory_events WHERE event_id=?",
      "pending-echo",
    ).content,
  ).toBeNull();
  const late = f.event("late-retell", {
    role: "assistant",
    author_id: "default",
    evidence_root_ids: ["root"],
  });
  expect(late.job_id).toBeNull();
  expect((await f.recall()).pending_events).toHaveLength(0);
  f.s.close();
});

test("forgotten support cannot return through in-flight consolidation with a surviving unrelated root", async () => {
  const f = fixture();
  f.set(async (i) => ({ decisions: [f.d(i.event.event_id)] }));
  f.event("sensitive", { content: "Support with marker ORCHID" });
  await f.w.runOnce();
  f.event("independent");
  await f.w.runOnce();
  const parent = f.s.one("SELECT * FROM memories");
  let release = () => {};
  const wait = new Promise<void>((r) => (release = r));
  f.set(async (i) => {
    await wait;
    return {
      decisions: [
        f.d(i.event.event_id, {
          predicate: "summary",
          object: "Cached ORCHID excerpt",
          derived_from: [parent.id],
        }),
      ],
    };
  });
  f.event("consolidation");
  const running = f.w.runOnce();
  await Bun.sleep(5);
  f.event("sensitive", { revision: 2, operation: "delete" });
  release();
  await running;
  expect(f.s.one("SELECT * FROM memories WHERE id=?", parent.id)).toBeTruthy();
  expect(f.s.all("SELECT * FROM memories WHERE derived=1")).toHaveLength(0);
  expect(
    f.s.one(
      "SELECT error_code FROM memory_jobs WHERE event_pk=(SELECT id FROM memory_events WHERE event_id=?)",
      "consolidation",
    ).error_code,
  ).toBe("curation_context_changed");
  f.s.close();
});

test("shared pending tail honors current read grants before content and freshness counts", async () => {
  const f = fixture();
  f.event("private-user-pending");
  f.s.run(
    "DELETE FROM memory_grants WHERE principal_id=? AND scope='user:alex' AND action='read'",
    f.b.id,
  );
  const r = await f.recall();
  expect(r.pending_events).toHaveLength(0);
  expect(r.freshness.pending_count).toBe(0);
  expect(r.context).not.toContain("private-user-pending");
  f.s.close();
});

test("private alias cannot reveal another agent canonical label and forgetting erases orphan entities", async () => {
  const f = fixture();
  f.set(async (i) => ({
    decisions: [
      f.d(i.event.event_id, {
        kind: "hypothesis",
        scope: "agent:default",
        subject: "Secret ORCHID project",
        entity_aliases: [
          { canonical: "Secret ORCHID project", aliases: ["X"] },
        ],
      }),
    ],
  }));
  f.event("private", { role: "assistant", author_id: "default" });
  await f.w.runOnce();
  f.set(async (i) => ({
    decisions: [
      f.d(i.event.event_id, {
        kind: "hypothesis",
        scope: "agent:builder",
        subject: "X",
      }),
    ],
  }));
  f.event("other-private", { role: "assistant", author_id: "builder" }, f.b);
  await f.w.runOnce();
  const mine = f.s.one("SELECT * FROM memories WHERE scope='agent:builder'");
  expect(mine.subject).toBe("X");
  expect(mine.subject).not.toContain("ORCHID");
  f.event("private", { revision: 2, operation: "delete" });
  expect(
    f.s.one(
      "SELECT * FROM memory_entities WHERE canonical=?",
      "Secret ORCHID project",
    ),
  ).toBeNull();
  f.s.close();
});

test("forgetting an intermediate state preserves independently observed later transition closure", async () => {
  const f = fixture();
  f.set(async (i) => ({ decisions: [f.d(i.event.event_id)] }));
  f.event("A");
  await f.w.runOnce();
  const a = f.s.one("SELECT * FROM memories");
  f.set(async (i) => ({
    decisions: [
      f.d(i.event.event_id, {
        kind: "update",
        object: "B",
        valid_from: feb,
        change: { type: "state_change", target_ids: [a.id] },
      }),
    ],
  }));
  f.event("B", { occurred_at: feb });
  await f.w.runOnce();
  const b = f.s.one("SELECT * FROM memories WHERE object=?", "B");
  f.set(async (i) => ({
    decisions: [
      f.d(i.event.event_id, {
        kind: "update",
        object: "C",
        valid_from: mar,
        change: { type: "state_change", target_ids: [b.id] },
      }),
    ],
  }));
  f.event("C", { occurred_at: mar });
  await f.w.runOnce();
  f.event("B", { revision: 2, operation: "delete" });
  expect((await f.recall()).memories.map((m: any) => m.object)).toEqual(["C"]);
  f.s.close();
});

test("populated original schema1 upgrade preserves auth, source provenance and facts; pristine backup remains rollbackable", () => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-migration-regression-")),
    path = join(dir, "legacy.sqlite"),
    backup = join(dir, "schema1-backup.sqlite");
  try {
    const db = new Database(path);
    db.exec(schema);
    const token = "synthetic-test-only-not-an-owner-credential";
    db.query("INSERT INTO workspaces VALUES (?,?,?)").run("ws", "legacy", jan);
    db.query("INSERT INTO principals VALUES (?,?,?,?,?,?)").run(
      "principal",
      "ws",
      "legacy admin",
      "human",
      1,
      jan,
    );
    db.query("INSERT INTO credentials VALUES (?,?,?,?,NULL)").run(
      "key",
      "principal",
      hash(token),
      jan,
    );
    db.query("INSERT INTO projects VALUES (?,?,?,?)").run(
      "project",
      "ws",
      "legacy",
      jan,
    );
    db.query("INSERT INTO spaces VALUES (?,?,?,?,?,?,?)").run(
      "space",
      "ws",
      "project",
      "legacy",
      "shared",
      "principal",
      jan,
    );
    db.query("INSERT INTO grants VALUES (?,?,?)").run(
      "space",
      "principal",
      "read",
    );
    db.query("INSERT INTO sources VALUES (?,?,?,?,?,?,NULL)").run(
      "source",
      "ws",
      "space",
      "legacy-source",
      "revision",
      jan,
    );
    db.query("INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL)").run(
      "revision",
      "source",
      1,
      "text",
      "assertions",
      jan,
      JSON.stringify("legacy evidence"),
      JSON.stringify([]),
      jan,
    );
    db.query("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "fact",
      "space",
      "fp",
      "Synthetic",
      "preserves",
      "provenance",
      jan,
      null,
      null,
      null,
    );
    db.query("INSERT INTO supports VALUES (?,?,?,NULL)").run(
      "fact",
      "revision",
      jan,
    );
    db.exec("PRAGMA user_version=1");
    db.close();
    copyFileSync(path, backup);
    const store = new Store(path);
    expect(store.one("PRAGMA user_version").user_version).toBe(2);
    expect(store.authenticate(token).id).toBe("principal");
    expect(
      store.one("SELECT payload_json FROM revisions WHERE id=?", "revision")
        .payload_json,
    ).toBe(JSON.stringify("legacy evidence"));
    expect(
      store.one("SELECT * FROM supports WHERE fact_id=?", "fact").revision_id,
    ).toBe("revision");
    expect(
      store.one("SELECT object FROM facts WHERE id=?", "fact").object,
    ).toBe("provenance");
    expect(store.one("PRAGMA integrity_check").integrity_check).toBe("ok");
    store.close();
    const old = new Database(backup);
    expect(old.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    expect(old.query("SELECT object FROM facts").get()).toEqual({
      object: "provenance",
    });
    old.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("independent concurrent subjects commit without a workspace cap; related concurrent beliefs retry", async () => {
  for (const related of [false, true]) {
    const f = fixture();
    const releases: Record<string, () => void> = {};
    f.set(async (input) => {
      await new Promise<void>((resolve) => {
        releases[input.event.event_id] = resolve;
      });
      return {
        decisions: [
          f.d(input.event.event_id, {
            subject:
              input.event.event_id === "concurrent-A" || related
                ? "Lantern"
                : "Other project",
          }),
        ],
      };
    });
    f.event("concurrent-A");
    f.event("concurrent-B");
    const first = f.w.runOnce(),
      second = f.w.runOnce();
    await Bun.sleep(5);
    expect(Object.keys(releases).length).toBe(2);
    releases["concurrent-A"]();
    await Bun.sleep(10);
    releases["concurrent-B"]();
    await Promise.all([first, second]);
    const statuses = f.s
      .all("SELECT status FROM memory_jobs")
      .map((x) => x.status);
    expect(statuses.filter((x) => x === "succeeded").length).toBe(
      related ? 1 : 2,
    );
    if (related) expect(statuses).toContain("retry");
    f.s.close();
  }
});

test("successive consolidation versions retain parent revisions and forget repairs every descendant", async () => {
  const f = fixture();
  f.set(async (input) => ({ decisions: [f.d(input.event.event_id)] }));
  f.event("base");
  await f.w.runOnce();
  let parent = f.s.one("SELECT * FROM memories");
  for (const version of [2, 3]) {
    f.set(async (input) => ({
      decisions: [
        f.d(input.event.event_id, {
          predicate: "summary-" + version,
          object: "Derived version " + version,
          derived_from: [parent.id],
        }),
      ],
    }));
    f.event("derive-" + version);
    await f.w.runOnce();
    const next = f.s.one("SELECT * FROM memories WHERE version=?", version);
    expect(next).toBeTruthy();
    expect(
      f.s.one(
        "SELECT parent_version FROM memory_lineage WHERE child_id=?",
        next.id,
      ).parent_version,
    ).toBe(version - 1);
    parent = next;
  }
  f.event("base", { revision: 2, operation: "delete" });
  expect(f.s.all("SELECT * FROM memories")).toHaveLength(0);
  expect(
    f.s.all("SELECT * FROM memory_versions WHERE snapshot_json IS NOT NULL"),
  ).toHaveLength(0);
  f.s.close();
});

test("oversize current inference input fails visibly and stays durable rather than partial-success", async () => {
  const f = fixture();
  const previous = process.env.THE_ATLAS_CURATION_INPUT_TOKENS;
  process.env.THE_ATLAS_CURATION_INPUT_TOKENS = "10";
  let called = false;
  try {
    f.set(async () => {
      called = true;
      return { decisions: [{ kind: "nothing" }] };
    });
    f.event("oversize");
    await f.w.runOnce();
    expect(called).toBe(false);
    expect(f.s.one("SELECT error_code FROM memory_jobs").error_code).toBe(
      "curation_budget_too_small",
    );
    expect(f.s.one("SELECT status,content FROM memory_events").status).toBe(
      "pending",
    );
    expect(f.s.one("SELECT content FROM memory_events").content).toBeTruthy();
  } finally {
    if (previous === undefined)
      delete process.env.THE_ATLAS_CURATION_INPUT_TOKENS;
    else process.env.THE_ATLAS_CURATION_INPUT_TOKENS = previous;
    f.s.close();
  }
});
