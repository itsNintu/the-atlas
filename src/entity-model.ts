// Bounded, source-qualified entity/relation vocabulary shared by graph reads and recall.
// This is deliberately an open triple model: unknown predicates/types remain valid.
export const ENTITY_TYPE_PREDICATES = new Set(['is_a','instance_of','entity_type','has_type','type']);
const norm=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[\s-]+/g,'_').replace(/^_+|_+$/g,'');
const tokens=(value:string)=>new Set(value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[]);
const TYPE_ALIASES:Record<string,string>={
 dog:'dog',dogs:'dog',doggo:'dog',doggos:'dog',puppy:'dog',puppies:'dog',pooch:'dog',pooches:'dog',
 cat:'cat',cats:'cat',kitty:'cat',kitties:'cat',kitten:'cat',kittens:'cat',
 pet:'pet',pets:'pet',person:'person',people:'person',human:'person',humans:'person',
 car:'vehicle',cars:'vehicle',vehicle:'vehicle',vehicles:'vehicle',motorcycle:'vehicle',motorcycles:'vehicle',bike:'vehicle',bikes:'vehicle',
};
const TYPE_PARENTS:Record<string,string[]>={dog:['pet'],cat:['pet']};
export function canonicalEntityType(value:string){const n=norm(value);return TYPE_ALIASES[n]??n;}
function withParents(types:Iterable<string>){const out=new Set<string>();for(const type of types){if(!type)continue;out.add(type);for(const parent of TYPE_PARENTS[type]??[])out.add(parent);}return [...out];}
const FAMILY=new Set(['is_married_to','married_to','spouse_of','partner_of','parent_of','has_child','child_of','son_of','daughter_of','has_sibling','sibling_of','brother_of','sister_of','family_member','member_of_family']);
const WORK_ROLE=new Set(['job_title','role','current_role','occupation','works_at','works_for','works_in','typically_works_with','is_interviewing_for','employed_by','employer','company','current_company']);
const WORK_PROJECT=new Set(['maintains','builds','building','develops','developing','working_on','leads','leading','contributes_to','active_project','has_project','current_project','project','aspires_to_build']);
const WORK_RESPONSIBILITY=new Set(['responsibility','responsibilities','responsible_for','duties','duty','scope_of_work']);
const WORK_DECISION=new Set(['decision','has_decision','active_decision','decided','goal','has_goal','active_goal','objective','priority','priorities','plan']);
const LANGUAGES=new Set(['knows_basic','speaks','language','languages','fluent_in','reads']);
const VEHICLES=new Set(['drives','owns_vehicle','has_car','has_motorcycle','motorcycle','vehicle']);
const OWNERSHIP=new Set(['owns','owner_of','has','possesses']);
const NAME=new Set(['name','named','called','has_name','pet_name']);
export type PredicateSignature={topics:string[];facet?:string;subjectTypes:string[];objectTypes:string[];ownership:boolean;typeRelation:boolean};
export function predicateSignature(predicate:string):PredicateSignature{
 const p=norm(predicate),dynamic=/^has_(dog|cat|pet)$/.exec(p)?.[1];
 const family=FAMILY.has(p),workRole=WORK_ROLE.has(p),workProject=WORK_PROJECT.has(p),workResponsibility=WORK_RESPONSIBILITY.has(p),workDecision=WORK_DECISION.has(p);
 const work=workRole||workProject||workResponsibility||workDecision;
 const topics=[...new Set([dynamic||p==='pet_of'?'pet':'',family?'family':'',work?'work':'',LANGUAGES.has(p)?'language':'',VEHICLES.has(p)?'vehicle':''].filter(Boolean))];
 const facet=NAME.has(p)?'name':workRole?'role':workProject?'project':workResponsibility?'responsibility':workDecision?'decision':family?'family':dynamic?'pet':undefined;
 return {topics,facet,
  subjectTypes:dynamic||family||workRole?['person']:[],
  objectTypes:dynamic?[canonicalEntityType(dynamic)]:family?['person']:['works_at','works_for','employed_by','employer','company','current_company'].includes(p)?['organization']:workProject?['project']:[],
  ownership:OWNERSHIP.has(p)||Boolean(dynamic),typeRelation:ENTITY_TYPE_PREDICATES.has(p)};
}
function textTopics(value:string){
 const t=tokens(value),has=(words:string[])=>words.some(w=>t.has(w)),topics:string[]=[];
 if(has(['pet','pets','dog','dogs','doggo','doggos','puppy','puppies','cat','cats','kitty','kitten','kittens']))topics.push('pet');
 if(has(['family','spouse','wife','husband','married','child','children','son','daughter','sibling','siblings','brother','sister','parent','parents']))topics.push('family');
 if(has(['work','working','building','developing','job','jobs','employment','employer','company','companies','business','role','roles','responsibility','responsibilities','decision','decisions','goal','goals','objective','objectives']))topics.push('work');
 if(has(['language','languages','speak','speaks','fluent']))topics.push('language');
 if(has(['car','cars','vehicle','vehicles','motorcycle','motorcycles','bike','bikes']))topics.push('vehicle');
 return topics;
}
export type MemoryEntityInfo={subjectTypes:string[];objectTypes:string[];topics:string[];signature:PredicateSignature;objectEntity:boolean};
export function memoryEntityInfo(m:any,explicitSubject:string[]=[],explicitObject:string[]=[],objectEntity=false):MemoryEntityInfo{
 const signature=predicateSignature(m.predicate),subjectTypes=withParents([...explicitSubject,...signature.subjectTypes].map(canonicalEntityType)),objectTypes=withParents([...explicitObject,...signature.objectTypes].map(canonicalEntityType));
 const topics=new Set<string>(signature.topics);
 for(const topic of textTopics(`${m.subject} ${m.predicate} ${m.object}`))topics.add(topic);
 if(subjectTypes.some(t=>['dog','cat','pet'].includes(t))||objectTypes.some(t=>['dog','cat','pet'].includes(t)))topics.add('pet');
 if(objectTypes.includes('vehicle'))topics.add('vehicle');
 return {subjectTypes,objectTypes,topics:[...topics],signature,objectEntity};
}
export type RecallMode='narrow'|'domain'|'profile'|'general';
export type RecallPlan={mode:RecallMode;topics:string[];recentTopics:string[];entityTypes:string[];requiredType?:string;facets:string[];owner?:string;topicShift:boolean;includeHistory:boolean;context:string[]};
const CONTEXT_REFERENCE=/\b(?:it|its|she|he|her|his|they|them|their|that|this|those|these|same|former|latter|back to)\b/i;
function queryFacets(query:string){
 const q=query.normalize('NFKC').toLowerCase().replaceAll('_',' '),facets:string[]=[];
 if(/\b(?:name|named|called)\b/.test(q))facets.push('name');
 if(/\b(?:breed|species)\b/.test(q))facets.push('breed');
 if(/\b(?:color|colour)\b/.test(q))facets.push('color');
 if(/\b(?:birthday|birth_date|born|age)\b/.test(q))facets.push('birth');
 if(/\b(?:owner|owns|belongs_to)\b/.test(q))facets.push('owner');
 if(/\b(?:responsibility|responsibilities|duties|responsible_for)\b/.test(q))facets.push('responsibility');
 if(/\b(?:decision|decisions|goal|goals|objective|objectives|priority|priorities)\b/.test(q))facets.push('decision');
 if(/\b(?:job_title|role|company|employer|occupation)\b/.test(q))facets.push('role');
 if(/\b(?:project|projects|working_on|building|developing|maintains)\b/.test(q))facets.push('project');
 return [...new Set(facets)];
}
export function analyzeRecallQuery(query:string,recent:string[]=[]):RecallPlan{
 const q=query.normalize('NFKC'),lower=q.toLowerCase(),topics=textTopics(q),recentTopics=[...new Set(recent.flatMap(textTopics))];
 const profile=/\b(?:what do you know about me|tell me (?:everything |more )?about me|who am i|my (?:profile|background|details)|summari[sz]e me)\b/i.test(q);
 const facets=queryFacets(q),workOverview=topics.includes('work')&&(/\b(?:talk about work|currently working|current (?:work|projects?|role|goals?|decisions?)|work details|what am i working on|active (?:projects?|goals?|decisions?)|work overview)\b/i.test(q)||!facets.length&&/\b(?:tell me about|what'?s happening in|discuss)\b/i.test(q));
 const types=[...new Set([...tokens(q)].map(canonicalEntityType).filter(t=>['dog','cat','pet','person','vehicle'].includes(t)))];
 const requiredType=types.includes('dog')?'dog':types.includes('cat')?'cat':types.includes('vehicle')?'vehicle':types.includes('pet')?'pet':undefined;
 const ownerMatch=/\b([\p{L}][\p{L}\p{N}_-]*)['’]s\b/iu.exec(q),ownerCandidate=ownerMatch?.[1];
 const owner=ownerCandidate&&!['what','who','whose','dog','doggos','doggo','cat','kitty','pet','name'].includes(ownerCandidate.toLowerCase())?ownerCandidate:undefined;
 const shiftMarker=/\b(?:back to|let'?s talk about|switch(?:ing)? to|change(?:d)? topic|instead)\b/i.test(q);
 const topicShift=Boolean(topics.length&&(shiftMarker||(recentTopics.length&&!topics.some(t=>recentTopics.includes(t)))));
 const includeHistory=/\b(?:former|formerly|previous|past|first job|used to|history|used_to)\b/i.test(q);
 const needsContext=CONTEXT_REFERENCE.test(q)||!topics.length&&tokens(q).size<=6;
 const context=!topicShift&&needsContext?recent.filter((message,index)=>{
  if(!topics.length)return true;const mt=textTopics(message);return !mt.length||mt.some(t=>topics.includes(t))||index===recent.length-1&&facets.length>0;
 }):[];
 const contextTopics=recent.map(textTopics).reverse().find(t=>t.length)??[];
 const mode:RecallMode=profile?'profile':workOverview||topics.includes('work')&&!facets.length?'domain':facets.length&&topics.length?'narrow':facets.some(f=>['name','breed','color','birth','owner'].includes(f))?'narrow':facets.length&&contextTopics.length?'narrow':'general';
 const contextTypes=types.length?types:context.length?[...new Set([...tokens(context.join(' '))].map(canonicalEntityType))]:[];
 const inheritedType=requiredType??contextTypes.find(t=>['dog','cat','vehicle','pet'].includes(t));
 return {mode,topics:topics.length?topics:context.length?contextTopics:[],recentTopics,entityTypes:types,requiredType:inheritedType,facets,owner,topicShift,includeHistory,context};
}
export function recallQueryExpansion(plan:RecallPlan){
 const terms=new Set<string>();
 if(plan.topics.includes('pet'))for(const term of ['pet','pets','dog','doggo','doggos','puppy','cat','kitty','kitten','has_pet','has_dog','has_cat','owns','name','named','called'])terms.add(term);
 if(plan.topics.includes('family'))for(const term of ['family','married','is_married_to','spouse','wife','husband','parent','parent_of','child','sibling','has_sibling','member_of_family'])terms.add(term);
 if(plan.topics.includes('work'))for(const term of ['work','job','job_title','role','employment','employed_by','employer','company','business','project','projects','maintains','builds','develops','working_on','responsibility','responsibilities','responsible_for','decision','active_decision','goal','objective','priority'])terms.add(term);
 if(plan.topics.includes('language'))for(const term of ['language','languages','speaks','knows_basic','fluent_in'])terms.add(term);
 if(plan.topics.includes('vehicle'))for(const term of ['vehicle','car','motorcycle','bike','drives','owns_vehicle'])terms.add(term);
 if(plan.facets.includes('name'))for(const term of ['name','named','called','has_name'])terms.add(term);
 for(const facet of plan.facets)terms.add(facet);
 if(plan.owner)terms.add(plan.owner);
 return [...terms].join(' ');
}
function typeMatches(actual:string[],required?:string){return !required||actual.includes(required)||required==='pet'&&actual.some(t=>['dog','cat','pet'].includes(t));}
export function directNameAnswer(m:any,plan:RecallPlan,info:MemoryEntityInfo){
 if(!plan.facets.includes('name'))return false;
 if(plan.owner&&norm(m.subject)!==norm(plan.owner))return false;
 const p=norm(m.predicate),sig=info.signature;
  if (NAME.has(p))return !plan.owner&&Boolean(plan.requiredType)&&typeMatches(info.subjectTypes,plan.requiredType);
 if(!sig.ownership&&!sig.topics.includes('pet'))return false;
 // Generic ownership needs explicit type evidence; has_dog/has_cat carries its own.
 if(!sig.topics.includes('pet')&&!info.objectTypes.length)return false;
 return typeMatches(info.objectTypes,plan.requiredType)&&(!plan.requiredType||info.objectEntity||sig.topics.includes('pet'));
}
export function matchesRequestedFacet(m:any,plan:RecallPlan,info:MemoryEntityInfo){
 if(!plan.facets.length)return false;
 return plan.facets.some(facet=>{
  if(facet==='name')return directNameAnswer(m,plan,info);
  if(facet==='responsibility'||facet==='project'||facet==='role'||facet==='decision')return info.signature.facet===facet;
  const p=norm(m.predicate);
  if(facet==='breed')return /breed|species/.test(p);
  if(facet==='color')return /color|colour/.test(p);
  if(facet==='birth')return /birth|birthday|age/.test(p);
  if(facet==='owner')return info.signature.ownership||/owner/.test(p);
  return false;
 });
}
export function topicCompatible(plan:RecallPlan,info:MemoryEntityInfo){
 if(!plan.topics.length)return true;
 for(const exclusive of ['pet','family'])if(info.topics.includes(exclusive)&&!plan.topics.includes(exclusive))return false;
 if(plan.requiredType){
  const actual=[...info.subjectTypes,...info.objectTypes],known=actual.filter(t=>['dog','cat','vehicle'].includes(t));
  if(known.length&&!typeMatches(known,plan.requiredType))return false;
 }
 return !info.topics.length||info.topics.some(t=>plan.topics.includes(t));
}
export function metaNarrative(m:any){return /^(?:reported_|recommends_|should_|learns_from|answered_from_)/.test(norm(m.predicate));}
export function diverseSelection(rows:any[],limit:number,plan:RecallPlan,info:(m:any)=>MemoryEntityInfo){
 const priority=(m:any)=>{
  const i=info(m),p=norm(m.predicate);
  if(plan.mode==='profile')return (m.scope.startsWith('user:')?4:0)+(i.signature.facet?3:0)+(/^(?:lives_in|birth_date|grew_up_in|born_in)$/.test(p)?2:0);
  return plan.topics.includes('work')&&i.signature.topics.includes('work')?4:0;
 };
 const sorted=[...rows].sort((a,b)=>(Number(matchesRequestedFacet(b,plan,info(b)))-Number(matchesRequestedFacet(a,plan,info(a))))||priority(b)-priority(a)||Number(!metaNarrative(b))-Number(!metaNarrative(a))||(b.score??0)-(a.score??0)||a.id.localeCompare(b.id));
 const selected:any[]=[],seen=new Set<string>(),facets=new Set<string>();
 // First preserve requested facets and distinct predicates/topics; later passes may
 // use remaining allocation, but cannot turn a narrow query into a broad packet.
 for(const m of sorted){
  const i=info(m),key=norm(m.predicate);
  if(selected.length<limit&&(!facets.has(key)||matchesRequestedFacet(m,plan,i))){selected.push(m);seen.add(m.id);facets.add(key);}
 }
 for(const m of sorted)if(selected.length<limit&&!seen.has(m.id)){selected.push(m);seen.add(m.id);}
 return selected;
}
export function historicalPredicate(predicate:string){return /^(?:first_|formerly_|previous_|past_|used_to_)/.test(norm(predicate));}
export function normalizedPredicate(predicate:string){return norm(predicate);}
export function statusReport(m:{predicate?:string}){
 const p=norm(String(m.predicate??''));
 return metaNarrative({predicate:p})||/(?:^|_)(?:assistant|reported|observed|stated|assessed|included|activation|content|status)(?:_|$)|_status$|^status$/.test(p);
}
export function continuityProfile(m:{scope?:string;predicate?:string},info:MemoryEntityInfo){
 if(!String(m.scope??'').startsWith('user:')||statusReport(m))return false;
 const facet=info.signature.facet;
 return facet==='name'||facet==='pet'||facet==='family'||facet==='role'||info.topics.includes('pet')||info.topics.includes('family');
}
export function continuityProfileRank(m:{predicate?:string},info:MemoryEntityInfo){
 const p=norm(String(m.predicate??'')),facet=info.signature.facet;
 if(facet==='name')return 100;
 if(facet==='pet'||facet==='family'||info.topics.includes('pet')||info.topics.includes('family'))return 80;
 if(p==='job_title'||p==='works_in'||p==='current_role'||p==='occupation')return 70;
 return facet==='role'?40:0;
}
export function continuityTopic(m:{kind?:string;scope?:string;predicate?:string;historical?:boolean},info:MemoryEntityInfo){
 if(statusReport(m)||m.historical)return false;
 if(info.signature.facet==='project'||info.signature.facet==='decision')return true;
 if(String(m.scope??'').startsWith('business:'))return false;
 return m.kind==='episode';
}
export function continuityTopicRank(m:{predicate?:string},info:MemoryEntityInfo){
 return info.signature.facet==='project'||info.signature.facet==='decision'||['has_goal','working_on','maintains','builds','current_project'].includes(norm(String(m.predicate??'')))?100:10;
}
export function topicLabel(m:{subject?:string;object?:string}){
 const clean=(value:unknown)=>String(value??'').replace(/\bt_[0-9a-f]{6,}\b/gi,'').replace(/\b\d{17,}\b/g,'').replace(/\s{2,}/g,' ').trim();
 const subject=clean(m.subject),object=clean(m.object);
 const generic=/^(?:alex|builder|agent|assistant|user)$/i.test(subject)||subject.length<8;
 const label=generic&&object.length>=8?object:subject;
 return label.slice(0,120);
}
