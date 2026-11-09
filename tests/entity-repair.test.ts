import {test,expect} from 'bun:test';
import {Store,now,id,canonical} from '../src/store.ts';
import {Memory,MemoryWorker} from '../src/memory.ts';
import {entityRepairPlan,repairMemoryEntity,authorizeEntityRepair,supportedPetIdentity,type EntityRepairRequest} from '../src/memory-entity-repair.ts';
const jan='2026-01-01T00:00:00.000Z',feb='2026-02-01T00:00:00.000Z',mar='2026-03-01T00:00:00.000Z';
async function fixture(scope='agent:builder') {
  const s=new Store(':memory:'),b=s.bootstrap('Synthetic pet amendment'),a=s.authenticate(b.token);
  let calls=0;
  const inf={async curate(){calls++;return {decisions:[]}},async embed(){calls++;return {vectors:[],model:'disabled'}}};
  const memory=new Memory(s,inf),worker=new MemoryWorker(s,inf);memory.bind(a,a.id,'builder');
  const event=(key:string,content:string,revision=1,operation='upsert')=>memory.event(a,{client_id:'pet-fixture',event_id:key,revision,operation,agent_id:'builder',thread_id:'pets',role:'user',author_id:'synthetic-owner',occurred_at:jan,observed_at:now(),...(operation==='upsert'?{content}:{})});
  const seed=async(key:string,object:string,predicate:string,valid_from:string)=>{
    const r=event(key,`Synthetic owner has pet ${object}.`);await worker.runOnce();
    const e=s.one('SELECT * FROM memory_events WHERE event_id=?',key);
    const mid=worker.apply(e,{kind:'episode',scope,subject:'Demo Rowan',predicate,object,object_entity:true,valid_from,valid_to:null,importance:.8,confidence:.9,evidence_event_ids:[key]},undefined,'disabled',[scope]);
    return {id:mid,e,r};
  };
  const old=await seed('old-pet','Demo Pip','owns',jan),next=await seed('new-pet','Demo Pippin','has_dog',feb);
  const proofText='Demo Pip is the same dog as Demo Pippin.';
  const amendment=()=>event('amendment',proofText);
  amendment();
  const request:EntityRepairRequest={agent_id:'builder',old_memory_id:old.id,replacement_memory_id:next.id,client_id:'pet-fixture',event_id:'amendment',expected_revision:1,identity_excerpt:proofText};
  const plan=()=>entityRepairPlan(memory,a,request);
  const apply=(p=plan(),key='repair')=>s.write(a,key,'entity-repair',{...request,expected_proof_sha256:p.proof_sha256,reason_code:'owner_name_correction'},'test',()=>{authorizeEntityRepair(memory,a,request)},()=>repairMemoryEntity(memory,a,{...request,expected_proof_sha256:p.proof_sha256,reason_code:'owner_name_correction'}));
  return {s,a,b,memory,worker,event,old,next,request,plan,apply,calls:()=>calls};
}
const tables=['memory_events','memory_jobs','memory_heads','memory_roots','memories','memory_supports','memory_versions'];
function custody(s:Store){return Object.fromEntries(tables.map(t=>[t,s.all(`SELECT * FROM ${t} ORDER BY rowid`)]));}

test('same-pet name correction is append-only, source-backed, bounded and recorded-time qualified',async()=>{
 const f=await fixture();try{
  const before=now(),rows=custody(f.s),calls=f.calls(),p=f.plan();await Bun.sleep(3);
  expect(custody(f.s)).toEqual(rows);expect(p.copies_supports).toBe(false);expect(p.rewrites_valid_time).toBe(false);
  const r=f.apply(p);
  expect(custody(f.s)).toEqual(rows);expect(f.calls()).toBe(calls);
  expect(f.memory.canonicalEntity(f.a.workspace_id,p.scope,p.previous_entity_id,before)).toBe(p.previous_entity_id);
  expect(f.memory.canonicalEntity(f.a.workspace_id,p.scope,p.previous_entity_id)).toBe(p.canonical_entity_id);
  expect(f.memory.effective(f.s.one('SELECT * FROM memories WHERE id=?',f.old.id),mar,before)).not.toBeNull();
  expect(f.memory.effective(f.s.one('SELECT * FROM memories WHERE id=?',f.old.id),mar,now())).toBeNull();
  expect(f.memory.effective(f.s.one('SELECT * FROM memories WHERE id=?',f.next.id),mar,now())).not.toBeNull();
  const c=f.s.one('SELECT * FROM memory_changes WHERE id=?',r.change_id);
  expect(c.type).toBe('superseded');expect(c.event_pk).toBe(p.source_event_pk);expect(c.replacement_id).toBe(f.next.id);
  const audit=JSON.parse(f.s.one('SELECT disposition_json FROM memory_reconciliations WHERE event_pk=?',p.source_event_pk).disposition_json);
  expect(audit.proof_sha256).toBe(p.proof_sha256);expect(audit.operation).toBe('supported_entity_repair_v1');
  expect(f.apply(p).idempotent_replay).toBe(true);expect(f.s.all('SELECT * FROM memory_changes')).toHaveLength(1);
  expect(f.s.one('PRAGMA foreign_key_check')).toBeNull();
 }finally{f.s.close()}
});

