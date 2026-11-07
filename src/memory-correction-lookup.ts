import type {Memory} from './memory.ts';
import {activeChanges} from './memory-truth.ts';

// A relevant rejected claim can locate its positive correction. Never follow
// state-change edges here: formerly-true history is a different recall path.
export function correctionReplacements(memory:Memory,target:any,valid_at:string,recorded_at:string) {
  const s=memory.store,queue=activeChanges(s,target.id,recorded_at).filter(c=>c.type==='correction'&&c.replacement_id).map(c=>c.replacement_id),seen=new Set<string>(),result:any[]=[];
  if(!memory.support(target,recorded_at).length)return result;
  for(const id of queue) {
    if(seen.has(id)||seen.size>=8)continue;seen.add(id);
    const m=s.one('SELECT * FROM memories WHERE id=? AND workspace_id=? AND scope=?',id,target.workspace_id,target.scope);
    if(!m||!memory.support(m,recorded_at).length)continue;
    if(memory.effective(m,valid_at,recorded_at)){result.push(m);continue;}
    for(const c of activeChanges(s,id,recorded_at))if(['correction','superseded'].includes(c.type)&&c.replacement_id&&queue.length<16)queue.push(c.replacement_id);
  }
  return result;
}
