import {test,expect} from 'bun:test';
import {Store,now} from '../src/store.ts';
import {Memory,MemoryWorker} from '../src/memory.ts';
import {memoryGraph} from '../src/memory-graph.ts';
import {recallTemporalQualifier} from '../src/recall-presentation.ts';

// Synthetic source-linked fixtures. Embeddings intentionally overmatch to expose
// admission/expansion bugs; no real owner source or private diagnostics here.
function fixture(){
 const s=new Store(':memory:'),b=s.bootstrap('Focused presentation regression'),a=s.authenticate(b.token);
 const inf={async curate(){throw Error('no curation in recall')},async embed(texts:string[]){return {vectors:texts.map(()=>[1,0]),model:'focused-presentation-double'}}};
 const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
 const seed=(subject:string,predicate:string,object:string,extra:any={})=>{
  const event_id=`synthetic-${s.one('SELECT COUNT(*) n FROM memory_events').n}`,at=extra.at??'2026-01-01T00:00:00.000Z';
  m.event(a,{client_id:'focused-presentation',event_id,revision:1,operation:'upsert',agent_id:'builder',thread_id:'fixture',role:'user',author_id:'alex',occurred_at:at,observed_at:now(),content:`Synthetic: ${subject} ${predicate} ${object}`});
  const e=s.one('SELECT * FROM memory_events WHERE event_id=?',event_id);
  return w.apply(e,{kind:'assertion',scope:extra.scope??'user:alex',subject,predicate,object,object_entity:extra.entity??false,valid_from:at,valid_to:extra.end??null,importance:.8,confidence:.9,evidence_event_ids:[event_id]},[1,0],'focused-presentation-double',['user:alex','business:alex','agent:builder','agent:overwatch']);
 };
 const recall=(query:string,extra:any={})=>m.recall(a,{agent_id:'builder',thread_id:'focused-regression',query,token_budget:1200,...extra});
 return {s,a,m,seed,recall};
}
for(const product of ['atlas','beacon'])test(`functional ${product} check does not become a career overview`,async()=>{
 const f=fixture();try{
  const own=f.seed(product,'builds','prompt packet');
  f.seed('Robin','worked_at','Old Company');f.seed('Robin','plans_work_trial_with','New Company',{entity:true});
  f.seed('Advertising task','goal','Manage read/write Ads');f.seed('Agent','working_on','Unrelated lineage repair');
  const spouse=f.seed('Robin','is_married_to','Casey',{entity:true});
  const r=await f.recall(`do a little check on ${product} to see if it is working as expected or if any issues`);
  expect(r.retrieval.focus.topics).not.toContain('work');
  expect(r.memories.map(x=>x.id)).toEqual([own]);expect(r.token_budget).toBe(1200);
  const large=await f.recall(`Is ${product} working correctly?`,{token_budget:8000});
  expect(large.memories.map(x=>x.id)).toEqual([own]);
  const session=await f.recall(`do a little check on ${product} to see if it is working as expected or if any issues`,{session_start:true});
  expect(session.memories.map(x=>x.id)).toContain(spouse);
  expect(session.memories.map(x=>x.id)).toContain(own);
 }finally{f.s.close()}
});
test('plan qualifiers use source observation, not processing time, and do not relabel standing requirements or conflict/history',()=>{
 const base={predicate:'expects_remote_work_trial_with',valid_from:'2026-06-01T00:00:00.000Z',supports:[{occurred_at:'2026-01-01T00:00:00.000Z'}]};
 expect(recallTemporalQualifier(base)).toBe('PLAN/EXPECTATION as of 2026-01-01; fulfillment unverified');
 expect(recallTemporalQualifier({...base,predicate:'expects_contextual_memory_retrieval'})).toBeNull();
 expect(recallTemporalQualifier({...base,historical:true})).toBeNull();
 expect(recallTemporalQualifier({...base,conflict:true})).toBeNull();
});
test('spouse and child slots exclude sibling, task prose, generic parent mentions and same-owner expansions',async()=>{
 const f=fixture();try{
  const spouse=f.seed('Alex','is_married_to','Casey',{entity:true}),child=f.seed('Alex','parent_of','Jamie',{entity:true});
  f.seed('Alex','has_sibling','Taylor',{entity:true});
  f.seed('Alex','requested_improvements_to','Connect memory retrieval to family relationships');
  f.seed('Ads task','remains_gated_on','Operations parent');f.seed('Repair task','has_owner_requirement','Preserve family and career history');
  f.seed('Morgan','is_married_to','Sky',{entity:true});
  const r=await f.recall("Who are Alex's spouse and child?");
  expect(new Set(r.memories.map(x=>x.id))).toEqual(new Set([spouse,child]));
  const broad=await f.recall('Tell me about my family');
  expect(broad.memories.some(x=>x.predicate==='has_sibling')).toBe(true);
  expect(broad.memories.some(x=>['requested_improvements_to','remains_gated_on','has_owner_requirement'].includes(x.predicate))).toBe(false);
 }finally{f.s.close()}
});
test('current company relationship ranks state first and labels source-dated plans without changing graph truth',async()=>{
 const f=fixture();try{
  const plan=f.seed('Alex','plans_work_trial_with','Paradev',{entity:true});
  const call=f.seed('Alex','has_final_call_with','Paradev',{entity:true});
  const state=f.seed('Alex','on_trial_with','Paradev',{entity:true,at:'2026-02-01T00:00:00.000Z'});
  f.seed('Alex','expects_future_onsite_with','Paradev',{entity:true});
  f.seed('Alex','received_offer_from','Paradev',{entity:true});
  f.seed('Alex','signed_up_for','Paradev');f.seed('Paradev account','sidebar_displayed_name','Alex');
  f.seed('Ads task','goal','Paradev advertising');f.seed('Alex','on_trial_with','Elsewhere',{entity:true});
  f.seed('Alex','is_married_to','Casey',{entity:true});
  const before=memoryGraph(f.m,f.a,{agent_id:'builder',query:'Paradev',include_history:true,limit:100});
  const r=await f.recall("What is Alex's current relationship with Paradev?");
  expect(r.memories[0].id).toBe(state);
  expect(r.memories.some(x=>x.id===plan||x.id===call)).toBe(true);
  expect(r.context).toContain('PLAN/EXPECTATION as of 2026-01-01; fulfillment unverified');
  expect(r.context).not.toMatch(/plans_work_trial_with[^\n]*\(since/);
  expect(r.memories.every(x=>!['signed_up_for','sidebar_displayed_name','goal','is_married_to'].includes(x.predicate)&&x.object!=='Elsewhere')).toBe(true);
  const after=memoryGraph(f.m,f.a,{agent_id:'builder',query:'Paradev',include_history:true,limit:100});
  expect(after.edges).toEqual(before.edges);expect(after.changes).toEqual(before.changes);
  const history=await f.recall("What was Alex's previous relationship with Paradev? Include history.");
  expect(history.memories.some(x=>x.id===plan)).toBe(true);
  expect(history.memories.find(x=>x.id===plan)!.supports[0].event_id).toBeTruthy();
 }finally{f.s.close()}
});
test('broad session/profile remains intentional, closed history remains labelled, private scope stays out',async()=>{
 const f=fixture();try{
  f.seed('Robin','is_married_to','Casey',{entity:true});f.seed('Robin','parent_of','Jamie',{entity:true});
  f.seed('Robin','job_title','Engineer');f.seed('Robin','knows_basic','French');
  f.seed('Robin','maintains','Beacon',{entity:true,scope:'business:alex'});
  f.seed('Robin','job_title','Old role',{end:'2026-02-01T00:00:00.000Z'});
  f.seed('Private Sentinel','goal','Beacon secret',{scope:'agent:overwatch'});
  const session=await f.recall('Hey',{session_start:true});
  expect(session.memories.some(x=>x.predicate==='is_married_to')).toBe(true);
  expect(session.memories.some(x=>x.predicate==='parent_of')).toBe(true);
  const profile=await f.recall('What do you know about me?');
  for(const p of ['is_married_to','parent_of','job_title','knows_basic','maintains'])expect(profile.memories.some(x=>x.predicate===p)).toBe(true);
  const history=await f.recall("What was Robin's previous job role? Include history.");
  expect(history.context).toContain('HISTORICAL');
  for(const r of [session,profile,history,await f.recall('Check Beacon')])expect(r.memories.every(x=>x.scope!=='agent:overwatch')).toBe(true);
  expect((await f.recall('Check Beacon',{token_budget:0})).memories).toEqual([]);
 }finally{f.s.close()}
});
