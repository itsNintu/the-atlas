import type {MemoryInference} from './inference.ts';
import {validateVectors} from './inference.ts';
import {hash,canonical} from './store.ts';

// Cache inference only, never evidence or packets. A Memory instance belongs to
// one store/deployment; exact private authorization and provider identities are
// additionally part of each digest. No raw query or credential is retained.
export class QueryEmbeddingCache {
  private values=new Map<string,{expires:number,value:{vectors:number[][],model:string}}>();
  private pending=new Map<string,Promise<{vectors:number[][],model:string}>>();
  private identities=new WeakMap<object,number>();
  private sequence=0;
  constructor(private clock=()=>Date.now(),private ttl=60_000,private capacity=128,private maxPending=32) {}
  async get(inference:MemoryInference,scope:unknown,query:string) {
    for(const identity of [inference,inference.embed])if(!this.identities.has(identity))this.identities.set(identity,++this.sequence);
    const key=hash(canonical([scope,this.identities.get(inference),this.identities.get(inference.embed),inference.embeddingIdentity?.()??'instance-local',query]));
    const at=this.clock();
    for(const [k,v] of this.values)if(v.expires<=at)this.values.delete(k);
    const cached=this.values.get(key);
    const copy=(v:{vectors:number[][],model:string})=>({model:v.model,vectors:v.vectors.map(row=>[...row])});
    if(cached){this.values.delete(key);this.values.set(key,cached);return {...copy(cached.value),cache:'hit'};}
    const existing=this.pending.get(key);
    if(existing)return {...copy(await existing),cache:'coalesced'};
    const retain=this.pending.size<this.maxPending;
    const work=(async()=>{
      const result=await inference.embed([query]);
      // Disabled/empty results are not successful semantics and are never kept.
      if(!result.vectors.length)return result;
      const value=copy(validateVectors(result,1));
      if(retain){
        while(this.values.size>=this.capacity)this.values.delete(this.values.keys().next().value!);
        this.values.set(key,{expires:this.clock()+this.ttl,value});
      }
      return value;
    })();
    if(retain)this.pending.set(key,work);
    try{return {...copy(await work),cache:retain?'miss':'bypass'};}
    finally{if(retain)this.pending.delete(key);}
  }
}
