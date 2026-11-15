import {test,expect} from 'bun:test';
import {Store,now} from '../src/store.ts';
import {Memory,MemoryWorker} from '../src/memory.ts';
import {Inference} from '../src/inference.ts';
import {QueryEmbeddingCache} from '../src/query-embedding.ts';
import {nativeMemory} from '../src/recall-delivery.ts';
import {recallFreshness,freshnessSQL} from '../src/memory-freshness.ts';
import {resetDerivedBrain} from '../src/derived-reset.ts';

const at='2026-01-01T00:00:00.000Z';
function fixture(){
 const s=new Store(':memory:'),boot=s.bootstrap('Latency synthetic'),a=s.authenticate(boot.token);
 let calls=0,identity='v1';const inputs:string[]=[];
 const inf={async curate(){throw Error('No model curation in regression')},embeddingIdentity:()=>identity,async embed(texts:string[]){calls++;inputs.push(...texts);return {vectors:texts.map(()=>[1,0]),model:'synthetic-v1'}}};
 const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
 const event=(event_id:string,extra:any={})=>m.event(a,{client_id:'latency',event_id,revision:1,operation:'upsert',agent_id:'builder',thread_id:'synthetic',role:'user',author_id:'alex',occurred_at:at,observed_at:now(),content:'Synthetic owner evidence',...extra});
 const seed=(predicate:string,object:string,extra:any={})=>{
  const event_id=`seed-${s.one('SELECT COUNT(*) n FROM memory_events').n}`;event(event_id);
  const e=s.one('SELECT * FROM memory_events WHERE event_id=?',event_id);
  const id=w.apply(e,{kind:'assertion',scope:'user:alex',subject:'Alex',predicate,object,object_entity:false,valid_from:at,valid_to:null,importance:.8,confidence:.9,evidence_event_ids:[event_id],...extra},[1,0],'synthetic-v1',['user:alex','agent:builder']);
  return {id,event_id,e};
 };
 const recall=(query="Who is Alex's spouse?",extra:any={})=>m.recall(a,{agent_id:'builder',thread_id:'latency-query',query,token_budget:1200,...extra});
 return {s,a,m,w,inf,inputs,event,seed,recall,calls:()=>calls,rotate:()=>identity='v2'};
}

