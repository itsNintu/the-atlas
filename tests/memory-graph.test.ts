import { test, expect } from "bun:test";
import { App } from "../src/app.ts";
import { memoryGraph } from "../src/memory-graph.ts";
import { Store, now } from "../src/store.ts";
import { brainFixture, seedBrain, jan, feb, mar } from "../scripts/brain-fixture.ts";
const graph=(f:ReturnType<typeof brainFixture>,body:any={},actor=f.actor)=>memoryGraph(f.memory,actor,{agent_id:actor===f.actor?"default":"builder",valid_at:mar,...body});

test("persisted scoped graph connects real entities; text stays literal; pending intake is only diagnostics",()=>{
 const f=brainFixture();seedBrain(f);
 const g=graph(f);expect(g.edges).toHaveLength(8);expect(g.nodes.some(n=>n.label==="Hidden Builder")).toBe(false);
 expect(g.nodes.find(n=>n.label==="short, specific updates")?.kind).toBe("literal");
 const mira=g.edges.find(e=>e.predicate==="leads")!,lantern=g.edges.find(e=>e.predicate==="based_in")!;
 expect(mira.target).toBe(lantern.source);expect(g.nodes.find(n=>n.id===mira.target)?.kind).toBe("entity");
 expect(g.nodes.filter(n=>n.label==="Mira")).toHaveLength(2); // separate private/shared identities
 expect(JSON.stringify(g.nodes)).not.toContain("Pending chatter");
 expect(g.processing.jobs.find(j=>j.status==="queued")?.count).toBe(1);
 expect(graph(f).edges.map(e=>[e.id,e.source,e.target])).toEqual(g.edges.map(e=>[e.id,e.source,e.target]));
 expect(f.store.all("SELECT * FROM memory_recalls")).toHaveLength(0);f.store.close();
});

test("bindings, mixed scopes, revocation, admin and cross-workspace fences precede graph counts",()=>{
 const f=brainFixture();seedBrain(f);
 expect(()=>graph(f,{agent_id:"builder"})).toThrow("server-bound");
 expect(()=>graph(f,{scopes:["user:alex","agent:builder"]})).toThrow("Every requested scope");
 const b=graph(f,{},f.builder);expect(b.nodes.some(n=>n.label==="Hidden Builder")).toBe(true);expect(b.edges.some(e=>e.scope==="agent:default")).toBe(false);
 f.store.run("DELETE FROM memory_grants WHERE principal_id=? AND scope='business:alex'",f.actor.id);
 expect(graph(f).scopes).not.toContain("business:alex");expect(()=>graph(f,{scopes:["business:alex"]})).toThrow();
 const foreign=brainFixture(new Store(":memory:"));expect(()=>memoryGraph(f.memory,foreign.actor,{agent_id:"default"})).toThrow();foreign.store.close();
 f.store.run("UPDATE credentials SET revoked_at=? WHERE id=?",now(),f.boot.credential_id);expect(()=>graph(f)).toThrow();f.store.close();
});

test("valid/recorded snapshot, state changes, never-true corrections, provenance and real versions remain distinct",()=>{
 const f=brainFixture();const old=f.add("Mira","location","Lisbon"),next=f.add("Mira","location","Porto","user:alex",{valid_from:feb,recorded_from:feb});f.change(old,next,"state_change");
 expect(graph(f).edges.map(e=>e.id)).toEqual([next.id]);
 const past=graph(f,{valid_at:"2026-01-15T00:00:00Z"});expect(past.edges[0]?.id).toBe(old.id);expect(past.edges[0]?.valid_to).toBe(feb);
 const historical=graph(f,{include_history:true});expect(historical.edges.find(e=>e.id===old.id)?.status).toBe("historical");expect(historical.changes[0]?.type).toBe("state_change");
 const truth=f.add("Mira","location","Coimbra","user:alex",{valid_from:feb,recorded_from:mar});f.change(next,truth,"correction",feb,mar);
 expect(graph(f).edges.map(e=>e.id)).toEqual([truth.id]);
 const known=graph(f,{recorded_at:"2026-02-15T00:00:00Z"});expect(known.edges.map(e=>e.id)).toEqual([next.id]);
 const h=graph(f,{include_history:true});expect(h.edges.find(e=>e.id===next.id)?.status).toBe("corrected");expect(h.changes.map(c=>c.type)).toContain("correction");
 const e=h.edges.find(e=>e.id===truth.id)!;expect(e.versions[0]?.reason).toBe("created");expect(e.sources[0]).toMatchObject({event_id:truth.event.event_id,revision:1,role:"user",author_id:"fictional-tester",excerpt:"Coimbra"});f.store.close();
});

