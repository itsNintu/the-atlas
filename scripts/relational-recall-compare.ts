// Readonly final-engine integration of the helper's concrete predicate-prune finding.
import {Database} from 'bun:sqlite';import {Store,hash} from '../src/store.ts';import {Inference} from '../src/inference.ts';import {Memory} from '../src/memory.ts';import assert from 'node:assert/strict';
const baselinePath=new URL('../.private/relational-prune-baseline.ts',import.meta.url);
if(!await Bun.file(baselinePath).exists()){
 const source=await Bun.file(new URL('../src/memory.ts',import.meta.url)).text();
 await Bun.write(baselinePath,source.replaceAll('from "./','from "../src/').replaceAll("from './","from '../src/").replace('!usefulFacet(ranked[i])',"!queryTerms(ranked[i].predicate.replaceAll('_',' ')).some(p => ts.some(t => matches([p],t)))"));
}
const {Memory:Baseline}=await import(baselinePath.href);
const helper=await Bun.file('evidence/recall-focus-repair/READONLY-COMPARISON.json').json();
const db=new Database('/home/alex/.local/share/the-atlas/atlas.sqlite',{readonly:true});const s=Object.create(Store.prototype) as Store;s.db=db;let writes=0,embeds=0;const cache=new Map<string,any>();
s.run=(sql:string)=>{if(!sql.startsWith('INSERT INTO memory_recalls'))throw Error('write forbidden');writes++;return {} as any};
const real=new Inference(),inf={async curate(){throw Error('curation forbidden')},async embed(texts:string[]){const key=JSON.stringify(texts);if(!cache.has(key)){embeds++;cache.set(key,await real.embed(texts))}return cache.get(key)}};
const lexical={async curate(){throw Error('curation forbidden')},async embed(){return {vectors:[],model:'disabled'}}};
const summary=(r:any)=>({tokens:r.tokens_used,ids:r.memories.map((m:any)=>m.id),scores:r.memories.map((m:any)=>({id:m.id,lexical:m.lexical,semantic:m.semantic,roles:m.supports.map((p:any)=>p.role)})),context_sha256:hash(r.context),pending:r.pending_events.length});
db.exec('BEGIN');try{
 const a=s.one("SELECT p.*,c.id credential_id FROM principals p JOIN credentials c ON c.principal_id=p.id JOIN memory_bindings b ON b.principal_id=p.id WHERE b.agent_id='reaver' AND c.revoked_at IS NULL LIMIT 1");assert(a);const comparisons:any[]=[];const current=new Date().toISOString();
 for(const c of helper.comparisons){const at=c.case==='FEN9-original-pre-capture'?'2026-11-07T13:41:57.500Z':current,request={agent_id:'reaver',thread_id:'readonly-final-integration',query:c.original_query,token_budget:1200,valid_at:at,recorded_at:at,recent_context:[]},provider=c.case==='lexical-only-nonadjacent'?lexical:inf;
 const before=await new Baseline(s,provider).recall(a,request),after=await new Memory(s,provider).recall(a,request);comparisons.push({case:c.case,recorded_at:at,before:summary(before),after:summary(after)});
 }
 const original=await Bun.file('/mnt/d/Work/Operations/hermes/atlas-native/activation/selection/OUTCOME-RECEIPT.json').json(),ids=original.fixtures.FEN9.memories.map((m:any)=>m.id),use=comparisons.find(c=>c.case==='FEN9-current-use');
 for(const id of ids)assert(use.after.ids.includes(id));for(const id of ['memory_05b08881-05cc-48b4-a211-8ac0d9f22527','memory_875228bc-41be-4023-856b-5f0b4352a550'])assert(!use.after.ids.includes(id));
 assert.equal(comparisons.find(c=>c.case==='FEN9-original-pre-capture').after.tokens,0);assert.equal(comparisons.find(c=>c.case==='QZX8-exact').after.tokens,0);assert(comparisons.every(c=>c.after.pending===0));assert.equal(writes,comparisons.length*2);
 const report={at:current,readonly:true,same_read_transaction:true,receipt_writes_intercepted:writes,curation_calls:0,new_native_sessions:0,embedding_calls:embeds,helper_sha256:hash(await Bun.file('src/recall-query.ts').text()),baseline_sha256:hash(await Bun.file('.private/relational-prune-baseline.ts').text()),engine_sha256:hash(await Bun.file('src/memory.ts').text()),original_fen9_ids:ids,comparisons};
 await Bun.write('.private/relational-readonly.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pairs:comparisons.length,intercepted:writes,results:comparisons.map(c=>({case:c.case,before:c.before.tokens,after:c.after.tokens}))},null,2));
}finally{db.exec('ROLLBACK');db.close()}
