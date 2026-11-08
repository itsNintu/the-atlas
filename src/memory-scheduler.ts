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
    MAX(e.accepted_at) OVER (PARTITION BY e.workspace_id,e.agent_id,e.thread_id) AS latest_accepted,
    MAX(CASE WHEN e.role='user' THEN e.accepted_at ELSE NULL END) OVER (PARTITION BY e.workspace_id,e.agent_id,e.thread_id) AS latest_user_accepted
   FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk
   WHERE j.status IN ('queued','retry','running') AND j.attempts<j.max_attempts
      OR j.status='running' AND j.lease_until>? AND j.attempts=j.max_attempts
  ) SELECT u.* FROM unfinished u LEFT JOIN memory_thread_schedule f
   ON f.workspace_id=u.workspace_id AND f.agent_id=u.agent_id AND f.thread_id=u.thread_id
   WHERE u.position=1 AND ((u.status IN ('queued','retry') AND u.available_at<=?) OR (u.status='running' AND u.lease_until<=?))`;
  // A bounded 24-claim focus preserves conversational coherence without making
  // the newest thread a monopoly. Focus rotates to the least-served human
  // conversation; other workers serve other heads and every fourth claim is old.
  let j:any=null;
  if(sequence%4!==3){
   const focus=s.one('SELECT * FROM memory_conversation_focus WHERE singleton=1');
   if(focus.remaining>0){
    j=s.one(heads+' AND u.workspace_id=? AND u.agent_id=? AND u.thread_id=? LIMIT 1',t,t,t,focus.workspace_id,focus.agent_id,focus.thread_id);
    if(j)s.run('UPDATE memory_conversation_focus SET remaining=remaining-1 WHERE singleton=1');
   }
   if(!j){
    const focusStillActive=focus.remaining>0&&s.one("SELECT 1 AS active FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk WHERE e.workspace_id=? AND e.agent_id=? AND e.thread_id=? AND j.status IN ('queued','retry','running') AND j.attempts<j.max_attempts LIMIT 1",focus.workspace_id,focus.agent_id,focus.thread_id);
    j=s.one(heads+' ORDER BY CASE WHEN u.latest_user_accepted IS NULL THEN 1 ELSE 0 END,COALESCE(f.last_claim,0),u.latest_user_accepted DESC,u.event_order DESC LIMIT 1',t,t,t);
    if(j?.latest_user_accepted&&!focusStillActive)s.run('UPDATE memory_conversation_focus SET workspace_id=?,agent_id=?,thread_id=?,remaining=23 WHERE singleton=1',j.workspace_id,j.agent_id,j.thread_id);
    else if(!focusStillActive&&focus.remaining>0)s.run("UPDATE memory_conversation_focus SET workspace_id='',agent_id='',thread_id='',remaining=0 WHERE singleton=1");
   }
  }
  j=j??s.one(heads+' ORDER BY u.accepted_at,u.event_order LIMIT 1',t,t,t);
  if(!j)return null;
  const lease_token=id('mlease');
  s.run("UPDATE memory_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,error_code=NULL WHERE id=?",lease_token,t+leaseMs,j.id);
  s.run('UPDATE memory_schedule_clock SET sequence=sequence+1 WHERE singleton=1');
  s.run('INSERT INTO memory_thread_schedule VALUES (?,?,?,?) ON CONFLICT(workspace_id,agent_id,thread_id) DO UPDATE SET last_claim=excluded.last_claim',j.workspace_id,j.agent_id,j.thread_id,sequence+1);
  const {position,latest_accepted,latest_user_accepted,event_order,workspace_id,agent_id,thread_id,accepted_at,...job}=j;
  return {...job,lease_token,attempts:j.attempts+1};
 });
}
