import {test,expect} from 'bun:test';
import {Store,now} from '../src/store.ts';
import {Memory,MemoryWorker,memoryTokens} from '../src/memory.ts';
import {candidateIdentities} from '../src/memory-identity.ts';
import {validateReconciliations} from '../src/memory-reconciliation.ts';
const t='2026-11-07T13:41:56.549Z';
const d:any={kind:'episode',scope:'agent:builder',subject:'FEN9',predicate:'qualification',object:'Fictional archive only; not Alex or real business.',object_entity:false,valid_from:t,valid_to:null,importance:.7,confidence:1,evidence_event_ids:['fen9']};
test('native literal qualification identity receives an exact response contract, not an invitation to rewrite candidate literals',async()=>{
 const s=new Store(':memory:'),b=s.bootstrap('Synthetic native phase contract'),a=s.authenticate(b.token);let identity:any,reconciliation:any;
 const inf={curate:async()=>({decisions:[d]}),resolveEntities:async(i:any)=>{identity=i;return {decisions:[],identity:{subject:d.subject,object:d.object,entity_aliases:[]},candidate_identities:[]}},reconcile:async(i:any)=>{reconciliation=i;return [{index:0,duplicate_ids:[]}]},embed:async()=>({vectors:[[1,0]],model:'deterministic-not-luna'})};
 const m=new Memory(s,inf),w=new MemoryWorker(s,inf);m.bind(a,a.id,'builder');
 try{const r=m.event(a,{client_id:'phase',event_id:'fen9',revision:1,operation:'upsert',agent_id:'builder',thread_id:'fen9',role:'user',author_id:'alex',occurred_at:t,observed_at:now(),content:'Private fictional archive FEN9 only, not Alex or real business.'});await w.runOnce();
 expect(s.one('SELECT status FROM memory_jobs WHERE id=?',r.job_id).status).toBe('succeeded');
 expect(identity.response_contract.identity_object).toEqual({literal_exact:d.object});
 expect(identity.response_contract.candidate_fields).toEqual(['id','subject']);
 expect(reconciliation.response_contract.item_indices).toEqual([0]);
 expect(reconciliation.response_contract).not.toHaveProperty('identity_object');
 expect(memoryTokens(JSON.stringify(identity))).toBeLessThanOrEqual(4096);expect(memoryTokens(JSON.stringify(reconciliation))).toBeLessThanOrEqual(4096);
 }finally{s.close()}
});
test('actual invalid literal candidate binding and ambiguous truth disposition stay fail-visible',()=>{
 const c=[{id:'qualification',subject:'FEN9',object:d.object}];
 // Native failure shape: generic candidate schema elicited an illegal literal paraphrase.
 expect(()=>candidateIdentities({candidate_identities:[{id:'qualification',subject:'FEN9',object:'Fictional archive context only; not independently verified real-world facts.'}]},d,c)).toThrow();
 expect(()=>validateReconciliations({items:[{index:0,duplicate_ids:[],change:{type:'superseded',target_ids:['qualification']}}]},1)).toThrow();
 expect(()=>validateReconciliations({items:[{index:1,duplicate_ids:[]}]},1)).toThrow();
 expect(()=>validateReconciliations({items:[{index:0,duplicate_ids:['same'],change:{type:'state_change',target_ids:['same']}}]},1)).toThrow();
});
test('same-source observation defaults cannot reverse time; real earlier supported prior truth still permits explicit handover',()=>{
 const w=new MemoryWorker({} as any),e={event_id:'same-original',occurred_at:t,role:'user',agent_id:'builder'};
 const decision:any={...d,evidence_event_ids:['same-original'],subject:'LDN7 Leda',predicate:'owns',object:'LDN7 Lantern',object_entity:true,change:{type:'state_change',target_ids:['prior']}};
 const prior={id:'prior',scope:d.scope,subject:'LDN7 Nola',predicate:'owns',object:'LDN7 Lantern',valid_from:t,supports:[{event_id:'same-original',occurred_at:t}]};
 expect(()=>w.validate([decision],e,[d.scope],[prior])).toThrow('State reversal must follow target start');
 expect(()=>w.validate([decision],e,[d.scope],[{...prior,supports:[{event_id:'earlier-original',occurred_at:'2026-11-06T13:41:56.549Z'}]}])).not.toThrow();
});
