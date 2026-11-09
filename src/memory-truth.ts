import type { Reconciliation } from './memory-reconciliation.ts';
import type { Store } from './store.ts';

// Audited processing invalidation is recorded-time repair, not a later domain
// transition. Keep original rows for inspection and pre-repair snapshots.
export function activeChanges(store:Store,target:string,at='9999-12-31T23:59:59.999Z') {
  return store.all(`SELECT c.*,c.rowid AS change_order FROM memory_changes c
    WHERE c.target_id=? AND c.recorded_at<=? AND NOT EXISTS
    (SELECT 1 FROM memory_change_invalidations i JOIN memory_jobs j ON j.id=i.job_id JOIN memory_events e ON e.id=j.event_pk JOIN memory_heads h ON h.event_pk=e.id WHERE i.change_id=c.id AND i.recorded_at<=? AND e.status NOT IN ('forgotten','deleted','superseded'))
    ORDER BY c.recorded_at,c.rowid`,target,at,at);
}
export function consistentReconciliation(r:Reconciliation,expand:(ids:string[])=>string[]=ids=>ids):Reconciliation {
  const blocked:any[]=[...(r.blocked_dispositions??[])],changes:NonNullable<Reconciliation['changes']>=[];
  for(const change of [...(r.change?[r.change]:[]),...(r.changes??[])]) {
    for(const target of change.target_ids) {
      const group=expand([target]);
      const unaffected=group.filter(id=>r.unaffected_ids?.includes(id));
      if(unaffected.length) {
        blocked.push({type:change.type,target_ids:group,reason:'incompatible_unaffected',unaffected_ids:unaffected});
      } else changes.push({...change,target_ids:group});
    }
  }
  // A conflicting group cannot be changed by another proposal in this batch.
  const veto=new Set(blocked.flatMap(b=>b.target_ids));
  return {...r,change:undefined,changes:changes.map(c=>({...c,target_ids:c.target_ids.filter(id=>!veto.has(id))})).filter(c=>c.target_ids.length),...(blocked.length?{blocked_dispositions:blocked}:{})};
}
