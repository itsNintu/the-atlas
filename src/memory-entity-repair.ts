import type { Memory } from './memory.ts';
import { canonical, hash, id, now, type Actor } from './store.ts';
import { fail, integer, text } from './errors.ts';
import { assertCurrentJobEpoch } from './reset-state.ts';
import { automaticStatusNotification } from './memory-admission.ts';
import { activeChanges } from './memory-truth.ts';

/** Narrow deterministic amendment, NOT an extraction/replay API. Both claims must
 * already exist. The owner source must explicitly identify the old/new pet names.
 * No copied supports: memory_supports has no insertion recorded-time, so copying
 * an old support would silently rewrite the replacement's recorded history. */
export type EntityRepairRequest = {
  agent_id: string;
  old_memory_id: string;
  replacement_memory_id: string;
  client_id: string;
  event_id: string;
  expected_revision: number;
  identity_excerpt: string;
  // Optional exact mistaken processing retractions, never domain state changes.
  invalidate_change_ids?: string[];
  retraction_excerpt?: string;
  // Explicit authenticated operator assessment of contextual co-reference or
  // a mistaken processing disposition, not a claimed model extraction result.
  owner_review?: {identity:boolean; retractions?:boolean; basis:string};
  // Close only the same-scope replacement of an exact invalidated retraction.
  // This withdraws an overgeneralized sibling without deleting its history.
  close_retraction_replacements?: boolean;
};
const operation = 'supported_entity_repair_v1';
const normalize = (v:string) => v.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' ');
const escape = (v:string) => v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

/** Deliberately small proof language. Matching names, co-occurrence, ordinary
 * ownership and agent reports alone are NOT identity proof. Fail closed on prose
 * outside these explicit same-pet/name-correction forms; never ask a model. */
export function supportedPetIdentity(excerpt:string, oldName:string, newName:string, species:string) {
  const old=escape(oldName),next=escape(newName),pet=species==='pet'?'pet':species;
  const q=(s:string)=>`["“”']?${s}["“”']?`;
  return [
    `${q(old)} is the same ${pet} as ${q(next)}`,
    `${q(old)}(?:,)? (?:is )?now (?:named|called) ${q(next)}`,
    `(?:my |the )?${pet}(?:'s|’s) (?:correct )?name is ${q(next)},? not ${q(old)}`,
  ].some(p=>new RegExp(`^(?:${p})[.!]?$`,'iu').test(excerpt.trim()));
}

/** Use as Store.write's authorization callback too: a cached idempotent receipt
 * must not bypass revocation or affected-scope authorization. No proof is read
 * before both affected memories have passed workspace/read/write checks. */
export function authorizeEntityRepair(memory:Memory,a:Actor,body:EntityRepairRequest) {
  const reads=memory.authorize(a,body.agent_id),writes=memory.authorize(a,body.agent_id,'write');
  const rows=[body.old_memory_id,body.replacement_memory_id].map(value=>memory.store.one(
    'SELECT * FROM memories WHERE id=? AND workspace_id=?',text(value,'memory_id',200),a.workspace_id));
  if(rows.some(m=>!m||!reads.includes(m.scope)))fail(404,'not_found','Affected memory not found');
  if(rows.some(m=>!writes.includes(m.scope)))fail(403,'memory_grant_required','Read and write required for every affected scope');
  if(rows[0].scope!==rows[1].scope)fail(409,'repair_not_supported','Cross-scope identity repair is not supported');
  return rows;
}

