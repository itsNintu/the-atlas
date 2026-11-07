// Focused continuation after the observed correction-positive-reassertion defect.
import assert from "node:assert/strict";
import { Store,now } from "../src/store.ts";
import { Memory,MemoryWorker } from "../src/memory.ts";
import { Inference } from "../src/inference.ts";
const dir=process.argv[2]; if(!dir?.startsWith(".private/"))throw Error("Fictional fixture only");
const s=new Store(`${dir}/fixture.sqlite`), real=new Inference(), calls:any[]=[];
const p=s.one("SELECT principal_id FROM memory_bindings WHERE agent_id='builder'").principal_id;
const a=s.authenticate(s.issueKey(p).token);
const inference={async curate(input:any){const result=await real.curate(input);calls.push({input,result,usage:real.last_usage.curate});return result;},embed:(texts:string[])=>real.embed(texts)};
const m=new Memory(s,inference),w=new MemoryWorker(s,inference);
try{
 const old=s.one("SELECT * FROM memory_events WHERE event_id='correction' ORDER BY revision DESC LIMIT 1");
 const r=m.event(a,{client_id:old.client_id,event_id:old.event_id,revision:old.revision+1,operation:"upsert",agent_id:"builder",thread_id:old.thread_id,role:"user",author_id:"alex",occurred_at:old.occurred_at,observed_at:now(),content:old.content,metadata:{}});
 for(let n=0;n<6;n++){
  await w.runOnce();const j=s.one("SELECT status,error_code FROM memory_jobs WHERE id=?",r.job_id);
  if(j.status==="succeeded")break;
  if(j.status==="failed")throw Error(j.error_code);
  await Bun.sleep(2200);
 }
 const corrected=await m.recall(a,{agent_id:"builder",thread_id:"repaired",query:"Who manages Lantern Loom clay deliveries?"});
 const raw=JSON.parse(await Bun.file(`${dir}/result.json`).text());
 const original=s.one("SELECT id FROM memory_events WHERE event_id='ownership'").id;
 const result={fictional:true,reason:"Observed model corrected old Nola claim but emitted positive Nola claim again; strengthened prompt and exact target-repeat validator, reprocessed only edited correction source",calls,corrected,changes:s.all("SELECT * FROM memory_changes"),metrics:s.all("SELECT * FROM memory_curation_metrics"),old_history:raw.history};
 await Bun.write(`${dir}/correction-repair.json`,JSON.stringify(result,null,2));
 assert(corrected.memories.some((x:any)=>x.subject==="Leda"));
 assert(!corrected.memories.some((x:any)=>x.subject==="Nola"&&/clay deliveries/i.test(x.object)&&!/never|not|withdraw/i.test(x.object)),"incorrect positive Nola claim must not return");
 assert(result.changes.some(x=>x.type==="correction"));
 assert(s.one("SELECT COUNT(*) n FROM memory_supports WHERE event_pk=?",original).n>0,"unaffected source kept");
 assert(s.one("SELECT status FROM memory_jobs WHERE id=?",r.job_id).status==="succeeded");
 assert(raw.largeRecall.memories.some((x:any)=>/teal/i.test(x.object)));
 assert(raw.contextual.memories.some((x:any)=>/reports_to/.test(x.predicate)));
 console.log(JSON.stringify({report:`${dir}/correction-repair.json`,calls:calls.length,corrected:corrected.context,input_tokens:result.metrics.map(x=>x.input_tokens)}));
}finally{s.close();}
