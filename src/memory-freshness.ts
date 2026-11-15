import type {Store} from './store.ts';

// Scan only covering metadata, never retained content/payload rows. A head-driven
// alternative was measured and rejected: nearly all events are heads. CROSS
// JOIN fixes SQLite loop order and the reverse head index resolves currentness.
// A single authorization OR counts own/shared overlap once. MAX is deliberately
// NOT time-conditioned, unlike pending/captured counts (the existing contract).
export const freshnessSQL=`SELECT MAX(e.accepted_at) AS latest_accepted_at,MAX(e.processed_at) AS latest_processed_at,
  COALESCE(SUM(CASE WHEN e.status='pending' AND e.operation='upsert' AND e.accepted_at<=? AND e.occurred_at<=? THEN 1 ELSE 0 END),0) AS pending_count,
  COALESCE(SUM(CASE WHEN e.status='captured' AND e.operation='upsert' AND e.accepted_at<=? AND e.occurred_at<=? THEN 1 ELSE 0 END),0) AS capture_only_count
  FROM memory_events e INDEXED BY memory_event_freshness CROSS JOIN memory_heads h INDEXED BY memory_head_event ON h.event_pk=e.id
  WHERE e.workspace_id=? AND e.reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1)
    AND ((e.agent_id=? AND ?=1) OR (e.role='user' AND e.author_id='alex' AND ?=1))`;
export function recallFreshness(s:Store,workspace:string,agent:string,scopes:string[],valid_at:string,recorded_at:string) {
  return s.one(freshnessSQL,recorded_at,valid_at,recorded_at,valid_at,workspace,agent,Number(scopes.includes(`agent:${agent}`)),Number(scopes.includes('user:alex')));
}
