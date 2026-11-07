import {test,expect} from 'bun:test';
import {Store,now} from '../src/store.ts';
import {Memory,MemoryWorker} from '../src/memory.ts';
import {recallFocus,asksAboutRecallProcess,isContextAvailabilityNote,needsRecallContext} from '../src/recall-query.ts';
const capture='Private fictional archive FEN9 only, not Alex or real business: Iona maintains the Copper beacon and reports to Remy. In that same imaginary archive, Remy reviews the Copper beacon checklist. No tools or builtin memory saves. Reply only "Noted fictional archive".';
const focused='FEN9: Iona maintains the Copper beacon and reports to Remy. Remy reviews the Copper beacon checklist.';
function fixture(){
 const s=new Store(':memory:'),b=s.bootstrap('Recall focus repair'),a=s.authenticate(b.token),inputs:string[]=[];
 const inf={async curate(){throw Error('no reasoning on recall')},async embed(texts:string[]){inputs.push(...texts);return {vectors:texts.map(()=>[1,0]),model:'focus-double'}}};
 const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
 const seed=(subject:string,predicate:string,object:string,similarity:number,role='user')=>{
  const event_id=`focus-${s.one('SELECT COUNT(*) n FROM memory_events').n}`;
  m.event(a,{client_id:'focus',event_id,revision:1,operation:'upsert',agent_id:'builder',thread_id:event_id,role,author_id:role==='user'?'alex':'agent:builder',occurred_at:'2026-01-01T00:00:00.000Z',observed_at:now(),content:`${subject} ${predicate} ${object}`});
  const e=s.one('SELECT * FROM memory_events WHERE event_id=?',event_id);
  w.apply(e,{kind:'episode',scope:'agent:builder',subject,predicate,object,valid_from:e.occurred_at,valid_to:null,importance:.7,confidence:.9,evidence_event_ids:[event_id]},[similarity,Math.sqrt(1-similarity**2)],'focus-double',['agent:builder']);
  return s.one('SELECT memory_id id FROM memory_supports WHERE event_pk=?',e.id).id;
 };
 return {s,m,seed,inputs,recall:(query:string,extra:any={})=>m.recall(a,{agent_id:'builder',thread_id:'fresh',query,...extra})};
}
test('exact native FEN9 new intake embeds substance, not fiction and reply wrappers',()=>{
 expect(recallFocus(capture)).toBe(focused);expect(recallFocus(focused)).toBe(focused);
 expect(asksAboutRecallProcess(recallFocus(capture))).toBe(false);expect(needsRecallContext(recallFocus(capture))).toBe(false);
 expect(recallFocus('Fictional private Reaver archive VES8, not Alex or real business: Suri maintains Ember. No tools or builtin memory saves. Reply only "Noted fictional archive".')).toBe('VES8: Suri maintains Ember.');
});
test('substantive declarations and ordinary questions do not implicitly request prior denials',()=>{
 for(const q of ['Iona maintains Copper and reports to Remy.','Copper has never used cobalt.','Explain Copper maintenance.','What is the Copper checklist?','How does the relay work?','There is no evidence of corrosion in the Copper inspection.'])expect(asksAboutRecallProcess(q)).toBe(false);
 for(const q of ['What did you previously answer about Copper?','Summarize the assistant\'s evidence limitations.','Why did retrieval fail for Copper?',"What happened during yesterday's VES8 test?",'What went wrong during yesterday\'s VES8 test?',"Describe yesterday's VES8 test",'Did you have enough context last time?',"How did yesterday's VES8 test go?",'Were you able to identify Copper in yesterday\'s session?',"What couldn't you determine about Copper?",'What information was missing from your previous assessment of Copper?','When did you lack evidence for VES8 ownership?'])expect(asksAboutRecallProcess(q)).toBe(true);
});
test('focus retains factual negatives, temporal distinctions, exact names and ordinary technical requests',()=>{
 for(const q of ['Copper never used cobalt; that was a mistaken claim, not a formerly true state.','From 2026-11-07, Leda takes over from Nola.','If no evidence of corrosion is available, which inspection should we perform next?','How do tools store memory in SQLite?','Use automatically supplied memory to identify who owns Lantern','No tools were used to repair Copper.'])expect(recallFocus(q)).toBe(q);
 expect(recallFocus('In the fictional QZX8 archive, who owns the Quasar kettle?')).toBe('QZX8: who owns the Quasar kettle?');
});
test('new intake excludes pure assistant availability denials but preserves real history and mixed useful notes',async()=>{
 const f=fixture();try{
 const denial=f.seed('Archive query','answered_from_available_context','Reaver lacked evidence in the supplied context. This describes the available context, not archive facts.',1,'assistant');
 const fact=f.seed('Iona','maintains','Copper beacon',.8);
 const mixed=f.seed('Remy','reviews','Copper beacon checklist; earlier Reaver lacked evidence in the supplied context.',.7,'assistant');
 const r=await f.recall(capture,{recent_context:[{role:'assistant',content:'Unrelated old denial in a different archive.'}]});
 expect(f.inputs[0]).toBe(focused);expect(r.retrieval.context_messages_used).toBe(0);
 expect(r.memories.map(x=>x.id)).not.toContain(denial);expect(r.memories.map(x=>x.id)).toContain(fact);expect(r.memories.map(x=>x.id)).toContain(mixed);
 expect((await f.recall('What did you previously answer about the archive query?')).memories.map(x=>x.id)).toContain(denial);
 }finally{f.s.close()}
});
test('availability classification does not discard domain negatives or user/tool supported evidence',()=>{
 const note=(object:string,roles=['assistant'])=>({predicate:'observed',object,supports:roles.map(role=>({role}))});
 expect(isContextAvailabilityNote(note('I lack evidence in the supplied context. This describes available context, not archive facts.'))).toBe(true);
 expect(isContextAvailabilityNote(note('I do not have relevant evidence in the supplied memory.'))).toBe(true);
 for(const m of [note('Copper never used cobalt.'),note('No evidence of corrosion was available during inspection.'),note('I lack evidence in the supplied context; Iona maintains Copper.'),note('I do not have relevant evidence in the supplied memory, although Iona maintains Copper.'),note('I do not have relevant evidence in the supplied memory, Iona maintains Copper.'),note('I do not have relevant evidence in the supplied memory: Iona maintains Copper.'),note('I did not have evidence in the supplied context because Iona transferred Copper to Remy.'),note('Iona maintains Copper: I do not have relevant evidence in the supplied context'),note('I lack evidence in the supplied context.',['user']),note('I lack evidence in the supplied context.',['assistant','tool'])])expect(isContextAvailabilityNote(m)).toBe(false);
});
for(const similarity of [.42,.50,.619])test(`useful semantic aliases without literal overlap survive at ${similarity}`,async()=>{
 const f=fixture();try{
 const id=f.seed('The night watch','responsibility','tending the signal tower',similarity);
 const r=await f.recall('Fictional private Reaver archive FEN9, not Alex or real business: Iona maintains Copper. No tools or builtin memory saves. Reply only "Noted".');
 expect(r.memories.map(x=>x.id)).toContain(id);expect(r.memories.find(x=>x.id===id)!.semantic).toBeCloseTo(similarity,6);
 }finally{f.s.close()}
});
test('lexical-only nonadjacent terms and ordinary followups remain supported',async()=>{
 const f=fixture();try{
 const id=f.seed('Lantern','current_owner','Nola owner',0);f.m.inference.embed=async()=>({vectors:[],model:'disabled'});
 const r=await f.recall('Lantern owner launch date');expect(r.memories.map(x=>x.id)).toContain(id);
 await f.recall('Who does she report to?',{recent_context:[{role:'assistant',content:'Mira handles the kiln.'}]});
 // No embeddings, but context resolution still runs on an actual followup.
 expect((await f.recall('Who does she report to?',{recent_context:[{role:'assistant',content:'Mira handles the kiln.'}]})).retrieval.context_messages_used).toBe(1);
 }finally{f.s.close()}
});
