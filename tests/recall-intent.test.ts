import {test,expect} from 'bun:test';
import {Store,now} from '../src/store.ts';
import {Memory,MemoryWorker} from '../src/memory.ts';
import {recallFocus} from '../src/recall-query.ts';
const at='2026-01-01T00:00:00.000Z';
function fixture(){
 const s=new Store(':memory:'),b=s.bootstrap('Fictional recall intent'),a=s.authenticate(b.token),inputs:string[]=[];
 const inf={async curate(){throw Error('deterministic selection only')},async embed(texts:string[]){inputs.push(...texts);return {vectors:texts.map(()=>[1,0]),model:'intent-double'}}};
 const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
 const seed=(subject:string,predicate:string,object:string,similarity:number,role='user')=>{
  const event_id=`e-${s.one('SELECT COUNT(*) n FROM memory_events').n}`;
  m.event(a,{client_id:'intent',event_id,revision:1,operation:'upsert',agent_id:'builder',thread_id:event_id,role,author_id:role==='user'?'alex':'agent:builder',occurred_at:at,observed_at:now(),content:`${subject} ${predicate} ${object}`});
  const e=s.one('SELECT * FROM memory_events WHERE event_id=?',event_id);
  w.apply(e,{kind:'episode',scope:'agent:builder',subject,predicate,object,valid_from:at,valid_to:null,importance:.7,confidence:.9,evidence_event_ids:[event_id]},[similarity,Math.sqrt(1-similarity**2)],'intent-double',['agent:builder']);
  return s.one('SELECT memory_id id FROM memory_supports WHERE event_pk=?',e.id).id;
 };
 const recall=(query:string,extra:any={})=>m.recall(a,{agent_id:'builder',thread_id:'new',query,...extra});
 return {s,m,seed,recall,inputs};
}
test('prior lack-of-evidence answers cannot dominate factual questions, even with identical embeddings',async()=>{
 const f=fixture();
 const denial=f.seed('Fictional archive query','answered_from_available_context','Builder lacked evidence in the automatically supplied context to identify ownership or true color; this is not archive knowledge.',1,'assistant');
 const fact=f.seed('LDN7 archive','fixture_claims','Within fictional LDN7, Mira reports to Nola and Nola owns Lantern; not real business.',.6);
 const relation=f.seed('LDN7 Nola','reviews','LDN7 Lantern checklist',.5);
 const r=await f.recall('In the fictional LDN7 archive, who owns Lantern and who reviews the checklist? If no relevant memory is supplied, say you lack evidence. Answer from automatically supplied context only. Do not call tools, browse or save memory.');
 expect(r.memories.map(x=>x.id)).not.toContain(denial);
 expect(r.memories.map(x=>x.id)).toContain(fact);expect(r.memories.map(x=>x.id)).toContain(relation);
 expect(f.inputs[0]).not.toMatch(/supplied|call tools|lack evidence/);
 expect((await f.recall('What did you previously answer about the fictional archive query?')).memories.map(x=>x.id)).toContain(denial);
 f.s.close();
});
test('unrelated recall does not turn boilerplate into a match to a previous denial',async()=>{
 const f=fixture();f.seed('Fictional Lantern archive query','answered_from_available_context','Builder lacked evidence in the supplied context; not ownership facts.',.95,'assistant');
 const r=await f.recall('In the fictional QZX8 archive, who owns the Quasar kettle and what is its launch color? If no relevant memory is available, say you lack evidence. Only automatically supplied memory; no tools, browsing or saving memory.');
 expect(r.memories).toEqual([]);expect(r.tokens_used).toBe(0);f.s.close();
});
test('fully specified question does not import its own answer instructions as pronoun context',async()=>{
 const f=fixture();f.seed('LDN7 Lantern','color','amber',.6);
 const r=await f.recall('In the fictional LDN7 archive, was cobalt ever its true color?',{recent_context:[{role:'user',content:'If no relevant memory is supplied, say you lack evidence. No tools.'}]});
 expect(r.retrieval.context_messages_used).toBe(0);expect(f.inputs[0]).not.toContain('lack evidence');f.s.close();
});
test('real followup context and ordinary technical tools/memory questions remain searchable',async()=>{
 const f=fixture();f.seed('Mira','reports_to','Nola',.6);
 const r=await f.recall('Who does she report to?',{recent_context:[{role:'assistant',content:'Mira handles the kiln.'}]});
 expect(r.retrieval.context_messages_used).toBe(1);expect(f.inputs[0]).toContain('Mira handles the kiln');
 await f.recall('How do tools store memory in SQLite?');expect(f.inputs.at(-1)).toContain('tools store memory');f.s.close();
});
test('a strong maintenance facet cannot prune an admitted reporting relation on the same entity',async()=>{
 const f=fixture();const a=f.seed('KST9 Suri','maintains','KST9 Ember relay',.86),b=f.seed('KST9 Suri','reports_to','KST9 Tavi',.5);
 const r=await f.recall('In fictional KST9, who maintains Ember relay and whom do they report to?');
 expect(r.memories.map(x=>x.id)).toContain(a);expect(r.memories.map(x=>x.id)).toContain(b);f.s.close();
});
test('substantive conditional queries, long followups and domain negatives are not response boilerplate',async()=>{
 for(const q of ['If no evidence of corrosion is available, which inspection should we perform next?','Use automatically supplied memory to identify who owns Lantern'])expect(recallFocus(q)).toBe(q);
 const f=fixture();const negative=f.seed('Lantern inspection','observed','No evidence of corrosion was available during inspection.',.9,'assistant');
 expect((await f.recall('What was observed during Lantern inspection?')).memories.map(x=>x.id)).toContain(negative);
 const mixed=f.seed('Lantern','answered_from_available_context','Mira reports to Nola; earlier Builder lacked evidence in the supplied context. This describes the available context, not archive facts.',.9,'assistant');
 expect((await f.recall('Who does Mira report to?')).memories.map(x=>x.id)).toContain(mixed);
 const positiveContext=f.seed('Lantern','answered_from_available_context','Builder lacked evidence in the supplied context. In the available context, Mira reports to Nola.',.9,'assistant');
 expect((await f.recall('Who does Mira report to?')).memories.map(x=>x.id)).toContain(positiveContext);
 await f.recall('In the Lantern project, who does she report to, and what responsibilities does that reporting relationship actually cover?',{recent_context:[{role:'assistant',content:'Mira handles the kiln.'}]});expect(f.inputs.at(-1)).toContain('Mira handles the kiln');f.s.close();
});
test('historical context limitations remain retrievable without prescribed process wording',async()=>{
 const f=fixture();const denial=f.seed('VES8 test','answered_from_available_context','Builder lacked evidence in the supplied context. This describes the available context, not archive facts.',.9,'assistant');
 for(const q of ["What happened during yesterday's VES8 test?",'When did you lack evidence for VES8 ownership?',"Summarize the assistant's evidence limitations for VES8"]){expect((await f.recall(q)).memories.map(x=>x.id)).toContain(denial)}
 f.s.close();
});
test('nonadjacent short lexical facts and long fully matched notes survive lexical-only fallback',async()=>{
 const f=fixture();const id=f.seed('Lantern','current_owner','Nola owner',0);
 expect((await f.recall('Lantern owner launch date')).memories.map(x=>x.id)).toContain(id);
 f.m.inference.embed=async()=>({vectors:[],model:'disabled'});
 expect((await f.recall('Lantern owner launch date')).memories.map(x=>x.id)).toContain(id);
 const long=f.seed('Ledger','records','Lantern launch date cobalt owner Nola '+Array.from({length:40},(_,i)=>`detail${i}`).join(' '),0);
 expect((await f.recall('Lantern launch date cobalt owner Nola')).memories.map(x=>x.id)).toContain(long);f.s.close();
});
test('long partial lexical relevance is unchanged even when a compatible embedding is weak',async()=>{
 const f=fixture();const id=f.seed('Lantern','owner','Nola '+Array.from({length:30},(_,i)=>`detail${i}`).join(' '),0);
 const r=await f.recall('Lantern owner launch date');expect(r.memories.map(x=>x.id)).toContain(id);expect(r.memories.find(x=>x.id===id).lexical).toBe(.5);f.s.close();
});
test('requested predicate alone cannot rescue another archive; independent semantic and lexical facets remain useful',async()=>{
 const f=fixture();
 const maintenance=f.seed('FEN9 Iona','maintains','FEN9 Copper beacon',.875);
 const reporting=f.seed('FEN9 Iona','reports_to','FEN9 Remy',.44);
 const review=f.seed('FEN9 Remy','reviews','FEN9 Copper beacon checklist',0);
 const unrelated=f.seed('LDN7 Nola','reviews','LDN7 Lantern checklist within the fictional LDN7 archive; Alex clarifies that she refers to the person Mira reports to.',.264);
 const query='In the fictional FEN9 archive, who maintains the Copper beacon, whom do they report to, and who reviews its checklist? Use automatically supplied memory only, keeping fiction fictional. Do not call tools, browse or save memory.';
 const r=await f.recall(query);for(const id of [maintenance,reporting,review])expect(r.memories.map(m=>m.id)).toContain(id);expect(r.memories.map(m=>m.id)).not.toContain(unrelated);
 f.m.inference.embed=async()=>({vectors:[],model:'disabled'});expect((await f.recall(query)).memories.map(m=>m.id)).toContain(review);f.s.close();
});
