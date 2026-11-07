import {test,expect} from 'bun:test';
import {Store,now} from '../src/store.ts';
import {Memory,MemoryWorker,memoryTokens} from '../src/memory.ts';
import {memoryGraph} from '../src/memory-graph.ts';
import {validateReconciliations,normalizeReconciliation} from '../src/memory-reconciliation.ts';
import {resolvedIdentity,candidateIdentities} from '../src/memory-identity.ts';
import type {Decision} from '../src/inference.ts';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const jan='2026-01-01T00:00:00.000Z',feb='2026-02-01T00:00:00.000Z',mar='2026-03-01T00:00:00.000Z';
function fixture(path=':memory:'){
 const s=new Store(path),b=s.bootstrap('Synthetic relational regression'),a=s.authenticate(b.token);
 const calls:any[]=[];let decide=(i:any):Decision[]=>[],reconcile=(i:any):any=>[{index:0,duplicate_ids:[]}];
 const inf={async curate(i:any){calls.push(i);return {decisions:decide(i)}},async reconcile(i:any){calls.push(i);return reconcile(i)},async embed(t:string[]){return {vectors:t.map(()=>[1,0]),model:'deterministic-not-luna'}}};
 const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
 const event=(id:string,content='Synthetic domain source',time=jan,extra:any={})=>m.event(a,{client_id:'regression',event_id:id,revision:1,operation:'upsert',agent_id:'builder',thread_id:'scenario',role:'user',author_id:'alex',occurred_at:time,observed_at:now(),content,...extra});
 const decision=(id:string,extra:any={}):Decision=>({kind:'episode',scope:'agent:builder',subject:'LDN7 Lantern',predicate:'color',object:'amber',object_entity:false,valid_from:jan,valid_to:null,importance:.8,confidence:.95,evidence_event_ids:[id],...extra});
 const seed=async(id:string,extra:any={},time=jan)=>{const r=event(id,'Synthetic original source',time);await w.runOnce();const e=s.one('SELECT * FROM memory_events WHERE event_id=?',id);return {id:w.apply(e,decision(id,extra),undefined,'disabled',['agent:builder']),r,e}};
 const finish=async(id:string,ds:Decision[],resolve:(i:any)=>any,time=mar,content='Synthetic new source')=>{decide=()=>ds;reconcile=resolve;const r=event(id,content,time);await w.runOnce();expect(s.one('SELECT status,error_code FROM memory_jobs WHERE id=?',r.job_id)).toEqual({status:'succeeded',error_code:null});decide=()=>[];return r};
 const graph=(history=false)=>memoryGraph(m,a,{agent_id:'builder',include_history:history,valid_at:mar,limit:100});
 return {s,a,m,w,calls,event,decision,seed,finish,graph,set:(d:any,r:any)=>{decide=d;reconcile=r}};
}
test('atomic typed object entities include never-subject targets; literals stay literals; scope/scenario identities do not pool',async()=>{
 const f=fixture();try{
 await f.finish('atomic',[f.decision('atomic',{subject:'FEN9 Iona',predicate:'reports_to',object:'FEN9 Remy',object_entity:true}),f.decision('atomic',{subject:'FEN9 Iona',predicate:'maintains',object:'FEN9 Copper beacon',object_entity:true}),f.decision('atomic',{subject:'FEN9',predicate:'qualification',object:'fictional archive only',object_entity:false})],()=>[{index:0,duplicate_ids:[]}]);
 const g=f.graph();expect(g.edges.length).toBe(3);expect(g.nodes.find(n=>n.label==='FEN9 Remy')?.kind).toBe('entity');expect(g.nodes.find(n=>n.label==='FEN9 Copper beacon')?.kind).toBe('entity');
 const privateId=f.m.entity(f.a.workspace_id,'Private Mira',[{canonical:'Private Mira',aliases:['Mira']}],['agent:builder']).id;
 const shared=f.m.entity(f.a.workspace_id,'Mira',[],['business:alex']);expect(shared.id).not.toBe(privateId);expect(shared.label).toBe('Mira');
 const different=f.m.entity(f.a.workspace_id,'OTHER Mira',[{canonical:'OTHER Mira',aliases:['Mira']}],['agent:builder']);expect(different.id).not.toBe(privateId);
 await f.finish('literal',[f.decision('literal',{subject:'FEN9 Iona',predicate:'favorite_text',object:'FEN9 Remy',object_entity:false})],()=>[{index:0,duplicate_ids:[]}]);
 const literal=f.graph().edges.find(e=>e.predicate==='favorite_text')!;expect(f.graph().nodes.find(n=>n.id===literal.target)?.kind).toBe('literal');
 expect(f.calls.every(i=>memoryTokens(JSON.stringify(i))<=4096)).toBe(true);
 }finally{f.s.close()}
});
test('never-true correction targets all stale aliases/wordings, not the already-correct history narrative; unrelated/co-owner facts survive',async()=>{
 const f=fixture();try{
 const a=await f.seed('a',{predicate:'uses',object:'Cobalt, according to imaginary LDN7 only.'});
 const b=await f.seed('b',{subject:'Fictional LDN7 Lantern',object:'cobalt'});
 const narrative=await f.seed('n',{predicate:'color_history',object:'Earlier cobalt claim was mistaken; always amber.'});
 const other=await f.seed('o',{subject:'OTHER Lantern',object:'cobalt'});
 const owner=await f.seed('owner',{subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern',object_entity:true});
 await f.finish('correction',[f.decision('correction',{valid_from:mar})],i=>{
  expect(i.candidates.map((c:any)=>c.id)).toContain(a.id);expect(i.candidates.map((c:any)=>c.id)).toContain(b.id);
  return [{index:0,duplicate_ids:[],change:{type:'correction',target_ids:[a.id,b.id]}}];
 });
 const ids=f.graph().edges.map(e=>e.id);expect(ids).not.toContain(a.id);expect(ids).not.toContain(b.id);expect(ids).toContain(narrative.id);expect(ids).toContain(other.id);expect(ids).toContain(owner.id);
 expect(f.graph(true).edges.find(e=>e.id===a.id)?.status).toBe('corrected');expect(f.s.one('SELECT COUNT(*) n FROM memory_reconciliations').n).toBe(1);
 }finally{f.s.close()}
});
test('handover closes duplicate alias claims at actual effective date even before observation default; retains prior truth with unknown start',async()=>{
 const f=fixture();try{
 const a=await f.seed('a',{subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern launch',valid_from:mar},feb);
 const b=await f.seed('b',{subject:'Nola',predicate:'owner_of',object:'LDN7 Lantern',valid_from:jan});
 const co=await f.seed('co',{subject:'LDN7 Ada',predicate:'owns',object:'LDN7 Lantern',object_entity:true});
 await f.finish('handover',[f.decision('handover',{subject:'LDN7 Leda',predicate:'owns',object:'LDN7 Lantern',object_entity:true,valid_from:feb})],()=>[{index:0,duplicate_ids:[],change:{type:'state_change',target_ids:[a.id,b.id]}}]);
 expect(f.graph().edges.some(e=>e.id===a.id||e.id===b.id)).toBe(false);expect(f.graph().edges.some(e=>e.id===co.id)).toBe(true);
 const history=f.graph(true);expect(history.edges.find(e=>e.id===a.id)?.status).toBe('historical');expect(history.edges.find(e=>e.id===a.id)?.historical_start_unknown).toBe(true);expect(history.edges.find(e=>e.id===b.id)?.valid_to).toBe(feb);
 const recall=await f.m.recall(f.a,{agent_id:'builder',thread_id:'fresh',query:'LDN7 Nola owns Lantern launch previous',valid_at:mar,token_budget:4000});expect(recall.context).toContain('unknown start');
 }finally{f.s.close()}
});
test('late original reprocess cannot reopen a later-supported correction or handover; audit cites later original not delivery order',async()=>{
 const f=fixture();try{
 const old=await f.seed('old',{object:'cobalt'});const later=await f.seed('later',{object:'amber',valid_from:mar},mar);
 const custody=f.s.one('SELECT * FROM memory_events WHERE id=?',old.e.id),priorJob=f.s.one('SELECT * FROM memory_jobs WHERE id=?',old.r.job_id);
 f.set((i:any)=>[f.decision(i.event.event_id,{object:'cobalt'})],()=>[{index:0,duplicate_ids:[],superseded_by:{id:later.id,type:'correction',effective_at:mar}}]);
 const r=f.m.reprocess(f.a,'builder',old.r.job_id,1,'late_original_regression');await f.w.runOnce();expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?',r.job_id).status).toBe('succeeded');
 expect(f.graph().edges.some(e=>e.id===old.id)).toBe(false);expect(f.graph().edges.some(e=>e.id===later.id)).toBe(true);
 expect(f.s.one('SELECT event_pk FROM memory_changes WHERE target_id=?',old.id).event_pk).toBe(later.e.id);
 expect(f.s.one('SELECT * FROM memory_jobs WHERE id=?',old.r.job_id)).toEqual(priorJob);
 const after=f.s.one('SELECT * FROM memory_events WHERE id=?',old.e.id);for(const key of ['id','content','roots_json','accepted_at','occurred_at','body_hash'])expect(after[key]).toBe(custody[key]);
 }finally{f.s.close()}
});
test('semantic duplicate normalization preserves roots and prior correction; compatible co-owners remain separate',async()=>{
 const f=fixture();try{
 const a=await f.seed('a',{subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern, fictional scenario only'});
 await f.finish('normalize',[f.decision('normalize',{subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern',object_entity:true})],()=>[{index:0,duplicate_ids:[a.id]}]);
 const active=f.graph().edges.find(e=>e.predicate==='owns')!;expect(f.graph().edges.filter(e=>e.predicate==='owns')).toHaveLength(1);expect(active.sources.map((s:any)=>s.event_id).sort()).toEqual(['a','normalize']);
 expect(f.graph(true).edges.find(e=>e.id===a.id)?.status).toBe('superseded');
 await f.finish('addition',[f.decision('addition',{subject:'LDN7 Ada',predicate:'owns',object:'LDN7 Lantern',object_entity:true})],()=>[{index:0,duplicate_ids:[]}]);
 expect(f.graph().edges.filter(e=>e.predicate==='owns')).toHaveLength(2);
 }finally{f.s.close()}
});
test('reconciliation fences changed evidence after await, rejects unsupported IDs and preserves interval corrections',async()=>{
 const f=fixture();try{
 const a=await f.seed('a');
 await f.finish('interval',[f.decision('interval',{valid_from:feb})],()=>[{index:0,duplicate_ids:[],change:{type:'correction',aspect:'interval',target_ids:[a.id]}}]);
 expect(f.graph(true).edges.find(e=>e.id===a.id)?.status).toBe('corrected');
 f.set((i:any)=>[f.decision(i.event.event_id)],()=>[{index:0,duplicate_ids:['not-supplied']}]);const r=f.event('bad');await f.w.runOnce();expect(f.s.one('SELECT error_code FROM memory_jobs WHERE id=?',r.job_id).error_code).toBe('curator_target_violation');
 f.s.run("UPDATE memory_jobs SET status='failed' WHERE id=?",r.job_id);
 f.set((i:any)=>[f.decision(i.event.event_id)],()=>{f.s.run('DELETE FROM memory_supports WHERE memory_id=?',a.id);return [{index:0,duplicate_ids:[]}]});const changed=f.event('changed');await f.w.runOnce();expect(f.s.one('SELECT error_code FROM memory_jobs WHERE id=?',changed.job_id).error_code).toBe('curation_context_changed');
 expect(()=>validateReconciliations({items:[{index:0,duplicate_ids:['b'],superseded_by:{id:'b',type:'correction',effective_at:mar}}]},1)).toThrow();
 }finally{f.s.close()}
});
test('on-disk reopen migrates supported old aliases by scope, typed targets survive reopen and forget removes support/targets/audit',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'atlas-relational-'));let f=fixture(join(dir,'db.sqlite'));
 try{
 const a=await f.seed('old-alias',{subject:'LDN7 Nola'});const entity=f.s.one('SELECT subject_id FROM memories WHERE id=?',a.id).subject_id;
 f.s.run('INSERT INTO memory_aliases VALUES (?,?,?)',f.a.workspace_id,'nola',entity);const actor=f.a;f.s.close();
 const s=new Store(join(dir,'db.sqlite')),m=new Memory(s);try{
 expect(m.entity(actor.workspace_id,'Nola',[],['agent:builder']).id).toBe(entity);expect(m.entity(actor.workspace_id,'Nola',[],['business:alex']).id).not.toBe(entity);
 m.event(actor,{client_id:'regression',event_id:'old-alias',revision:2,operation:'delete',agent_id:'builder',thread_id:'scenario',role:'user',author_id:'alex',occurred_at:jan,observed_at:now()});
 expect(s.one('SELECT COUNT(*) n FROM memories').n).toBe(0);expect(s.one('PRAGMA foreign_key_check')).toBeNull();
 }finally{s.close()}
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('focused relation windows retain actual ownership targets amid duplicate long qualification narratives; duplicate and change can combine',async()=>{
 const f=fixture();try{
 const old=await f.seed('old-owner',{subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern launch; in the fictional archive only'});
 const correct=await f.seed('correct',{subject:'LDN7 Leda',predicate:'owns',object:'LDN7 Lantern',valid_from:feb,object_entity:true},feb);
 for(let n=0;n<24;n++)await f.seed('noise'+n,{subject:'LDN7 fictional archive '+n,predicate:'qualification',object:'LDN7 Leda and Lantern are fictional scenario labels. This source occurrence narrative is not an ownership assertion.'});
 await f.finish('window',[f.decision('window',{subject:'LDN7 Leda',predicate:'owns',object:'LDN7 Lantern',object_entity:true,valid_from:feb})],i=>{
  expect(i.candidates.some((c:any)=>c.id===old.id)).toBe(true);expect(i.candidates.some((c:any)=>c.id===correct.id)).toBe(true);
  expect(i.sources.length).toBeLessThanOrEqual(i.candidates.length*2);
  return [{index:0,duplicate_ids:[correct.id],change:{type:'state_change',target_ids:[old.id]}}];
 });
 expect(f.graph().edges.some(e=>e.id===old.id)).toBe(false);expect(f.graph(true).edges.find(e=>e.id===old.id)?.status).toBe('historical');
 }finally{f.s.close()}
});
test('focused sourced identities canonicalize launch wording before handover and late original reconciliation without merging namesakes',async()=>{
 const f=fixture();try{
 const old=await f.seed('launch',{subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern launch',object_entity:true});
 const later=await f.seed('new-owner',{subject:'LDN7 Leda',predicate:'owns',object:'LDN7 Lantern',object_entity:true,valid_from:feb},feb);
 f.w.inference.resolveEntities=async i=>({decisions:[],identity:{subject:i.incoming[0].subject,object:'LDN7 Lantern',entity_aliases:[{canonical:'LDN7 Lantern',aliases:['LDN7 Lantern launch']}]}});
 await f.finish('handover',[f.decision('handover',{subject:'LDN7 Leda',predicate:'owns',object:'LDN7 Lantern',object_entity:true,valid_from:feb})],i=>{
  expect(i.identity_aliases).toEqual([{canonical:'LDN7 Lantern',aliases:['LDN7 Lantern launch']}]);return [{index:0,duplicate_ids:[later.id],change:{type:'state_change',target_ids:[old.id]}}];
 });
 f.set((i:any)=>[f.decision(i.event.event_id,{subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern launch',object_entity:true})],()=>[{index:0,duplicate_ids:[old.id],superseded_by:{id:later.id,type:'state_change',effective_at:feb}}]);
 const retry=f.m.reprocess(f.a,'builder',old.r.job_id,1,'identity_late_original');await f.w.runOnce();expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?',retry.job_id).status).toBe('succeeded');
 expect(f.graph().edges.some(e=>f.s.one('SELECT subject FROM memories WHERE id=?',e.id).subject==='LDN7 Nola')).toBe(false);
 const h=f.graph(true);expect(h.edges.some(e=>e.status==='historical'&&e.valid_to===feb)).toBe(true);
 expect(()=>resolvedIdentity({identity:{subject:'Invented Nola',object:'LDN7 Lantern',entity_aliases:[]}},f.decision('x',{object_entity:true}),[])).toThrow();
 expect(()=>resolvedIdentity({identity:{subject:'LDN7 Lantern',object:'changed literal',entity_aliases:[]}},f.decision('x'),[])).toThrow();
 }finally{f.s.close()}
});
test('write-only shared scope still accepts new knowledge but supplies no unreadable reconciliation candidates',async()=>{
 const f=fixture();try{
 await f.seed('shared',{scope:'business:alex',subject:'Shared artifact',predicate:'owner',object:'Private existing value'});
 f.s.run("DELETE FROM memory_grants WHERE principal_id=? AND scope='business:alex' AND action='read'",f.a.id);
 await f.finish('write-only',[f.decision('write-only',{scope:'business:alex',subject:'Shared artifact',predicate:'location',object:'warehouse'})],i=>{expect(i.candidates).toEqual([]);return [{index:0,duplicate_ids:[]}]});
 expect(f.s.one("SELECT COUNT(*) n FROM memories WHERE scope='business:alex'").n).toBe(2);
 }finally{f.s.close()}
});
test('identity proof is scoped and recorded, actor retargeting is quarantined, and forgetting removes alias/equivalence proof',async()=>{
 const f=fixture();try{
 const old=await f.seed('old-artifact',{subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern launch',object_entity:true});
 const later=await f.seed('later-artifact',{subject:'LDN7 Leda',predicate:'owns',object:'LDN7 Lantern',object_entity:true,valid_from:feb},feb);
 const target=f.s.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=?',old.id).entity_id;
 const canonical=f.s.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=?',later.id).entity_id;
 const before=now();await Bun.sleep(2);
 f.w.inference.resolveEntities=async i=>({identity:{subject:i.incoming[0].subject,object:i.incoming[0].object,entity_aliases:[]},candidate_identities:[{id:old.id,object:'LDN7 Lantern'}]});
 await f.finish('proof',[f.decision('proof',{subject:'LDN7 Leda',predicate:'owns',object:'LDN7 Lantern',object_entity:true,valid_from:feb})],i=>{expect(i.candidates.find((c:any)=>c.id===old.id).object).toBe('LDN7 Lantern');return [{index:0,duplicate_ids:[later.id],change:{type:'state_change',target_ids:[old.id]}}]});
 expect(f.m.canonicalEntity(f.a.workspace_id,'agent:builder',target)).toBe(canonical);expect(f.m.canonicalEntity(f.a.workspace_id,'business:alex',target)).toBe(target);expect(f.m.canonicalEntity(f.a.workspace_id,'agent:builder',target,before)).toBe(target);
 const rejected=candidateIdentities({candidate_identities:[{id:later.id,subject:'LDN7 Nola',object:'LDN7 Lantern'}]},f.decision('x',{object:'LDN7 Lantern',object_entity:true}),[{id:later.id,subject:'LDN7 Leda',object:'LDN7 Lantern'}],{content:'LDN7 Leda and LDN7 Nola are different owners'});
 expect(rejected[0].subject).toBeUndefined();expect(rejected[0].rejected_subject).toBe('LDN7 Nola');
 f.event('proof','',mar,{revision:2,operation:'delete'});expect(f.m.canonicalEntity(f.a.workspace_id,'agent:builder',target)).toBe(target);expect(f.s.one('SELECT COUNT(*) n FROM memory_entity_equivalences').n).toBe(0);
 const alias=await f.seed('alias',{subject:'LDN7 Remy',entity_aliases:[{canonical:'LDN7 Remy',aliases:['Reviewer R']}],predicate:'role',object:'reviewer'});
 await f.seed('independent',{subject:'LDN7 Remy',predicate:'role',object:'reviewer'});
 const actor=f.m.entity(f.a.workspace_id,'Reviewer R',[],['agent:builder']).id;expect(actor).toBe(f.s.one('SELECT subject_id FROM memories WHERE id=?',alias.id).subject_id);
 f.event('alias','',mar,{revision:2,operation:'delete'});expect(f.m.entity(f.a.workspace_id,'Reviewer R',[],['agent:builder']).id).not.toBe(actor);
 }finally{f.s.close()}
});
test('canonical same-claim same-interval state output normalizes to duplicate, not false handover; distinct actors and dates do not',()=>{
 const d={subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern',valid_from:jan,valid_to:null};
 const candidates=[{id:'same',...d},{id:'co-owner',...d,subject:'LDN7 Ada'},{id:'other-date',...d,valid_from:feb}];
 const r=normalizeReconciliation({index:0,duplicate_ids:[],change:{type:'state_change',target_ids:['same','co-owner','other-date']}},d,candidates);
 expect(r.duplicate_ids).toEqual(['same']);expect(r.change?.target_ids).toEqual(['co-owner','other-date']);expect(r.normalized_duplicate_ids).toEqual(['same']);
});
test('three phase packing reserves headroom and advances oversized Unicode without changing accepted source',async()=>{
 const f=fixture();try{
 const content='Synthetic scope context. '+ '象🐘'.repeat(1800);
 f.set((i:any)=>[f.decision(i.event.event_id,{subject:'Synthetic scope context',predicate:'has_fragment',object:'selected fragment',valid_from:jan})],()=>[{index:0,duplicate_ids:[]}]);
 f.w.inference.resolveEntities=async i=>({identity:{subject:i.incoming[0].subject,object:i.incoming[0].object,entity_aliases:[]}});
 const receipt=f.event('large',content);let count=0;
 while(f.s.one('SELECT status FROM memory_jobs WHERE id=?',receipt.job_id).status!=='succeeded'&&count++<64)await f.w.runOnce();
 expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?',receipt.job_id).status).toBe('succeeded');expect(count).toBeGreaterThan(1);expect(f.s.one("SELECT content FROM memory_events WHERE event_id='large'").content).toBe(content);
 expect(f.calls.every(i=>memoryTokens(JSON.stringify(i))<=4096)).toBe(true);
 }finally{f.s.close()}
});
test('repeated alias-format reconciliation preserves a positive prior state instead of supersession cycles hiding every representation',async()=>{
 const f=fixture();try{
 const old=await f.seed('old-format',{subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern launch',object_entity:true});
 await f.finish('normalize-format',[f.decision('normalize-format',{subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern',object_entity:true})],()=>[{index:0,duplicate_ids:[old.id]}]);
 const normalized=f.s.one("SELECT * FROM memories WHERE object='LDN7 Lantern'");
 await f.finish('next-owner',[f.decision('next-owner',{subject:'LDN7 Leda',predicate:'owns',object:'LDN7 Lantern',object_entity:true,valid_from:feb})],()=>[{index:0,duplicate_ids:[],change:{type:'state_change',target_ids:[normalized.id]}}]);
 const before=now();await Bun.sleep(2);
 f.set((i:any)=>[f.decision(i.event.event_id,{subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern launch',object_entity:true})],()=>[{index:0,duplicate_ids:[normalized.id],superseded_by:{id:f.s.one("SELECT id FROM memories WHERE subject='LDN7 Leda'").id,type:'state_change',effective_at:feb}}]);
 const retry=f.m.reprocess(f.a,'builder',old.r.job_id,1,'prior_truth_format');await f.w.runOnce();expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?',retry.job_id).status).toBe('succeeded');
 expect(f.graph().edges.some(e=>e.id===old.id)).toBe(false);expect(f.graph(true).edges.find(e=>e.id===old.id)?.status).toBe('historical');expect(f.graph(true).edges.find(e=>e.id===old.id)?.valid_to).toBe(feb);
 expect(f.s.one("SELECT COUNT(*) n FROM memory_changes WHERE target_id=? AND type='restored'",old.id).n).toBe(1);
 expect(memoryGraph(f.m,f.a,{agent_id:'builder',include_history:true,valid_at:mar,recorded_at:before}).edges.find(e=>e.id===old.id)?.status).toBe('superseded');
 const r=await f.m.recall(f.a,{agent_id:'builder',thread_id:'fresh',query:'LDN7 Nola owns Lantern launch previous',valid_at:mar,token_budget:4000});expect(r.memories.some(m=>m.id===old.id&&m.historical)).toBe(true);
 }finally{f.s.close()}
});
