// Explicit opt-in SOURCE fixture. No native sessions or production DB/actions.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {Store,now,hash} from '../src/store.ts';
import {Memory,MemoryWorker,memoryTokens} from '../src/memory.ts';
import {Inference,CURATE_PROMPT} from '../src/inference.ts';
import {memoryGraph} from '../src/memory-graph.ts';
const dir=process.argv[2];if(!dir?.startsWith('.private/')||!process.env.THE_ATLAS_INFERENCE_COMMAND||!process.env.THE_ATLAS_EMBED_URL)throw Error('Fresh .private source fixture and proven provider route required');
mkdirSync(dir,{recursive:true,mode:0o700});const s=new Store(`${dir}/fixture.sqlite`);
assert.equal(s.one('SELECT COUNT(*) n FROM workspaces').n,0,'new isolated fixture only');
const boot=s.bootstrap('Fictional KST9 source fixture'),a=s.authenticate(boot.token),real=new Inference(),calls:any[]=[];
const inf={async curate(input:any){const start=performance.now(),result=await real.curate(input);calls.push({event_id:input.event.event_id,input_tokens:memoryTokens(JSON.stringify(input)),candidate_count:input.candidates.length,result,usage:real.last_usage.curate,elapsed_ms:performance.now()-start});return result},embed:(texts:string[])=>real.embed(texts)};
const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
const event=(event_id:string,content:string,role='user')=>m.event(a,{client_id:'source-fiction',event_id,revision:1,operation:'upsert',agent_id:'builder',thread_id:'fictional-archive',role,author_id:role==='user'?'alex':'agent:builder',occurred_at:'2026-01-01T00:00:00.000Z',observed_at:now(),content});
async function finish(job_id:string){for(let i=0;i<8;i++){await w.runOnce();const j=s.one('SELECT status,error_code FROM memory_jobs WHERE id=?',job_id);if(j.status==='succeeded')return;if(j.status==='failed')throw Error(j.error_code);await Bun.sleep(1100)}throw Error('bounded source fixture did not finish')}
const recall=(query:string)=>m.recall(a,{agent_id:'builder',thread_id:'fresh-answer',query});
try{
 const r=event('original-fiction','Fictional private working archive KST9, not Alex or real business: KST9 Suri maintains the KST9 Ember relay, and KST9 Suri reports to KST9 Tavi. No tools or builtin memory saves. Reply only "Noted fictional archive".');
 // Explicit deterministic fault injection to exercise the supported zero-decision
 // remediation path, NOT a claimed old Luna result.
 await new MemoryWorker(s,{async curate(){return {decisions:[]}},embed:inf.embed}).runOnce();
 const original=s.one('SELECT * FROM memory_events WHERE event_id=\'original-fiction\'');
 const retry=m.reprocess(a,'builder',r.job_id,1,'source_selection_fixture');await finish(retry.job_id);
 const facts=await recall('In the fictional KST9 archive, who maintains Ember relay and whom do they report to? If no relevant memory is supplied, say you lack evidence. Use automatically supplied memory only; do not call tools, browse or save memory.');
 await finish(event('ack','Noted fictional archive','assistant').job_id);
 await finish(event('followup','Still fictional KST9: she also reviews the Ember relay checklist; by she I mean the person Suri reports to. The paper moon tastes like hiccups!').job_id);
 const beforeDenial=s.one('SELECT COUNT(*) n FROM memories').n;
 await finish(event('denial','I lack evidence in the automatically supplied context to establish who owns the Quasar kettle. This answer describes the available context and does not establish any archive facts.','assistant').job_id);
 const afterDenial=s.one('SELECT COUNT(*) n FROM memories').n;
 const related=await recall('In fictional KST9, who reviews Ember relay checklist?');
 const unrelated=await recall('In the fictional QZX8 archive, who owns the Quasar kettle and what is its launch color? If no relevant memory is available, say you lack evidence. Only automatically supplied memory; no tools, browsing or saving memory.');
 const graph=memoryGraph(m,a,{agent_id:'builder',include_history:true});
 const memories=s.all('SELECT id,scope,kind,subject,predicate,object FROM memories');
 const metrics=s.all('SELECT * FROM memory_curation_metrics');
 const report={fictional:true,source_fixture_not_native:true,prompt_sha256:hash(CURATE_PROMPT),calls,metrics,memories,facts,related,unrelated,graph,reprocess:s.all('SELECT * FROM memory_reprocess_requests'),old_job:s.one('SELECT * FROM memory_jobs WHERE id=?',r.job_id),original_custody_unchanged:['id','event_id','revision','content','body_hash','accepted_at','roots_json','causal_json'].every(key=>s.one('SELECT * FROM memory_events WHERE id=?',original.id)[key]===original[key]),beforeDenial,afterDenial};
 await Bun.write(`${dir}/result.json`,JSON.stringify(report,null,2));
 assert(report.original_custody_unchanged);assert(memories.length>=2);assert(memories.every(x=>x.scope==='agent:builder'));
 assert(facts.memories.some(x=>/maintain/i.test(x.predicate)&&/suri/i.test(`${x.subject} ${x.object}`)),'useful maintenance fact');
 assert(facts.memories.some(x=>/report/i.test(x.predicate)&&/tavi/i.test(x.object)),'useful reporting fact');
 assert(related.memories.some(x=>/review/i.test(x.predicate)&&/tavi/i.test(x.subject)),'contextual relationship');
 assert.equal(beforeDenial,afterDenial,'routine denial must not become knowledge');assert.equal(unrelated.memories.length,0,'unrelated packet must be empty');
 assert(calls.every(x=>x.input_tokens<=4096));
 const maintenance=graph.edges.find(x=>/maintain/i.test(x.predicate)),reporting=graph.edges.find(x=>/report/i.test(x.predicate));
 assert(maintenance&&reporting);assert([maintenance.source,maintenance.target].some(x=>[reporting.source,reporting.target].includes(x)),'actual connected entity edges');
 console.log(JSON.stringify({report:`${dir}/result.json`,calls:calls.length,input_tokens:calls.map(x=>x.input_tokens),decisions:calls.map(x=>x.result.decisions.filter((d:any)=>d.kind!=='nothing').length),memories:memories.length,graph_edges:graph.edges.length,unrelated_count:unrelated.memories.length,recall_ms:facts.retrieval.service_ms}));
}finally{s.close()}
