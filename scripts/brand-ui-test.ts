import { chromium, expect, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { App } from "../src/app.ts";
import { brainFixture, seedBrain } from "./brain-fixture.ts";

// Focused visual/interaction coverage, not a replay of memory/provider acceptance.
const repo=join(import.meta.dir,".."),out=join(repo,"evidence/creator-labs");
mkdirSync(out,{recursive:true});
const dir=mkdtempSync(join(repo,".private-brand-"));
const f=brainFixture(new Store(join(dir,"brand.sqlite")));seedBrain(f);
const app=new App(f.store);app.memory=f.memory;
const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:r=>app.fetch(r)});
const origin=`http://127.0.0.1:${server.port}`;
const browser=await chromium.launch({headless:true});
const checks:string[]=[],errors:string[]=[],screenshots:string[]=[],metrics:any[]=[];
async function capture(page:Page,name:string){await page.screenshot({path:join(out,name),fullPage:true});screenshots.push(name);}
async function composition(page:Page,label:string){
 await page.evaluate(()=>document.fonts.ready);
 const m=await page.evaluate(()=>{
  const css=(q:string)=>getComputedStyle(document.querySelector(q)!);
  const img=document.querySelector<HTMLImageElement>(".publisher img")!;
  const buttons=Array.from(document.querySelectorAll("button")).filter(b=>b.getClientRects().length);
  return {width:innerWidth,scroll:document.documentElement.scrollWidth,bodyFont:css("body").fontFamily,buttonFont:css("button").fontFamily,background:css("body").backgroundColor,
   fonts:(()=>{const fonts:{family:string,status:string}[]=[];document.fonts.forEach(f=>fonts.push({family:f.family,status:f.status}));return fonts})(),logo:img.complete&&img.naturalWidth>0,transform:css(".publisher img").transform,
   accentButtons:buttons.filter(b=>["rgb(255, 0, 61)","rgb(196, 61, 179)"].includes(getComputedStyle(b).backgroundColor)).length,
   inputSizes:Array.from(document.querySelectorAll("input:not([type=checkbox]),select,textarea")).filter(e=>e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize))};
 });
 assert(m.scroll<=m.width,`${label} overflow ${JSON.stringify(m)}`);assert(m.logo);assert.equal(m.transform,"none");
 assert(m.bodyFont.includes("Space Grotesk"));assert(m.buttonFont.includes("IBM Plex Mono"));assert.equal(m.background,"rgb(11, 12, 12)");
 assert(m.fonts.every(f=>f.status==="loaded"));assert.equal(m.accentButtons,0);assert(m.inputSizes.every(s=>s>=16),`${label} input sizes ${m.inputSizes}`);metrics.push({label,...m});
}
try{
 const context=await browser.newContext({viewport:{width:1500,height:1100}}),page=await context.newPage();
 page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
 for(const [asset,type] of [["/brand.css","text/css"],["/brand/creator-labs-white.svg","image/svg+xml"],["/brand/SpaceGrotesk-variable.ttf","font/ttf"],["/brand/IBMPlexMono-Regular.ttf","font/ttf"],["/brand/IBMPlexMono-Medium.ttf","font/ttf"]]){
  const r=await fetch(origin+asset);assert.equal(r.status,200);assert(r.headers.get("content-type")?.startsWith(type));
  assert.equal(r.headers.get("x-content-type-options"),"nosniff");assert(Buffer.from(await r.arrayBuffer()).equals(readFileSync(join(repo,"ui",asset))));
 }
 for(const path of ["/brand/sources.json","/brand/README.md","/brand/missing.ttf","/brand/../app.ts"]){assert.equal((await fetch(origin+path)).status,404)}
 checks.push("Exact static allowlist serves identical CSS/SVG/font bytes with correct MIME/nosniff; unknown/private paths fail closed");
 await page.goto(origin+"/brain");await expect(page).toHaveTitle("The Atlas · Durable brain");
 await composition(page,"brain entry desktop");await page.locator("#login button").focus();
 assert.equal(await page.locator("#login button").evaluate(e=>getComputedStyle(e).outlineStyle),"solid");
 await capture(page,"brain-entry-focus-desktop.png");
 await page.locator("#login button").hover();await capture(page,"brain-entry-hover-desktop.png");
 await page.locator("#token").fill(f.boot.token);await page.locator("#login button").click();await expect(page.locator("#relations .relation")).toHaveCount(8);
 await page.locator("#relations .relation").filter({hasText:"leads"}).click();await expect(page.locator("#detail")).toContainText("fictional-tester");await expect(page.locator("#detail")).toContainText("brain-fiction:");
 await page.locator("#graph .node[aria-label^='Lantern,']").focus();await page.keyboard.press("Enter");await expect(page.locator("#detail h2")).toHaveText("Lantern");
 await page.getByRole("button",{name:"Focus this neighborhood"}).click();await expect(page.locator("#relations .relation")).toHaveCount(3);await page.locator("#clear-focus").click();
 const view=await page.locator("#graph").getAttribute("viewBox");await page.locator("#zoom-in").click();assert.notEqual(await page.locator("#graph").getAttribute("viewBox"),view);await page.locator("#fit").click();
 await page.locator("summary").click();await page.locator("#history").check();await expect(page.locator("#relations .relation")).toHaveCount(9);
 await page.locator("#relations .relation").filter({hasText:"Ivo"}).click();await expect(page.locator("#detail")).toContainText("historical");await expect(page.locator("#detail")).toContainText("state_change");
 await composition(page,"brain history desktop");await capture(page,"brain-desktop.png");
 const dash=await page.locator(".edge.history").first().evaluate(e=>getComputedStyle(e).strokeDasharray);assert.notEqual(dash,"none");
 assert.notEqual(await page.locator(".node.entity circle").first().evaluate(e=>getComputedStyle(e).fill),await page.locator(".node.literal circle").first().evaluate(e=>getComputedStyle(e).fill));
 checks.push("Real on-disk graph: node keyboard selection, edge source attribution/history, focus/reset and zoom/fit; neutral entity/literal shapes and historical dashes remain distinct");
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await composition(page,`brain history ${width}`);
  await page.locator("#relations .relation").filter({hasText:"Ivo"}).click();await expect(page.locator("#detail")).toContainText("Attributed sources");
  await capture(page,`brain-${width}.png`);
 }
 await page.locator("#query").fill("absent fictional search");await page.locator("#refresh").click();await expect(page.locator("#empty")).toBeVisible();await composition(page,"brain empty 320");
 await page.locator("#disconnect").click();await expect(page.locator("#connect")).toBeVisible();await composition(page,"brain entry 320");await capture(page,"brain-entry-320.png");
 checks.push("Brain history/source controls, empty state and entry fit 390/320px; disconnect returns to private tab-only entry");
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin);await expect(page).toHaveTitle("The Atlas · Evidence inspector");
 await composition(page,"inspector entry desktop");await capture(page,"inspector-entry-desktop.png");
 await page.locator("#token").fill(f.boot.token);await page.locator("#login button").click();await expect(page.locator("#workspace")).toBeVisible();
 await page.locator("#project-form input").fill("Fictional design fixture");await page.locator("#project-form button").click();await expect(page.locator("#projects option")).toHaveCount(1);
 await page.locator("#space-form input").fill("Fictional shared space");await page.locator("#space-form button").click();await expect(page.locator("#ingest-space option")).toHaveCount(1);
 await page.locator("#ingest-form button").click();await expect(page.locator("#sources .row")).toHaveCount(1);await page.locator("#sources button").click();await expect(page.locator("#source-output")).toContainText("Mira lives in Lisbon.");
 await page.locator("summary").click();await expect(page.locator("#grant-form")).toBeVisible();await page.locator("#correction-json").fill('{"fictional":"edit transition only"}');
 await composition(page,"inspector populated desktop");await capture(page,"inspector-desktop.png");
 for(const width of [390,320]){await page.setViewportSize({width,height:844});await composition(page,`inspector populated ${width}`);await capture(page,`inspector-${width}.png`)}
 checks.push("Inspector real authenticated project/space creation, queue ingestion, source payload inspection, grants disclosure and correction form editing preserved; desktop/390/320 layout without overflow");
 assert.deepEqual(await page.evaluate(()=>({l:localStorage.length,s:sessionStorage.length,c:document.cookie})),{l:0,s:0,c:""});assert(!page.url().includes(f.boot.token));
 await page.reload();await expect(page.locator("#connect")).toBeVisible();await composition(page,"inspector entry 320");await page.locator("#login button").focus();await capture(page,"inspector-entry-focus-320.png");
 await page.getByRole("link",{name:"Explore durable brain"}).click();await expect(page).toHaveTitle("The Atlas · Durable brain");
 assert.deepEqual(errors,[]);checks.push("No browser storage/cookies/URL credential persistence; reload disconnects and cross-view navigation works; no page/CSP/console errors");
 const result={run_at:new Date().toISOString(),result:"pass",browser:browser.version(),synthetic_data_only:true,actual_http:true,actual_sqlite_disk:true,production_activation:false,checks,metrics,page_errors:errors,screenshots,reused_evidence:["evidence/brain-view/browser.json (full graph behavior)","reports/dreaming-source.json (unaffected memory/provider coverage)"]};
 await Bun.write(join(out,"browser.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await server.stop(true);f.store.close();rmSync(dir,{recursive:true,force:true});}
