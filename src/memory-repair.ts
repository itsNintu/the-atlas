import type { Memory } from './memory.ts';
import { canonical,hash,now,type Actor } from './store.ts';
import { fail,integer,text } from './errors.ts';
import { assertCurrentJobEpoch } from './reset-state.ts';

// Supported narrow repair of a contradictory compiled processing disposition.
// Never accepts caller facts, valid-time edits, or arbitrary change deletion.
export function repairPlan(memory:Memory,a:Actor,agent:string,job:string,revision:unknown) {
  const scopes=memory.authorize(a,agent),writes=memory.authorize(a,agent,'write'),s=memory.store;
  const e=s.one(`SELECT e.*,j.status AS job_status,j.reset_epoch AS job_reset_epoch FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk JOIN memory_heads h ON h.event_pk=e.id WHERE j.id=? AND e.workspace_id=? AND e.agent_id=?`,job,a.workspace_id,agent);
  if(!e)fail(404,'not_found','Current reconciliation not found');
  assertCurrentJobEpoch(s,e.reset_epoch,e.job_reset_epoch);
  if(e.revision!==integer(revision,'expected_revision',1,Number.MAX_SAFE_INTEGER))fail(409,'revision_conflict','Event revision changed');
  if(e.job_status!=='succeeded'||e.status!=='processed'||e.operation!=='upsert')fail(409,'repair_conflict','Repair requires a completed retained current source');
  const rows=s.all('SELECT * FROM memory_reconciliations WHERE job_id=? AND event_pk=?',job,e.id),changes=new Map<string,any>(),proof:any[]=[];
  for(const row of rows) {
    const r=JSON.parse(row.disposition_json);
    if(![...(r.change?[r.change]:[]),...(r.changes??[])].some(c=>c.target_ids.some((id:string)=>r.unaffected_ids?.includes(id))))continue;
    const incoming=s.one('SELECT * FROM memories WHERE id=?',row.memory_id);
    if(!incoming||!scopes.includes(incoming.scope)||!writes.includes(incoming.scope))fail(403,'memory_grant_required','Repair requires read and write for every affected scope');
    if(!memory.support(incoming).some(x=>x.event_id===e.event_id&&x.client_id===e.client_id&&x.revision===e.revision))fail(409,'repair_conflict','Original source support is missing');
    for(const change of [...(r.change?[r.change]:[]),...(r.changes??[])]) {
      // The stored expanded group itself contradicts its explicit unaffected
      // disposition. Do NOT reconstruct old model bytes/current equivalence.
      if(!change.target_ids.some((id:string)=>r.unaffected_ids?.includes(id)))continue;
      for(const target of change.target_ids) {
        const m=s.one('SELECT * FROM memories WHERE id=?',target);
        if(!m||m.scope!==incoming.scope||m.workspace_id!==a.workspace_id||!memory.support(m).length)fail(409,'repair_conflict','Target source support changed');
        const matched=s.all(`SELECT c.* FROM memory_changes c WHERE c.event_pk=? AND c.target_id=? AND c.replacement_id=? AND c.type=? AND c.effective_at=? AND NOT EXISTS (SELECT 1 FROM memory_change_invalidations i WHERE i.change_id=c.id)`,e.id,target,incoming.id,change.type,incoming.valid_from);
        for(const c of matched)changes.set(c.id,c);
        proof.push({target,version:m.version,supports:memory.support(m),disposition:change,unaffected:r.unaffected_ids});
      }
    }
    proof.push(row);
  }
  const selected=[...changes.values()].sort((a,b)=>a.id.localeCompare(b.id));
  if(!selected.length)fail(409,'repair_not_supported','No contradictory compiled truth disposition is eligible');
  return {job_id:job,event_id:e.event_id,expected_revision:e.revision,change_ids:selected.map(c=>c.id),proof_sha256:hash(canonical({event:{id:e.id,revision:e.revision,body_hash:e.body_hash},proof,changes:selected})),memory_only:true};
}
export function repairReconciliation(memory:Memory,a:Actor,body:any,job:string) {
  const s=memory.store;
  return s.transaction(()=>{
    const plan=repairPlan(memory,a,body.agent_id,job,body.expected_revision);
    if(body.expected_proof_sha256!==plan.proof_sha256||canonical(body.change_ids)!==canonical(plan.change_ids))fail(409,'repair_conflict','Repair proof or exact change set changed; inspect a fresh plan');
    const reason=text(body.reason_code,'reason_code',80);
    if(!/^[a-z0-9_-]+$/.test(reason))fail(400,'invalid_request','reason_code must be a non-content diagnostic code');
    const at=now();
    for(const change of plan.change_ids)s.run('INSERT INTO memory_change_invalidations VALUES (?,?,?,?,?,?)',change,job,a.id,reason,plan.proof_sha256,at);
    // Truth is projected from changes, not materialized in memories.valid_to.
    // Derived descendants were conservatively invalidated by the old decision;
    // leave them invalid rather than silently manufacture derived truth.
    return {...plan,invalidated_at:at,reason_code:reason};
  });
}
