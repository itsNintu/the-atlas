import {queryTerms} from './memory-index.ts';
import {prospectivePredicate,normalizedPredicate,predicateSignature} from './entity-model.ts';

const words=(s:string)=>s.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)??[];
const phrase=(text:string,label:string)=>{
 const needle=words(label).join(' ');
 return Boolean(needle)&&` ${words(text).join(' ')} `.includes(` ${needle} `);
};

// A named operational/entity question must not widen to every fact sharing the
// owner or a generic domain. Derive labels only from authorized, effective
// candidates. Declarations, broad profiles and ungrounded semantic aliases keep
// ordinary semantic admission; topic identifiers are still ranking hints only.
export function usesNamedRecallFocus(query:string){
 return /\b(?:check|inspect|verify|health|relationship\s+with)\b|\bworking\s+(?:as expected|properly|correctly|well|fine|at all)\b/i.test(query);
}
export function namedRecallFocus(query:string,rows:any[],owner?:string){
 if(!usesNamedRecallFocus(query))return [] as string[];
 const labels=new Set<string>();
 for(const row of rows)for(const label of [row.subject,...(row.objectEntity?[row.object]:[])]){
  if(typeof label!=='string'||label.length>100||words(label).length>6||!queryTerms(label).length)continue;
  if(owner&&words(owner).join(' ')===words(label).join(' '))continue;
  if(phrase(query,label))labels.add(label);
 }
 // Prefer the complete mentioned entity over a coincidentally matching suffix.
 return [...labels].filter(label=>![...labels].some(other=>other!==label&&phrase(other,label)));
}
export function matchesNamedRecallFocus(row:any,labels:string[]){
 return !labels.length||labels.some(label=>phrase(row.subject,label)||phrase(row.object,label));
}

// Observation time qualifies a plan; an open valid interval does not prove it
// was fulfilled or remains pending. This presentation never closes/retracts a
// source-backed relation or guesses which stage superseded another.
export function recallTemporalQualifier(m:any){
 if(m.historical||m.conflict)return null;
 const dates=(m.supports??[]).map((s:any)=>s.occurred_at).filter((s:any)=>typeof s==='string').sort();
 const date=String(dates.at(-1)??m.valid_from??'unknown').slice(0,10);
 if(prospectivePredicate(m.predicate)&&(predicateSignature(m.predicate).facet==='company'||normalizedPredicate(m.predicate)==='hopes_to_transition_to'))return `PLAN/EXPECTATION as of ${date}; fulfillment unverified`;
 if(/^(?:interviewing_with|discussing_compensation_with)$/.test(normalizedPredicate(m.predicate)))return `REPORTED STAGE as of ${date}; current status unverified`;
 if(/^(?:worked_at|interviewed_with|completed_interviews_with|received_offer_from)$/.test(normalizedPredicate(m.predicate)))return `PAST EVENT reported ${date}; not current status`;
 return null;
}
