// Same retained source/candidate snapshot; no new extraction or assistant recap evidence.
import assert from 'node:assert/strict';import {copyFileSync,existsSync,mkdirSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {Store,hash} from '../src/store.ts';import {Memory} from '../src/memory.ts';import {Inference} from '../src/inference.ts';
const base=process.argv[2]??'.private/original-truth-repair/current.sqlite',label=process.argv[3]??'recall';assert(base.startsWith('.private/original-truth-repair/'));assert(/^[a-z0-9-]+$/.test(label));
const dir=`.private/original-truth-repair/${label}`;assert(!existsSync(dir));mkdirSync(dir,{mode:0o700});copyFileSync(base,`${dir}/copy.sqlite`);
const original=execFileSync('git',['show','e0d2789f6715ead59276b1d391a4894b6d57e2d9:src/memory.ts'],{encoding:'utf8'});await Bun.write('.private/original-truth-repair/baseline-memory.ts',original.replace(/from (["'])\.\//g,'from $1../../src/'));
const {Memory:Baseline}=await import('../.private/original-truth-repair/baseline-memory.ts');
const s=new Store(`${dir}/copy.sqlite`),snapshot=await Bun.file('evidence/original-truth-repair/READONLY-CURRENT.json').json();const e=s.one('SELECT * FROM memory_events WHERE id=?',snapshot.originals[0].event_pk),a={...s.one('SELECT * FROM principals WHERE id=?',e.principal_id),credential_id:e.credential_id};
const native=s.one("SELECT content FROM memory_events WHERE event_id='native:reaver:36f5d578cea447d39d61d118a87bee1d:part:0'");assert(native?.content);const queries=[native.content,'Who does LDN7 Mira report to? Who owns LDN7 Lantern now, and what is its true color?'];
const real=new Inference(),results:any[]=[];const ids=new Set(snapshot.originals.map((r:any)=>r.event_id));
try{for(const query of queries){const vector=await real.embed([query]);for(const disabled of [false,true])for(const Engine of [Baseline,Memory])for(const originalOnly of [false,true]){
 const inf:any={embed:async()=>disabled?{vectors:[],model:'disabled'}:vector};const m=new Engine(s,inf);
 // A test-only evidence view: no mutation/removal of source, job, support or graph.
 if(originalOnly){const effective:any=m.effective.bind(m);m.effective=(...args:any[])=>{const r=effective(...args);if(!r)return r;const supports=r.supports.filter((x:any)=>ids.has(x.event_id)&&x.role==='user');return supports.length?{...r,supports}:null};}
 const r=await m.recall(a,{agent_id:'reaver',thread_id:'copy-recall-no-session',query,token_budget:1200});
 const relevant=r.memories.filter((m:any)=>m.supports.some((x:any)=>ids.has(x.event_id)));
 results.push({engine:Engine===Memory?'corrected':'baseline',disabled,original_only:originalOnly,query,context_sha256:hash(r.context),tokens:r.tokens_used,original_memories:relevant.map((m:any)=>({id:m.id,subject:m.subject,predicate:m.predicate,object:m.object,historical:m.historical??false,valid_from:m.valid_from,valid_to:m.valid_to,historical_start_unknown:m.historical_start_unknown??false,sources:m.supports.filter((x:any)=>ids.has(x.event_id))})),total_selected:r.memories.length,reporting:r.memories.some((m:any)=>m.id==='memory_2a0ddab2-4d0d-4dfd-b064-adad79b97b94'),context_messages:r.retrieval.context_messages_used});
 }}await Bun.write(`evidence/original-truth-repair/${label}.json`,JSON.stringify({base,source_copy_not_native_acceptance:true,results},null,2));console.log(JSON.stringify(results.map(r=>({engine:r.engine,disabled:r.disabled,original_only:r.original_only,tokens:r.tokens,reporting:r.reporting,original_ids:r.original_memories.map((m:any)=>m.id)})),null,2));
 assert(results.filter(r=>r.engine==='corrected').every(r=>r.reporting),'direct original-supported reporting must serve without recap');
}finally{s.close()}
