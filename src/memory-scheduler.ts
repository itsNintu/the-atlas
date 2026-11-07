import {Store,id} from './store.ts';

// Three least-served-thread turns followed by one oldest-work turn. The persisted
// clock makes the reserve survive process restarts and independent workers.
// A thread's oldest unfinished event is its sole eligible head: leases/backoff
// cannot let a later conversational correction overtake its original evidence.
export function claimMemoryJob(s:Store,leaseMs:number) {
 return s.transaction(()=>{
  const t=Date.now();
  s.run("UPDATE memory_jobs SET status='failed',error_code='lease_exhausted',lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<=? AND attempts>=max_attempts",t);
  const sequence=s.one('SELECT sequence FROM memory_schedule_clock WHERE singleton=1').sequence as number;
  const heads=`WITH unfinished AS (
   SELECT j.*,e.workspace_id,e.agent_id,e.thread_id,e.accepted_at,e.rowid AS event_order,
    ROW_NUMBER() OVER (PARTITION BY e.workspace_id,e.agent_id,e.thread_id ORDER BY e.accepted_at,e.rowid) AS position,
    MAX(e.accepted_at) OVER (PARTITION BY e.workspace_id,e.agent_id,e.thread_id) AS latest_accepted
   FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk
   WHERE j.status IN ('queued','retry','running') AND j.attempts<j.max_attempts
      OR j.status='running' AND j.lease_until>? AND j.attempts=j.max_attempts
  ) SELECT u.* FROM unfinished u LEFT JOIN memory_thread_schedule f
   ON f.workspace_id=u.workspace_id AND f.agent_id=u.agent_id AND f.thread_id=u.thread_id
   WHERE u.position=1 AND ((u.status IN ('queued','retry') AND u.available_at<=?) OR (u.status='running' AND u.lease_until<=?))`;
  // No age cutoff: an overdue conversation must not age out of the fair lane.
  // New/least-served threads rotate, newest intake breaks unseen-thread ties.
  // Original accepted_at, never chunk requeue time, orders the oldest reserve.
  const recent=sequence%4!==3?s.one(heads+' ORDER BY COALESCE(f.last_claim,0),u.latest_accepted DESC,u.event_order DESC LIMIT 1',t,t,t):null;
  const j=recent??s.one(heads+' ORDER BY u.accepted_at,u.event_order LIMIT 1',t,t,t);
  if(!j)return null;
  const lease_token=id('mlease');
  s.run("UPDATE memory_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,error_code=NULL WHERE id=?",lease_token,t+leaseMs,j.id);
  s.run('UPDATE memory_schedule_clock SET sequence=sequence+1 WHERE singleton=1');
  s.run('INSERT INTO memory_thread_schedule VALUES (?,?,?,?) ON CONFLICT(workspace_id,agent_id,thread_id) DO UPDATE SET last_claim=excluded.last_claim',j.workspace_id,j.agent_id,j.thread_id,sequence+1);
  const {position,latest_accepted,event_order,workspace_id,agent_id,thread_id,accepted_at,...job}=j;
  return {...job,lease_token,attempts:j.attempts+1};
 });
}
