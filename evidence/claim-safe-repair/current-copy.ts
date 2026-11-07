import {copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Store,canonical,hash,now} from '../../src/store.ts';
import {Memory,MemoryWorker,memoryTokens} from '../../src/memory.ts';
import {Inference} from '../../src/inference.ts';
import {memoryGraph} from '../../src/memory-graph.ts';
import {repairPlan,repairReconciliation} from '../../src/memory-repair.ts';
import {consistentReconciliation} from '../../src/memory-truth.ts';
const privateDir='/home/alex/.local/share/the-atlas/source-probes/t_c3cd6ab0';
const prestate=privateDir+'/current.sqlite',copy=privateDir+'/integration.sqlite';
copyFileSync(prestate,copy);const prestate_sha256=createHash('sha256').update(readFileSync(prestate)).digest('hex');
const s=new Store(copy),originalJob='mjob_f7df693a-b393-4944-8af8-8874fe402838';
const e=s.one('SELECT e.* FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk WHERE j.id=?',originalJob);
const a=s.one('SELECT p.*,c.id AS credential_id FROM principals p JOIN credentials c ON c.principal_id=p.id WHERE c.id=?',e.credential_id);
process.env.THE_ATLAS_EMBED_URL='http://127.0.0.1:8788/v1/embed';
process.env.THE_ATLAS_EMBEDDING_MODEL='sentence-transformers/all-MiniLM-L6-v2';
const inf=new Inference(),m=new Memory(s,inf),w=new MemoryWorker(s,inf);
const ids={reporting:'memory_2a0ddab2-4d0d-4dfd-b064-adad79b97b94',raw_reporting:'memory_0f30a228-b97c-45b5-851a-d95441e81423',prior_owner:'memory_94163b5d-e2de-4cfe-950c-e2d56fac632b',owner:'memory_c11e1ee2-cc69-490c-853e-f7b2dd630761',reviewer:'memory_ab36996d-8abe-497d-8b9c-1d20196a37d8',cobalt:'memory_36a62b9d-b757-48ed-8f92-7a65303eabbd'};
const graph=(recorded_at=now())=>memoryGraph(m,a,{agent_id:'reaver',query:'LDN7',include_history:true,recorded_at,limit:100});
const status=(g:any)=>Object.fromEntries(Object.entries(ids).map(([k,id])=>{const edge=g.edges.find((x:any)=>x.id===id);return [k,edge?{id,status:edge.status,valid_to:edge.valid_to,historical_start_unknown:edge.historical_start_unknown??false}:null]}));
const assert=(ok:any,message:string)=>{if(!ok)throw Error(message)};
const before=now(),beforeGraph=graph(before),custody=hash(canonical({events:s.all('SELECT * FROM memory_events'),jobs:s.all('SELECT * FROM memory_jobs'),changes:s.all('SELECT * FROM memory_changes')}));
assert(beforeGraph.edges.find(x=>x.id===ids.reporting)?.status==='historical','prestate damaged reporting');
const rows=s.all('SELECT * FROM memory_reconciliations WHERE job_id=?',originalJob),prevented=rows.map(row=>{
 const original=JSON.parse(row.disposition_json),candidates=m.candidates(a.workspace_id,['agent:reaver'],'LDN7 Mira Nola Lantern owns reporting',24),safe=consistentReconciliation(original,ids=>w.claimGroupTargets(ids,candidates));
 return {memory_id:row.memory_id,blocked:safe.blocked_dispositions??[],remaining_changes:safe.changes??[]};
});
await Bun.sleep(2);const plan=repairPlan(m,a,'reaver',originalJob,1);
const repair=repairReconciliation(m,a,{agent_id:'reaver',expected_revision:1,expected_proof_sha256:plan.proof_sha256,change_ids:plan.change_ids,reason_code:'compiled_unaffected_conflict'},originalJob);
const after=graph();
assert(after.edges.find(x=>x.id===ids.reporting)?.status==='active','reporting restored');assert(after.edges.find(x=>x.id===ids.prior_owner)?.status==='historical','ended owner stays historical');assert(after.edges.find(x=>x.id===ids.prior_owner)?.valid_to==='2026-11-07T00:00:00.000Z','owner cutoff unchanged');assert(after.edges.find(x=>x.id===ids.cobalt)?.status==='corrected','original cobalt stays corrected');
assert(graph(before).edges.find(x=>x.id===ids.reporting)?.status==='historical','pre-repair recorded state retained');
assert(hash(canonical({events:s.all('SELECT * FROM memory_events'),jobs:s.all('SELECT * FROM memory_jobs'),changes:s.all('SELECT * FROM memory_changes')}))===custody,'custody byte values retained');
const query='In the fictional LDN7 archive, who owns Lantern now, who owned it before, and was cobalt ever its true color? Also, who does Mira report to, and who reviews the checklist? If no relevant memory is supplied, say you lack evidence. Answer from automatically supplied context only. Do not call tools, browse or save memory.';
const recall=[];
for(const strategy of ['minilm','lexical-only']) {
 const memory=strategy==='minilm'?m:new Memory(s,{async curate(){throw Error('no curation allowed')},async embed(){return {vectors:[],model:'disabled'}}});
 for(const [label,q] of [['original',query],['irrelevant','Explain Neptune orbital eccentricity and trigonometry']]) {
 const r=await memory.recall(a,{agent_id:'reaver',thread_id:'source-copy-check',query:q,token_budget:1200});
 if(label==='original') {
 assert(r.memories.some(x=>x.id===ids.reporting&&!x.historical),'packet current direct reporting');assert(r.context.includes('never-true')&&r.context.toLowerCase().includes('never cobalt')&&r.context.includes('always used amber'),'packet correction meaning');
 assert(!r.memories.some(x=>x.id===ids.cobalt),'no false positive cobalt');for(const id of [ids.owner,ids.reviewer,ids.prior_owner])assert(r.memories.some(x=>x.id===id),'required facet '+id);
 assert(r.memories.find(x=>x.id===ids.reporting)?.supports.some((x:any)=>x.role==='user'),'direct original reporting authority');
 writeFileSync(privateDir+'/packet-'+strategy+'.txt',r.context);
 } else assert(!r.context,'irrelevant packet empty');
 recall.push({strategy,label,context_sha256:hash(r.context),tokens:r.tokens_used??memoryTokens(r.context),pending_events:r.pending_events.length,retrieval:r.retrieval,ids:r.memories.map(x=>x.id),corrections:r.memories.flatMap(x=>x.corrections??[]),flags:{current_reporting:r.memories.some(x=>x.id===ids.reporting&&!x.historical),never_true:r.context.includes('never-true'),always_amber:r.context.includes('always used amber'),never_cobalt:r.context.toLowerCase().includes('never cobalt')}});
 }
}
const result={method:'Exact current readonly snapshot, copied-only supported repair; real resident MiniLM query embeddings and lexical fallback; NO new extraction/native session/model-curation calls',prestate_sha256,prestate_copy:prestate,at:now(),before:status(beforeGraph),after:status(after),plan,repair,prevented,old_sources_jobs_changes_unchanged:true,recorded_history_retained:true,recall};
writeFileSync('evidence/claim-safe-repair/CURRENT-COPY.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));s.close();