test('proof CAS covers current source heads, support contents, claim versions and identity registry',async()=>{
 for(const mutation of ['version','support','equivalence','revision']){
  const f=await fixture();try{
   const p=f.plan();
   if(mutation==='version')f.s.run('UPDATE memories SET version=version+1 WHERE id=?',f.old.id);
   if(mutation==='support')f.s.run('UPDATE memory_supports SET excerpt=? WHERE memory_id=?','Changed retained support',f.old.id);
   if(mutation==='equivalence')f.s.run('INSERT INTO memory_entity_equivalences VALUES (?,?,?,?,?,?)',f.a.workspace_id,p.scope,p.previous_entity_id,p.canonical_entity_id,f.old.e.id,now());
   if(mutation==='revision')f.event('amendment',f.request.identity_excerpt,2);
   expect(()=>f.apply(p)).toThrow();expect(f.s.all('SELECT * FROM memory_changes')).toHaveLength(0);
  }finally{f.s.close()}
 }
});

test('auth and all affected scope grants are mandatory on preview, apply and idempotent replay',async()=>{
 for(const action of ['read','write']){
  const f=await fixture('business:alex');try{
   const p=f.plan();f.apply(p);
   f.s.run('DELETE FROM memory_grants WHERE principal_id=? AND scope=? AND action=?',f.a.id,'business:alex',action);
   expect(()=>f.plan()).toThrow();expect(()=>f.apply(p)).toThrow();
  }finally{f.s.close()}
 }
 const f=await fixture();try{
  const p=f.plan();f.s.run('UPDATE credentials SET revoked_at=? WHERE id=?',now(),f.a.credential_id);
  expect(()=>f.apply(p)).toThrow();expect(()=>entityRepairPlan(f.memory,f.a,{...f.request,agent_id:'reaver'})).toThrow();
 }finally{f.s.close()}
});