test('exact embeddings coalesce, clone vectors, expire at boundary, evict LRU, isolate scopes/config/instances',async()=>{
 let clock=0,calls=0,release!:()=>void;let identity='a';
 const cache=new QueryEmbeddingCache(()=>clock,100,2,2);
 const inf={curate:async()=>({decisions:[]}),embeddingIdentity:()=>identity,embed:async()=>{calls++;await new Promise<void>(r=>release=r);return {vectors:[[1,0]],model:'actual-model'}}};
 const first=cache.get(inf,['w','p','a'],'exact'),second=cache.get(inf,['w','p','a'],'exact');
 expect(calls).toBe(1);release();const [a,b]=await Promise.all([first,second]);expect([a.cache,b.cache]).toEqual(['miss','coalesced']);
 a.vectors[0]![0]=9;expect((await cache.get(inf,['w','p','a'],'exact')).vectors).toEqual([[1,0]]);
 clock=100;const expired=cache.get(inf,['w','p','a'],'exact');release();expect((await expired).cache).toBe('miss');
 const load=async(scope:any,q:string)=>{const pending=cache.get(inf,scope,q);release();return pending;};
 expect((await load(['w','other','a'],'exact')).cache).toBe('miss');
 await cache.get(inf,['w','p','a'],'exact'); // refresh LRU
 await load(['w','p','a'],'different');
 expect((await load(['w','other','a'],'exact')).cache).toBe('miss');
 identity='b';expect((await load(['w','p','a'],'exact')).cache).toBe('miss');
 const other={...inf};const pending=cache.get(other,['w','p','a'],'exact');release();expect((await pending).cache).toBe('miss');
 expect(calls).toBe(7);
});
test('embedding failures, invalid vectors and disabled results are not cached; in-flight retention is bounded',async()=>{
 const cache=new QueryEmbeddingCache(()=>0,100,2,1);let calls=0;
 const inf={curate:async()=>({decisions:[]}),embed:async()=>{calls++;throw Error('upstream')}};
 await expect(cache.get(inf,'p','q')).rejects.toThrow();await expect(cache.get(inf,'p','q')).rejects.toThrow();expect(calls).toBe(2);
 for(const vectors of [[],[[0,0]],[[NaN,1]]]){
  const inf={curate:async()=>({decisions:[]}),embed:async()=>{calls++;return {vectors,model:'test'}}};
  for(let i=0;i<2;i++){try{await cache.get(inf,'p','q')}catch{}}
 }
 expect(calls).toBe(8);
 let release!:()=>void;const slow={curate:async()=>({decisions:[]}),embed:async()=>{await new Promise<void>(r=>release=r);return {vectors:[[1,0]],model:'test'}}};
 const pending=cache.get(slow,'p','one');const fast={...slow,embed:async()=>({vectors:[[1,0]],model:'test'})};
 expect((await cache.get(fast,'p','two')).cache).toBe('bypass');release();await pending;
 expect((await cache.get(fast,'p','two')).cache).toBe('miss');
});
test('production embedding identity changes with model/route/credentials and disabled configuration',()=>{
 const names=['EMBEDDING_MODEL','EMBED_URL','EMBED_COMMAND','INFERENCE_COMMAND','PROVIDER_BASE_URL','PROVIDER_API_KEY','EMBEDDING_DISABLED'];
 const original=Object.fromEntries(names.map(x=>[x,process.env['THE_ATLAS_'+x]]));const inf=new Inference();
 try{for(const name of names){const before=inf.embeddingIdentity();process.env['THE_ATLAS_'+name]='synthetic-'+name;expect(inf.embeddingIdentity()).not.toBe(before);}}
 finally{for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env['THE_ATLAS_'+key];else process.env['THE_ATLAS_'+key]=value;}}
});
test('thin startup uses exact continuity predicate with no discarded embedding/index; substantive startup remains semantic',async()=>{
 const f=fixture();try{
  f.seed('is_married_to','Casey');f.seed('lives_in','Harborland');f.seed('maintains','Beacon');
  const greeting=await f.recall('Hey',{session_start:true});const thin=await f.recall('Good morning',{session_start:true});
  expect(thin.context).toBe(greeting.context);expect(thin.memories.map(m=>m.id)).toEqual(greeting.memories.map(m=>m.id));
  expect(f.calls()).toBe(0);expect(thin.retrieval.path).toBe('thin_start_continuity');expect(thin.retrieval.candidates_examined).toBe(0);
  expect(thin.context).toContain('LAST REPORTED RESIDENCE; source 2026-01-01; current whereabouts unverified');
  const focused=await f.recall("Who is Alex's spouse?",{session_start:true});expect(f.calls()).toBe(1);expect(focused.retrieval.path).toBe('query');
  await f.recall('one two three four five six seven eight nine',{session_start:true});expect(f.calls()).toBe(2);
 }finally{f.s.close()}
});
test('cache hits read new graph, corrections and forgetting; resolved followup context is part of exact key',async()=>{
 const f=fixture();try{
  const old=f.seed('is_married_to','Casey');let result=await f.recall();expect(result.retrieval.embedding_cache).toBe('miss');
  const next=f.seed('is_married_to','Jordan');f.s.run('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?)','correction',next.e.id,old.id,next.id,'correction',at,now());
  result=await f.recall();expect(result.retrieval.embedding_cache).toBe('hit');expect(result.memories.map(m=>m.id)).not.toContain(old.id);expect(result.memories.map(m=>m.id)).toContain(next.id);expect(result.memories[0].corrections.length).toBe(1);
  f.event(next.event_id,{revision:2,operation:'delete'});result=await f.recall();expect(result.retrieval.embedding_cache).toBe('hit');expect(result.memories.map(m=>m.id)).not.toContain(next.id);
  await f.recall('What about them?',{recent_context:[{role:'user',content:'Tell me about the Beacon project'}]});
  await f.recall('What about them?',{recent_context:[{role:'user',content:'Tell me about the Harbor project'}]});
  expect(f.inputs.at(-1)).not.toBe(f.inputs.at(-2));expect(f.calls()).toBe(3);
  f.rotate();expect((await f.recall()).retrieval.embedding_cache).toBe('miss');expect(f.calls()).toBe(4);
 }finally{f.s.close()}
});
test('in-flight embedding coalescing still authorizes and reads graph after await',async()=>{
 const f=fixture();try{
  const seed=f.seed('is_married_to','Casey');let release!:()=>void,calls=0;
  f.inf.embed=async()=>{calls++;await new Promise<void>(r=>release=r);return {vectors:[[1,0]],model:'synthetic-v1'}};
  const first=f.recall(),second=f.recall();expect(calls).toBe(1);
  f.event(seed.event_id,{revision:2,operation:'delete'});release();const results=await Promise.all([first,second]);
  expect(results.every(r=>r.memories.length===0)).toBe(true);expect(results.map(r=>r.retrieval.embedding_cache)).toEqual(['miss','coalesced']);
  f.rotate();const revoked=f.recall();f.s.run("DELETE FROM memory_grants WHERE principal_id=? AND scope='agent:builder' AND action='read'",f.a.id);release();await expect(revoked).rejects.toMatchObject({code:'memory_grant_required'});
 }finally{f.s.close()}
});
test('effective identity metadata cache does not alias raw and resolved row inputs; type reads are shared',async()=>{
 const f=fixture();try{
  const seed=f.seed('is_married_to','Casey'),row=f.s.one('SELECT * FROM memories WHERE id=?',seed.id);
  const cache=new Map<string,string[]>(),targets=new Map<string,any>();let reads=0;const all=f.s.all.bind(f.s);
  f.s.all=(sql:string,...args:any[])=>{if(sql.includes("predicate IN ('is_a'"))reads++;return all(sql,...args)};
  const before=f.m.entityInfo(row,now(),now(),cache,targets);f.m.entityInfo({...row,predicate:'parent_of',object:'Jamie'},now(),now(),cache,targets);
  expect(reads).toBeLessThanOrEqual(2);expect(before).not.toEqual(f.m.entityInfo({...row,predicate:'maintains',object:'Beacon'},at,at,cache,targets));
 }finally{f.s.close()}
});
test('native projection retains exact context, feedback IDs, source/time/correction identities and full API remains available',async()=>{
 const f=fixture();try{
  const old=f.seed('is_married_to','Casey'),next=f.seed('is_married_to','Jordan');f.s.run('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?)','correction',next.e.id,old.id,next.id,'correction',at,now());
  const args={valid_at:now(),recorded_at:now()};const full=await f.recall(undefined,args),compact=await f.recall(undefined,{...args,response_format:'native-v1'});
  expect(compact.context).toBe(full.context);expect(compact.memories).toEqual(full.memories.map(nativeMemory));expect(compact.freshness).toEqual(full.freshness);expect(compact.pending_events).toEqual([]);expect(compact.tokens_used).toBe(full.tokens_used);
  expect(compact.memories[0].supports[0].event_id).toBe(next.event_id);expect(compact.memories[0].corrections[0].change_id).toBe('correction');
  expect(compact.memories[0].predicate).toBeUndefined();expect(compact.memories[0].supports[0].excerpt).toBeUndefined();expect(full.memories[0].predicate).toBe('is_married_to');expect('excerpt' in full.memories[0].supports[0]).toBe(true);
  const outcome='outcome';f.event(outcome,{thread_id:'latency-query',role:'assistant',author_id:'agent:builder'});
  f.m.feedback(f.a,{agent_id:'builder',recall_id:compact.recall_id,outcome_event_id:outcome,used_memory_ids:compact.memories.map(m=>m.id)});
  expect(f.s.one('SELECT recall_id FROM memory_feedback WHERE recall_id=?',compact.recall_id).recall_id).toBe(compact.recall_id);
  await expect(f.recall(undefined,{response_format:'other'})).rejects.toMatchObject({code:'invalid_request'});
 }finally{f.s.close()}
});

