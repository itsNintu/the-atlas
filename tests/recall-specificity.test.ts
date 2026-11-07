import {test,expect} from 'bun:test';
import {Store,now} from '../src/store.ts';
import {Memory,MemoryWorker} from '../src/memory.ts';
function fixture(){
 const s=new Store(':memory:'),b=s.bootstrap('Fictional specificity regression'),a=s.authenticate(b.token);
 const inf={async curate(){throw Error('No provider in deterministic ranking regression');},async embed(){return {vectors:[[1,0]],model:'specificity-double'};}};
 const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
 const seed=(id:string,subject:string,predicate:string,object:string,at:string,similarity=1,content='independent fictional observation')=>{
  m.event(a,{client_id:'specificity',event_id:id,revision:1,operation:'upsert',agent_id:'builder',thread_id:id,role:'tool',author_id:'fictional-tool',occurred_at:at,observed_at:now(),content});
  const e=s.one('SELECT * FROM memory_events WHERE event_id=?',id);
  w.apply(e,{kind:'episode',scope:'agent:builder',subject,predicate,object,valid_from:at,valid_to:null,importance:.8,confidence:.9,evidence_event_ids:[id]},[similarity,Math.sqrt(1-similarity**2)],'specificity-double',['agent:builder']);
  return s.one('SELECT memory_id id FROM memory_supports WHERE event_pk=?',e.id).id;
 };
 const recall=(query:string,extra:any={})=>m.recall(a,{agent_id:'builder',thread_id:'query',query,token_budget:1200,...extra});
 return {s,seed,recall};
}
test('named topic can recall strong semantic alias and linked relationship without literal code; incidental code is not a gate',async()=>{
 const f=fixture(),at='2026-01-01T00:00:00.000Z';
 const owner=f.seed('owner','Lantern','owner','Nola',at,1,'fictional LDN7 archive: Lantern is owned by Nola');
 const relation=f.seed('relation','Nola','reviews','launch checklist',at,0);
 const alias=f.seed('alias','Candle Archive','true_color','amber',at,.9);
 const r=await f.recall('In the fictional LDN7 archive who owns Lantern?');
 expect(r.memories.map(x=>x.id)).toContain(owner);expect(r.memories.map(x=>x.id)).toContain(relation);expect(r.memories.map(x=>x.id)).toContain(alias);
 expect((await f.recall('GPT4, explain the archive')).memories.some(x=>x.id===owner)).toBe(true);
 expect((await f.recall('What observation happened around 2026-01-01T00:00 UTC?')).memories.some(x=>x.id===owner)).toBe(true);f.s.close();
});
test('explicit source topic/action/time beats generic older or wrong-topic receipt, without a newest-outcome rule',async()=>{
 const f=fixture();
 const target=f.seed('target','Atlas exercise t_3e1c1ed1','continuation_comment_posted','Comment 2030 posted; not repair completion or acceptance.','2026-11-07T07:23:51.384Z',.6597);
 f.seed('older','Atlas exercise t_3e1c1ed1','recall_repair_continuation_comment_posted','Comment 2017 posted; not repair completion or acceptance.','2026-11-07T06:37:25.565Z',.7158);
 f.seed('different','Atlas task t_9a4fc271','kanban_comment_posted','Comment 2026 posted; not completion.','2026-11-07T07:22:47.904Z',.7522);
 f.seed('later','Atlas exercise t_3e1c1ed1','continuation_comment_posted','Comment 3000 is a later posting, not acceptance.','2026-11-07T09:23:51.384Z',.7);
 const r=await f.recall('What durable event did the kanban tool confirm for the continuation comment on Atlas exercise t_3e1c1ed1 around 2026-11-07T07:23 UTC? Distinguish actual comment posting from repair completion and later acceptance.');
 expect(r.memories[0].id).toBe(target);expect(r.context).toContain('Comment 2030 posted; not repair completion or acceptance.');
 // Valid-at semantics are not replaced by the mentioned source timestamp.
 expect((await f.recall('Atlas exercise t_3e1c1ed1 around 2026-11-07T07:23 UTC',{valid_at:'2026-11-07T06:00:00Z'})).memories).toEqual([]);f.s.close();
});