test('names/co-occurrence alone, explicit literals, other actors, cross-scope and missing owner proof fail closed',async()=>{
 expect(supportedPetIdentity('Demo Pip and Demo Pippin are dogs.','Demo Pip','Demo Pippin','dog')).toBe(false);
 expect(supportedPetIdentity('Demo Pip is NOT the same dog as Demo Pippin.','Demo Pip','Demo Pippin','dog')).toBe(false);
 expect(supportedPetIdentity('The dog’s correct name is Demo Pippin, not Demo Pip.','Demo Pip','Demo Pippin','dog')).toBe(true);
 for(const mutation of ['literal','actor','scope','agent-proof','missing','negated-context','reset']){
  const f=await fixture();try{
   if(mutation==='literal')f.s.run('UPDATE memory_entity_targets SET entity_id=NULL WHERE memory_id=?',f.old.id);
   if(mutation==='actor')f.s.run('UPDATE memories SET subject_id=? WHERE id=?',f.s.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=?',f.next.id).entity_id,f.next.id);
   if(mutation==='scope')f.s.run('UPDATE memories SET scope=? WHERE id=?','business:alex',f.next.id);
   if(mutation==='agent-proof')f.s.run("UPDATE memory_events SET role='assistant' WHERE event_id='amendment'");
   if(mutation==='missing')f.request.identity_excerpt='Demo Pip is now called Demo Pippin.';
   if(mutation==='negated-context')f.s.run("UPDATE memory_events SET content=? WHERE event_id='amendment'",`It is false that ${f.request.identity_excerpt}`);
   if(mutation==='reset')f.s.run('UPDATE derived_brain_reset_state SET epoch=epoch+1');
   expect(()=>f.plan()).toThrow();expect(f.s.all('SELECT * FROM memory_changes')).toHaveLength(0);
  }finally{f.s.close()}
 }
});

test('forgetting amendment withdraws its identity proof and correction without touching independent pet support',async()=>{
 const f=await fixture('business:alex');try{
  const p=f.plan();f.apply(p);
  expect(f.memory.canonicalEntity(f.a.workspace_id,'agent:builder',p.previous_entity_id)).toBe(p.previous_entity_id);
  expect(f.memory.canonicalEntity(f.a.workspace_id,p.scope,p.previous_entity_id)).toBe(p.canonical_entity_id);
  f.event('amendment','',2,'delete');
  expect(f.memory.canonicalEntity(f.a.workspace_id,p.scope,p.previous_entity_id)).toBe(p.previous_entity_id);
  expect(f.s.all('SELECT * FROM memory_entity_equivalences')).toHaveLength(0);
  expect(f.s.all('SELECT * FROM memory_changes')).toHaveLength(0);
  expect(f.memory.support({id:f.old.id})).toHaveLength(1);
  expect(f.memory.support({id:f.next.id})).toHaveLength(1);
  expect(f.s.one('PRAGMA foreign_key_check')).toBeNull();
 }finally{f.s.close()}
});

test('overgeneralized retraction replacement is closed without deleting its support or the name correction',async()=>{
 const f=await fixture();try{
  f.event('sibling-note','Remove the separate profile note.');
  await f.worker.runOnce();
  const siblingSource=f.s.one('SELECT * FROM memory_events WHERE event_id=?','sibling-note');
  const sibling=f.worker.apply(siblingSource,{kind:'episode',scope:'agent:builder',subject:'Demo Rowan',predicate:'does_not_want',object:'storing the corrected pet name',object_entity:false,valid_from:feb,valid_to:null,importance:.4,confidence:.5,evidence_event_ids:['sibling-note']},undefined,'disabled',['agent:builder']);
  const retraction=id('change');
  f.s.run('INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)',retraction,siblingSource.id,f.next.id,sibling,'retraction',feb,now());
  f.request.invalidate_change_ids=[retraction];
  f.request.close_retraction_replacements=true;
  f.request.owner_review={identity:true,retractions:true,basis:'The name correction stands; the sibling storage prohibition overgeneralized a separate note removal.'};
  const beforeSupports=f.memory.support({id:sibling}).length;
  const p=f.plan();
  expect(p.closed_memory_ids).toEqual([sibling]);
  f.apply(p);
  expect(f.memory.effective(f.s.one('SELECT * FROM memories WHERE id=?',sibling),mar,now())).toBeNull();
  expect(f.memory.support({id:sibling})).toHaveLength(beforeSupports);
  expect(f.memory.effective(f.s.one('SELECT * FROM memories WHERE id=?',f.next.id),mar,now())).not.toBeNull();
  expect(f.s.one('SELECT type FROM memory_changes WHERE target_id=? AND type=?',sibling,'retraction').type).toBe('retraction');
 }finally{f.s.close()}
});

test('only exact earlier mistaken retractions are invalidated; genuine closures and old recorded history survive',async()=>{
 const f=await fixture();try{
  const change=id('change');f.s.run('INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)',change,f.next.e.id,f.next.id,null,'retraction',feb,now());
  const before=now();await Bun.sleep(3);
  const quote=`The retraction of ${f.next.id} was mistaken.`;
  f.event('amendment',`${f.request.identity_excerpt}\n${quote}`,2);
  f.request.expected_revision=2;f.request.invalidate_change_ids=[change];f.request.retraction_excerpt=quote;
  const saved=canonical(f.s.all('SELECT * FROM memory_changes'));
  const p=f.plan();f.apply(p);
  expect(canonical(f.s.all('SELECT * FROM memory_changes WHERE id=?',change))).toBe(saved);
  expect(f.s.one('SELECT change_id FROM memory_change_invalidations').change_id).toBe(change);
  expect(f.memory.effective(f.s.one('SELECT * FROM memories WHERE id=?',f.next.id),mar,before)).toBeNull();
  expect(f.memory.effective(f.s.one('SELECT * FROM memories WHERE id=?',f.next.id),mar,now())).not.toBeNull();
 }finally{f.s.close()}
 const g=await fixture();try{
  const change=id('change');g.s.run('INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)',change,g.next.e.id,g.next.id,null,'state_change',feb,jan);
  g.request.invalidate_change_ids=[change];expect(()=>g.plan()).toThrow();
 }finally{g.s.close()}
});
