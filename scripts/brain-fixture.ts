import { Store, id, hash, now } from "../src/store.ts";
import { Memory } from "../src/memory.ts";

// Explicit fictional persisted fixture, NOT model extraction or production data.
export const jan = "2026-01-01T00:00:00.000Z", feb = "2026-02-01T00:00:00.000Z", mar = "2026-03-01T00:00:00.000Z";
export function brainFixture(store = new Store(":memory:")) {
  const boot = store.bootstrap("Fictional brain fixture"), actor = store.authenticate(boot.token), memory = new Memory(store);
  memory.bind(actor, actor.id, "default");
  const p = id("prn");
  store.run("INSERT INTO principals VALUES (?,?,?,?,?,?)", p, actor.workspace_id, "builder", "agent", 0, now());
  memory.bind(actor, p, "builder");
  const key = store.issueKey(p), builder = store.authenticate(key.token);
  const event = (event_id: string, content: string, a = actor, extra: any = {}) => {
    const r=memory.event(a, {client_id:"brain-fiction",event_id,revision:1,operation:"upsert",agent_id:a===actor?"default":"builder",thread_id:"fictional-brain",role:"user",author_id:"fictional-tester",occurred_at:jan,observed_at:jan,content,causal_parent_ids:[],evidence_root_ids:[],metadata:{synthetic:true},...extra});
    const e=store.one("SELECT * FROM memory_events WHERE event_id=? AND revision=?",event_id,extra.revision||1);
    store.run("UPDATE memory_events SET accepted_at=? WHERE id=?",jan,e.id);
    return {...e,receipt:r};
  };
  const add = (subject:string,predicate:string,object:string,scope="user:alex",extra:any={}) => {
    const e=event(id("fixture"),`${subject} ${predicate} ${object}`,scope==="agent:builder"?builder:actor);
    const entity=memory.entity(actor.workspace_id,subject,[],[scope]);
    const mid=id("memory"),start=extra.valid_from||jan,recorded=extra.recorded_from||jan;
    store.run("INSERT INTO memories (id,workspace_id,scope,kind,subject_id,subject,predicate,object,valid_from,valid_to,recorded_from,importance,confidence,fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",mid,actor.workspace_id,scope,extra.kind||"assertion",entity.id,subject,predicate,object,start,extra.valid_to||null,recorded,.8,.95,hash(mid));
    store.run("INSERT INTO memory_supports VALUES (?,?,?,?)",mid,e.id,e.roots_json,object);
    store.run("INSERT INTO memory_versions VALUES (?,?,?,?,?,?)",mid,1,scope,recorded,"created",JSON.stringify({subject,predicate,object,valid_from:start,valid_to:extra.valid_to||null}));
    store.run("UPDATE memory_events SET status='processed',processed_at=? WHERE id=?",jan,e.id);
    store.run("UPDATE memory_jobs SET status='succeeded',completed_at=? WHERE event_pk=?",jan,e.id);
    return {id:mid,event:e};
  };
  const change=(target:any,replacement:any,type:string,effective_at=feb,recorded_at=feb)=>store.run("INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)",id("change"),replacement.event.id,target.id,replacement.id,type,effective_at,recorded_at);
  return {store,boot,actor,memory,builder,builderKey:key,event,add,change};
}
export function seedBrain(f:ReturnType<typeof brainFixture>) {
  const a=f.add("Mira","leads","Lantern"), b=f.add("Lantern","based_in","Porto"),c=f.add("Porto","country","Portugal"),d=f.add("Mira","prefers","short, specific updates"),old=f.add("Lantern","release_owner","Ivo"),next=f.add("Lantern","release_owner","Nia","user:alex",{valid_from:feb,recorded_from:feb});
  f.change(old,next,"state_change");
  const business=f.add("Orchid Studio","maintains","Kite","business:alex");
  f.add("Kite","stage","prototype","business:alex");
  f.add("Mira","private_note","Check the fictional fixture","agent:default",{kind:"episode"});
  f.add("Hidden Builder","private_task","Invisible to default","agent:builder");
  f.event("unprocessed-intake","Pending chatter is not a durable graph node.");
  return {a,b,c,d,old,next,business};
}
