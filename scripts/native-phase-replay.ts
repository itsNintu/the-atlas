// Final-source integration of recorded REAL Luna outputs; no new Luna calls.
import assert from 'node:assert/strict';import {copyFileSync,mkdirSync,existsSync} from 'node:fs';
import {Store,canonical,hash} from '../src/store.ts';import {Memory,MemoryWorker,memoryTokens} from '../src/memory.ts';import {Inference,validateDecisions} from '../src/inference.ts';import {validateReconciliations} from '../src/memory-reconciliation.ts';import {memoryGraph} from '../src/memory-graph.ts';
const dir='.private/native-phase-repair/final-replay-v2';assert(!existsSync(dir));mkdirSync(dir,{mode:0o700});copyFileSync('.private/native-phase-repair/corrected-ldn7/copy.sqlite',`${dir}/copy.sqlite`);
const s=new Store(`${dir}/copy.sqlite`),snapshot=await Bun.file('evidence/native-phase-repair/READONLY-CURRENT.json').json();
const recordings=['corrected-ldn7-chain','corrected-final-fen9'],responses=new Map<string,any[]>(),calls:any[]=[];
for(const label of recordings){const r=await Bun.file(`.private/native-phase-repair/${label}/trace.json`).json();for(const c of r.calls){const event=c.input.event.event_id;responses.set(event,[...(responses.get(event)??[]),c]);}}
const real=new Inference();
async function recorded(i:any){const c=responses.get(i.event.event_id)?.shift();assert(c,'Recorded response required');assert.equal(c.phase,i.phase??'extract');calls.push({event_id:i.event.event_id,phase:c.phase,input_tokens:memoryTokens(JSON.stringify(i)),recorded_input_sha256:hash(JSON.stringify(c.input)),final_input_sha256:hash(JSON.stringify(i))});return c.output;}
const inf={curate:async(i:any)=>validateDecisions(await recorded(i)),resolveEntities:recorded,reconcile:async(i:any)=>validateReconciliations(await recorded(i),1),embed:(texts:string[])=>real.embed(texts)};
const m=new Memory(s,inf),w=new MemoryWorker(s,inf),targets=snapshot.originals.map((r:any)=>r.job),custody=targets.map((t:any)=>s.one('SELECT * FROM memory_events WHERE id=?',t.event_pk));
s.run("UPDATE memory_jobs SET status='failed',lease_token=NULL,lease_until=NULL WHERE status IN ('running','retry','queued')");
for(const t of targets.slice(1)){s.run("UPDATE memory_jobs SET status='queued',attempts=0,available_at=0,error_code=NULL,lease_token=NULL,lease_until=NULL WHERE id=?",t.id);s.run("UPDATE memory_events SET status='pending' WHERE id=?",t.event_pk)}
try{
 for(let n=0;n<4;n++)await w.runOnce();
 const jobs=targets.map((t:any)=>s.one('SELECT id,status,error_code FROM memory_jobs WHERE id=?',t.id));
 const fields=['id','event_id','revision','operation','content','body_hash','roots_json','causal_json','metadata_json','occurred_at','observed_at','accepted_at','role','author_id','credential_id','principal_id','thread_id','workspace_id','client_id'];
 const unchanged=custody.every((e:any)=>{const after=s.one('SELECT * FROM memory_events WHERE id=?',e.id);return fields.every(k=>after[k]===e[k])});
 const e=custody[0],a={...s.one('SELECT * FROM principals WHERE id=?',e.principal_id),credential_id:e.credential_id},originals=new Set(custody.map((e:any)=>e.event_id));
 const graphs=['LDN7','FEN9'].flatMap(query=>[false,true].map(include_history=>{const g=memoryGraph(m,a,{agent_id:'reaver',query,include_history,limit:100});const edges=g.edges.filter((e:any)=>e.sources.some((x:any)=>originals.has(x.event_id)));const ids=new Set(edges.flatMap((e:any)=>[e.source,e.target]));return {query,include_history,nodes:g.nodes.filter((n:any)=>ids.has(n.id)),edges,changes:g.changes.filter((c:any)=>originals.has(c.event_id))}}));
 const ldn=graphs.find(g=>g.query==='LDN7'&&!g.include_history)!,history=graphs.find(g=>g.query==='LDN7'&&g.include_history)!;
 const typed=(g:any)=>g.edges.filter((e:any)=>g.nodes.find((n:any)=>n.id===e.target)?.kind==='entity');
 const report={source_fixture_not_native_activation:true,method:'recorded real Luna outputs through final worker/validators on private exact snapshot; real resident embeddings; no Luna calls',recordings,calls,jobs,custody_preserved:unchanged,graphs,typed_edge_counts:graphs.map(g=>({topic:g.query,history:g.include_history,positive:typed(g).filter((e:any)=>['active','historical'].includes(e.status)).length}))};
 await Bun.write('evidence/native-phase-repair/FINAL-INTEGRATION.json',JSON.stringify(report,null,2));
 assert(jobs.every((j:any)=>j.status==='succeeded'),JSON.stringify(jobs));assert(unchanged);assert(calls.every(c=>c.input_tokens<=4096));
 assert(!ldn.edges.some(e=>['memory_36a62b9d-b757-48ed-8f92-7a65303eabbd','memory_a826fdb2-4310-40e3-8b39-387d212bbc63'].includes(e.id)));
 assert(typed(history).some((e:any)=>e.status==='historical'&&e.valid_to==='2026-11-07T00:00:00.000Z'&&/Nola/.test(history.nodes.find((n:any)=>n.id===e.source)?.label??'')),'positive typed prior owner at actual date');
 assert(typed(ldn).some((e:any)=>e.predicate==='owns'&&/Leda/.test(ldn.nodes.find((n:any)=>n.id===e.source)?.label??'')),'positive current typed Leda');
 assert(typed(graphs.find(g=>g.query==='FEN9'&&!g.include_history)).filter((e:any)=>['maintains','reports_to','reviews'].includes(e.predicate)).length>=3);
 console.log(JSON.stringify({jobs,custody_preserved:unchanged,calls:calls.length,max_tokens:Math.max(...calls.map(c=>c.input_tokens)),typed:report.typed_edge_counts}));
}finally{s.close()}
