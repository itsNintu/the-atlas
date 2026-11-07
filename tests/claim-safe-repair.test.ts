import {test,expect} from 'bun:test';
import {Store,now,id,canonical} from '../src/store.ts';
import {Memory,MemoryWorker,memoryTokens} from '../src/memory.ts';
import {App} from '../src/app.ts';
import {memoryGraph} from '../src/memory-graph.ts';
import {consistentReconciliation,activeChanges} from '../src/memory-truth.ts';
import {correctionEvidence} from '../src/memory-corrections.ts';
import {repairPlan,repairReconciliation} from '../src/memory-repair.ts';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const jan='2026-01-01T00:00:00.000Z',feb='2026-02-01T00:00:00.000Z',mar='2026-03-01T00:00:00.000Z';
function fixture(path=':memory:') {
 const s=new Store(path),b=s.bootstrap('Synthetic claim consistency'),a=s.authenticate(b.token);
 let decide=(i:any):any[]=>[],reconcile=(i:any):any=>[{index:0,duplicate_ids:[]}];
 const inf={async curate(i:any){return {decisions:decide(i)}},async reconcile(i:any){return reconcile(i)},async embed(){return {vectors:[],model:'disabled'}}};
 const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
 const event=(key:string,content='Synthetic original source',time=jan)=>m.event(a,{client_id:'consistency',event_id:key,revision:1,operation:'upsert',agent_id:'builder',thread_id:'scenario',role:'user',author_id:'alex',occurred_at:time,observed_at:now(),content});
 const d=(key:string,extra:any={})=>({kind:'episode' as const,scope:'agent:builder',subject:'Demo Mira',predicate:'reports_to',object:'Demo Nola',object_entity:true,valid_from:jan,valid_to:null,importance:.8,confidence:.9,evidence_event_ids:[key],...extra});
 const seed=async(key:string,extra:any={},content='Synthetic original source',time=jan)=>{const receipt=event(key,content,time);await w.runOnce();const e=s.one('SELECT * FROM memory_events WHERE event_id=?',key);return {id:w.apply(e,d(key,extra),undefined,'disabled',['agent:builder']),e,receipt}};
 const graph=(history=true,recorded_at=now())=>memoryGraph(m,a,{agent_id:'builder',include_history:history,valid_at:mar,recorded_at,limit:100});
 return {s,b,a,m,w,d,event,seed,graph,set:(ds:any,rs:any)=>{decide=ds;reconcile=rs}};
}
test('raw/typed disagreement cannot propagate across an explicit unaffected disposition; unrelated ownership still closes',async()=>{
 const f=fixture();try{
 const raw=await f.seed('raw',{subject:'Demo archive',predicate:'Mira reports_to',object:'Demo Nola; source says Mira reports to Nola',object_entity:false});
 const typed=await f.seed('typed');
 // Recorded duplicate audit is the same equivalence mechanism as production.
 f.s.run('INSERT INTO memory_reconciliations VALUES (?,?,?,?,?)',typed.receipt.job_id,typed.e.id,typed.id,JSON.stringify({index:0,duplicate_ids:[raw.id]}),now());
 const owner=await f.seed('owner',{subject:'Demo Nola',predicate:'owns',object:'Demo Lantern'});
 const sibling=await f.seed('sibling',{subject:'Demo Mira',predicate:'reviews',object:'Demo checklist'});
 f.set((i:any)=>[f.d(i.event.event_id,{subject:'Demo Leda',predicate:'owns',object:'Demo Lantern',valid_from:feb})],(i:any)=>[{index:0,duplicate_ids:[],unaffected_ids:i.candidates.filter((c:any)=>[typed.id,sibling.id].includes(c.id)).map((c:any)=>c.id),changes:i.candidates.filter((c:any)=>[raw.id,owner.id].includes(c.id)).map((c:any)=>({type:'state_change',target_ids:[c.id]}))}]);
 const r=f.event('handover','Demo Leda takes over Demo Lantern from Demo Nola. Reporting and review are unchanged.',feb);await f.w.runOnce();
 expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?',r.job_id).status).toBe('succeeded');
 expect(f.graph().edges.find(e=>e.id===typed.id)?.status).toBe('active');expect(f.graph().edges.find(e=>e.id===raw.id)?.status).toBe('active');
 expect(f.graph().edges.find(e=>e.id===sibling.id)?.status).toBe('active');expect(f.graph().edges.find(e=>e.id===owner.id)?.status).toBe('historical');
 const audit=JSON.parse(f.s.one('SELECT disposition_json FROM memory_reconciliations WHERE job_id=?',r.job_id).disposition_json);
 expect(audit.blocked_dispositions[0].reason).toBe('incompatible_unaffected');expect(audit.changes.flatMap((c:any)=>c.target_ids)).not.toContain(typed.id);
 }finally{f.s.close()}
});
test('consistency is symmetric, preserves legitimate predicate/entity rewrites and never creates a vocabulary gate',()=>{
 const expand=(ids:string[])=>ids.some(id=>['raw','typed'].includes(id))?['raw','typed']:ids;
 for(const [affected,unaffected] of [['raw','typed'],['typed','raw']]) {
 const r=consistentReconciliation({index:0,duplicate_ids:[],unaffected_ids:[unaffected!],changes:[{type:'correction',target_ids:[affected!]},{type:'state_change',target_ids:['actual-owner']}]},expand);
 expect(r.changes).toEqual([{type:'state_change',target_ids:['actual-owner']}]);expect(r.blocked_dispositions?.[0].target_ids).toContain('typed');
 }
 expect(consistentReconciliation({index:0,duplicate_ids:[],changes:[{type:'correction',target_ids:['renamed-both-endpoints']}]},expand).changes).toHaveLength(1);
});
test('already-damaged on-disk graph repairs via authenticated exact-proof API, preserves custody/history and rejects stale/ungranted repair',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'atlas-decision-repair-')),path=join(dir,'fixture.sqlite');const f=fixture(path);
 try{
 const raw=await f.seed('raw',{subject:'Demo archive',predicate:'Mira reports_to',object:'Demo Nola; raw reporting'}),typed=await f.seed('typed');
 const oldOwner=await f.seed('owner',{subject:'Demo Nola',predicate:'owns',object:'Demo Lantern'});
 const handover=await f.seed('handover',{subject:'Demo Leda',predicate:'owns',object:'Demo Lantern',valid_from:feb},'Demo Leda takes over Demo Lantern from Demo Nola. Nothing ends reporting.',feb);
 const changes=[raw.id,typed.id,oldOwner.id].map(target=>({id:id('change'),event_pk:handover.e.id,target_id:target,replacement_id:handover.id,type:'state_change',effective_at:feb,recorded_at:now()}));
 // Fault injection reconstructs the old compiled inconsistency, NOT new model evidence.
 for(const c of changes)f.s.run('INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)',...Object.values(c));
 f.s.run('INSERT INTO memory_reconciliations VALUES (?,?,?,?,?)',handover.receipt.job_id,handover.e.id,handover.id,JSON.stringify({index:0,duplicate_ids:[],unaffected_ids:[typed.id],changes:[{type:'state_change',target_ids:[raw.id,typed.id]},{type:'state_change',target_ids:[oldOwner.id]}]}),now());
 const before=now(),sources=f.s.all('SELECT * FROM memory_events'),jobs=f.s.all('SELECT * FROM memory_jobs'),priorChanges=f.s.all('SELECT * FROM memory_changes');await Bun.sleep(3);
 expect(f.graph().edges.find(e=>e.id===typed.id)?.status).toBe('historical');
 const snapshot=f.m.candidates(f.a.workspace_id,['agent:builder'],'Demo Mira Nola',24);
 const app=new App(f.s),url=`http://localhost/v1/memory/reconciliations/${handover.receipt.job_id}`;
 const call=async(route:string,body:any,key='repair')=>{const r=await app.fetch(new Request(url+route,{method:'POST',headers:{Authorization:`Bearer ${f.b.token}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)}));return {status:r.status,body:await r.json() as any}};
 expect((await call('/repair-preview',{agent_id:'builder',expected_revision:2})).status).toBe(409);
 const p=await call('/repair-preview',{agent_id:'builder',expected_revision:1});expect(p.status).toBe(200);const plan=p.body.data;
 expect(plan.change_ids.sort()).toEqual(changes.slice(0,2).map(c=>c.id).sort());
 const body={agent_id:'builder',expected_revision:1,expected_proof_sha256:plan.proof_sha256,change_ids:plan.change_ids,reason_code:'inconsistent_processing_decision'};
 expect((await call('/repair',{...body,expected_proof_sha256:'stale'},'stale')).status).toBe(409);
 const repaired=await call('/repair',body);expect(repaired.status).toBe(200);expect((await call('/repair',body)).body.data.idempotent_replay).toBe(true);
 expect(()=>f.w.reconciliationCurrent(snapshot)).toThrow('evidence changed');
 expect(f.graph().edges.find(e=>e.id===typed.id)?.status).toBe('active');expect(f.graph().edges.find(e=>e.id===oldOwner.id)?.status).toBe('historical');
 expect(f.graph(true,before).edges.find(e=>e.id===typed.id)?.status).toBe('historical');
 expect(f.graph().changes.find(c=>c.id===changes[1]!.id)?.invalidated_at).toBeTruthy();
 expect(f.s.all('SELECT * FROM memory_events')).toEqual(sources);expect(f.s.all('SELECT * FROM memory_jobs')).toEqual(jobs);expect(f.s.all('SELECT * FROM memory_changes')).toEqual(priorChanges);
 const reopened=new Store(path);try{expect(activeChanges(reopened,typed.id).length).toBe(0);expect(reopened.one('PRAGMA foreign_key_check')).toBeNull()}finally{reopened.close()}
 f.s.run("DELETE FROM memory_grants WHERE principal_id=? AND scope='agent:builder' AND action='write'",f.a.id);expect((await call('/repair',body)).status).toBe(403);
 expect(()=>repairPlan(f.m,f.a,'reaver',handover.receipt.job_id,1)).toThrow();
 }finally{f.s.close();rmSync(dir,{recursive:true,force:true})}
});
test('relevant atomic recall carries never-true scope through representation normalization; irrelevant recall empty and false claim never historical',async()=>{
 const f=fixture();try{
 const falseClaim=await f.seed('mistake',{subject:'Demo Lantern',predicate:'uses',object:'cobalt',object_entity:false});
 const narrative=await f.seed('correction',{subject:'Demo Lantern',predicate:'color',object:'Always amber, never cobalt; earlier cobalt was mistaken.',object_entity:false,valid_from:feb},'Correction: Demo Lantern has always used amber, never cobalt. The earlier cobalt claim was mistaken. No tools.',feb);
 const atom=await f.seed('atom',{subject:'Demo Lantern',predicate:'color',object:'amber',object_entity:false,valid_from:feb},'Demo Lantern is amber.',feb);
 const before=now();await Bun.sleep(3);
 f.s.run('INSERT INTO memory_supports SELECT ?,event_pk,roots_json,excerpt FROM memory_supports WHERE memory_id=?',atom.id,narrative.id);
 for(const [target,replacement,type] of [[falseClaim.id,narrative.id,'correction'],[narrative.id,atom.id,'superseded']])f.s.run('INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)',id('change'),narrative.e.id,target,replacement,type,feb,now());
 await f.seed('owner',{subject:'Demo Leda',predicate:'owns',object:'Demo Lantern',valid_from:feb});
 await f.seed('reporting');
 const r=await f.m.recall(f.a,{agent_id:'builder',thread_id:'fresh',query:'Demo Lantern: what color has it always used; was cobalt ever true; who owns it; who does Demo Mira report to?',valid_at:mar,token_budget:1200});
 expect(r.context).toContain('never-true belief, NOT a formerly true state');expect(r.context).toContain('always used amber, never cobalt');expect(r.memories.some(m=>m.id===falseClaim.id)).toBe(false);expect(r.memories.find(m=>m.id===atom.id)?.corrections[0].source.event_id).toBe('correction');expect(r.memories.some(m=>m.id===atom.id)).toBe(true);expect(r.pending_events).toEqual([]);
 expect((await f.m.recall(f.a,{agent_id:'builder',thread_id:'negative-only',query:'cobalt',valid_at:mar})).context).toContain('never-true');
 f.s.run('UPDATE memory_events SET content=NULL WHERE id=?',narrative.e.id);
 expect((await f.m.recall(f.a,{agent_id:'builder',thread_id:'retained',query:'Demo Lantern color',valid_at:mar})).context).toContain('always used amber, never cobalt');expect(memoryTokens(r.context)).toBeLessThanOrEqual(1200);
 expect((await f.m.recall(f.a,{agent_id:'builder',thread_id:'old',query:'Demo Lantern color',valid_at:mar,recorded_at:before})).context).not.toContain('CORRECTION');
 expect((await f.m.recall(f.a,{agent_id:'builder',thread_id:'irrelevant',query:'Neptune orbital eccentricity'})).context).toBe('');
 f.m.event(f.a,{client_id:'consistency',event_id:'correction',revision:2,operation:'delete',agent_id:'builder',thread_id:'scenario',role:'user',author_id:'alex',occurred_at:feb,observed_at:now()});
 expect((await f.m.recall(f.a,{agent_id:'builder',thread_id:'forgotten',query:'Demo Lantern color',valid_at:mar})).context).not.toContain('CORRECTION');
 }finally{f.s.close()}
});
test('shared correction metadata never publishes private source siblings; interval corrections are not never-true claims',async()=>{
 const f=fixture();try{
 const old=await f.seed('shared-old',{scope:'business:alex',subject:'Demo Lantern',predicate:'color',object:'cobalt',object_entity:false});
 const positive=await f.seed('shared-new',{scope:'business:alex',subject:'Demo Lantern',predicate:'color',object:'amber',object_entity:false,valid_from:feb},'Correction: Demo Lantern has always used amber, never cobalt, and private vault location is hidden-cabinet.',feb);
 f.s.run('INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)',id('change'),positive.e.id,old.id,positive.id,'correction',feb,now());
 const principal=id('prn');f.s.run('INSERT INTO principals VALUES (?,?,?,?,?,?)',principal,f.a.workspace_id,'Other reader','agent',0,now());
 const key=f.s.issueKey(principal),other=f.s.authenticate(key.token);f.m.bind(f.a,other.id,'reaver');
 const r=await f.m.recall(other,{agent_id:'reaver',thread_id:'shared-reader',query:'Demo Lantern color',valid_at:mar});
 expect(r.context).toContain('never-true');expect(r.context).not.toContain('hidden-cabinet');expect(JSON.stringify(r.memories)).not.toContain('hidden-cabinet');
 const earlier=await f.seed('earlier',{subject:'Demo milestone',predicate:'status',object:'active',object_entity:false});
 const dated=await f.seed('dated',{subject:'Demo milestone',predicate:'status',object:'active',object_entity:false,valid_from:feb},'Date correction: active began in February, not January.',feb);
 f.s.run('INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)',id('change'),dated.e.id,earlier.id,dated.id,'correction',feb,now());
 expect(correctionEvidence(f.m,f.s.one('SELECT * FROM memories WHERE id=?',dated.id),now())[0].meaning).toBe('interval_correction');
 }finally{f.s.close()}
});
