// Explicit source-only opt-in. Isolated synthetic fixture; never opens production DB.
import assert from 'node:assert/strict';import {mkdirSync} from 'node:fs';
import {Store,now,hash} from '../src/store.ts';import {Memory,MemoryWorker,memoryTokens} from '../src/memory.ts';import {Inference} from '../src/inference.ts';import {EXTRACT_PROMPT,RECONCILE_PROMPT} from '../src/memory-reconciliation.ts';import {memoryGraph} from '../src/memory-graph.ts';
const dir=process.argv[2];if(!dir?.startsWith('.private/')||!process.env.THE_ATLAS_INFERENCE_COMMAND)throw Error('Fresh isolated source fixture/provider required');mkdirSync(dir,{recursive:true,mode:0o700});
const s=new Store(`${dir}/fixture.sqlite`);assert.equal(s.one('SELECT COUNT(*) n FROM workspaces').n,0);const boot=s.bootstrap('Synthetic reported relational failure copy'),a=s.authenticate(boot.token),real=new Inference(),calls:any[]=[];
const inf={async resolveEntities(input:any){const result=await real.resolveEntities(input);calls.push({phase:'identity',event:input.event.event_id,input_tokens:memoryTokens(JSON.stringify(input)),result,usage:real.last_usage.curate});await save();return result},async curate(input:any){const at=performance.now(),result=await real.curate(input);calls.push({phase:'extract',event:input.event.event_id,input_tokens:memoryTokens(JSON.stringify(input)),result,usage:real.last_usage.curate,ms:performance.now()-at});await save();return result},async reconcile(input:any){const at=performance.now(),result=await real.reconcile(input);calls.push({phase:'reconcile',event:input.event.event_id,input_tokens:memoryTokens(JSON.stringify(input)),incoming:input.incoming,candidates:input.candidates,result,usage:real.last_usage.curate,ms:performance.now()-at});await save();return result},embed:(texts:string[])=>real.embed(texts)};
const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
const receipt=await Bun.file('/mnt/d/Work/Operations/hermes/atlas-native/activation/selection/OUTCOME-RECEIPT.json').json();
const fixture=receipt.fixtures.LDN7;const originals=fixture.events.filter((e:any)=>e.role==='user');const sourceRows=new Map<string,any>();const initialJobs=new Map<string,string>();
const times=['2026-11-07T11:40:04.339Z','2026-11-07T11:40:11.302Z','2026-11-07T11:40:20.311Z','2026-11-07T11:40:26.912Z'];
async function save(){await Bun.write(`${dir}/progress.json`,JSON.stringify({calls},null,2))}
async function finish(job:string){for(let n=0;n<6;n++){await w.runOnce();const j=s.one('SELECT * FROM memory_jobs WHERE id=?',job);if(j.status==='succeeded')return;if(j.status==='failed')throw Error(j.error_code);console.log(JSON.stringify({job,status:j.status,error:j.error_code}));await Bun.sleep(1100)}throw Error('bounded fixture job failed')}
function graph(history=false){return memoryGraph(m,a,{agent_id:'builder',include_history:history,limit:100})}
const checkpoints:any[]=[];let result:any;
try{
 // Seed ONLY the exact previously reported synthetic LDN7 memories/supports.
 // These are historical recorded outputs, not fresh successful Luna decisions.
 const zero=new MemoryWorker(s,{async curate(){return {decisions:[]}},embed:inf.embed});
 for(let i=0;i<originals.length;i++){
  const e=originals[i],support=fixture.supports.find((x:any)=>x.event_id===e.event_id);
  const r=m.event(a,{client_id:'reported-copy',event_id:e.event_id,revision:1,operation:'upsert',agent_id:'builder',thread_id:'LDN7-copy',role:'user',author_id:'alex',occurred_at:times[i],observed_at:now(),content:support.excerpt});await zero.runOnce();sourceRows.set(e.event_id,s.one('SELECT * FROM memory_events WHERE event_id=?',e.event_id));initialJobs.set(e.event_id,r.job_id);
 }
 const idMap=new Map<string,string>();
 for(const old of fixture.memories){const support=fixture.supports.find((x:any)=>x.memory_id===old.id);if(!support)continue;const e=sourceRows.get(support.event_id);if(!e)continue;
  const id=w.apply(e,{kind:old.kind,scope:'agent:builder',subject:old.subject,predicate:old.predicate,object:old.object,valid_from:old.valid_from,valid_to:old.valid_to,importance:old.importance,confidence:old.confidence,evidence_event_ids:[e.event_id]},undefined,'disabled',['agent:builder']);idMap.set(old.id,id);
 }
 for(const old of fixture.changes){const e=sourceRows.get(originals[3].event_id);s.run('INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)',`seed-${old.id}`,e.id,idMap.get(old.target_id),idMap.get(old.replacement_id),old.type,old.effective_at,now())}
 const before=graph(true),custody=[...sourceRows.values()];
 // Actual supported reprocessing, original sources in chronology.
 for(const e of originals){const r=m.reprocess(a,'builder',initialJobs.get(e.event_id)!,1,'relational_source_fixture');await finish(r.job_id);checkpoints.push({event:e.event_id,current:graph(),history:graph(true)})}
 // Central out-of-order regression: repeat original AFTER later truth is known.
 const first=originals[0],current=s.one('SELECT job_id FROM memory_events WHERE event_id=?',first.event_id);const late=m.reprocess(a,'builder',current.job_id,1,'late_original_source_fixture');await finish(late.job_id);const afterLate=graph(true);
 // Actual new atomic non-legacy source with entity-only targets and pronouns.
 const capture=(id:string,content:string)=>m.event(a,{client_id:'new-fiction',event_id:id,revision:1,operation:'upsert',agent_id:'builder',thread_id:'FEN9-copy',role:'user',author_id:'alex',occurred_at:now(),observed_at:now(),content});
 await finish(capture('fen9','Private fictional archive FEN9 only, not Alex or real business: Iona maintains the Copper beacon and reports to Remy. In that same imaginary archive, Remy reviews the Copper beacon checklist. No tools or builtin memory saves. Reply only "Noted fictional archive".').job_id);
 await finish(capture('fen9-pronoun','Still fictional FEN9: she also audits the Copper beacon schedule; by she I mean the person Iona reports to. The paper moon tastes like hiccups! No tools; acknowledge only.').job_id);
 const recall=await m.recall(a,{agent_id:'builder',thread_id:'fresh',query:'In fictional LDN7, who owns Lantern now and previously, was cobalt ever true, who does Mira report to and who reviews the checklist?',token_budget:4000});
 const fenRecall=await m.recall(a,{agent_id:'builder',thread_id:'fresh',query:'In fictional FEN9, who maintains Copper beacon, whom do they report to, and who reviews its checklist and audits the schedule?',token_budget:4000});
 const after=graph(),history=graph(true);
 const memories=s.all('SELECT id,subject,predicate,object,scope,valid_from,valid_to FROM memories');
 result={source_fixture_not_native:true,seeded_prior_reported_outputs:true,seeded_memory_ids:[...idMap],prompt_hashes:{extract:hash(EXTRACT_PROMPT),reconcile:hash(RECONCILE_PROMPT)},calls,before,checkpoints,afterLate,after,history,recall,fenRecall,memories,audit:s.all('SELECT * FROM memory_reconciliations'),changes:s.all('SELECT * FROM memory_changes'),reprocess:s.all('SELECT * FROM memory_reprocess_requests'),custody_preserved:custody.every(e=>['event_id','revision','content','roots_json','body_hash','occurred_at','accepted_at'].every(k=>s.one('SELECT * FROM memory_events WHERE id=?',e.id)[k]===e[k]))};
 await Bun.write(`${dir}/result.json`,JSON.stringify(result,null,2));
 assert(result.custody_preserved);assert(calls.every(c=>c.input_tokens<=4096));
 const currentMem=after.edges.map((e:any)=>memories.find((x:any)=>x.id===e.id));
 assert(!currentMem.some((m:any)=>m?.subject.includes('Lantern')&&/^(uses|color)$/.test(m.predicate)&&/^cobalt\b/i.test(m.object)),'no current stale cobalt');
 assert(!currentMem.some((m:any)=>/Nola/.test(m?.subject)&&/owns|owner_of/.test(m?.predicate)),'no current stale Nola ownership');
 assert(after.edges.some((e:any)=>e.predicate==='reports_to'&&after.nodes.find((n:any)=>n.id===e.target)?.kind==='entity'),'meaningful linked reporting');
 assert(fenRecall.memories.some((m:any)=>/Iona/.test(m.subject)&&/maintain/.test(m.predicate)));assert(fenRecall.memories.some((m:any)=>/report/.test(m.predicate)&&/Remy/.test(m.object)));assert(fenRecall.memories.some((m:any)=>/audit/.test(m.predicate)&&/Remy/.test(m.subject)));
 assert(history.edges.some((e:any)=>e.status==='historical'&&e.valid_to==='2026-11-07T00:00:00.000Z'),'actual handover date retained');
 assert(history.edges.some((e:any)=>e.status==='corrected'),'never-true distinct from history');
 console.log(JSON.stringify({report:`${dir}/result.json`,calls:calls.length,tokens:calls.map(c=>c.input_tokens),current_edges:after.edges.length,history_edges:history.edges.length,custody_preserved:result.custody_preserved}));
}finally{if(!result)await save();s.close()}