// The previous query is an executable oracle, not a separately inferred count.
const oldFreshness=`SELECT MAX(e.accepted_at) AS latest_accepted_at,MAX(e.processed_at) AS latest_processed_at,
 COALESCE(SUM(CASE WHEN e.status='pending' AND e.operation='upsert' AND e.accepted_at<=? AND e.occurred_at<=? THEN 1 ELSE 0 END),0) AS pending_count,
 COALESCE(SUM(CASE WHEN e.status='captured' AND e.operation='upsert' AND e.accepted_at<=? AND e.occurred_at<=? THEN 1 ELSE 0 END),0) AS capture_only_count
 FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id
 WHERE e.reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1) AND e.workspace_id=? AND ((e.agent_id=? AND ?=1) OR (e.role='user' AND e.author_id='alex' AND ?=1))`;
test('covering freshness equals old aggregate through scope overlap, dates, revisions, statuses and reset epochs',()=>{
 const f=fixture();try{
  for(let i=0;i<20;i++){
   const e=`event-${i}`;f.event(e,{author_id:i%2?'other':'alex',role:i%3?'user':'assistant',occurred_at:i%2?at:'2099-01-01T00:00:00.000Z'});
   f.s.run('UPDATE memory_events SET status=?,processed_at=? WHERE event_id=?',['pending','captured','processed','forgotten','deleted'][i%5],i%2?null:'2026-05-01T00:00:00.000Z',e);
  }
  // Another authorized own/shared overlap, another agent's shared owner event,
  // and another workspace are represented without requiring a second provider.
  f.s.run("UPDATE memory_events SET agent_id='other' WHERE event_id='event-2'");
  f.event('revision');f.event('revision',{revision:2});f.event('revision',{revision:3,operation:'delete'});
  const otherBoot=f.s.bootstrap('Other workspace'),other=f.s.authenticate(otherBoot.token);f.m.bind(other,other.id,'other');
  f.m.event(other,{client_id:'other',event_id:'other',revision:1,operation:'upsert',agent_id:'other',thread_id:'other',role:'user',author_id:'alex',occurred_at:at,observed_at:now(),content:'Other workspace'});
  const compare=()=>{
   for(const own of [0,1])for(const shared of [0,1])for(const recorded of [at,now(),'2099-01-01T00:00:00.000Z'])for(const valid of [at,'2099-01-01T00:00:00.000Z']){
    const expected=f.s.one(oldFreshness,recorded,valid,recorded,valid,f.a.workspace_id,'builder',own,shared);
    expect(recallFreshness(f.s,f.a.workspace_id,'builder',[...(own?['agent:builder']:[]),...(shared?['user:alex']:[])],valid,recorded)).toEqual(expected);
   }
  };compare();
  resetDerivedBrain(f.s,'RESET_DERIVED_BRAIN');compare();
  expect(recallFreshness(f.s,f.a.workspace_id,'builder',['agent:builder','user:alex'],now(),now())).toEqual({latest_accepted_at:null,latest_processed_at:null,pending_count:0,capture_only_count:0});
  f.event('new-epoch');compare();
  const plan=f.s.all('EXPLAIN QUERY PLAN '+freshnessSQL,...Array(8).fill('')).map(x=>x.detail).join('\n');
  expect(plan).toContain('COVERING INDEX memory_event_freshness');expect(plan).toContain('COVERING INDEX memory_head_event');expect(plan).not.toMatch(/SCAN e\b/);
 }finally{f.s.close()}
});
