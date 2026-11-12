import {normalizedPredicate,topicLabel} from './entity-model.ts';

// Explicit observations/residence only: neither work preferences, timezone,
// birthplace nor travel intentions establish physical whereabouts.
export const LOCATION_PREDICATES=['lives_in','resides_in','resident_of','based_in','current_location','last_known_location','currently_in','is_currently_in','located_in'];
export const CURRENT_WORK_PREDICATES=['job_title','works_in','current_role','occupation','works_at','works_for','employed_by','employer','current_company','on_trial_with','on_work_trial_with','trial_with'];
export function sourceTime(m:any):string{
 return (m.supports??[]).map((s:any)=>s.occurred_at).filter((s:any)=>typeof s==='string'&&Number.isFinite(Date.parse(s))).sort().at(-1)??'';
}
export function continuityLocation(m:any){
 return String(m.scope??'').startsWith('user:')&&normalizedPredicate(String(m.subject??''))===normalizedPredicate(m.scope.slice(5))&&
  LOCATION_PREDICATES.includes(normalizedPredicate(m.predicate))&&!m.historical&&!m.conflict&&Boolean(sourceTime(m));
}
export function sessionPacketLine(m:any,format:(m:any,time?:string)=>string,topic=false){
 const source=`source ${sourceTime(m).slice(0,10)||'date unknown'}`;
 if(topic){
  // Attribute the label using the same support rule as ordinary compact facts.
  const author=String(m.supports?.[0]?.author_id??'');
  const speaker=!author||author==='alex'||author.endsWith('/alex')?'':`${author} noted: `;
  return `${speaker}recent: ${topicLabel(m)} (${source})`;
 }
 if(continuityLocation(m)){
  const residence=['lives_in','resides_in','resident_of','based_in'].includes(normalizedPredicate(m.predicate));
  // Remove the ordinary validity suffix: source observation is not the start of
  // residence, nor proof of current physical presence, even with an open end.
  return format(m,`LAST REPORTED ${residence?'RESIDENCE':'LOCATION'}; ${source}; current whereabouts unverified`);
 }
 return `${format(m)} (${source})`;
}
