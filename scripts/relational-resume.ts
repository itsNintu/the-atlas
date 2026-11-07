// Resume ONLY the existing isolated reported-failure fixture after source change.
import assert from 'node:assert/strict';import {Store,hash} from '../src/store.ts';import {Memory,MemoryWorker,memoryTokens} from '../src/memory.ts';import {Inference} from '../src/inference.ts';import {EXTRACT_PROMPT,RECONCILE_PROMPT} from '../src/memory-reconciliation.ts';import {memoryGraph} from '../src/memory-graph.ts';
const dir=process.argv[2];if(!dir?.startsWith('.private/')||!await Bun.file(`${dir}/result.json`).exists())throw Error('Existing isolated source fixture required');
const previous=await Bun.file(`${dir}/result.json`).json();const s=new Store(`${dir}/fixture.sqlite`);assert.equal(s.one('SELECT name FROM workspaces').name,'Synthetic reported relational failure copy');
const principal=s.one('SELECT id FROM principals WHERE is_admin=1'),a=s.authenticate(s.issueKey(principal.id).token),calls:any[]=[],raw:any[]=[];
class Trace extends Inference{async command(op:'curate'|'embed',input:any){const result=await super.command(op,input);raw.push({phase:input.phase??'extract',input_tokens:memoryTokens(JSON.stringify(input)),output:result,usage:this.last_usage.curate});await Bun.write(`${dir}/followup-raw.json`,JSON.stringify(raw,null,2));return result}}
const real=new Trace();const inf={async resolveEntities(input:any){const result=await real.resolveEntities(input);calls.push({phase:'identity',event:input.event.event_id,input_tokens:memoryTokens(JSON.stringify(input)),result,usage:real.last_usage.curate});return result},async curate(input:any){const result=await real.curate(input);calls.push({phase:'extract',event:input.event.event_id,input_tokens:memoryTokens(JSON.stringify(input)),result,usage:real.last_usage.curate});return result},async reconcile(input:any){const result=await real.reconcile(input);calls.push({phase:'reconcile',event:input.event.event_id,input_tokens:memoryTokens(JSON.stringify(input)),incoming:input.incoming,candidates:input.candidates,sources:input.sources,result,usage:real.last_usage.curate});return result},embed:(t:string[])=>real.embed(t)};
const m=new Memory(s,inf),w=new MemoryWorker(s,inf),steps:any[]=[];
const graph=(history=false)=>memoryGraph(m,a,{agent_id:'builder',include_history:history,limit:100});
const receipt=await Bun.file('/mnt/d/Work/Operations/hermes/atlas-native/activation/selection/OUTCOME-RECEIPT.json').json();const originals=receipt.fixtures.LDN7.events.filter((e:any)=>e.role==='user');
async function retry(event_id:string){const e=s.one('SELECT * FROM memory_events WHERE event_id=?',event_id),state=s.one('SELECT status FROM memory_jobs WHERE id=?',e.job_id),r=state.status==='failed'?m.retry(a,'builder',e.job_id):m.reprocess(a,'builder',e.job_id,1,'changed_relation_reconciliation_fixture');for(let n=0;n<5;n++){await w.runOnce();const j=s.one('SELECT * FROM memory_jobs WHERE id=?',r.job_id);await Bun.write(`${dir}/followup-progress.json`,JSON.stringify({calls,steps,j},null,2));if(j.status==='succeeded'){steps.push({event_id,job_id:r.job_id,graph:graph(true)});return}if(j.status==='failed')throw Error(j.error_code);console.log(JSON.stringify({job:r.job_id,status:j.status,error:j.error_code}));await Bun.sleep(1100)}throw Error('finite retry failed')}
try{
 // Initial real fixture exposed duplicate-vs-change exclusivity and candidate
 // source repetition. Reuse all unaffected output; retry only affected handover
 // and the central older original after those actual source changes.
 if(!process.argv.includes('--late-only'))await retry(originals[2].event_id);await retry(originals[0].event_id);
 const current=graph(),history=graph(true),memories=s.all('SELECT id,subject,predicate,object,scope,valid_from,valid_to FROM memories');
 const recall=await m.recall(a,{agent_id:'builder',thread_id:'fresh-final',query:'In fictional LDN7, who owns Lantern now and previously, was cobalt ever true, who does Mira report to and who reviews the checklist?',token_budget:4000});
 const fenRecall=await m.recall(a,{agent_id:'builder',thread_id:'fresh-final',query:'In fictional FEN9, who maintains Copper beacon, whom do they report to, and who reviews its checklist and audits the schedule?',token_budget:4000});
 const result={source_fixture_not_native:true,reuses_initial_real_outputs:true,initial_failure:'Handover duplicate reconciliation omitted stale Nola closure; no source acceptance claimed for initial run',prompt_hashes:{extract:hash(EXTRACT_PROMPT),reconcile:hash(RECONCILE_PROMPT)},calls,raw,steps,current,history,memories,recall,fenRecall,changes:s.all('SELECT * FROM memory_changes'),audit:s.all('SELECT * FROM memory_reconciliations'),reprocess:s.all('SELECT * FROM memory_reprocess_requests'),original_support_counts:s.all("SELECT e.role,COUNT(DISTINCT m.id) memories,COUNT(DISTINCT e.id) events FROM memories m JOIN memory_supports p ON p.memory_id=m.id JOIN memory_events e ON e.id=p.event_pk GROUP BY e.role"),original_custody_preserved:previous.custody_preserved};
 await Bun.write(`${dir}/final.json`,JSON.stringify(result,null,2));
 const currentMem=current.edges.map((e:any)=>memories.find((m:any)=>m.id===e.id));
 assert(!currentMem.some((m:any)=>/Nola/.test(m.subject)&&/owns|owner_of/.test(m.predicate)),'no stale Nola ownership');
 assert(!currentMem.some((m:any)=>/Lantern/.test(m.subject)&&/uses|color/.test(m.predicate)&&/^cobalt\b/i.test(m.object)),'no stale cobalt');
 assert(!currentMem.some((m:any)=>m.predicate==='fixture_claims'),'opaque compound source is represented by atomics/history');
 assert(currentMem.some((m:any)=>m.subject==='LDN7 Mira'&&m.predicate==='reports_to'&&m.object==='LDN7 Nola'));
 assert(currentMem.some((m:any)=>m.subject==='LDN7 Nola'&&m.predicate==='reviews'&&m.object==='LDN7 Lantern checklist'));
 assert(currentMem.some((m:any)=>m.subject==='LDN7 Leda'&&m.predicate==='owns'&&m.object==='LDN7 Lantern'));
 assert(history.edges.some((e:any)=>e.status==='historical'&&e.valid_to==='2026-11-07T00:00:00.000Z'));
 assert(history.edges.some((e:any)=>e.status==='corrected'));
 assert(fenRecall.memories.some((m:any)=>m.subject==='FEN9 Remy'&&m.predicate==='audits'));assert(fenRecall.memories.some((m:any)=>m.subject==='FEN9 Iona'&&m.predicate==='reports_to'));
 assert(calls.every(c=>c.input_tokens<=4096));console.log(JSON.stringify({report:`${dir}/final.json`,calls:calls.length,tokens:calls.map(c=>c.input_tokens),current_edges:current.edges.length,history_edges:history.edges.length}));
}finally{s.close()}
