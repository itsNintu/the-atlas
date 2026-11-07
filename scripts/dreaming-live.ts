// Explicit opt-in fictional fixture, never production DB/profile events.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { Store, now } from "../src/store.ts";
import { Memory, MemoryWorker } from "../src/memory.ts";
import { Inference } from "../src/inference.ts";
if (!process.env.THE_ATLAS_INFERENCE_COMMAND || !process.env.THE_ATLAS_EMBED_URL)
  throw Error("Configure proven Luna command and local MiniLM EMBED_URL explicitly");
const out = process.argv[2];
if (!out || !out.startsWith(".private/")) throw Error("Use a new .private/ fixture directory");
mkdirSync(out, { recursive: true, mode: 0o700 });
const s = new Store(`${out}/fixture.sqlite`);
assert.equal(s.one("SELECT COUNT(*) n FROM workspaces").n, 0, "fresh fixture required");
const boot = s.bootstrap("Fictional Lantern Loom cooperative");
const a = s.authenticate(boot.token), real = new Inference();
const calls: any[] = [];
const inference = {
  async curate(input: any) {
    const t = performance.now(), result = await real.curate(input);
    calls.push({ event_id: input.event.event_id, input, result, usage: real.last_usage.curate, elapsed_ms: performance.now() - t });
    return result;
  },
  embed: (texts: string[]) => real.embed(texts),
};
const m = new Memory(s, inference), w = new MemoryWorker(s, inference);
m.bind(a, a.id, "builder");
const capture = async (event_id: string, content: string, time: string) => {
  const receipt = m.event(a, { client_id: "fictional", event_id, revision: 1, operation: "upsert", agent_id: "builder", thread_id: "lantern-loom", role: "user", author_id: "alex", occurred_at: time, observed_at: now(), content, metadata: {}, causal_parent_ids: [], evidence_root_ids: [] });
  for (let i = 0; i < 60; i++) {
    await w.runOnce();
    const job = s.one("SELECT status,error_code FROM memory_jobs WHERE id=?", receipt.job_id);
    if (job.status === "succeeded") return;
    if (job.status === "failed") throw Error(`curation failed ${job.error_code}`);
    if (job.status === "retry") await Bun.sleep(1100);
  }
  throw Error("bounded fixture processing did not finish");
};
const recall = async (query: string) => m.recall(a, { agent_id: "builder", thread_id: "fresh", query });
try {
  await capture("ownership", "Lantern Loom is our small ceramics cooperative. Mira owns the kiln calibration work. Nola manages the clay deliveries. Mira reports to Nola.", "2026-01-01T00:00:00Z");
  await capture("noise", "Thanks, got it!", "2026-01-02T00:00:00Z");
  const before = await recall("Who is responsible for adjusting Lantern Loom's furnace settings?");
  await capture("change", "From February 1, Nola takes over the kiln calibration from Mira. Mira really did own that work in January; this is a handover, not a correction of January's record.", "2026-02-01T00:00:00Z");
  const after = await recall("Who owns Lantern Loom kiln calibration now?");
  const history = await m.recall(a, { agent_id: "builder", thread_id: "history", query: "Lantern Loom kiln calibration owner", valid_at: "2026-01-15T00:00:00Z" });
  const unrelated = await recall("How do I bake a sourdough loaf with rye flour?");
  const contextual = await m.recall(a, { agent_id: "builder", thread_id: "followup", query: "Who does she report to?", recent_context: [{role:"assistant", content:"Mira handled the kiln in January."}] });
  const oversize = ("Routine chatter: thanks, got it, all right.\n").repeat(250) + "\nThe emergency kiln checklist is kept in the teal cabinet beside the loading door.";
  await capture("large", oversize, "2026-03-01T00:00:00Z");
  const largeRecall = await recall("Where do we keep the emergency kiln checklist?");
  await capture("correction", "Correction: I was mistaken when I said Nola managed clay deliveries. She never did; Leda has managed clay deliveries since January 1.", "2026-03-02T00:00:00Z");
  const corrected = await recall("Who manages Lantern Loom clay deliveries?");
  const timings: any[] = [];
  for (let i = 0; i < 24; i++) {
    const query = ["Who manages kiln calibration?", "Which person supervises Mira?", "Explain the orbit of Jupiter's moons."][i % 3]!;
    const t = performance.now(), r = await recall(query);
    timings.push({ query, elapsed_ms: performance.now() - t, ...r.retrieval, tokens: r.tokens_used, objects: r.memories.map((x: any) => [x.subject,x.predicate,x.object]) });
  }
  const memories = s.all("SELECT id,scope,kind,subject,predicate,object,valid_from,valid_to FROM memories");
  const metrics = s.all("SELECT * FROM memory_curation_metrics");
  await Bun.write(`${out}/result.json`, JSON.stringify({ fictional: true, calls, metrics, memories, changes: s.all("SELECT * FROM memory_changes"), before, after, history, unrelated, contextual, largeRecall, corrected, timings }, null, 2));
  assert(before.memories.some((x: any) => /mira/i.test(x.subject + " " + x.object)), "paraphrase should recall Mira");
  assert(after.memories.some((x: any) => /nola/i.test(x.subject + " " + x.object)), "handover should recall Nola");
  assert.equal(unrelated.memories.length, 0, "unrelated request must return no graph memory");
  assert(s.one("SELECT COUNT(*) n FROM memory_changes WHERE type='state_change'").n > 0, "real handover must reconcile");
  assert(metrics.every(x => x.input_tokens <= 4096));
  assert(metrics.filter(x=>x.event_pk===s.one("SELECT id FROM memory_events WHERE event_id='large'").id).length>1, "real oversized source must use multiple chunks");
  assert(/teal/i.test(largeRecall.context), "last chunk must not strand meaningful information");
  assert(contextual.memories.some((x:any)=>/reports|supervis/i.test(x.predicate)), "contextual followup should resolve she");
  assert(s.one("SELECT COUNT(*) n FROM memory_changes WHERE type='correction'").n>0, "never-true correction must be distinct");
  assert(corrected.context.includes("Leda"), "corrected delivery owner must be recalled");
  console.log(JSON.stringify({ report: `${out}/result.json`, curation_calls: calls.length, input_tokens: metrics.map(x=>x.input_tokens), memories: memories.length, samples: timings.length, first_recall: before.retrieval, unrelated_count: unrelated.memories.length }));
} finally { s.close(); }
