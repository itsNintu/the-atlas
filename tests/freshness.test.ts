import {test,expect} from 'bun:test';
import {Store,now} from '../src/store.ts';
import {Memory,MemoryWorker} from '../src/memory.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const old='2026-01-01T00:00:00.000Z';
function fixture(path=':memory:') {
 const s=new Store(path),b=s.bootstrap('Fictional fairness regression'),a=s.authenticate(b.token);
 const inf={async curate(){return {decisions:[{kind:'nothing' as const}]};},async embed(texts:string[]){return {vectors:texts.map(()=>[1,0]),model:'fairness-double'};}};
 const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
 const event=(id:string,thread:string,accepted=now())=>{const r=m.event(a,{client_id:'fair',event_id:id,revision:1,operation:'upsert',agent_id:'builder',thread_id:thread,role:'user',author_id:'alex',occurred_at:old,observed_at:now(),content:'fictional noise'});s.run('UPDATE memory_events SET accepted_at=? WHERE event_id=?',accepted,id);s.run('UPDATE memory_jobs SET created_at=? WHERE id=?',accepted,r.job_id);return r;};
 return {s,a,m,w,inf,event};
}
test('fresh coherent conversations advance behind inherited backlog while old work has reserved service',()=>{
 const f=fixture();for(let n=0;n<1200;n++)f.event(`old-${n}`,'inherited',old);
 for(let n=0;n<8;n++)f.event(`fresh-${n}`,'fresh');
 const sequence:string[]=[];
 for(let n=0;n<20;n++){const j=f.w.claim();expect(j).not.toBeNull();const e=f.s.one('SELECT * FROM memory_events WHERE id=?',j!.event_pk);sequence.push(e.event_id);f.w.finish(j,'succeeded');}
 expect(sequence.filter(x=>x.startsWith('fresh-'))).toEqual(Array.from({length:8},(_,n)=>`fresh-${n}`));
 expect(sequence.slice(0,4)).toContain('old-0');
 expect(sequence.filter(x=>x.startsWith('old-')).length).toBeGreaterThanOrEqual(3);
 expect(f.s.one('SELECT COUNT(*) n FROM memory_events').n).toBe(1208);
 expect(f.s.one("SELECT COUNT(*) n FROM memory_jobs WHERE status='queued'").n).toBe(1188);f.s.close();
});
test('single-flight chronology includes retry backoff and expired claims across workers',()=>{
 const f=fixture();const first=f.event('first','same');f.event('second','same');f.event('other','other');
 const j=f.w.claim()!;const e=f.s.one('SELECT event_id FROM memory_events WHERE id=?',j.event_pk);
 // A fresh other thread may win initial service; complete it to reach the first same-thread event.
 if(e.event_id==='other'){f.w.finish(j,'succeeded');}
 const held=e.event_id==='first'?j:f.w.claim()!;expect(held.id).toBe(first.job_id);
 const secondWorker=new MemoryWorker(f.s,f.inf);expect(secondWorker.claim()).toBeNull();
 f.s.run("UPDATE memory_jobs SET status='retry',available_at=?,lease_token=NULL,lease_until=NULL WHERE id=?",Date.now()+60000,held.id);
 expect(secondWorker.claim()).toBeNull();
 f.s.run("UPDATE memory_jobs SET status='running',lease_until=0,attempts=1 WHERE id=?",held.id);
 const recovered=secondWorker.claim()!;expect(recovered.id).toBe(held.id);expect(recovered.lease_token).not.toBe(held.lease_token);
 f.w.finish(held,'succeeded');expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?',held.id).status).toBe('running');
 secondWorker.finish(recovered,'succeeded');expect(secondWorker.claim()!.event_pk).toBe(f.s.one("SELECT id FROM memory_events WHERE event_id='second'").id);f.s.close();
});
test('fairness survives reopen and active fresh arrivals cannot starve inherited work',()=>{
 const dir=mkdtempSync(join(tmpdir(),'atlas-fair-')),path=join(dir,'fair.sqlite');const f=fixture(path);
 try{for(let n=0;n<20;n++)f.event(`old-${n}`,'old',old);f.event('start','fresh');let j=f.w.claim()!;f.w.finish(j,'succeeded');f.s.close();
 const s=new Store(path),w=new MemoryWorker(s,f.inf),m=new Memory(s,f.inf);let oldClaims=0;
 for(let n=0;n<12;n++){m.event(f.a,{client_id:'fair',event_id:`new-${n}`,revision:1,operation:'upsert',agent_id:'builder',thread_id:`new-thread-${n}`,role:'user',author_id:'alex',occurred_at:old,observed_at:now(),content:'noise'});j=w.claim()!;if(s.one('SELECT thread_id FROM memory_events WHERE id=?',j.event_pk).thread_id==='old')oldClaims++;w.finish(j,'succeeded');}
 expect(oldClaims).toBeGreaterThanOrEqual(3);s.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('named topics retain configured semantic admission and prefer directly matching facts when available',async()=>{
 const f=fixture();f.event('receipt','seed');const e=f.s.one("SELECT * FROM memory_events WHERE event_id='receipt'");
 // Reproduce the real unrelated MiniLM .479 match, not a perfectly identical
 // vector that would falsely claim perfect semantic equivalence.
 f.w.apply(e,{kind:'episode',scope:'agent:builder',subject:'Lantern Cobalt 573',predicate:'receipt',object:'fictional runtime true',valid_from:old,valid_to:null,importance:.9,confidence:.9,evidence_event_ids:['receipt']},[.479,Math.sqrt(1-.479**2)],'fairness-double',['agent:builder']);
 // A named topic cannot raise the configured .42 admission threshold. This
 // double verifies eligibility, not real-world relevance of a fixture receipt.
 expect((await f.m.recall(f.a,{agent_id:'builder',thread_id:'query',query:'What does fictional LDN7 say about runtime status?'})).memories).toHaveLength(1);
 expect((await f.m.recall(f.a,{agent_id:'builder',thread_id:'query',query:'runtime receipt paraphrase'})).memories).toHaveLength(1);
 f.w.apply(e,{kind:'assertion',scope:'agent:builder',subject:'LDN7 Lantern',predicate:'uses',object:'amber',valid_from:old,valid_to:null,importance:.9,confidence:.9,evidence_event_ids:['receipt']},[1,0],'fairness-double',['agent:builder']);
 const r=await f.m.recall(f.a,{agent_id:'builder',thread_id:'query',query:'fictional LDN7 Lantern color'});expect(r.memories.map(x=>x.subject)).toEqual(['LDN7 Lantern']);f.s.close();
});
test('explicit history query includes closed state but never retracted false belief',async()=>{
 const f=fixture();f.event('initial','story');const e=f.s.one("SELECT * FROM memory_events WHERE event_id='initial'");
 const apply=(subject:string,object:string,extra:any={})=>f.w.apply(e,{kind:'assertion',scope:'agent:builder',subject,predicate:'owner',object,valid_from:old,valid_to:null,importance:.8,confidence:.9,evidence_event_ids:['initial'],...extra},[1,0],'fairness-double',['agent:builder']);
 apply('LDN7 Lantern','Nola');const first=f.s.one("SELECT * FROM memories WHERE object='Nola'");apply('LDN7 Lantern','Leda',{kind:'update',valid_from:'2026-02-01T00:00:00.000Z',change:{type:'state_change',target_ids:[first.id]}});
 apply('LDN7 color','cobalt');const bad=f.s.one("SELECT * FROM memories WHERE object='cobalt'");apply('LDN7 color','amber',{kind:'update',change:{type:'correction',target_ids:[bad.id]}});
 const q=(query:string)=>f.m.recall(f.a,{agent_id:'builder',thread_id:'query',query});
 expect((await q('LDN7 owner now')).memories.some(x=>x.object==='Nola')).toBe(false);
 const r=await q('LDN7 who owns Lantern now and who owned it before?');expect(r.memories.some(x=>x.object==='Nola'&&x.historical===true&&x.valid_to==='2026-02-01T00:00:00.000Z')).toBe(true);expect(r.context).toContain('HISTORICAL');expect(r.memories.some(x=>x.object==='cobalt')).toBe(false);f.s.close();
});
