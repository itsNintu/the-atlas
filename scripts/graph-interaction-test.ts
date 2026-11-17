import { chromium, expect, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { App } from '../src/app.ts';
import { brainFixture, seedBrain } from './brain-fixture.ts';

// The same browser gestures run against synthetic disk fixtures or the authorized
// hosted graph. Hosted output stays under .private, never in public Git evidence.
const live=!!process.env.ATLAS_GRAPH_URL, repo=join(import.meta.dir,'..');
const out=join(repo,live?'.private/graph-t92/live':'evidence/graph-interaction');mkdirSync(out,{recursive:true});
const dir=live?null:mkdtempSync(join(repo,'.private-graph-'));
const f=dir?brainFixture(new Store(join(dir,'brain.sqlite'))):null;
let server:ReturnType<typeof Bun.serve>|undefined;
let token:string;
if(f){seedBrain(f);for(let i=0;i<105;i++)f.add('Lantern','connected_to',`Fictional endpoint ${i}`);const app=new App(f.store);app.memory=f.memory;server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:r=>app.fetch(r)});token=f.boot.token;}
else token=JSON.parse(readFileSync(process.env.ATLAS_GRAPH_CREDENTIAL!,'utf8')).token;
const url=live?process.env.ATLAS_GRAPH_URL!:`http://127.0.0.1:${server!.port}/brain`;
const browser=await chromium.launch({headless:true});const checks:any[]=[],errors:string[]=[];
const responseCounts:Record<string,number>={};let latest:any;
const record=(name:string,detail:any={})=>checks.push({name,...detail});
async function readGraph(page:Page,act:()=>Promise<unknown>){
 const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/v1/memory/graph')&&r.ok()),act()]);
 latest=(await response.json()).data;
 await expect(page.locator('#page-label')).toContainText(`${latest.edges.length?latest.page.offset+1:0}–${latest.page.offset+latest.edges.length} loaded`);
}
async function center(page:Page,node:any){return node.evaluate((g:SVGGElement)=>{const p=new DOMPoint(0,0).matrixTransform(g.getScreenCTM()!);return {x:p.x,y:p.y};});}
async function fit(page:Page){await page.locator('#fit').click();}
async function nodeForGesture(page:Page){
 return page.locator('#scene .node.entity').first();
}
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async r=>{if(r.url().endsWith('/v1/memory/graph')){responseCounts[r.status()]=(responseCounts[r.status()]||0)+1;}});
  await page.goto(url);await page.locator('#token').fill(token!);await page.locator('#agent').fill(live?(process.env.ATLAS_GRAPH_AGENT||'default'):'default');await readGraph(page,()=>page.locator('#login button').click());
  await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#scene .node').first()).toBeVisible();
  assert(await page.locator('#scene .node').count()>1);await page.locator('#expand-map').click();await fit(page);
  record(`${mobile?'touch':'mouse'} graph loaded`,{nodes:await page.locator('#scene .node').count(),edges:latest.edges.length,truncated:latest.truncated,viewport:mobile?'390x844 touch emulation':'1440x1000 desktop'});
  const firstNode=await nodeForGesture(page),id=await firstNode.getAttribute('data-node');
  const node=page.locator(`#scene .node[data-node="${id}"]`);
  const before=await node.getAttribute('transform'),view=await page.locator('#graph').getAttribute('viewBox');
  const incident=latest.edges.find((e:any)=>e.source===id||e.target===id)!;
  const path=page.locator(`#scene .edge-hit[data-edge="${incident.id}"]`),pathBefore=await path.getAttribute('d');
  const pos=await center(page,node),dx=mobile?45:85,dy=mobile?-45:-55;
  const cdp=await context.newCDPSession(page);
  const touch=async(type:string,points:any[])=>cdp.send('Input.dispatchTouchEvent' as any,{type,touchPoints:points.map((p,i)=>({id:i,x:p.x,y:p.y,radiusX:2,radiusY:2,force:1}))});
  if(mobile){await touch('touchStart',[pos]);for(let i=1;i<=6;i++)await touch('touchMove',[{x:pos.x+dx*i/6,y:pos.y+dy*i/6}]);await touch('touchEnd',[]);}
  else{await page.mouse.move(pos.x,pos.y);await page.mouse.down();await page.mouse.move(pos.x+dx,pos.y+dy,{steps:6});await page.mouse.up();}
  const after=await node.getAttribute('transform');assert.notEqual(after,before);assert.notEqual(await path.getAttribute('d'),pathBefore);assert.equal(await page.locator('#graph').getAttribute('viewBox'),view);
  assert.equal(await node.getAttribute('aria-pressed'),'false');
  const moved=await center(page,node);assert(Math.abs(moved.x-pos.x-dx)<1);assert(Math.abs(moved.y-pos.y-dy)<1);
  record(`${mobile?'touch':'mouse'} node drag updates node AND incident geometry without selecting/panning`,{before,after,screen_delta:{x:moved.x-pos.x,y:moved.y-pos.y},view_unchanged:true});
  await page.screenshot({path:join(out,mobile?'mobile-drag.png':'desktop-drag.png')});
  if(mobile)await page.touchscreen.tap(moved.x,moved.y);else await page.mouse.click(moved.x,moved.y);
  await expect(node).toHaveAttribute('aria-pressed','true');await expect(page.locator('#detail h2')).not.toBeEmpty();assert(await page.locator('#scene .edge.connected').count()>0);
  assert(await page.locator('#scene .node.dimmed').count()>0||await page.locator('#scene .node.connected').count()===await page.locator('#scene .node').count());
  record(`${mobile?'touch':'mouse'} tap selects and highlights actual adjacency`,{connected_edges:await page.locator('#scene .edge.connected').count(),connected_nodes:await page.locator('#scene .node.connected').count()});
  if(mobile){
   await expect(page.locator('#close-detail')).toBeInViewport();await page.locator('#close-detail').tap();await expect(page.locator('#inspector')).toBeHidden();await page.locator('#show-detail').tap();await expect(page.locator('#inspector')).toBeVisible();
  }
  // Source drill-through stays independent of the graph's render budget.
  await page.locator('#detail .relation').first().click();await expect(page.locator('#detail')).toContainText('Attributed sources');await expect(page.locator('#detail .source').first()).toBeVisible();
  assert(await page.locator('#scene .edge.selected').count()===1);
  if(mobile){await page.locator('#inspector').evaluate(e=>e.scrollTop=0);await expect(page.locator('#close-detail')).toBeInViewport();}
  await page.screenshot({path:join(out,mobile?'mobile-inspect.png':'desktop-inspect.png')});
  record(`${mobile?'touch':'mouse'} relationship selection opens persisted provenance and versions`);
  if(mobile)await page.locator('#close-detail').tap();
  // Empty top-left graph space is outside all fitted nodes (fit adds margins).
  const box=(await page.locator('#graph').boundingBox())!;const a={x:box.x+10,y:box.y+10};
  const v1=await page.locator('#graph').getAttribute('viewBox');
  if(mobile){await touch('touchStart',[a]);await touch('touchMove',[{x:a.x+50,y:a.y+40}]);await touch('touchEnd',[]);}
  else{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(a.x+80,a.y+45,{steps:6});await page.mouse.up();}
  assert.notEqual(await page.locator('#graph').getAttribute('viewBox'),v1);record(`${mobile?'touch':'mouse'} background drag pans graph`);
  const v2=await page.locator('#graph').getAttribute('viewBox');
  if(mobile){
   const y=box.y+box.height/2,cx=box.x+box.width/2;
   await touch('touchStart',[{x:cx-35,y},{x:cx+35,y}]);await touch('touchMove',[{x:cx-70,y:y+15},{x:cx+70,y:y+15}]);await touch('touchEnd',[]);
  }else{await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-150);await page.waitForTimeout(100);}
  const v3=await page.locator('#graph').getAttribute('viewBox');assert.notEqual(v3,v2);assert(Number(v3!.split(' ')[2])<Number(v2!.split(' ')[2]));record(mobile?'two-finger pinch zooms and pans':'wheel zooms at cursor',{before:v2,after:v3});
  await page.locator('#zoom-out').click();assert.notEqual(await page.locator('#graph').getAttribute('viewBox'),v3);await fit(page);
  const stable=await node.getAttribute('transform');assert.equal(stable,after);record('Fit and zoom controls preserve dragged positions');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(mobile){
   const b=(await page.locator('#graph').boundingBox())!;assert(b.width>=380&&b.height>450);record('mobile full-view graph fills available screen; controls reachable; no horizontal overflow',{graph_box:b,actual_phone:false});
  }
  await page.locator('#expand-map').click();
  await readGraph(page,()=>page.locator('#refresh').click());assert.equal(await node.getAttribute('transform'),after);record('Unchanged manual refresh retains dragged coordinates');
  // Fetch a fresh bounded page. Exercise off-page navigation and paging over HTTP.
  await page.locator('#query').fill(live?'Alex':'Lantern');await readGraph(page,()=>page.locator('#refresh').click());await expect(page.locator('#relations .relation').first()).toBeVisible();
  const seed=page.locator('#scene .node.entity').first();await seed.focus();await page.keyboard.press('Enter');
  await readGraph(page,()=>page.getByRole('button',{name:'Explore all matching connections'}).click());
  await expect(page.locator('#clear-focus')).toHaveText('Back to overview');await expect(page.locator('#page-label')).toContainText('loaded');
  record('server exact-label neighborhood navigation', {edges:latest.edges.length,focus:latest.focus,all_edges_scope_qualified:latest.edges.every((e:any)=>e.scope===latest.focus.scope)});
  assert(latest.edges.every((e:any)=>e.scope===latest.focus.scope));
  if(await page.locator('#next').isEnabled()){
   const firstIds=latest.edges.map((e:any)=>e.id);await readGraph(page,()=>page.locator('#next').click());await expect(page.locator('#previous')).toBeEnabled();
   assert(!latest.edges.some((e:any)=>firstIds.includes(e.id)));record('Next connections retrieves distinct off-page stored edges',{first_page:firstIds.length,next_page:latest.edges.length});
   await readGraph(page,()=>page.locator('#previous').click());await expect(page.locator('#previous')).toBeDisabled();
  }
  assert.deepEqual(await page.evaluate(()=>({l:localStorage.length,s:sessionStorage.length,c:document.cookie})),{l:0,s:0,c:''});
  await context.close();
 }
 assert.deepEqual(errors,[]);
 const report={result:'pass',run_at:new Date().toISOString(),origin:new URL(url).origin,live_persisted_data:live,synthetic_fixture:!live,actual_phone:false,browser:browser.version(),checks,responseCounts,page_errors:errors,screenshots:['desktop-drag.png','desktop-inspect.png','mobile-drag.png','mobile-inspect.png']};
 await Bun.write(join(out,'interactions.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();if(server)await server.stop(true);if(f)f.store.close();if(dir)rmSync(dir,{recursive:true,force:true});}
