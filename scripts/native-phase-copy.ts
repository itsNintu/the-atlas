// Exact native phase seam, on a PRIVATE SQLite COPY only. Never opens production.
import assert from 'node:assert/strict';
import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {Store} from '../src/store.ts';
import {MemoryWorker,memoryTokens} from '../src/memory.ts';
import {Inference,validateDecisions} from '../src/inference.ts';
import {validateReconciliations} from '../src/memory-reconciliation.ts';
const label=process.argv[2],indices=(process.argv[3]??'0').split(',').map(Number);
assert(/^[a-z0-9-]+$/.test(label));assert(indices.length<=5&&indices.every(i=>Number.isInteger(i)&&i>=0&&i<5));
const dir=`.private/native-phase-repair/${label}`;assert(!existsSync(dir));mkdirSync(dir,{mode:0o700});
const base=process.argv[4]??'.private/native-phase-repair/native.sqlite';assert(/^\.private\/native-phase-repair\/(?:[a-z0-9-]+\/copy\.sqlite|native\.sqlite)$/.test(base));
copyFileSync(base,`${dir}/copy.sqlite`);
const snapshot=await Bun.file('evidence/native-phase-repair/READONLY-CURRENT.json').json(),targets=indices.map(i=>snapshot.originals[i].job);
const s=new Store(`${dir}/copy.sqlite`),real=new Inference(),calls:any[]=[],errors:any[]=[];
const jobs=()=>targets.map(target=>s.one('SELECT id,status,attempts,error_code FROM memory_jobs WHERE id=?',target.id));
async function save(){await Bun.write(`${dir}/trace.json`,JSON.stringify({label,indices,calls,errors,jobs:jobs()},null,2));}
async function call(input:any){
 const n=calls.length,row:any={phase:input.phase??'extract',input_tokens:memoryTokens(JSON.stringify(input)),input};calls.push(row);await save();
 try{row.output=await real.command('curate',input);row.usage=real.last_usage.curate;await save();console.log(JSON.stringify({call:n,phase:row.phase,tokens:row.input_tokens,output:row.output}));return row.output;}
 catch(e:any){row.error={code:e.code,message:e.message};await save();throw e;}
}
const inf={curate:async(i:any)=>validateDecisions(await call(i)),resolveEntities:call,reconcile:async(i:any)=>validateReconciliations(await call(i),i.incoming.length),embed:(texts:string[])=>real.embed(texts)};
const w=new MemoryWorker(s,inf);
// COPY ONLY: select exactly one original, preserving source and candidate shapes.
s.run("UPDATE memory_jobs SET status='failed',lease_token=NULL,lease_until=NULL WHERE status IN ('queued','running','retry')");
for(const target of targets){s.run("UPDATE memory_jobs SET status='queued',attempts=0,available_at=0,error_code=NULL,lease_token=NULL,lease_until=NULL WHERE id=?",target.id);
s.run("UPDATE memory_events SET status='pending' WHERE id=?",target.event_pk);}
const validate=w.validate.bind(w);w.validate=(...args)=>{try{return validate(...args)}catch(e:any){errors.push({method:'validate',message:e.message,code:e.code,decisions:args[0]});throw e}};
try{for(let n=0;n<targets.length;n++){await w.runOnce();await save();}console.log(JSON.stringify({dir,jobs:jobs()}));}finally{s.close()}
