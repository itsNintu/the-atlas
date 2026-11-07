import {test,expect} from 'bun:test';
import {Store,now,hash} from '../src/store.ts';
import {Memory,MemoryWorker} from '../src/memory.ts';
import {CURATE_PROMPT} from '../src/inference.ts';
import {App} from '../src/app.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const at='2026-01-01T00:00:00.000Z';
test('audited HTTP memory reprocess retains original custody/outcome, idempotency and on-disk lifecycle',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'atlas-reprocess-')),path=join(dir,'fixture.sqlite');let s=new Store(path);
 try{
  const b=s.bootstrap('Fictional reprocess fixture'),a=s.authenticate(b.token),m=new Memory(s);m.bind(a,a.id,'builder');
  const receipt=m.event(a,{client_id:'reprocess',event_id:'original',revision:1,operation:'upsert',agent_id:'builder',thread_id:'fixture',role:'user',author_id:'alex',occurred_at:at,observed_at:now(),content:'Fictional note: Ember relay is maintained by Suri. Not real business.'});
  const oldInference={async curate(){return {decisions:[{kind:'nothing' as const}]}},async embed(){return {vectors:[],model:'disabled'}}};
  await new MemoryWorker(s,oldInference).runOnce();
  const original=s.one('SELECT * FROM memory_events WHERE event_id=\'original\''),oldJob=s.one('SELECT * FROM memory_jobs WHERE id=?',receipt.job_id);
  const app=new App(s);let n=0;
  const call=async(job:string,body:any,key='same')=>{
   const r=await app.fetch(new Request(`http://localhost/v1/memory/jobs/${job}/reprocess`,{method:'POST',headers:{Authorization:`Bearer ${b.token}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)}));
   return {status:r.status,body:await r.json() as any};
  };
  const body={agent_id:'builder',expected_revision:1,reason_code:'curator_selection_repair'};
  expect((await call(receipt.job_id,{...body,expected_revision:2},'wrong')).status).toBe(409);
  const r=await call(receipt.job_id,body);expect(r.status).toBe(200);expect(r.body.data.memory_only).toBe(true);
  const replay=await call(receipt.job_id,body);expect(replay.body.data.job_id).toBe(r.body.data.job_id);
  expect((await call(receipt.job_id,body,'not-idempotent')).status).toBe(404);
  expect(s.one('SELECT COUNT(*) n FROM memory_jobs').n).toBe(2);
  expect(s.one('SELECT * FROM memory_jobs WHERE id=?',receipt.job_id)).toEqual(oldJob);
  const pending=s.one('SELECT * FROM memory_events WHERE id=?',original.id);
  for(const key of ['id','event_id','revision','content','body_hash','accepted_at','processed_at','roots_json','causal_json','credential_id'])expect(pending[key]).toEqual(original[key]);
  const audit=s.one('SELECT * FROM memory_reprocess_requests');expect(audit.previous_job_id).toBe(receipt.job_id);expect(audit.prompt_sha256).toBe(hash(CURATE_PROMPT));expect(audit.previous_processed_at).toBe(original.processed_at);
  expect(s.one("SELECT COUNT(*) n FROM audit WHERE operation LIKE '%reprocess%'").n).toBe(1);
  s.close();s=new Store(path);
  const inf={async curate(i:any){n++;return {decisions:[{kind:'episode' as const,scope:'agent:builder',subject:'Fictional Ember relay',predicate:'maintained_by',object:'Fictional Suri',valid_from:at,valid_to:null,importance:.6,confidence:.9,evidence_event_ids:[i.event.event_id]}]}},async embed(texts:string[]){return {vectors:texts.map(()=>[1,0]),model:'reprocess-double'}}};
  await new MemoryWorker(s,inf).runOnce();expect(n).toBe(1);
  expect(s.one('SELECT status FROM memory_jobs WHERE id=?',r.body.data.job_id).status).toBe('succeeded');
  expect(s.one('SELECT COUNT(*) n FROM memory_curation_metrics').n).toBe(2);
  expect(s.one('SELECT event_pk FROM memory_supports').event_pk).toBe(original.id);
  expect(JSON.parse(s.one('SELECT roots_json FROM memory_supports').roots_json)).toEqual(JSON.parse(original.roots_json));
  expect(s.one('SELECT COUNT(*) n FROM memory_events').n).toBe(1);
 }finally{s.close();rmSync(dir,{recursive:true,force:true})}
});
test('reprocessing cannot cross bindings, overlap work, use missing content or resurrect deleted source',async()=>{
 const s=new Store(':memory:'),b=s.bootstrap('Synthetic boundaries'),a=s.authenticate(b.token),m=new Memory(s);m.bind(a,a.id,'builder');
 const make=async(id:string)=>{
  const r=m.event(a,{client_id:'reprocess',event_id:id,revision:1,operation:'upsert',agent_id:'builder',thread_id:id,role:'user',author_id:'alex',occurred_at:at,observed_at:now(),content:'Synthetic private fact'});
  await new MemoryWorker(s,{async curate(){return {decisions:[]}},async embed(){return {vectors:[],model:'disabled'}}}).runOnce();return r;
 };
 const r=await make('original');
 expect(()=>m.reprocess(a,'reaver',r.job_id,1,'repair')).toThrow();
 const e=s.one("SELECT * FROM memory_events WHERE event_id='original'");
 s.run('UPDATE memory_events SET content=NULL WHERE id=?',e.id);expect(()=>m.reprocess(a,'builder',r.job_id,1,'repair')).toThrow('no longer available');
 s.run('UPDATE memory_events SET content=? WHERE id=?',e.content,e.id);
 const queued=m.reprocess(a,'builder',r.job_id,1,'repair');expect(()=>m.reprocess(a,'builder',queued.job_id,1,'repair')).toThrow('Only a completed');
 m.event(a,{client_id:'reprocess',event_id:'original',revision:2,operation:'delete',agent_id:'builder',thread_id:'original',role:'user',author_id:'alex',occurred_at:at,observed_at:now()});
 expect(()=>m.reprocess(a,'builder',queued.job_id,1,'repair')).toThrow('not found');
 await new MemoryWorker(s,{async curate(){throw Error('deleted source must never reach provider')},async embed(){throw Error('deleted')}}).runOnce();
 expect(s.one('SELECT COUNT(*) n FROM memories').n).toBe(0);s.close();
});
