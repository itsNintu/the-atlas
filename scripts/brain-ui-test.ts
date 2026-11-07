import { chromium, expect } from "@playwright/test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { App } from "../src/app.ts";
import { brainFixture, seedBrain } from "./brain-fixture.ts";
const repo=join(import.meta.dir,".."),out=join(repo,"evidence/brain-view");mkdirSync(out,{recursive:true});
const dir=mkdtempSync(join(repo,".private-brain-")),f=brainFixture(new Store(join(dir,"brain.sqlite"))),seed=seedBrain(f),app=new App(f.store);
app.memory=f.memory;
const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:r=>app.fetch(r)}),url=`http://127.0.0.1:${server.port}/brain`;
const browser=await chromium.launch({headless:true}),checks:string[]=[],errors:string[]=[],http:number[]=[];
try{
 const context=await browser.newContext({viewport:{width:1500,height:1100}}),page=await context.newPage();
 page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
 page.on("response",r=>{if(r.url().endsWith("/v1/memory/graph"))http.push(r.status());});
 await page.goto(url);await expect(page).toHaveTitle("The Atlas · Durable brain");
 assert.deepEqual(await page.evaluate(()=>({l:localStorage.length,s:sessionStorage.length,c:document.cookie})),{l:0,s:0,c:""});
 await page.locator("#token").fill(f.boot.token);await page.locator("#login button").click();
 await expect(page.locator("#workspace")).toBeVisible();await expect(page.locator("#token")).toHaveValue("");await expect(page.locator("#relations .relation")).toHaveCount(8);
 await expect(page.locator("#processing")).toContainText("1 awaiting / processing");assert(!await page.locator("#scene").textContent().then(t=>(t||"").includes("Hidden Builder")));
 checks.push("Actual authenticated HTTP API reads on-disk persisted fixture; pending chatter excluded and caller-only processing state visible; private other-agent graph absent");
 const lead=page.locator("#relations .relation").filter({hasText:"leads"});await lead.click();await expect(page.locator("#detail")).toContainText("fictional-tester");await expect(page.locator("#detail")).toContainText("brain-fiction:");await expect(page.locator("#detail")).toContainText("Lantern");
 await page.locator("#graph .node[aria-label^='Lantern,']").click();await expect(page.locator("#detail h2")).toHaveText("Lantern");await page.getByRole("button",{name:"Focus this neighborhood"}).click();await expect(page.locator("#relations .relation")).toHaveCount(3);await page.locator("#clear-focus").click();await expect(page.locator("#relations .relation")).toHaveCount(8);
 const v=await page.locator("#graph").getAttribute("viewBox");await page.locator("#zoom-in").click();assert.notEqual(await page.locator("#graph").getAttribute("viewBox"),v);
 await page.locator("#graph").hover();await page.mouse.wheel(0,140);const v2=await page.locator("#graph").getAttribute("viewBox");
 const box=(await page.locator("#graph").boundingBox())!;await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(box.x+70,box.y+65,{steps:5});await page.mouse.up();assert.notEqual(await page.locator("#graph").getAttribute("viewBox"),v2);await page.locator("#fit").click();
 checks.push("Node selection, source detail, bounded neighborhood focus, reset, zoom buttons/wheel, pointer pan and fit work in real Chromium");
 await page.locator("#scopes input[value='business:alex']").uncheck();await expect(page.locator("#relations .relation")).toHaveCount(6);await page.locator("#scopes input[value='business:alex']").check();await expect(page.locator("#relations .relation")).toHaveCount(8);
 await page.locator("#query").fill("absent nonsense");await page.locator("#refresh").click();await expect(page.locator("#empty")).toBeVisible();await expect(page.locator("#relations .relation")).toHaveCount(0);
 await page.locator("#query").fill("Lantern");await page.locator("#refresh").click();await expect(page.locator("#relations .relation")).toHaveCount(3);
 await page.locator("#query").fill("");await page.locator("#refresh").click();await expect(page.locator("#relations .relation")).toHaveCount(8);
 await page.locator("summary").click();await page.locator("#history").check();await expect(page.locator("#relations .relation")).toHaveCount(9);await expect(page.locator("#changes")).toContainText("state_change");await page.locator("#relations .relation").filter({hasText:"Ivo"}).click();await expect(page.locator("#detail")).toContainText("historical");await expect(page.locator("#detail")).toContainText("state_change");
 await page.locator("#history").uncheck();await page.locator("#valid").fill("2026-01-15T00:00:00Z");await page.locator("#refresh").click();await expect(page.locator("#relations")).toContainText("Ivo");await expect(page.locator("#relations")).not.toContainText("Nia");
 await page.locator("#valid").fill("");await page.locator("#recorded").fill("2026-01-15T00:00:00Z");await page.locator("#refresh").click();await expect(page.locator("#relations")).toContainText("Ivo");await expect(page.locator("#relations")).not.toContainText("Nia");
 await page.locator("#recorded").fill("");await page.locator("#refresh").click();await expect(page.locator("#relations")).toContainText("Nia");
 checks.push("Authorized scope toggles, literal search, empty state, valid-time and recorded-time snapshots, real persisted state-change/history and attribution are reflected");
 const evolved=f.add("Nia","works_on","Lantern");await page.locator("#refresh").click();await expect(page.locator("#relations .relation")).toHaveCount(9);await expect(page.locator("#relations")).toContainText("works_on");
 // Actual deletion through the product custody path must disappear on refresh.
 f.event(evolved.event.event_id,"",f.actor,{revision:2,operation:"delete"});await page.locator("#refresh").click();await expect(page.locator("#relations .relation")).toHaveCount(8);await expect(page.locator("#relations")).not.toContainText("works_on");
 checks.push("Persisted new knowledge appears on refresh; real source forgetting removes the edge and history, without changing unrelated supported relationships");
 await page.locator("#history").check();await expect(page.locator("#relations .relation")).toHaveCount(9);await page.locator("#relations .relation").filter({hasText:"Nia"}).click();
 await page.screenshot({path:join(out,"desktop.png"),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.locator("#relations .relation").filter({hasText:"Nia"}).click();await expect(page.locator("#detail")).toContainText("Nia");
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(out,"narrow.png"),fullPage:true});
 await page.locator("#graph .node").first().focus();await page.keyboard.press("Enter");await expect(page.getByRole("button",{name:"Focus this neighborhood"})).toBeVisible();
 checks.push("1500×1100 and 390×844 viewports render without horizontal overflow; accessible list and keyboard node selection remain usable");
 // Poll is exercised once against a real persisted addition, not a mocked fetch.
 await page.locator("#history").uncheck();await expect(page.locator("#relations .relation")).toHaveCount(8);await page.locator("#live").check();f.add("Lantern","milestone","Fictional pilot");await expect(page.locator("#relations")).toContainText("Fictional pilot",{timeout:18000});await page.locator("#live").uncheck();
 checks.push("15-second polling reflects new persisted fixture knowledge without navigation");
 assert.deepEqual(await page.evaluate(()=>({l:localStorage.length,s:sessionStorage.length,c:document.cookie})),{l:0,s:0,c:""});assert(!page.url().includes(f.boot.token));
 f.store.run("DELETE FROM memory_grants WHERE principal_id=? AND scope='user:alex'",f.actor.id);await page.locator("#refresh").click();await expect(page.locator("#error")).toContainText("memory_grant_required");await expect(page.locator("#relations .relation")).toHaveCount(0);await expect(page.locator("#scene .node")).toHaveCount(0);
 await page.reload();await expect(page.locator("#connect")).toBeVisible();await expect(page.locator("#workspace")).toBeHidden();
 checks.push("Current grant revocation fails the entire mixed-scope request and clears stale graph/detail; credential never stored or URL-encoded; reload disconnects");
 // Expected 403 console error is not a JS/CSP defect.
 assert.deepEqual(errors.filter(e=>!e.includes("403 (Forbidden)")),[]);assert(http.includes(403)&&http.filter(s=>s===200).length>10);
 const result={run_at:new Date().toISOString(),result:"pass",checks,browser:browser.version(),synthetic_data_only:true,actual_http:true,actual_sqlite_disk:true,model_extraction_claim:false,viewports:[{width:1500,height:1100},{width:390,height:844}],http_responses:{ok:http.filter(s=>s===200).length,denied:http.filter(s=>s===403).length},page_errors:errors.filter(e=>!e.includes("403 (Forbidden)")),screenshots:["desktop.png","narrow.png"]};
 await Bun.write(join(out,"browser.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await server.stop(true);f.store.close();rmSync(dir,{recursive:true,force:true});}
