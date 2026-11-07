// Final source on exact retained prestate; recorded real responses plus one changed temporal contract call.
import assert from 'node:assert/strict';import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {Store,hash} from '../src/store.ts';import {Memory,MemoryWorker,memoryTokens} from '../src/memory.ts';import {Inference,validateDecisions} from '../src/inference.ts';import {validateCandidateAssessments} from '../src/memory-reconciliation.ts';import {memoryGraph} from '../src/memory-graph.ts';
const label=process.argv[2]??'final-replay',dir=`.private/original-truth-repair/${label}`;assert(/^[a-z0-9-]+$/.test(label));assert(!existsSync(dir));mkdirSync(dir,{mode:0o700});copyFileSync('.private/original-truth-repair/current.sqlite',`${dir}/copy.sqlite`);
const s=new Store(`${dir}/copy.sqlite`),actual=new Store('.private/original-truth-repair/directional-v3/copy.sqlite'),trace=await Bun.file('.private/original-truth-repair/directional-v3/trace.json').json(),snapshot=await Bun.file('evidence/original-truth-repair/READONLY-CURRENT.json').json(),real=new Inference();
assert(trace.jobs.every((j:any)=>j.status==='succeeded'));
// Pin only generated identities by exact entity canonical / complete claim fingerprint.
// This is explicit verified test identity mapping, never model-output editing or a production write.
const entities=new Map(actual.all('SELECT id,workspace_id,canonical FROM memory_entities').map((r:any)=>[JSON.stringify([r.workspace_id,r.canonical]),r.id]));
const memories=new Map(actual.all('SELECT id,workspace_id,scope,fingerprint FROM memories').map((r:any)=>[JSON.stringify([r.workspace_id,r.scope,r.fingerprint]),r.id]));actual.close();
const mapping=new Map<string,string>(),map=(v:any)=>typeof v==='string'?(mapping.get(v)??v):v;
const run=s.run.bind(s),one=s.one.bind(s),all=s.all.bind(s);
s.run=(sql:string,...params:any[])=>{
 if(sql.startsWith('INSERT INTO memories (')){const expected=memories.get(JSON.stringify([params[1],params[2],params[13]]));assert(expected,'Exact recorded claim fingerprint needed');mapping.set(params[0],expected);}
 if(sql.startsWith('INSERT INTO memory_entities VALUES')){const expected=entities.get(JSON.stringify([params[1],params[2]]));assert(expected,'Exact recorded entity identity needed');mapping.set(params[0],expected);}
 return run(sql,...params.map(map));};s.one=(sql:string,...params:any[])=>one(sql,...params.map(map));s.all=(sql:string,...params:any[])=>all(sql,...params.map(map));
const temporal=await Bun.file('.private/original-truth-repair/final-replay/trace.json').json();
const actualTemporal=temporal.calls.filter((c:any)=>c.actual_native);assert.equal(actualTemporal.length,1);
const ledger=[...trace.calls,...actualTemporal],calls:any[]=[],jobs:any[]=[],errors:any[]=[];let n=0;const nativeCalls=0;
const claim=(i:any)=>JSON.stringify([i.event.event_id,...['scope','subject','predicate','object','valid_from','valid_to'].map(k=>i.incoming?.[0]?.[k])]);
async function save(){await Bun.write(`${dir}/trace.json`,JSON.stringify({label,method:'Structurally projected real per-candidate outputs across final token-window partitions; semantic labels/values unchanged; generated IDs pinned by exact fingerprints',base_sha256:snapshot.private_snapshot_sha256,calls,errors,identity_mapping:[...mapping],jobs:jobs.map(j=>s.one('SELECT id,status,error_code FROM memory_jobs WHERE id=?',j.job_id)),native_calls:nativeCalls},null,2));}
async function recorded(i:any){n++;const phase=i.phase??'extract';const sources=ledger.filter((c:any)=>c.phase===phase&&c.input.event.event_id===i.event.event_id&&(phase==='extract'||claim(c.input)===claim(i)));assert(sources.length,'Real recorded claim response required');
 const row:any={phase,input_tokens:memoryTokens(JSON.stringify(i)),input:i,recorded_output_hashes:sources.map((c:any)=>hash(JSON.stringify(c.output))),final_input_sha256:hash(JSON.stringify(i))};calls.push(row);
 if(phase==='extract')row.output=sources[0].output;
 else if(phase==='identity'){
  const bindings=new Map<string,any>(),aliases=new Map<string,Set<string>>();
  for(const c of sources){for(const b of c.output.candidate_identities??[])bindings.set(b.id,b);for(const a of c.output.identity.entity_aliases){const labels=aliases.get(a.canonical)??new Set<string>();for(const label of a.aliases)labels.add(label);aliases.set(a.canonical,labels);}}
  row.output={decisions:[],identity:{...sources[0].output.identity,entity_aliases:[...aliases].map(([canonical,labels])=>({canonical,aliases:[...labels]}))},candidate_identities:i.candidates.flatMap((c:any)=>bindings.has(c.id)?[bindings.get(c.id)]:[])};
 }else{
  const assessments=new Map<string,any>();for(const c of sources)for(const a of c.output.assessments)assessments.set(a.id,a);
  row.output={decisions:[],assessments:i.candidates.map((c:any)=>{assert(assessments.has(c.id),'Exact recorded candidate assessment required');return assessments.get(c.id)})};
 }
 await save();return row.output;}