function inspect(memory:Memory,a:Actor,body:EntityRepairRequest) {
  const [old,replacement]=authorizeEntityRepair(memory,a,body),s=memory.store;
  if(old.id===replacement.id||old.derived||replacement.derived||
    !['owns','has','owner_of','possesses'].includes(normalize(old.predicate)))
    fail(409,'repair_not_supported','Requires distinct direct generic ownership and typed pet claims');
  const species=/^has_(dog|cat|pet)$/.exec(normalize(replacement.predicate))?.[1];
  if(!species||old.subject_id!==replacement.subject_id||old.kind!==replacement.kind||old.valid_to!==replacement.valid_to)
    fail(409,'repair_not_supported','Requires the same actor, kind and end bound with an existing typed pet claim');
  const target=s.one('SELECT * FROM memory_entity_targets WHERE memory_id=?',replacement.id);
  const oldTarget=s.one('SELECT * FROM memory_entity_targets WHERE memory_id=?',old.id);
  // Explicit literals are not entities. A legacy untyped ownership object can
  // bind only to an existing exact entity label, not an invented new entity.
  const prior=oldTarget?.entity_id ? s.one('SELECT * FROM memory_entities WHERE id=?',oldTarget.entity_id) :
    oldTarget ? null : s.one('SELECT * FROM memory_entities WHERE workspace_id=? AND canonical=?',a.workspace_id,old.object);
  const next=target?.entity_id?s.one('SELECT * FROM memory_entities WHERE id=?',target.entity_id):null;
  if(!prior||!next||prior.workspace_id!==a.workspace_id||next.workspace_id!==a.workspace_id||prior.id===next.id)
    fail(409,'repair_not_supported','Requires existing distinct entity targets; explicit literals cannot be retargeted');
  const e=s.one(`SELECT e.*,j.reset_epoch AS job_reset_epoch FROM memory_events e
    JOIN memory_heads h ON h.event_pk=e.id JOIN memory_jobs j ON j.id=e.job_id
    WHERE e.workspace_id=? AND e.agent_id=? AND e.client_id=? AND e.event_id=?`,
    a.workspace_id,body.agent_id,text(body.client_id,'client_id',200),text(body.event_id,'event_id',200));
  if(!e)fail(404,'not_found','Current amendment source not found');
  assertCurrentJobEpoch(s,e.reset_epoch,e.job_reset_epoch);
  if(e.revision!==integer(body.expected_revision,'expected_revision',1,Number.MAX_SAFE_INTEGER))
    fail(409,'revision_conflict','Amendment revision changed');
  if(e.operation!=='upsert'||e.role!=='user'||!['pending','processed'].includes(e.status)||automaticStatusNotification(e))
    fail(409,'repair_not_supported','Identity amendment requires a current genuine user communication');
  const excerpt=text(body.identity_excerpt,'identity_excerpt',2000);
  const retained=s.all(`SELECT excerpt FROM memory_supports WHERE event_pk=? AND memory_id IN (?,?)`,e.id,old.id,replacement.id);
  // A caller cannot carve the positive clause out of a negation/report. Only a
  // complete standalone source line is admitted by this deliberately narrow API.
  const hasLine=(v:unknown,quote:string)=>typeof v==='string'&&v.split(/\r?\n/).some(line=>line.trim()===quote.trim());
  const reviewed=body.owner_review;
  if(reviewed && (reviewed.identity!==true||typeof reviewed.basis!=='string'||reviewed.basis.trim().length<12||reviewed.basis.length>2000))
    fail(400,'invalid_request','Operator assessment needs explicit identity and a bounded evidence rationale');
  const retainedSource=[e.content,...retained.map(r=>r.excerpt)].some(v=>typeof v==='string'&&(reviewed?v.includes(excerpt):hasLine(v,excerpt)));
  if(!retainedSource||!reviewed&&!supportedPetIdentity(excerpt,old.object,replacement.object,species))
    fail(409,'repair_not_supported','Retained source and supported identity assessment required');
  // Context review is an attributed operator disposition, not a deterministic
  // natural-language oracle. Require both exact original endpoints and their
  // genuine retained sources; proof-CAS records the complete bounded evidence.
  if(reviewed && (!e.content?.includes(replacement.object)||!memory.communicationSupport(old).length||!memory.communicationSupport(replacement).length))
    fail(409,'repair_not_supported','Contextual review requires genuine endpoint provenance');
  const supports=[old,replacement].map(m=>{
    const rows=s.all(`SELECT p.*,e.body_hash,e.revision,e.client_id,e.event_id,e.agent_id,e.role,e.author_id,e.status,
      e.reset_epoch,e.accepted_at,e.occurred_at,e.operation,h.event_pk AS head_pk
      FROM memory_supports p JOIN memory_events e ON e.id=p.event_pk LEFT JOIN memory_heads h
      ON h.workspace_id=e.workspace_id AND h.client_id=e.client_id AND h.event_id=e.event_id
      WHERE p.memory_id=? ORDER BY p.event_pk`,m.id);
    if(!rows.length||rows.length>32||rows.some(r=>r.head_pk!==r.event_pk||r.operation!=='upsert'||!['pending','processed'].includes(r.status)||!['user','assistant','inter_agent'].includes(r.role)))
      fail(409,'repair_conflict','All bounded direct supports must still be current genuine communication');
    for(const r of rows)assertCurrentJobEpoch(s,r.reset_epoch);
    if(!memory.communicationSupport(m).length)fail(409,'repair_conflict','Genuine communication support required');
    return rows;
  });
  const ids=body.invalidate_change_ids??[];
  if(!Array.isArray(ids)||ids.length>4||new Set(ids).size!==ids.length||ids.some(v=>typeof v!=='string'))
    fail(400,'invalid_request','At most four distinct exact retraction change IDs are supported');
  const changes=[activeChanges(s,old.id),activeChanges(s,replacement.id)];
  if(changes[0].some(c=>!['conflict','start_unknown'].includes(c.type)))fail(409,'repair_conflict','Old representation already has a disposition');
  const invalidated=changes[1].filter(c=>ids.includes(c.id));
  if(invalidated.length!==ids.length||invalidated.some(c=>c.type!=='retraction')||
    changes[1].some(c=>!ids.includes(c.id)&&!['conflict','start_unknown'].includes(c.type)))
    fail(409,'repair_conflict','Only exact earlier retractions of the replacement can be invalidated');
  if(ids.length && reviewed?.retractions!==true){
    const quote=text(body.retraction_excerpt,'retraction_excerpt',2000);
    if(!hasLine(e.content,quote))fail(409,'repair_not_supported','Retained correction evidence or an explicit attributed operator review is required');
  }
  const siblings=body.close_retraction_replacements?invalidated.map(c=>{
    if(!c.replacement_id)fail(409,'repair_not_supported','Overgeneralized closure requires the retraction replacement');
    const row=s.one('SELECT * FROM memories WHERE id=? AND workspace_id=?',c.replacement_id,a.workspace_id);
    if(!row||row.scope!==old.scope||row.id===old.id||row.id===replacement.id)fail(409,'repair_not_supported','Retraction replacement is not a same-scope sibling');
    if(!memory.communicationSupport(row).length)fail(409,'repair_conflict','Sibling needs genuine communication support');
    return row;
  }):[];
  if(body.close_retraction_replacements&&reviewed?.retractions!==true)fail(409,'repair_not_supported','Closing an overgeneralized sibling requires an attributed retraction review');
  const equivalences=s.all(`SELECT * FROM memory_entity_equivalences WHERE workspace_id=? AND scope=? AND entity_id IN (?,?) ORDER BY entity_id,canonical_id,event_pk`,a.workspace_id,old.scope,prior.id,next.id);
  const oldCanonical=memory.canonicalEntity(a.workspace_id,old.scope,prior.id),newCanonical=memory.canonicalEntity(a.workspace_id,old.scope,next.id);
  if(newCanonical!==next.id||(oldCanonical!==prior.id&&oldCanonical!==next.id)||equivalences.some(q=>q.entity_id===next.id||q.canonical_id!==next.id))
    fail(409,'repair_conflict','Ambiguous or redirected identity is not supported');
  const aliases=s.all(`SELECT * FROM memory_scoped_aliases WHERE workspace_id=? AND scope=? AND alias IN (?,?) ORDER BY alias`,a.workspace_id,old.scope,normalize(old.object),normalize(replacement.object));
  if(aliases.some(r=>r.entity_id!==(r.alias===normalize(old.object)?prior.id:next.id)))
    fail(409,'repair_conflict','Conflicting scoped alias');
  const proof={operation,principal_id:a.id,workspace_id:a.workspace_id,request:body,old,replacement,source:{id:e.id,revision:e.revision,body_hash:e.body_hash,status:e.status,job_id:e.job_id},supports,changes,siblings,equivalences,aliases};
  return {old,replacement,prior,next,e,invalidated,siblings,proof};
}

