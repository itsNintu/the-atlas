import type {Memory} from './memory.ts';
import {activeChanges} from './memory-truth.ts';
import {queryTerms} from './memory-index.ts';

// Negative correction evidence belongs to a relevant positive selection, never
// becomes a positive past state or an independently relevance-admitted memory.
export function correctionEvidence(memory:Memory,m:any,recorded_at:string) {
  const s=memory.store,queue=[{id:m.id,depth:0}],seen=new Set<string>(),found:any[]=[];
  for(const {id,depth} of queue) {
    if(seen.has(id)||seen.size>=8)continue;seen.add(id);
    const current=s.one('SELECT * FROM memories WHERE id=? AND workspace_id=? AND scope=?',id,m.workspace_id,m.scope);
    if(!current||!memory.support(current,recorded_at).length)continue;
    const inbound=s.all("SELECT c.*,t.subject,t.predicate,t.object,t.scope,t.workspace_id FROM memory_changes c JOIN memories t ON t.id=c.target_id WHERE c.replacement_id=? AND c.recorded_at<=? AND c.type IN ('correction','superseded') ORDER BY length(t.object),c.id LIMIT 24",id,recorded_at);
    for(const c of inbound) {
      if(c.scope!==m.scope||c.workspace_id!==m.workspace_id||!activeChanges(s,c.target_id,recorded_at).some(x=>x.id===c.id))continue;
      const target=s.one('SELECT * FROM memories WHERE id=?',c.target_id);
      if(!memory.support(target,recorded_at).length)continue;
      if(c.type==='superseded'){if(queue.length<8)queue.push({id:c.target_id,depth:depth+1});continue;}
      const source=s.one('SELECT e.* FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id WHERE e.id=? AND e.accepted_at<=?',c.event_pk,recorded_at);
      if(!source)continue;
      // The replacement's support must actually retain this correcting source,
      // not merely a source paragraph reached through an unrelated transition.
      if(!memory.support(current,recorded_at).some(x=>x.client_id===source.client_id&&x.event_id===source.event_id&&x.revision===source.revision))continue;
      const oldTerms=queryTerms(c.object),newTerms=queryTerms(m.object);
      const retainedSupport=memory.support(current,recorded_at).find(x=>x.client_id===source.client_id&&x.event_id===source.event_id&&x.revision===source.revision);
      // Support excerpts are scoped by apply(): own-scope source excerpts may
      // retain context; shared claims retain only the published literal. Reading
      // source.content here would leak private siblings from an agent event.
      const sentences=((retainedSupport?.excerpt??'') as string).match(/[^.!?\n]+(?:[.!?]+|$)/gu)??[];
      const excerpt=sentences.map(x=>x.trim()).find(x=>x.length<=360&&/\b(never|always|mistaken|incorrect|correction|wrong)\b/i.test(x)&&oldTerms.some(t=>queryTerms(x).includes(t))&&newTerms.some(t=>queryTerms(x).includes(t)))??null;
      if(found.some(x=>x.subject===c.subject&&x.predicate===c.predicate&&x.object===c.object))continue;
      found.push({representation_depth:depth,change_id:c.id,target_id:c.target_id,subject:c.subject,predicate:c.predicate,object:c.object,type:'correction',meaning:c.subject===current.subject&&c.predicate===current.predicate&&c.object===current.object?'interval_correction':'never_true_not_former_state',effective_at:c.effective_at,recorded_at:c.recorded_at,source:{client_id:source.client_id,event_id:source.event_id,revision:source.revision,role:source.role,author_id:source.author_id,occurred_at:source.occurred_at},excerpt});
    }
  }
  // Claim-level deduplication is above, not source-level: a source can correct
  // more than one claim. Prefer concise atomic targets before compound copies.
  return found.filter(c=>!found.some(other=>other.source.client_id===c.source.client_id&&other.source.event_id===c.source.event_id&&other.excerpt!==null&&other.excerpt===c.excerpt&&other.representation_depth<c.representation_depth)).sort((a,b)=>a.object.length-b.object.length).slice(0,4);
}
export function correctionLines(corrections:ReturnType<typeof correctionEvidence>) {
  const seen=new Set<string>();
  return corrections.filter(c=>{const key=JSON.stringify([c.meaning,c.source,c.excerpt??[c.subject,c.predicate,c.object]]);if(seen.has(key))return false;seen.add(key);return true;}).map(c=>` CORRECTION [${c.change_id}]: ${c.meaning==='interval_correction'?'corrected validity interval, not a never-true claim':'never-true belief, NOT a formerly true state'}: ${c.subject} | ${c.predicate} | ${c.object}; source ${c.source.client_id}:${c.source.event_id}@${c.source.revision} ${c.source.role}/${c.source.author_id}${c.excerpt?`; source scope: ${c.excerpt}`:''}`).join('');
}
