import { test, expect, afterEach } from "bun:test";
import { fixture, at, statement } from "./helpers.ts";
import { Store, assertions, canonical } from "../src/store.ts";
import { ApiError, timestamp } from "../src/errors.ts";
import { Worker } from "../src/worker.ts";
import { App } from "../src/app.ts";
import { OpenAICompatible, cosine } from "../src/provider.ts";
const stores: Store[] = [];
async function setup() {
  const f = await fixture();
  stores.push(f.store);
  return f;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

test("ingests explicit assertions as durable source-linked facts, not NL extraction", async () => {
  const f = await setup();
  const r = await f.ingest();
  expect(r.status).toBe(200);
  expect((await f.context()).body.facts).toHaveLength(0);
  expect(await f.worker.runOnce()).toBe(true);
  const c = (await f.context()).body;
  expect(c.facts).toHaveLength(1);
  expect(c.facts[0].supports[0].source_id).toBe(r.body.source_id);
  expect(c.context).toContain("Lisbon");
  expect(c.used_chars).toBe(Array.from(c.context).length);
  expect((await f.call("GET", "/v1/jobs/" + r.body.job_id)).body.status).toBe(
    "succeeded",
  );
});
test("source formats text, JSON and timestamped messages work without invented extraction", async () => {
  const f = await setup();
  for (const [format, payload] of [
    ["text", "Text has no implicit fact"],
    ["json", { note: "structured" }],
    ["messages", [{ role: "user", content: "Hello", timestamp: at }]],
  ] as const) {
    expect(
      (await f.ingest("Lisbon", { format, payload, assertions: [] })).status,
    ).toBe(200);
    await f.worker.runOnce();
  }
  expect((await f.context()).body.facts).toHaveLength(0);
});
test("idempotency canonicalizes object key ordering and conflicts on changed request", async () => {
  const f = await setup();
  const b = {
    space_id: f.space.id,
    external_id: "stable",
    format: "text",
    source_timestamp: at,
    payload: "Mira",
    assertions: [statement()],
  };
  const a = await f.call("POST", "/v1/sources", b, f.owner.token, "same-key");
  const replay = await f.call(
    "POST",
    "/v1/sources",
    Object.fromEntries(Object.entries(b).reverse()),
    f.owner.token,
    "same-key",
  );
  expect(replay.body.source_id).toBe(a.body.source_id);
  expect(replay.body.idempotent_replay).toBe(true);
  expect(
    (
      await f.call(
        "POST",
        "/v1/sources",
        { ...b, payload: "different" },
        f.owner.token,
        "same-key",
      )
    ).status,
  ).toBe(409);
  expect(f.store.one("SELECT COUNT(*) n FROM jobs").n).toBe(1);
});
test("workspace boundary denies source/job/provenance reads, writes and inference", async () => {
  const f = await setup();
  const r = (await f.ingest()).body;
  await f.worker.runOnce();
  for (const route of [
    "/v1/sources/" + r.source_id,
    "/v1/jobs/" + r.job_id,
    "/v1/facts/" + (await f.context()).body.facts[0].id,
  ])
    expect((await f.call("GET", route, undefined, f.other.token)).status).toBe(
      404,
    );
  expect((await f.context({}, f.other.token)).status).toBe(404);
  expect(
    (await f.call("DELETE", "/v1/sources/" + r.source_id, {}, f.other.token))
      .status,
  ).toBe(404);
  expect(
    (
      await f.call(
        "POST",
        "/v1/sources",
        {
          space_id: f.space.id,
          external_id: "attack",
          format: "text",
          source_timestamp: at,
          payload: "attack",
        },
        f.other.token,
      )
    ).status,
  ).toBe(404);
  expect(
    (await f.call("GET", "/v1/sources", undefined, f.other.token)).body.data,
  ).toHaveLength(0);
  expect(
    (
      await f.call(
        "POST",
        "/v1/context",
        {
          workspace_id: f.owner.workspace_id,
          space_ids: [f.space.id],
          query: "secret",
        },
        f.other.token,
      )
    ).status,
  ).toBe(400);
});
test("personal spaces are owner-only, shared grants allow only explicit actions and revocation applies to replay", async () => {
  const f = await setup();
  const agent = (
    await f.call("POST", "/v1/principals", { name: "Agent", kind: "agent" })
  ).body;
  const token = f.store.issueKey(agent.id).token;
  const personal = (
    await f.call("POST", "/v1/spaces", {
      name: "Private",
      kind: "personal",
      owner_id: agent.id,
      project_id: f.project.id,
    })
  ).body;
  expect((await f.context({ space_ids: [personal.id] })).status).toBe(404); // even admin
  expect(
    (
      await f.call("POST", "/v1/grants", {
        space_id: personal.id,
        principal_id: f.owner.principal_id,
        actions: ["read"],
      })
    ).status,
  ).toBe(403);
  expect((await f.context({}, token)).status).toBe(404);
  await f.call("POST", "/v1/grants", {
    space_id: f.space.id,
    principal_id: agent.id,
    actions: ["read"],
  });
  expect((await f.context({}, token)).status).toBe(200);
  const body = {
    space_id: f.space.id,
    external_id: "agent-write",
    format: "text",
    payload: "x",
    source_timestamp: at,
    assertions: [],
  };
  expect(
    (await f.call("POST", "/v1/sources", body, token, "write-key")).status,
  ).toBe(404);
  await f.call("POST", "/v1/grants", {
    space_id: f.space.id,
    principal_id: agent.id,
    actions: ["read", "write"],
  });
  const r = await f.call("POST", "/v1/sources", body, token, "write-key");
  expect(r.status).toBe(200);
  expect(
    (await f.call("DELETE", "/v1/sources/" + r.body.source_id, {}, token))
      .status,
  ).toBe(404);
  await f.call("POST", "/v1/grants", {
    space_id: f.space.id,
    principal_id: agent.id,
    actions: [],
  });
  expect(
    (await f.call("POST", "/v1/sources", body, token, "write-key")).status,
  ).toBe(404);
});
test("correction closes recorded-time interval, preserves historical evidence and enforces revision CAS", async () => {
  const f = await setup();
  const original = (await f.ingest()).body;
  await f.worker.runOnce();
  const before = new Date().toISOString();
  await Bun.sleep(5);
  const b = {
    expected_revision_number: 1,
    format: "text",
    source_timestamp: at,
    payload: "Mira now lives in Porto.",
    assertions: [statement("Porto")],
  };
  const changed = await f.call(
    "POST",
    `/v1/sources/${original.source_id}/revisions`,
    b,
  );
  expect(changed.status).toBe(200);
  expect((await f.context()).body.facts).toHaveLength(0); // pending correction: no stale current evidence
  expect(
    (await f.call("POST", `/v1/sources/${original.source_id}/revisions`, b))
      .status,
  ).toBe(409);
  await f.worker.runOnce();
  expect((await f.context()).body.context).toContain("Porto");
  expect((await f.context()).body.context).not.toContain("Lisbon");
  expect((await f.context({ recorded_at: before })).body.context).toContain(
    "Lisbon",
  );
  const exact = (await f.context({ recorded_at: changed.body.recorded_at }))
    .body;
  expect(exact.context).toContain("Porto");
  expect(exact.context).not.toContain("Lisbon");
  const history = (await f.call("GET", "/v1/sources/" + original.source_id))
    .body.revisions;
  expect(history).toHaveLength(2);
  expect(history[0].superseded_at).toBe(changed.body.recorded_at);
});
test("valid-time intervals are half-open and relative dates are not fabricated", async () => {
  const f = await setup();
  await f.ingest("Lisbon", {
    assertions: [
      statement("Lisbon", { valid_from: at, valid_to: "2026-02-01T00:00:00Z" }),
      statement("Porto", { valid_from: "2026-02-01T00:00:00Z" }),
    ],
  });
  await f.worker.runOnce();
  expect(
    (await f.context({ valid_at: "2026-01-31T23:59:59Z" })).body.context,
  ).toContain("Lisbon");
  const c = (await f.context({ valid_at: "2026-02-01T00:00:00Z" })).body;
  expect(c.context).toContain("Porto");
  expect(c.context).not.toContain("Lisbon");
});
test("forget erases revisions and orphan facts, preserves independent same-space support only", async () => {
  const f = await setup();
  const a = (await f.ingest()).body,
    b = (await f.ingest()).body;
  const otherSpace = (
    await f.call("POST", "/v1/spaces", {
      name: "Other",
      project_id: f.project.id,
    })
  ).body;
  await f.ingest("Lisbon", { space_id: otherSpace.id });
  while (await f.worker.runOnce()) {}
  let c = (await f.context()).body;
  expect(c.facts).toHaveLength(1);
  expect(c.facts[0].supports).toHaveLength(2);
  await f.call("DELETE", "/v1/sources/" + a.source_id, {});
  c = (await f.context()).body;
  expect(c.facts[0].supports).toHaveLength(1);
  expect(c.facts[0].supports[0].source_id).toBe(b.source_id);
  const gone = (await f.call("GET", "/v1/sources/" + a.source_id)).body;
  expect(gone.revisions[0].payload).toBeNull();
  expect(gone.revisions[0].assertions).toBeNull();
  await f.call("DELETE", "/v1/sources/" + b.source_id, {});
  expect((await f.context()).body.facts).toHaveLength(0);
  expect(
    (await f.context({ recorded_at: a.recorded_at })).body.facts,
  ).toHaveLength(0); // forget also removes history
  expect(
    f.store.one("SELECT COUNT(*) n FROM facts WHERE space_id=?", f.space.id).n,
  ).toBe(0);
  expect(
    f.store.one("SELECT COUNT(*) n FROM facts WHERE space_id=?", otherSpace.id)
      .n,
  ).toBe(1);
});
test("forgetting and correcting queued work cannot resurrect forgotten or superseded facts", async () => {
  const f = await setup();
  const a = (await f.ingest()).body;
  await f.call("DELETE", "/v1/sources/" + a.source_id, {});
  expect(await f.worker.runOnce()).toBe(false);
  expect(
    (
      await f.call("POST", `/v1/sources/${a.source_id}/revisions`, {
        expected_revision_number: 1,
      })
    ).status,
  ).toBe(410);
  const b = (await f.ingest()).body;
  await f.call("POST", `/v1/sources/${b.source_id}/revisions`, {
    expected_revision_number: 1,
    format: "text",
    payload: "Porto",
    source_timestamp: at,
    assertions: [statement("Porto")],
  });
  while (await f.worker.runOnce()) {}
  expect((await f.context()).body.context).not.toContain("Lisbon");
});
test("job lease fencing rejects stale results and retries provider network failures", async () => {
  const f = await setup();
  const r = (
    await f.ingest("x", { mode: "natural_language", assertions: undefined })
  ).body;
  let release!: () => void;
  const blocked = new Promise<void>((r) => (release = r));
  const provider = {
    name: "test_double_NOT_real_model",
    embedding_model: "test",
    extract: async () => {
      await blocked;
      return assertions([statement()], at);
    },
    embed: async () => [[1, 0]],
  };
  const w = new Worker(f.store, provider, 1000);
  const running = w.runOnce();
  await Bun.sleep(2);
  await f.call("DELETE", "/v1/sources/" + r.source_id, {});
  release();
  await running;
  expect((await f.context()).body.facts).toHaveLength(0);
  expect((await f.call("GET", "/v1/jobs/" + r.job_id)).body.status).toBe(
    "cancelled",
  );
  const retry = (
    await f.ingest("x", { mode: "natural_language", assertions: undefined })
  ).body;
  const flaky = {
    ...provider,
    extract: async () => {
      throw new ApiError(
        503,
        "provider_network_error",
        "Synthetic fault",
        true,
      );
    },
  };
  await new Worker(f.store, flaky).runOnce();
  let job = (await f.call("GET", "/v1/jobs/" + retry.job_id)).body;
  expect(job.status).toBe("retry");
  expect(job.error_code).toBe("provider_network_error");
  f.store.run("UPDATE jobs SET available_at=0 WHERE id=?", retry.job_id);
  await new Worker(f.store, provider).runOnce();
  job = (await f.call("GET", "/v1/jobs/" + retry.job_id)).body;
  expect(job.status).toBe("succeeded");
  expect(job.attempts).toBe(2);
});
test("expired leases recover, and exhausted final crash becomes failed", async () => {
  const f = await setup();
  const r = (await f.ingest()).body;
  const claimed = f.worker.claim();
  expect(claimed.id).toBe(r.job_id);
  f.store.run("UPDATE jobs SET lease_until=0 WHERE id=?", r.job_id);
  await new Worker(f.store).runOnce();
  expect((await f.call("GET", "/v1/jobs/" + r.job_id)).body.attempts).toBe(2);
  const x = (await f.ingest()).body;
  f.worker.claim();
  f.store.run(
    "UPDATE jobs SET lease_until=0,attempts=max_attempts WHERE id=?",
    x.job_id,
  );
  expect(await f.worker.runOnce()).toBe(false);
  expect((await f.call("GET", "/v1/jobs/" + x.job_id)).body.error_code).toBe(
    "lease_exhausted",
  );
});
test("budgets include Unicode code points and provenance handles, not response metadata", async () => {
  const f = await setup();
  await f.ingest("🌍 Porto");
  await f.worker.runOnce();
  const full = (await f.context()).body,
    n = Array.from(full.context).length;
  expect((await f.context({ budget_chars: 0 })).body.context).toBe("");
  expect((await f.context({ budget_chars: n - 1 })).body.context).toBe("");
  expect((await f.context({ budget_chars: n })).body.used_chars).toBe(n);
});
test("pagination is stable for unchanged data and binds cursor to caller/query", async () => {
  const f = await setup();
  for (let i = 0; i < 4; i++) await f.ingest();
  const first = (await f.call("GET", "/v1/sources?limit=2")).body;
  expect(first.data).toHaveLength(2);
  expect(first.next_cursor).toBeTruthy();
  const second = (
    await f.call("GET", "/v1/sources?limit=2&cursor=" + first.next_cursor)
  ).body;
  expect(second.data).toHaveLength(2);
  expect(second.next_cursor).toBeNull();
  expect(new Set([...first.data, ...second.data].map((x) => x.id)).size).toBe(
    4,
  );
  expect(
    (await f.call("GET", "/v1/jobs?cursor=" + first.next_cursor)).status,
  ).toBe(400);
  expect(
    (
      await f.call(
        "GET",
        "/v1/sources?cursor=" + first.next_cursor,
        undefined,
        f.other.token,
      )
    ).status,
  ).toBe(400);
});
test("missing and revoked credentials fail without leaking source contents", async () => {
  const f = await setup();
  expect((await f.call("GET", "/v1/me", undefined, "")).status).toBe(401);
  const key = f.store.issueKey(f.owner.principal_id);
  expect(
    (await f.call("POST", `/v1/credentials/${key.credential_id}/revoke`, {}))
      .status,
  ).toBe(200);
  expect((await f.call("GET", "/v1/me", undefined, key.token)).status).toBe(
    401,
  );
  const audit = (await f.call("GET", "/v1/audit")).body;
  expect(JSON.stringify(audit)).not.toContain(key.token);
});
test("no-provider mode is actionable and does not manufacture natural-language output", async () => {
  const old = process.env.THE_ATLAS_PROVIDER_API_KEY,
    legacy = process.env.THREADATLAS_PROVIDER_API_KEY,
    old2 = process.env.OPENAI_API_KEY;
  delete process.env.THE_ATLAS_PROVIDER_API_KEY;
  delete process.env.THREADATLAS_PROVIDER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const f = await setup();
    const r = (
      await f.ingest("x", { mode: "natural_language", assertions: undefined })
    ).body;
    await f.worker.runOnce();
    const job = (await f.call("GET", "/v1/jobs/" + r.job_id)).body;
    expect(job.status).toBe("failed");
    expect(job.error_code).toBe("provider_unavailable");
    expect((await f.context()).body.facts).toHaveLength(0);
    expect((await f.call("GET", "/v1/status")).body.provider.action).toContain(
      "THE_ATLAS_PROVIDER_API_KEY",
    );
    expect(
      (await f.call("POST", `/v1/jobs/${r.job_id}/retry`, {})).body.status,
    ).toBe("queued");
  } finally {
    if (old !== undefined) process.env.THE_ATLAS_PROVIDER_API_KEY = old;
    if (legacy !== undefined) process.env.THREADATLAS_PROVIDER_API_KEY = legacy;
    if (old2 !== undefined) process.env.OPENAI_API_KEY = old2;
  }
});
test("input contracts reject invalid intervals, message timestamps and malformed JSON", async () => {
  expect(() =>
    assertions([statement("x", { valid_from: at, valid_to: at })], at),
  ).toThrow();
  expect(() => timestamp("2026-01-01", "x")).toThrow();
  expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
  const f = await setup();
  expect(
    (
      await f.ingest("x", {
        format: "messages",
        payload: [{ role: "user", content: "x" }],
      })
    ).status,
  ).toBe(400);
  const r = await f.app.fetch(
    new Request("http://localhost/v1/sources", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${f.owner.token}`,
        "Content-Type": "application/json",
      },
      body: "{",
    }),
  );
  expect(r.status).toBe(400);
  expect(((await r.json()) as any).error.code).toBe("invalid_json");
  expect(cosine([1, 0], [1, 0])).toBe(1);
  expect(cosine([0, 0], [1, 0])).toBe(0);
});
