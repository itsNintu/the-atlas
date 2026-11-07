// Bounded readonly comparison: same DB transaction, same engine, helper-only delta.
// No Store constructor/migrations, receipts, feedback, curation or native sessions.
import {Database} from 'bun:sqlite';
import {Store,hash} from '../../src/store.ts';
import {Inference} from '../../src/inference.ts';
import {Memory as Baseline} from './baseline-memory.ts';
import {Memory as Corrected} from './corrected-memory.ts';
import {recallFocus,asksAboutRecallProcess} from '../../src/recall-query.ts';
import {recallFocus as oldFocus,asksAboutRecallProcess as oldProcess} from './baseline-query.ts';
const db=new Database('/home/alex/.local/share/the-atlas/atlas.sqlite',{readonly:true});
const store=Object.create(Store.prototype) as Store;store.db=db;
let intercepted=0,embedCalls=0;
store.run=(sql:string)=>{if(!sql.startsWith('INSERT INTO memory_recalls'))throw Error('write forbidden');intercepted++;return {} as any};
const real=new Inference(),inf={async curate(){throw Error('curation forbidden')},async embed(texts:string[]){embedCalls++;const r=await real.embed(texts);if(r.model!=='sentence-transformers/all-MiniLM-L6-v2'||r.vectors.some(v=>v.length!==384))throw Error('resident model mismatch');return r}};
const lexical={async curate(){throw Error('curation forbidden')},async embed(){return {vectors:[],model:'disabled'}}};
const capture='Private fictional archive FEN9 only, not Alex or real business: Iona maintains the Copper beacon and reports to Remy. In that same imaginary archive, Remy reviews the Copper beacon checklist. No tools or builtin memory saves. Reply only "Noted fictional archive".';
const cases=[
 {name:'FEN9-original-pre-capture',query:capture,at:'2026-11-07T13:41:57.500Z'},
 {name:'FEN9-current-intake',query:capture},
 {name:'FEN9-current-use',query:'In the fictional FEN9 archive, who maintains the Copper beacon, whom do they report to, and who reviews its checklist? Use automatically supplied memory only, keeping fiction fictional. Do not call tools, browse or save memory.'},
 {name:'FEN9-paraphrase',query:'Who services the copper signal tower and who is Iona accountable to in FEN9?'},
 {name:'VES8-use',query:'In the fictional VES8 archive, who maintains Ember relay and whom do they report to? If no relevant memory is supplied, say you lack evidence. Use automatically supplied memory only; do not call tools, browse or save memory.'},
 {name:'VES8-paraphrase',query:'In VES8, who tends the Ember transmitter and who is Suri accountable to?'},
 {name:'LDN7-use',query:'In the fictional LDN7 archive, who owns Lantern now, who owned it before, and was cobalt ever its true color? Also, who does Mira report to, and who reviews the checklist? If no relevant memory is supplied, say you lack evidence. Answer from automatically supplied context only. Do not call tools, browse or save memory.'},
 {name:'QZX8-exact',query:'In the fictional QZX8 archive, who owns the Quasar kettle and what is its launch color? If no relevant memory is available, say you lack evidence. Only automatically supplied memory; no tools, browsing or saving memory.'},
 {name:'response-history',query:'What did you previously answer about the fictional VES8 archive query?'},
 {name:'lexical-only-nonadjacent',query:'Lantern owner launch date',lexical:true},
];
const summary=(r:any)=>({tokens:r.tokens_used,ids:r.memories.map((m:any)=>m.id),memories:r.memories.map((m:any)=>({id:m.id,subject:m.subject,predicate:m.predicate,lexical:m.lexical,semantic:m.semantic,roles:m.supports.map((s:any)=>s.role)})),context_sha256:hash(r.context),pending:r.pending_events.length,candidates:r.retrieval.candidates_examined,context_messages:r.retrieval.context_messages_used,semantic_status:r.retrieval.semantic_status,model:r.retrieval.embedding_model,service_ms:r.retrieval.service_ms});
db.exec('BEGIN');
try{
 const actor=store.one("SELECT p.*,c.id credential_id FROM principals p JOIN credentials c ON c.principal_id=p.id JOIN memory_bindings b ON b.principal_id=p.id WHERE b.agent_id='reaver' AND c.revoked_at IS NULL LIMIT 1");
 if(!actor)throw Error('no existing authorized Reaver actor');
 const current=new Date().toISOString(),comparisons=[];
 const identity=store.one('SELECT COUNT(*) memories,MAX(recorded_from) latest FROM memories');
 for(const c of cases){
  const request={agent_id:'reaver',thread_id:'readonly-focus-repair',query:c.query,token_budget:1200,valid_at:c.at??current,recorded_at:c.at??current,recent_context:[]};
  const b=await new Baseline(store,c.lexical?lexical:inf).recall(actor,request),r=await new Corrected(store,c.lexical?lexical:inf).recall(actor,request);
  comparisons.push({case:c.name,recorded_at:request.recorded_at,original_query:c.query,baseline_focus:oldFocus(c.query),corrected_focus:recallFocus(c.query),baseline_process:oldProcess(oldFocus(c.query)),corrected_process:asksAboutRecallProcess(recallFocus(c.query)),baseline:summary(b),corrected:summary(r)});
 }
 const report={at:current,readonly:true,same_sqlite_read_transaction:true,logical_pre_capture_recorded_at:'2026-11-07T13:41:57.500Z',pre_capture_note:'Recorded/valid-time reconstruction on the same readonly snapshot, not a new native session; later FEN9 memories are ineligible at that cutoff.',baseline_commit:'65b9a6302bdfdb4daed8022f6220ee81f70aee3f',engine_sha256:(await Bun.file(import.meta.dir+'/engine-source.sha256').text()).trim(),helper_sha256:hash(await Bun.file(import.meta.dir+'/../../src/recall-query.ts').text()),snapshot_identity:identity,receipt_writes_intercepted:intercepted,embedding_calls:embedCalls,curation_calls:0,comparisons};
 await Bun.write(import.meta.dir+'/READONLY-COMPARISON.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({cases:comparisons.length,receipt_writes_intercepted:intercepted,results:comparisons.map(c=>({case:c.case,before:c.baseline.tokens,after:c.corrected.tokens,ids:c.corrected.ids}))},null,2));
}finally{db.exec('ROLLBACK');db.close()}
