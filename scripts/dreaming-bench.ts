// Fictional query-serving workload; no production DB or credentials.
import assert from "node:assert/strict";
import { Store, now } from "../src/store.ts";
import { Memory, MemoryWorker } from "../src/memory.ts";
import { Inference } from "../src/inference.ts";
import { App } from "../src/app.ts";
const directory = process.argv[2];
if (!directory?.startsWith(".private/")) throw Error("Use isolated fictional fixture directory");
const s = new Store(`${directory}/fixture.sqlite`), real = new Inference(), m = new Memory(s,real), w = new MemoryWorker(s,real);
const p = s.one("SELECT principal_id FROM memory_bindings WHERE agent_id='builder'").principal_id;
const key = s.issueKey(p), a = s.authenticate(key.token);
const at="2026-01-01T00:00:00.000Z";
const event=(event_id:string, content:string)=>m.event(a,{client_id:"load-fixture",event_id,revision:1,operation:"upsert",agent_id:"builder",thread_id:"load",role:"tool",author_id:"synthetic-load",occurred_at:at,observed_at:now(),content,metadata:{}});
const vocab=["Orchids bloom under humid glasshouse conditions.","The polar research hut uses orange wool blankets.","A fictional chess club meets on Thursdays.","The fictional orchard grows cider apples.","The brass telescope is stored in a padded case.","Violet pigments make blue watercolor washes.","An imaginary hiking trail follows the river.","The synthetic garden grows purple carrots."];
if (!s.one("SELECT 1 FROM memory_events WHERE client_id='load-fixture' AND event_id='distractors'")) {
const embeddings=await real.embed(vocab);
const receipt=event("distractors",vocab.join("\n"));
const e=s.one("SELECT * FROM memory_events WHERE event_id='distractors'");
s.transaction(()=>{
  for(let i=0;i<2000;i++)w.apply(e,{kind:"assertion",scope:"agent:builder",subject:`Fictional specimen ${i}`,predicate:"description",object:vocab[i%vocab.length]!,valid_from:at,valid_to:null,importance:.5,confidence:.9,evidence_event_ids:["distractors"]},embeddings.vectors[i%vocab.length],embeddings.model,["agent:builder"]);
  s.run("UPDATE memory_events SET status='processed',processed_at=? WHERE id=?",now(),e.id);
  s.run("UPDATE memory_jobs SET status='succeeded' WHERE id=?",receipt.job_id);
  for(let i=0;i<1500;i++)event(`pending-${i}`,"Captured noise that must not be served. ".repeat(40));
});
}
const app=new App(s); app.memory=m;
const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:r=>app.fetch(r)});
const cases=[
 {label:"paraphrase",query:"Who is responsible for adjusting Lantern Loom's furnace settings?",nonempty:true},
 {label:"relationship",query:"Which person supervises Mira?",nonempty:true},
 {label:"unrelated",query:"How do superconducting quantum computers correct qubit errors?",nonempty:false},
];
const samples:any[]=[];
try {
 for(let n=0;n<25;n++)for(const q of cases){
  const start=performance.now(), response=await fetch(new URL("/v1/recall",server.url),{method:"POST",headers:{Authorization:`Bearer ${key.token}`,"Content-Type":"application/json"},body:JSON.stringify({agent_id:"builder",thread_id:"load-query",query:q.query})});
  const body:any=await response.json(), elapsed_ms=performance.now()-start;
  assert.equal(response.status,200);
  const data=body.data;
  if(q.nonempty) assert(data.memories.length>0,`${q.label} must retrieve useful knowledge`);
  else assert.equal(data.memories.length,0,"unrelated may not fill budget");
  assert.equal(data.pending_events.length,0);
  samples.push({label:q.label,cold_serving:n===0,elapsed_ms,tokens:data.tokens_used,context:data.context,...data.retrieval});
 }
 const percentile=(xs:number[],p:number)=>[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
 const summary=Object.fromEntries(cases.map(q=>{
  const xs=samples.filter(x=>x.label===q.label&&!x.cold_serving);
  return[q.label,{n:xs.length,cold:samples.find(x=>x.label===q.label&&x.cold_serving),http_ms:{p50:percentile(xs.map(x=>x.elapsed_ms),.5),p95:percentile(xs.map(x=>x.elapsed_ms),.95),max:Math.max(...xs.map(x=>x.elapsed_ms))},embedding_ms:{p50:percentile(xs.map(x=>x.embedding_ms),.5),p95:percentile(xs.map(x=>x.embedding_ms),.95),max:Math.max(...xs.map(x=>x.embedding_ms))},tokens:[...new Set(xs.map(x=>x.tokens))],max_candidates:Math.max(...xs.map(x=>x.candidates_examined))}];
 }));
 const result={fictional:true,extraction:"Luna fixture knowledge; 2000 explicit synthetic distractors with real MiniLM vectors, NOT 2000 model-extracted facts",embedding_service:"prewarmed resident MiniLM384",startup_excluded:"Bun/tokenizer load; model service load measured by native owner separately",counts:{memories:s.one("SELECT COUNT(*) n FROM memories").n,events:s.one("SELECT COUNT(*) n FROM memory_events").n,pending:s.one("SELECT COUNT(*) n FROM memory_events WHERE status='pending'").n},summary,samples};
 await Bun.write(`${directory}/benchmark.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify({counts:result.counts,summary}));
} finally {await server.stop(true);s.close();}