const inf={curate:async(i:any)=>validateDecisions(await recorded(i)),resolveEntities:recorded,reconcile:async(i:any)=>validateCandidateAssessments(await recorded(i),i.candidates.map((c:any)=>c.id)),embed:(t:string[])=>real.embed(t)};
const m=new Memory(s,inf),w=new MemoryWorker(s,inf);for(const memory of [m,w.memory]){const entity=memory.entity.bind(memory);memory.entity=(...args)=>{const r=entity(...args);return {...r,id:map(r.id)}};}
const validate=w.validate.bind(w);w.validate=(...args)=>{try{return validate(...args)}catch(e:any){errors.push({code:e.code,message:e.message});throw e}};
const originals=snapshot.originals.map((r:any)=>s.one('SELECT * FROM memory_events WHERE id=?',r.event_pk)),e=originals[0],a={...s.one('SELECT * FROM principals WHERE id=?',e.principal_id),credential_id:e.credential_id};const oldJobs=originals.flatMap((e:any)=>s.all('SELECT * FROM memory_jobs WHERE event_pk=?',e.id)),oldChange=s.one("SELECT * FROM memory_changes WHERE id='change_900e67f4-9042-49e8-85cd-bad6e1172a72'");
s.run("UPDATE memory_jobs SET status='failed',lease_token=NULL,lease_until=NULL WHERE status IN ('running','retry','queued')");
try{
 for(const index of [2,3]){const t=originals[index];jobs.push(m.reprocess(a,'reaver',t.job_id,t.revision,'final_original_truth_source_copy'));}
 for(let index=0;index<jobs.length;index++){await w.runOnce();await save();}
 const sourceIds=new Set(originals.map((e:any)=>e.event_id));const graphs=[false,true].map(include_history=>{const g=memoryGraph(m,a,{agent_id:'reaver',query:'LDN7',include_history,limit:100});const edges=g.edges.filter((e:any)=>e.sources.some((x:any)=>sourceIds.has(x.event_id)));const ids=new Set(edges.flatMap((e:any)=>[e.source,e.target]));return {include_history,nodes:g.nodes.filter(n=>ids.has(n.id)),edges,changes:g.changes.filter((c:any)=>sourceIds.has(c.event_id))}});
 const custody=originals.every((e:any)=>{const after=s.one('SELECT * FROM memory_events WHERE id=?',e.id);return ['id','revision','content','roots_json','body_hash','occurred_at','observed_at','accepted_at','role','author_id','credential_id','principal_id'].every(k=>after[k]===e[k])})&&oldJobs.every((j:any)=>hash(JSON.stringify(j))===hash(JSON.stringify(s.one('SELECT * FROM memory_jobs WHERE id=?',j.id))))&&hash(JSON.stringify(oldChange))===hash(JSON.stringify(s.one('SELECT * FROM memory_changes WHERE id=?',oldChange.id)));
 const report={source_copy_not_native_acceptance:true,label,base_sha256:snapshot.private_snapshot_sha256,custody_preserved:custody,graphs,jobs:jobs.map(j=>s.one('SELECT id,status,error_code FROM memory_jobs WHERE id=?',j.job_id)),calls:calls.length,native_calls:nativeCalls,max_tokens:Math.max(...calls.map(c=>c.input_tokens)),identity_mapping:[...mapping]};await Bun.write(`evidence/original-truth-repair/FINAL-INTEGRATION.json`,JSON.stringify(report,null,2));
 assert(custody);assert(report.jobs.every(j=>j.status==='succeeded'),JSON.stringify(report.jobs));assert(n>=trace.calls.length);assert(calls.every(c=>c.input_tokens<=4096));
 const current=graphs[0],history=graphs[1];assert(!current.edges.some(e=>['memory_36a62b9d-b757-48ed-8f92-7a65303eabbd','memory_a826fdb2-4310-40e3-8b39-387d212bbc63','memory_94163b5d-e2de-4cfe-950c-e2d56fac632b'].includes(e.id)));
 assert(history.edges.some(e=>e.id==='memory_94163b5d-e2de-4cfe-950c-e2d56fac632b'&&e.status==='historical'&&e.valid_to==='2026-11-07T00:00:00.000Z'&&e.historical_start_unknown));
 const legacy=history.edges.find(e=>e.id==='memory_2d4241ab-1aea-41d4-a69e-e8e28bbd87d8');assert(legacy?.historical_start_unknown||legacy?.status==='superseded','Unsupported legacy start must not be endorsed');
 console.log(JSON.stringify({jobs:report.jobs,custody,calls:n,nativeCalls,max_tokens:report.max_tokens,identity_mapping:report.identity_mapping,typed_history:history.edges.find(e=>e.id==='memory_94163b5d-e2de-4cfe-950c-e2d56fac632b'),legacy}));
}finally{s.close()}
