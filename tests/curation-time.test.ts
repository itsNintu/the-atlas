import { test, expect } from "bun:test";
import { validateDecisions } from "../src/inference.ts";
import { timestamp } from "../src/errors.ts";
import { Store } from "../src/store.ts";
import { Memory, MemoryWorker } from "../src/memory.ts";

const exact = "2026-11-07T03:52:04.289846+00:00";
const episode = (event_id = "tool-result", valid_from = exact) => ({
  kind: "episode" as const, scope: "agent:overwatch", subject: "Lantern-Cobalt-573",
  predicate: "synthetic_receipt_observed",
  object: `Fictional receipt cobalt573-check-001 reports R573 ready at ${exact}; synthetic=true, actual_deployment=false. No real service accessed or deployment verified.`,
  valid_from, valid_to: null, importance: 0.6, confidence: 0.99,
  evidence_event_ids: [event_id],
});
const parse = (start: string, end: string | null = null) => validateDecisions({
  decisions: [{ ...episode("tool-result", start), valid_to: end }],
}).decisions[0]!;

test("curator UTC fractions and zero offset project to existing millisecond storage without altering source text", () => {
  for (const input of [exact, "2026-11-07T03:52:04.289846Z", "2026-11-07T03:52:04.289846123Z", "2026-11-07T03:52:04.289Z"]) {
    const d = parse(input, "2026-11-07T03:52:05.999999+00:00");
    expect(d.valid_from).toBe("2026-11-07T03:52:04.289Z");
    expect(d.valid_to).toBe("2026-11-07T03:52:05.999Z");
    expect(d.object).toBe(episode().object);
  }
  expect(parse("2026-11-07T03:52:04Z").valid_from).toBe("2026-11-07T03:52:04.000Z");
  expect(parse("2026-11-07T03:52:04.2+00:00").valid_from).toBe("2026-11-07T03:52:04.200Z");
  // The external event/query contract is intentionally unchanged.
  expect(() => timestamp(exact, "occurred_at")).toThrow();
});

test("curator date adaptation retains calendar/UTC/interval validation and never invents a widened interval", () => {
  for (const invalid of ["2026-02-30T03:52:04.289846Z", "2026-13-07T03:52:04Z", "2026-11-07T24:00:00Z", "2026-11-07T03:52:60Z", "2026-11-07T03:52:04.1+07:00", "2026-11-07T03:52:04.1-00:00", "2026-11-07T03:52:04Z trailing", "2026-11-07T03:52:04.Z", "2026-11-07T03:52:04", "2026-11-07"]) {
    expect(() => parse(invalid)).toThrow("Curator output failed schema validation");
  }
  expect(() => parse(exact, "2026-11-07T03:52:04.289999Z")).toThrow();
  expect(() => parse(exact, "2026-11-07T03:52:04.100Z")).toThrow();
});

test("both dated inter-agent representations process with unchanged identities, attribution and one evidence root", async () => {
  const s = new Store(":memory:");
  const a = s.authenticate(s.bootstrap("Synthetic dated observations").token);
  const inference = {
    curate: async (input: any) => ({ decisions: [episode(input.event.event_id)] }),
    embed: async (texts: string[]) => ({ vectors: texts.map(() => [1, 0.5]), model: "test-double-not-real-model" }),
  };
  const m = new Memory(s, inference), w = new MemoryWorker(s, inference);
  m.bind(a, a.id, "overwatch");
  const receipt = { synthetic: true, project: "Lantern-Cobalt-573", build: "R573", actual_deployment: false, status: "fixture_runtime_observed", receipt_id: "cobalt573-check-001", observed_at: exact, reported_health: "ready" };
  const contents = [`Agent one reports ${JSON.stringify(receipt)}`, `Agent two acknowledges ${JSON.stringify(receipt)}`];
  const root = "agent-observation:overwatch:synthetic-session:observe";
  const ids = ["agent-observation:overwatch:synthetic-session:part:0", "agent-followup:overwatch:synthetic-session:part:0"];
  for (const [i, event_id] of ids.entries()) {
    const captured = m.event(a, { client_id: "synthetic", event_id, revision: 1, operation: "upsert", agent_id: "overwatch", thread_id: "synthetic-session", role: "inter_agent", author_id: "agent:observer", occurred_at: "2026-11-07T03:52:04.290Z", observed_at: "2026-11-07T03:52:11.000Z", content: contents[i], causal_parent_ids: [], evidence_root_ids: [root], metadata: {} });
    await w.runOnce();
    expect(s.one("SELECT status FROM memory_jobs WHERE id=?", captured.job_id).status).toBe("succeeded");
    const e = s.one("SELECT * FROM memory_events WHERE event_id=?", event_id);
    expect(e.revision).toBe(1);
    expect(e.role).toBe("inter_agent");
    expect(e.author_id).toBe("agent:observer");
    expect(e.content).toBe(contents[i]);
  }
  const memories = s.all("SELECT * FROM memories");
  expect(memories.length).toBe(1);
  expect(memories[0].scope).toBe("agent:overwatch");
  expect(memories[0].valid_from).toBe("2026-11-07T03:52:04.289Z");
  expect(memories[0].object).toContain(exact);
  const supports = m.support(memories[0]);
  expect(supports.length).toBe(2);
  expect(new Set(supports.flatMap((x: any) => x.evidence_root_ids))).toEqual(new Set([root]));
  s.close();
});

test("accepting natural dates does not relax current-event lineage checks", async () => {
  const s = new Store(":memory:");
  const a = s.authenticate(s.bootstrap("Synthetic dated lineage").token);
  const inference = { curate: async () => ({ decisions: [episode("wrong-event")] }), embed: async () => { throw new Error("must not embed"); } };
  const m = new Memory(s, inference), w = new MemoryWorker(s, inference);
  m.bind(a, a.id, "overwatch");
  const e = m.event(a, { client_id: "synthetic", event_id: "real-event", revision: 1, operation: "upsert", agent_id: "overwatch", thread_id: "synthetic", role: "inter_agent", author_id: "agent:observer", occurred_at: "2026-11-07T03:52:04.290Z", observed_at: "2026-11-07T03:52:11.000Z", content: episode().object, causal_parent_ids: [], evidence_root_ids: [], metadata: {} });
  await w.runOnce();
  expect(s.one("SELECT error_code FROM memory_jobs WHERE id=?", e.job_id).error_code).toBe("curator_lineage_violation");
  expect(s.all("SELECT * FROM memories").length).toBe(0);
  s.close();
});
