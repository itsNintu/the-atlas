// Explicit synthetic product exercise. Requires REAL configured curate+embedding providers.
// Never run against the owner's production workspace; this script owns its disposable database.
import { Store, id, now } from "../src/store.ts";
import { Memory, MemoryWorker } from "../src/memory.ts";
import { Inference, inferenceStatus } from "../src/inference.ts";
import { mkdirSync, writeFileSync } from "node:fs";
const directory = process.argv[2] ?? ".private/memory-live";
mkdirSync(directory, { recursive: true, mode: 0o700 });
const store = new Store(`${directory}/${id("synthetic")}.sqlite`);
const admin = store.bootstrap("Disposable synthetic live-memory exercise"),
  a = store.authenticate(admin.token),
  inference = new Inference(),
  memory = new Memory(store, inference),
  worker = new MemoryWorker(store, inference);
memory.bind(a, a.id, "default");
const p = id("prn");
store.run(
  "INSERT INTO principals VALUES (?,?,?,?,?,?)",
  p,
  a.workspace_id,
  "Synthetic Builder",
  "agent",
  0,
  now(),
);
memory.bind(a, p, "builder");
const builder = store.authenticate(store.issueKey(p).token);
const report: any = {
  kind: "real-model-backed synthetic product test, not native activation",
  started_at: now(),
  provider: inferenceStatus(),
  events: [],
  recalls: [],
  checks: [],
};
const checkpoint = async (
  label: string,
  query: string,
  valid_at?: string,
  actor = builder,
) => {
  const start = performance.now();
  const result = await memory.recall(actor, {
    agent_id: actor === a ? "default" : "builder",
    thread_id: "fresh-" + label,
    query,
    recent_context: [],
    token_budget: 2500,
    valid_at,
  });
  report.recalls.push({
    label,
    elapsed_ms: performance.now() - start,
    ...result,
  });
  if (result.retrieval.semantic_status !== "available")
    throw Error(
      "Real semantic recall unavailable: " + result.retrieval.semantic_status,
    );
  return result;
};
const send = async (
  event_id: string,
  content: string,
  occurred_at: string,
  extra: any = {},
  processEvent = true,
) => {
  const event = {
    client_id: "atlas-synthetic-live",
    event_id,
    revision: 1,
    operation: "upsert",
    agent_id: "default",
    thread_id: extra.thread_id ?? "synthetic-connected-walk",
    role: "user",
    author_id: "alex",
    occurred_at,
    observed_at: now(),
    content,
    causal_parent_ids: [],
    evidence_root_ids: [],
    metadata: { synthetic: true },
    ...extra,
  };
  const receipt = memory.event(a, event);
  const start = performance.now();
  if (processEvent) {
    await worker.runOnce();
    const job = store.one(
      "SELECT id,status,error_code,attempts FROM memory_jobs WHERE id=?",
      receipt.job_id,
    );
    report.events.push({
      event,
      receipt,
      job,
      usage: { ...inference.last_usage },
      elapsed_ms: performance.now() - start,
    });
    if (job.status !== "succeeded")
      throw Error("Live curation failed: " + JSON.stringify(job));
  } else report.events.push({ event, receipt, job: "deliberately pending" });
};
try {
  await send(
    "preference",
    "For my standing communication preferences: keep ordinary progress updates short. For architecture decisions, give me detailed reasoning and trade-offs, not just a terse conclusion.",
    "2026-10-01T09:00:00Z",
  );
  await checkpoint(
    "shared-contextual-preference",
    "How should you explain the architecture choices for our memory system?",
  );
  await send(
    "one-turn",
    "For this reply only, answer briefly. This does not change my standing architecture preference.",
    "2026-10-02T09:00:00Z",
  );
  await checkpoint(
    "one-turn-not-standing",
    "Explain architectural trade-offs for a new indexing system.",
  );
  await send(
    "reversal",
    "From 2026-11-01 onward, change my standing preference: architecture explanations should also be concise, unless I explicitly request depth. The earlier preference for detailed architecture answers was valid before that date.",
    "2026-11-01T00:00:00Z",
    {},
    false,
  );
  await checkpoint(
    "pending-cross-agent-reversal",
    "How detailed should this architecture explanation be?",
  );
  await worker.runOnce();
  const reversal = store.one(
    "SELECT j.status,j.error_code FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk WHERE e.event_id='reversal'",
  );
  if (reversal.status !== "succeeded")
    throw Error("Reversal failed " + JSON.stringify(reversal));
  await checkpoint(
    "current-reversal",
    "What level of architecture explanation does Alex prefer now?",
  );
  await checkpoint(
    "historical-preference",
    "Why did Alex want detailed architecture explanations in October?",
    "2026-10-15T00:00:00Z",
  );
  await send(
    "assignment",
    "For the synthetic Lantern project, effective 2026-11-02T00:00:00Z Maya owns release decisions. Builder remains responsible for implementation.",
    "2026-11-02T00:00:00Z",
  );
  await send(
    "delayed-handoff",
    "Historical handoff note dated 2026-10-20: Rowan owns Lantern release decisions from October 20 until November 2, when Maya takes over. This arrived late and is not a new assignment.",
    "2026-10-20T00:00:00Z",
  );
  await checkpoint(
    "delayed-responsibility",
    "Who owns Lantern release decisions now and who implements?",
  );
  await send(
    "deploy-failed",
    "Synthetic deploy tool returned: build L7 activation FAILED before switch-over. No runtime activation occurred.",
    "2026-11-03T09:00:00Z",
    {
      role: "tool",
      author_id: "synthetic-deploy",
      metadata: { synthetic: true, status: "failed", phase: "activation" },
    },
  );
  await checkpoint(
    "failure-not-success",
    "Is synthetic Lantern build L7 verified live?",
  );
  await send(
    "runtime-verified",
    "Synthetic runtime-check tool observed: at 2026-11-04T09:05:00Z the running Lantern service reports build L7 with health OK, after a later successful deploy. This is one observed runtime check, not a permanent liveness guarantee.",
    "2026-11-04T09:05:00Z",
    {
      role: "tool",
      author_id: "synthetic-runtime-check",
      evidence_root_ids: ["synthetic-runtime-L7-check"],
      metadata: { synthetic: true, status: "verified", phase: "runtime-check" },
    },
  );
  await checkpoint(
    "verified-outcome-dated",
    "What is the last verified runtime state of Lantern L7, and did the earlier attempt succeed?",
  );
  report.memory_count = store.one("SELECT COUNT(*) AS n FROM memories").n;
  report.job_counts = store.all(
    "SELECT status,COUNT(*) AS n FROM memory_jobs GROUP BY status",
  );
  report.finished_at = now();
  report.success = true;
} catch (error) {
  report.success = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(`${directory}/result.json`, JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  store.close();
  console.log(
    JSON.stringify({
      success: report.success,
      report: `${directory}/result.json`,
      events: report.events.length,
      recalls: report.recalls.length,
      error: report.error,
    }),
  );
}
