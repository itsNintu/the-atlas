import {test,expect} from 'bun:test';
import {Store,now} from '../src/store.ts';
import {Memory,MemoryWorker} from '../src/memory.ts';
import {memoryGraph} from '../src/memory-graph.ts';
const jan='2026-01-01T00:00:00.000Z',feb='2026-02-01T00:00:00.000Z',mar='2026-03-01T00:00:00.000Z';
function fixture(semantic=false){
 const s=new Store(':memory:'),b=s.bootstrap('Synthetic entity focused recall'),a=s.authenticate(b.token);
 const inf={async curate(){throw Error('deterministic recall only')},async embed(texts:string[]){return semantic?{vectors:texts.map(t=>t.includes('QZX9')?[0,1]:[1,.2]),model:'entity-double'}:{vectors:[],model:'disabled'}}};
 const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
 const seed=(subject:string,predicate:string,object:string,extra:any={})=>{
  const event_id=extra.event_id??`e-${s.one('SELECT COUNT(*) n FROM memory_events').n}`;
  const role=extra.role??'user',scope=extra.scope??'user:alex',time=extra.time??jan;
  m.event(a,{client_id:'entity-recall',event_id,revision:1,operation:'upsert',agent_id:'builder',thread_id:extra.thread_id??'entity-fixture',role,author_id:role==='user'?'alex':'agent:builder',occurred_at:time,observed_at:now(),content:extra.content??`${subject} ${predicate} ${object}`});
  const e=s.one('SELECT * FROM memory_events WHERE event_id=?',event_id);
  return w.apply(e,{kind:extra.kind??'assertion',scope,subject,predicate,object,object_entity:extra.object_entity??false,valid_from:extra.valid_from??time,valid_to:extra.valid_to??null,importance:extra.importance??.8,confidence:.95,evidence_event_ids:[event_id],entity_aliases:extra.entity_aliases},semantic?[1,.2]:undefined,semantic?'entity-double':'disabled',['agent:builder','user:alex','business:alex']);
 };
 const recall=(query:string,extra:any={})=>m.recall(a,{agent_id:'builder',thread_id:'automatic-conversation',query,token_budget:1200,valid_at:mar,...extra});
 return {s,a,m,w,seed,recall};
}
function profile(f:ReturnType<typeof fixture>){
 f.seed('Alex','has_dog','Ghosty',{object_entity:true});
 f.seed('Ghosty','is_a','dog');
 f.seed('Alex','is_married_to','Nona',{object_entity:true});
 f.seed('Alex','parent_of','Lia',{object_entity:true});
 f.seed('Alex','knows_basic','German');f.seed('Alex','knows_basic','Vietnamese');
 f.seed('Alex','owns','2016 KTM Duke 390');f.seed('Alex','birth_date','1994-01-20',{time:'1994-01-20T00:00:00.000Z',valid_from:'1994-01-20T00:00:00.000Z'});
}
test('dog-name intent follows the typed direct entity relationship and stops instead of packing biography',async()=>{
 const f=fixture();try{profile(f);
 const current=f.s.one("SELECT id FROM memories WHERE predicate='has_dog'").id;
 const vehicles=f.s.one("SELECT id FROM memories WHERE object LIKE '%KTM%'").id;
 const r=await f.recall('Do you know what doggos name is?');
 expect(r.memories.map((m:any)=>m.id)).toEqual([current]);
 expect(r.memories.map((m:any)=>m.id)).not.toContain(vehicles);
 expect(r.tokens_used).toBeLessThan(300);expect(r.pending_events).toEqual([]);
 expect(r.retrieval.focus?.mode).toBe('narrow');
 }finally{f.s.close()}
});
test('name and entity-type synonyms do not depend on embeddings or fixture names',async()=>{
 const f=fixture();try{
 const answer=f.seed('Robin','has_cat','Pepper',{object_entity:true});f.seed('Pepper','is_a','cat');
 f.seed('Robin','job_title','Architect',{scope:'business:alex'});f.seed('Robin','knows_basic','French');
 const r=await f.recall("What is Robin's kitty's name?");
 expect(r.memories.map((m:any)=>m.id)).toEqual([answer]);
 }finally{f.s.close()}
});
test('broad self profile intentionally returns varied current facets rather than only lexical language matches',async()=>{
 const f=fixture();try{profile(f);f.seed('Alex','job_title','Founding Growth',{scope:'business:alex'});
 const r=await f.recall('What do you know about me?');
 const predicates=new Set(r.memories.map((m:any)=>m.predicate));
 for(const p of ['has_dog','is_married_to','parent_of','job_title','knows_basic'])expect(predicates.has(p)).toBe(true);
 expect(r.memories.length).toBeGreaterThanOrEqual(6);expect(r.memories.length).toBeLessThanOrEqual(12);
 expect(r.retrieval.focus?.mode).toBe('profile');
 }finally{f.s.close()}
});
test('automatic dog-to-work shift uses current work graph, suppresses family and closed jobs, then restores the pet topic',async()=>{
 const f=fixture();try{profile(f);
 const role=f.seed('Alex','job_title','Founding Growth',{scope:'business:alex'});
 const project=f.seed('Alex','maintains','Atlas',{scope:'business:alex',object_entity:true});
 const responsibility=f.seed('Atlas','responsibility','Focused entity graph retrieval and current work recall',{scope:'business:alex'});
 const decision=f.seed('Atlas','active_decision','Use sourced canonical entities with compact recall',{scope:'business:alex'});
 f.seed('Alex','job_title','Legacy role',{scope:'business:alex',valid_to:feb});
 f.seed('Alex','first_job','Earlier role',{scope:'business:alex'});
 const dogContext=[{role:'user',content:'Do you know what doggos name is?'},{role:'assistant',content:'Your dog is Ghosty.'}];
 const workQuestion="Let's talk about work. What am I currently working on?";
 const work=await f.recall(workQuestion,{recent_context:dogContext});
 const ids=work.memories.map((m:any)=>m.id);
 for(const id of [role,project,responsibility,decision])expect(ids).toContain(id);
 expect(work.memories.every((m:any)=>!['has_dog','is_married_to','parent_of','is_a','first_job'].includes(m.predicate)&&m.object!=='Legacy role')).toBe(true);
 expect(work.memories.length).toBeLessThanOrEqual(8);expect(work.retrieval.focus?.mode).toBe('domain');
 const follow=await f.recall('What are my main responsibilities on it?',{recent_context:[{role:'user',content:workQuestion},{role:'assistant',content:'You are building Atlas and making current work recall useful.'}]});
 expect(follow.memories.map((m:any)=>m.id)).toContain(responsibility);
 expect(follow.memories.every((m:any)=>!['has_dog','is_married_to','parent_of'].includes(m.predicate))).toBe(true);
 expect(follow.retrieval.context_messages_used).toBeGreaterThan(0);
 const restored=await f.recall("Back to my dog—what's his name?",{recent_context:[{role:'user',content:workQuestion},{role:'assistant',content:'We were discussing Atlas and your current role.'}]});
 expect(restored.memories.map((m:any)=>m.id)).toEqual([f.s.one("SELECT id FROM memories WHERE predicate='has_dog'").id]);
 expect(restored.memories.some((m:any)=>m.id===role)).toBe(false);
 }finally{f.s.close()}
});
test('unrelated and unsupported narrow lookups stay empty or compact',async()=>{
 const f=fixture(true);try{profile(f);
 const empty=await f.recall('What is the resonance frequency of the fictional QZX9 copper telescope on Neptune?');
 expect(empty.memories).toEqual([]);expect(empty.tokens_used).toBe(0);
 const missing=await f.recall("What is Robin's kitty's name?");expect(missing.memories.length).toBeLessThanOrEqual(1);
 }finally{f.s.close()}
});
test('graph read model exposes predicate-sourced entity types and family provenance',()=>{
 const f=fixture();try{profile(f);
 const g=memoryGraph(f.m,f.a,{agent_id:'builder',query:'Ghosty',include_history:true,valid_at:mar,limit:100});
 const dog=g.nodes.find((n:any)=>n.label==='Ghosty');
 expect(dog.types.map((t:any)=>t.label)).toEqual(expect.arrayContaining(['dog','pet']));
 expect(dog.types.every((t:any)=>typeof t.relation_id==='string')).toBe(true);
 const alex=g.nodes.find((n:any)=>n.label==='Alex');expect(alex.types.map((t:any)=>t.label)).toContain('person');
 const family=memoryGraph(f.m,f.a,{agent_id:'builder',query:'Nona',include_history:true,valid_at:mar,limit:100});
 expect(family.edges[0].sources[0].event_id).toBeTruthy();expect(family.nodes.find((n:any)=>n.label==='Nona').types.map((t:any)=>t.label)).toContain('person');
 }finally{f.s.close()}
});