test("forget/edit removes graph and historical evidence, keeps independent supported claims, repairs changes",()=>{
 const f=brainFixture();const a=f.add("Mira","location","Porto"),b=f.add("Mira","location","Coimbra");f.change(a,b,"correction");
 f.event(a.event.event_id,"",f.actor,{revision:2,operation:"delete"});
 const g=graph(f,{include_history:true});expect(g.edges.map(e=>e.id)).toEqual([b.id]);expect(g.changes).toHaveLength(0);expect(JSON.stringify(g)).not.toContain("Porto");
 f.event(b.event.event_id,"Replacement source not yet digested",f.actor,{revision:2});
 expect(graph(f,{include_history:true,recorded_at:feb}).edges).toHaveLength(0);f.store.close();
});

test("entity identity never leaks across scopes; search/limit/truncation and malformed inputs are honest",()=>{
 const f=brainFixture();f.add("Hidden Entity","knows","secret","agent:builder");f.add("Mira","mentions","Hidden Entity");
 expect(graph(f).nodes.find(n=>n.label==="Hidden Entity")?.kind).toBe("literal");
 f.add("Mira","prefers","tea");expect(graph(f,{query:"no such text"}).edges).toHaveLength(0);
 expect(graph(f,{query:"%"}).edges).toHaveLength(0);expect(graph(f,{limit:1}).truncated).toBe(true);
 expect(graph(f,{query:"tea"}).edges).toHaveLength(1);
 for(const body of [{limit:101},{limit:0},{valid_at:"bad"},{recorded_at:jan+"junk"},{include_history:"true"},{scopes:[]},{query:123}])expect(()=>graph(f,body)).toThrow();f.store.close();
});

test("retained known historical entities stay connected; source redaction and provenance bounds are explicit",()=>{
 const f=brainFixture();const entity=f.add("Lantern","location","Porto","user:alex",{valid_to:feb});const link=f.add("Mira","leads","Lantern");
 const g=graph(f,{include_history:true}),a=g.edges.find(e=>e.id===entity.id)!,b=g.edges.find(e=>e.id===link.id)!;expect(a.source).toBe(b.target);
 f.store.run("UPDATE memory_supports SET excerpt=? WHERE memory_id=?","password=fixture-sensitive-value",link.id);
 for(let i=2;i<=22;i++) f.store.run("INSERT INTO memory_versions VALUES (?,?,?,?,?,?)",link.id,i,"user:alex",jan,"consolidation","{}");
 const bounded=graph(f,{query:"leads"}).edges[0]!;expect(bounded.versions).toHaveLength(20);expect(bounded.versions_truncated).toBe(true);expect(bounded.sources[0]?.excerpt).not.toContain("fixture-sensitive-value");
 expect(JSON.stringify(graph(f,{query:"Porto"}))).not.toContain(link.event.event_id);f.store.close();
});

test("HTTP v1 envelope, authentication, no idempotency requirement and private static asset policy",async()=>{
 const f=brainFixture();seedBrain(f);const app=new App(f.store);app.memory=f.memory;
 const request=(body:any,token=f.boot.token)=>app.fetch(new Request("http://localhost/v1/memory/graph",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)}));
 const r=await request({agent_id:"default"});expect(r.status).toBe(200);const result=await r.json() as any;expect(result.api_version).toBe("v1");expect(result.request_id).toBeTruthy();expect(result.data.nodes.length).toBeGreaterThan(0);
 expect((await request({agent_id:"default"},"invalid")).status).toBe(401);
 expect((await request({agent_id:"default",scopes:["user:alex","agent:builder"]})).status).toBe(403);
 for(const path of ["/brain","/brain.js","/brain.css"]){const r=await app.fetch(new Request("http://localhost"+path));expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("no-store");expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");}
 f.store.close();
});