export function entityRepairPlan(memory:Memory,a:Actor,body:EntityRepairRequest) {
  // Synchronous snapshot, no providers, no source/job creation or mutation.
  return memory.store.transaction(()=>{
    const x=inspect(memory,a,body);
    return {operation,old_memory_id:x.old.id,replacement_memory_id:x.replacement.id,scope:x.old.scope,
      canonical_entity_id:x.next.id,previous_entity_id:x.prior.id,
      source_event_pk:x.e.id,job_id:x.e.job_id,expected_revision:x.e.revision,
      source_revisions:x.proof.supports.flat().map(r=>({event_pk:r.event_pk,revision:r.revision})),
      invalidate_change_ids:x.invalidated.map(c=>c.id).sort(),closed_memory_ids:x.siblings.map(m=>m.id).sort(),proof_sha256:hash(canonical(x.proof)),memory_only:true,
      copies_supports:false,rewrites_valid_time:false};
  });
}

export function repairMemoryEntity(memory:Memory,a:Actor,body:EntityRepairRequest & {expected_proof_sha256:string;reason_code:string}) {
  return memory.store.transaction(()=>{
    // Do not include apply-only fields in the preview fingerprint.
    const {expected_proof_sha256,reason_code,...request}=body;
    const reason=text(reason_code,'reason_code',80);
    if(!/^[a-z0-9_-]+$/.test(reason))fail(400,'invalid_request','reason_code must be a non-content diagnostic code');
    const plan=entityRepairPlan(memory,a,request);
    if(expected_proof_sha256!==plan.proof_sha256)fail(409,'repair_conflict','Repair proof changed; inspect a fresh preview');
    const {old,replacement,prior,next,e,invalidated,siblings}=inspect(memory,a,request),s=memory.store,at=now();
    // Existing scoped aliases keep their original IDs. Their canonical projection
    // follows this timestamped, source-backed equivalence; no registry overwrite.
    memory.entity(a.workspace_id,old.object,[],[old.scope],e.id);
    memory.entity(a.workspace_id,replacement.object,[],[old.scope],e.id);
    s.run('INSERT OR IGNORE INTO memory_entity_equivalences VALUES (?,?,?,?,?,?)',a.workspace_id,old.scope,prior.id,next.id,e.id,at);
    const change_id=id('change');
    s.run('INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)',change_id,e.id,old.id,replacement.id,'superseded',replacement.valid_from,at);
    for(const c of invalidated)s.run('INSERT INTO memory_change_invalidations VALUES (?,?,?,?,?,?)',c.id,e.job_id,a.id,reason,plan.proof_sha256,at);
    const closed_change_ids=siblings.map(row=>{
      const sibling_change=id('change');
      s.run('INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)',sibling_change,e.id,row.id,null,'retraction',at,at);
      return sibling_change;
    });
    s.run('INSERT INTO memory_reconciliations VALUES (?,?,?,?,?)',e.job_id,e.id,replacement.id,canonical({operation,model:'owner_directive',review:request.owner_review??null,principal_id:a.id,reason_code:reason,proof_sha256:plan.proof_sha256,old_memory_id:old.id,replacement_memory_id:replacement.id,change_id,closed_change_ids,closed_memory_ids:plan.closed_memory_ids,identity_excerpt_sha256:hash(request.identity_excerpt),invalidated_change_ids:plan.invalidate_change_ids}),at);
    return {...plan,change_id,closed_change_ids,recorded_at:at,reason_code:reason};
  });
}
