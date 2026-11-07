import { test, expect } from "bun:test";
import { Store, now } from "../src/store.ts";
import { Memory, MemoryWorker, memoryTokens } from "../src/memory.ts";
import { indexedCandidates, vectorBuckets } from "../src/memory-index.ts";
import { Inference } from "../src/inference.ts";
import { mkdtempSync,rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const at = "2026-01-01T00:00:00.000Z";
function fixture(path = ":memory:") {
  const s = new Store(path), boot = s.bootstrap("Fictional dreaming regression"), a = s.authenticate(boot.token);
  const inputs: any[] = [];
  const inf = { async curate(i: any) { inputs.push(structuredClone(i)); return { decisions: [{ kind: "nothing" as const }] }; }, async embed(texts: string[]) { return { vectors: texts.map(t => t.includes("furnace") || t.includes("kiln") ? [1,0] : [0,1]), model: "deterministic-double" }; } };
  const m = new Memory(s, inf), w = new MemoryWorker(s, inf); m.bind(a, a.id, "builder");
  const event = (event_id: string, content: string, extra: any = {}) => m.event(a, { client_id: "fixture", event_id, revision: 1, operation: "upsert", agent_id: "builder", thread_id: "loom", role: "user", author_id: "alex", occurred_at: at, observed_at: now(), content, metadata: {}, ...extra });
  const seed = (event_id: string, subject: string, predicate: string, object: string, scope = "business:alex", vector = [1,0]) => {
    event(event_id, `${subject} ${predicate} ${object}`);
    const e = s.one("SELECT * FROM memory_events WHERE event_id=?", event_id);
    w.apply(e, { kind: "assertion", scope, subject, predicate, object, valid_from: at, valid_to: null, importance: .8, confidence: .9, evidence_event_ids: [event_id] }, vector, "deterministic-double", [scope]);
    s.run("UPDATE memory_jobs SET status='succeeded' WHERE event_pk=?", e.id);
    s.run("UPDATE memory_events SET status='processed',processed_at=? WHERE id=?", now(), e.id);
    return s.one("SELECT id FROM memories WHERE subject=? AND object=?", subject, object).id;
  };
  const recall = (query: string) => m.recall(a, { agent_id: "builder", thread_id: "fresh", query });
  return { s, a, m, w, inputs, event, seed, recall };
}

test("oversized Unicode event advances coherent bounded chunks without changing durable source or roots", async () => {
  const f = fixture();
  const content = ("Lantern Loom kiln notes. 🐈 陶器 ไทย\n").repeat(2400);
  const r = f.event("large", content);
  let last = 0, turns = 0;
  while (f.s.one("SELECT status FROM memory_jobs WHERE id=?", r.job_id).status !== "succeeded" && turns++ < 200) {
    await f.w.runOnce();
    const i = f.inputs.at(-1);
    expect(memoryTokens(JSON.stringify(i))).toBeLessThanOrEqual(4096);
    expect(i.event.chunk.start).toBe(last);
    expect(i.event.content).toBe(content.slice(i.event.chunk.start, i.event.chunk.end));
    expect(i.event.chunk.end).toBeGreaterThan(last);
    if (last) expect(i.event.chunk.previous_context).toBe(content.slice(Math.max(0,last-500),last));
    last = i.event.chunk.end;
  }
  expect(last).toBe(content.length);
  expect(turns).toBeGreaterThan(1);
  expect(f.s.one("SELECT content FROM memory_events WHERE event_id='large'").content).toBe(content);
  expect(f.s.one("SELECT COUNT(*) n FROM memory_chunk_progress").n).toBe(0);
  expect(f.s.one("SELECT COUNT(*) n FROM memory_roots").n).toBe(1);
  expect(f.s.one("SELECT COUNT(*) n FROM memories").n).toBe(0); // noise may yield nothing
  expect(f.s.one("SELECT COUNT(*) n FROM memory_curation_metrics").n).toBe(turns);
  f.s.close();
}, 20000);

test("indexed semantic paraphrase and one-hop relations are useful; unrelated and empty queries return none", async () => {
  const f = fixture();
  const owner = f.seed("owner", "Lantern kiln", "calibrated_by", "Mira");
  const relation = f.seed("relation", "Mira", "reports_to", "Nola", "business:alex", [0,1]);
  for (let i=0;i<260;i++) f.seed(`noise-${i}`, `Orchid ${i}`, "species", "orchid blossom", "agent:builder", [0,1]);
  const r = await f.recall("furnace settings technician");
  expect(r.memories.map((x:any)=>x.id)).toContain(owner);
  expect(r.memories.map((x:any)=>x.id)).toContain(relation);
  expect(r.context).toContain("reports_to");
  expect(r.retrieval.candidates_examined).toBeLessThanOrEqual(192);
  expect(r.tokens_used).toBeLessThan(1200);
  // Disable semantic double for unrelated test, unlike real quality fixture.
  f.m.inference.embed = async () => ({ vectors: [[0,0,1]], model: "different-dimensions-double" });
  expect((await f.recall("rye sourdough baking instructions")).memories).toEqual([]);
  expect((await f.recall("")).context).toBe("");
  f.s.close();
});

test("FTS and semantic indexes enforce scope and delete/update cleanup synchronously", async () => {
  const f = fixture();
  f.seed("private", "Hidden default note", "about", "kiln", "agent:default");
  f.seed("visible", "Visible kiln", "owned_by", "Mira");
  expect(indexedCandidates(f.s,f.a.workspace_id,["agent:builder"],"kiln",[1,0],"deterministic-double")).toEqual([]);
  expect((await f.recall("kiln")).memories.map((x:any)=>x.subject)).toEqual(["Visible kiln"]);
  const old = f.s.one("SELECT id FROM memories WHERE subject='Visible kiln'").id;
  f.event("visible", "changed", {revision:2});
  expect(f.s.one("SELECT COUNT(*) n FROM memory_vector_buckets WHERE memory_id=?",old).n).toBe(0);
  expect(indexedCandidates(f.s,f.a.workspace_id,["business:alex"],"Visible kiln")).toEqual([]);
  f.event("private", "", {revision:2,operation:"delete"});
  expect(f.s.one("SELECT COUNT(*) n FROM memory_vector_buckets").n).toBe(0);
  expect(f.s.one("SELECT COUNT(*) n FROM memories").n).toBe(0);
  f.s.close();
});

test("a correction cannot re-create the same invalidated positive claim under a new date", () => {
  const f=fixture();f.seed("bad","Nola","manages","clay deliveries");
  const target=f.s.one("SELECT * FROM memories");
  const decision:any={kind:"update",scope:"business:alex",subject:"Nola",predicate:"manages",object:"clay deliveries",valid_from:"2026-02-01T00:00:00.000Z",valid_to:null,importance:.9,confidence:.9,evidence_event_ids:["correct"],change:{type:"correction",target_ids:[target.id]}};
  expect(()=>f.w.validate([decision],{event_id:"correct",role:"user",agent_id:"builder"},["business:alex"],[target])).toThrow("Correction must express corrected");
  decision.subject="Leda";
  expect(()=>f.w.validate([decision],{event_id:"correct",role:"user",agent_id:"builder"},["business:alex"],[target])).not.toThrow();
  f.s.close();
});

test("query plans use serving indexes and LSH is deterministic/model-dimension fenced", () => {
  const f = fixture();
  f.seed("indexed", "kiln", "owner", "Mira");
  expect(vectorBuckets([1,.5])).toEqual(vectorBuckets([1,.5]));
  expect(vectorBuckets([1,.5])).toHaveLength(24);
  const plans = f.s.all("EXPLAIN QUERY PLAN SELECT memory_id FROM memory_vector_buckets WHERE workspace_id=? AND scope=? AND model=? AND dimensions=? AND bucket=?",f.a.workspace_id,"business:alex","deterministic-double",2,vectorBuckets([1,0])[0]);
  expect(JSON.stringify(plans)).toContain("memory_bucket_lookup");
  const fts = f.s.all("EXPLAIN QUERY PLAN SELECT rowid FROM memory_search WHERE memory_search MATCH ?","kiln");
  expect(JSON.stringify(fts)).toContain("VIRTUAL TABLE INDEX");
  f.s.close();
});

test("additive serving migration backfills populated schema2 with unchanged custody/auth and resumes committed chunks", async () => {
  const dir=mkdtempSync(join(tmpdir(),"atlas-dreaming-")), path=join(dir,"fixture.sqlite");
  const f=fixture(path);
  try {
    f.seed("old","kiln","owner","Mira");
    const custody=f.s.all("SELECT * FROM memory_events"), credential=f.s.one("SELECT * FROM credentials");
    f.s.db.exec("DROP TRIGGER memory_search_insert; DROP TRIGGER memory_search_update; DROP TRIGGER memory_search_delete; DROP TABLE memory_search; DROP TABLE memory_vector_buckets; DROP TABLE memory_index_meta;");
    f.s.close();
    const reopened=new Store(path);
    expect(reopened.all("SELECT * FROM memory_events")).toEqual(custody);
    expect(reopened.one("SELECT * FROM credentials")).toEqual(credential);
    expect(indexedCandidates(reopened,f.a.workspace_id,["business:alex"],"kiln")).toHaveLength(1);
    const m=new Memory(reopened,f.m.inference),w=new MemoryWorker(reopened,f.m.inference);
    const receipt=m.event(f.a,{client_id:"fixture",event_id:"large-restart",revision:1,operation:"upsert",agent_id:"builder",thread_id:"restart",role:"tool",author_id:"fictional",occurred_at:at,observed_at:now(),content:"Routine noise. ".repeat(3000)});
    await w.runOnce();
    const offset=reopened.one("SELECT offset_chars FROM memory_chunk_progress").offset_chars;
    expect(offset).toBeGreaterThan(0);
    reopened.close();
    const recovered=new Store(path),worker=new MemoryWorker(recovered,f.m.inference);
    // Simulate a lost claim after the last atomic committed checkpoint.
    recovered.run("UPDATE memory_jobs SET status='running',lease_until=0,attempts=1 WHERE id=?",receipt.job_id);
    f.inputs.length=0;
    for(let n=0;n<20&&recovered.one("SELECT status FROM memory_jobs WHERE id=?",receipt.job_id).status!=="succeeded";n++)await worker.runOnce();
    expect(f.inputs[0].event.chunk.start).toBe(offset);
    expect(recovered.one("SELECT status FROM memory_jobs WHERE id=?",receipt.job_id).status).toBe("succeeded");
    expect(recovered.one("SELECT COUNT(*) n FROM memory_events WHERE event_id='large-restart'").n).toBe(1);
    recovered.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("persistent embedding HTTP uses exact protocol/identity and rejects mismatched replies", async () => {
  const old = process.env.THE_ATLAS_EMBED_URL;
  let bad = false;
  const server = Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req) {const q:any=await req.json();expect(q.protocol).toBe("atlas-inference-v1");expect(q.operation).toBe("embed");return Response.json({protocol:q.protocol,request_id:bad?"wrong":q.request_id,output:{vectors:[[1,.5]],model:"http-double"},usage:{local:true}});}});
  process.env.THE_ATLAS_EMBED_URL = new URL("/v1/embed",server.url).href;
  try { const i=new Inference(); expect((await i.embed(["kiln"])).model).toBe("http-double"); bad=true; await expect(i.embed(["kiln"])).rejects.toMatchObject({code:"invalid_embedding"}); }
  finally { if(old===undefined) delete process.env.THE_ATLAS_EMBED_URL; else process.env.THE_ATLAS_EMBED_URL=old; await server.stop(true); }
});
