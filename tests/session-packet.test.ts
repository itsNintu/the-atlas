import {test,expect} from 'bun:test';
import {Store,now} from '../src/store.ts';
import {Memory,MemoryWorker} from '../src/memory.ts';
import {memoryGraph} from '../src/memory-graph.ts';
import {continuityLocation,sessionPacketLine,sourceTime} from '../src/session-packet.ts';

function fixture(){
 const s=new Store(':memory:'),b=s.bootstrap('Session packet'),a=s.authenticate(b.token);
 const inf={async curate(){throw Error('read-only recall')},async embed(texts:string[]){return {vectors:texts.map(()=>[1,0]),model:'session-double'}}};
 const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
 const seed=(predicate:string,object:string,extra:any={})=>{
  const event_id=`packet-${s.one('SELECT COUNT(*) n FROM memory_events').n}`,at=extra.at??'2026-01-02T00:00:00.000Z';
  m.event(a,{client_id:'session-packet',event_id,revision:1,operation:'upsert',agent_id:'builder',thread_id:'fixture',role:extra.role??'user',author_id:extra.author??'alex',occurred_at:at,observed_at:now(),content:`Synthetic ${predicate}: ${object}`});
  const e=s.one('SELECT * FROM memory_events WHERE event_id=?',event_id);
  const id=w.apply(e,{kind:extra.kind??'assertion',scope:extra.scope??'user:alex',subject:extra.subject??'Alex',predicate,object,object_entity:false,valid_from:extra.start??at,valid_to:extra.end??null,importance:.8,confidence:.9,evidence_event_ids:[event_id]},[1,0],'session-double',['user:alex','business:alex','agent:builder','agent:overwatch']);
  if(extra.unknown)s.run('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?)',`unknown-${event_id}`,e.id,id,null,'start_unknown',at,now());
  return id;
 };
 const recall=(query='Hey',extra:any={})=>m.recall(a,{agent_id:'builder',thread_id:'packet-query',query,token_budget:1200,session_start:true,...extra});
 return {s,a,m,seed,recall};
}
test('startup source-dates identity/family/work and two compact topics, retaining unknown-start custody',async()=>{
 const f=fixture();try{
  f.seed('parent_of','Jamie',{unknown:true});f.seed('is_married_to','Casey',{unknown:true});
  f.seed('on_trial_with','Beacon');
  f.seed('maintains','Beacon launch',{scope:'business:alex',at:'2026-02-03T00:00:00.000Z'});
  f.seed('builds','Harbor workspace',{scope:'business:alex',at:'2026-02-02T00:00:00.000Z'});
  f.seed('builds','Older project',{scope:'business:alex'});
  const before=memoryGraph(f.m,f.a,{agent_id:'builder',query:'Alex',include_history:true,limit:100});
  const r=await f.recall();
  expect(r.context).toContain('Alex | parent_of | Jamie (source 2026-01-02)');
  expect(r.context).toContain('Alex | on_trial_with | Beacon');
  expect(r.context).toContain('recent: Beacon launch (source 2026-02-03)');
  expect(r.context).toContain('recent: Harbor workspace (source 2026-02-02)');
  expect(r.context).not.toContain('Older project');
  expect(r.context.split('\n').every(l=>l.includes('source 2026-'))).toBe(true);
  expect(r.memories.find(x=>x.predicate==='parent_of')!.historical_start_unknown).toBe(true);
  expect(r.memories.every(x=>x.supports[0].event_id)).toBe(true);
  expect(r.context).not.toMatch(/packet-|memory_|ATLAS/);expect(r.tokens_used).toBeLessThan(250);
  const after=memoryGraph(f.m,f.a,{agent_id:'builder',query:'Alex',include_history:true,limit:100});
  expect(after.edges).toEqual(before.edges);expect(after.changes).toEqual(before.changes);
 }finally{f.s.close()}
});
test('old supported residence outside newest startup window is reported, never upgraded to current whereabouts',async()=>{
 const f=fixture();try{
  const home=f.seed('lives_in','Harborland',{unknown:true,at:'2025-01-02T00:00:00.000Z'});
  for(let i=0;i<85;i++)f.seed('has_note',`noise ${i}`);
  const r=await f.recall();
  expect(r.memories.map(x=>x.id)).toContain(home);
  expect(r.context).toContain('Alex | lives_in | Harborland (LAST REPORTED RESIDENCE; source 2025-01-02; current whereabouts unverified)');
  expect(r.context).not.toContain('since');
  expect(r.retrieval.session_start_location).toBe('included_source_qualified');
  const tiny=await f.recall('Hey',{token_budget:1});
  expect(tiny.context).toBe('');expect(tiny.retrieval.session_start_location).toBe('omitted_token_budget');
  const later=await f.recall("Who is Alex's spouse?",{session_start:false});
  expect(later.memories.map(x=>x.id)).not.toContain(home);expect(later.context).not.toContain('RESIDENCE');
 }finally{f.s.close()}
});
test('source qualification never substitutes processing/start dates; conflicted locations are not startup observations',()=>{
 const m={scope:'user:alex',subject:'Alex',predicate:'lives_in',recorded_from:'2026-10-01',valid_from:'2025-01-01',supports:[{occurred_at:'2026-02-03T00:00:00.000Z'},{occurred_at:'2026-03-04T00:00:00.000Z'}]};
 expect(sourceTime(m)).toBe('2026-03-04T00:00:00.000Z');
 expect(continuityLocation(m)).toBe(true);expect(continuityLocation({...m,conflict:true})).toBe(false);
 expect(continuityLocation({...m,historical:true})).toBe(false);expect(continuityLocation({...m,supports:[]})).toBe(false);
 expect(sessionPacketLine({...m,predicate:'parent_of',supports:[]},()=> 'Alex | parent_of | Jamie')).toContain('source date unknown');
});
test('supported physical observation is last reported with source time, not processing or valid start',async()=>{
 const f=fixture();try{
  f.seed('current_location','Harbor City',{at:'2026-03-04T00:00:00.000Z',start:'2026-02-01T00:00:00.000Z'});
  const r=await f.recall();
  expect(r.context).toContain('LAST REPORTED LOCATION; source 2026-03-04; current whereabouts unverified');
  expect(r.context).not.toContain('2026-02-01');
 }finally{f.s.close()}
});
test('no source, historical/closed, planned, preferences, other people and private locations leave an honest omitted slot',async()=>{
 const f=fixture();try{
  const empty=await f.recall();expect(empty.context).toBe('');
  expect(empty.retrieval.session_start_location).toBe('omitted_no_supported_location_in_bounded_selection');
  f.seed('lives_in','Old City',{end:'2026-02-01T00:00:00.000Z'});
  f.seed('formerly_lived_in','Past City');f.seed('born_in','Birth City');
  f.seed('may_travel_to','Planned City');f.seed('plans_to_move_to','Future City');
  f.seed('prefers_work_location','Remote');f.seed('timezone','UTC+7');
  f.seed('lives_in','Other City',{subject:'Morgan'});
  f.seed('lives_in','Secret City',{scope:'agent:overwatch'});
  f.seed('has_goal','Private topic',{scope:'agent:overwatch'});
  const r=await f.recall('Hey, previous history');
  expect(r.memories).toEqual([]);expect(r.context).toBe('');
  expect(r.retrieval.session_start_location).toBe('omitted_no_supported_location_in_bounded_selection');
  expect((await f.recall('Hey',{token_budget:0})).context).toBe('');
  await expect(f.recall('Hey',{agent_id:'overwatch'})).rejects.toThrow();
 }finally{f.s.close()}
});
