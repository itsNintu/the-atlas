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
const out=join(repo,live?'.private/graph-physics/live':'evidence/graph-interaction');mkdirSync(out,{recursive:true});
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
 const hubs=await page.locator('#scene .node.entity').evaluateAll(ns=>ns.map(n=>({id:n.getAttribute('data-node')!})));
 const degree=new Map<string,number>();for(const e of latest.edges)for(const id of [e.source,e.target])degree.set(id,(degree.get(id)||0)+1);
 hubs.sort((a,b)=>(degree.get(b.id)||0)-(degree.get(a.id)||0));
 return page.locator(`#scene .node[data-node="${hubs[0].id}"]`);
}
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,...(live?{recordVideo:{dir:join(out,'video'),size:mobile?{width:390,height:844}:{width:1440,height:1000}}}:{})});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async r=>{if(r.url().endsWith('/v1/memory/graph')){responseCounts[r.status()]=(responseCounts[r.status()]||0)+1;}});
  await page.goto(url);await page.locator('#token').fill(token!);await page.locator('#agent').fill(live?(process.env.ATLAS_GRAPH_AGENT||'default'):'default');await readGraph(page,()=>page.locator('#login button').click());
  await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#scene .node').first()).toBeVisible();
  assert(await page.locator('#scene .node').count()>1);await page.locator('#expand-map').click();await fit(page);
  record(`${mobile?'touch':'mouse'} graph loaded`,{nodes:await page.locator('#scene .node').count(),edges:latest.edges.length,truncated:latest.truncated,viewport:mobile?'390x844 touch emulation':'1440x1000 desktop'});
  await page.mouse.move(0,0);await page.evaluate(()=>document.fonts.ready);
  const design=await page.evaluate(()=>({nodeLabels:document.querySelectorAll('.node text.label-visible').length,edgeLabels:document.querySelectorAll('.edge-label.label-visible').length,nodes:document.querySelectorAll('.node').length,arrows:Array.from(document.querySelectorAll('.edge')).some(e=>getComputedStyle(e).markerEnd!=='none'),fonts:document.fonts.check('14px "Space Grotesk"')&&document.fonts.check('12px "IBM Plex Mono"'),font:getComputedStyle(document.body).fontFamily}));
  assert(!design.arrows);assert(design.fonts);assert(design.nodeLabels<design.nodes);assert.equal(design.edgeLabels,0);
  await page.screenshot({path:join(out,mobile?'mobile-overview.png':'desktop-overview.png')});
  record('Creator Labs fonts, arrowless edges and sparse overview labels',design);
  const firstNode=await nodeForGesture(page),id=await firstNode.getAttribute('data-node');
  const labelCounts=[];const zoomPoint=await center(page,firstNode);
  await page.mouse.move(zoomPoint.x,zoomPoint.y);
  // Wheel dispatch here changes only the camera; move off canvas before counts
  // so hover emphasis cannot masquerade as zoom-dependent eligibility.
  for(let i=0;i<7;i++){
   await page.locator('#graph').dispatchEvent('wheel',{deltaY:-100,clientX:zoomPoint.x,clientY:zoomPoint.y,ctrlKey:true});
   await page.mouse.move(0,0);
   labelCounts.push(await page.locator('.node text.label-visible').count());
  }
  const labelRects=await page.locator('.node text.label-visible,.edge-label.label-visible').evaluateAll(ts=>ts.map(t=>{const r=t.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
  for(let a=0;a<labelRects.length;a++)for(let b=a+1;b<labelRects.length;b++){const x=labelRects[a],y=labelRects[b];assert(!(x.x<y.x+y.w-1&&x.x+x.w>y.x+1&&x.y<y.y+y.h-1&&x.y+x.h>y.y+1),'visible graph labels must not collide');}
  assert(labelCounts.some(n=>n>design.nodeLabels),'zoom should reveal additional eligible node labels');
  await page.screenshot({path:join(out,mobile?'mobile-zoom-labels.png':'desktop-zoom-labels.png')});
  record('Zoom progressively reveals non-overlapping labels',{overview:design.nodeLabels,zoom_counts:labelCounts,visible_labels:labelRects.length});
  await fit(page);
  if(!mobile){
   const p=await center(page,firstNode);await page.mouse.move(p.x,p.y);
   assert(await page.locator('.edge.connected').count()>0);assert(await page.locator('.node.hovered').count()===1);
   await page.screenshot({path:join(out,'desktop-hover.png')});
   record('Hover reveals actual neighborhood without selection');
   await page.mouse.move(0,0);
   const positionsBefore=await page.locator('.node').evaluateAll(ns=>ns.map(n=>n.getAttribute('transform')));
   const cameraBefore=await page.locator('#graph').getAttribute('viewBox');
   await page.keyboard.down('Space');await expect(page.locator('#graph')).toHaveClass(/space-pan/);
   await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+66,p.y+32,{steps:8});
   await expect(page.locator('#graph')).toHaveClass(/is-panning/);await page.mouse.up();await page.keyboard.up('Space');
   assert.notEqual(await page.locator('#graph').getAttribute('viewBox'),cameraBefore);
   assert.deepEqual(await page.locator('.node').evaluateAll(ns=>ns.map(n=>n.getAttribute('transform'))),positionsBefore);
   await expect(firstNode).toHaveAttribute('aria-pressed','false');
   record('Space-drag starting on a node pans without changing physics or selecting');
   await page.keyboard.down('Space');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(page.locator('#graph')).not.toHaveClass(/space-pan/);await page.keyboard.up('Space');
   await page.locator('#query').focus();await page.keyboard.type('two words');await expect(page.locator('#query')).toHaveValue('two words');await expect(page.locator('#graph')).not.toHaveClass(/space-pan/);await page.locator('#query').fill('');
   await page.evaluate(()=>{const e=document.createElement('div');e.id='test-editor';e.contentEditable='true';document.body.appendChild(e);e.focus();});await page.keyboard.type('a b');assert.equal(await page.locator('#test-editor').innerText(),'a b');await expect(page.locator('#graph')).not.toHaveClass(/space-pan/);await page.locator('#test-editor').evaluate(e=>e.remove());
   record('Space keyup/blur clears pan; input and contenteditable spaces remain typing');
   const box=(await page.locator('#graph').boundingBox())!,cursor={x:box.x+box.width*.38,y:box.y+box.height*.44};
   const anchor=await page.locator('#graph').evaluate((g:SVGSVGElement,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(g.getScreenCTM()!.inverse());return {x:q.x,y:q.y};},cursor);
   const scrollBefore=await page.evaluate(()=>({y:scrollY,scale:visualViewport!.scale,dpr:devicePixelRatio}));const v=await page.locator('#graph').getAttribute('viewBox');
   await page.mouse.move(cursor.x,cursor.y);await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control');await page.waitForTimeout(150);
   assert(Number((await page.locator('#graph').getAttribute('viewBox'))!.split(' ')[2])<Number(v!.split(' ')[2]));
   const projected=await page.locator('#graph').evaluate((g:SVGSVGElement,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(g.getScreenCTM()!);return {x:q.x,y:q.y};},anchor);
   assert(Math.hypot(projected.x-cursor.x,projected.y-cursor.y)<.5);assert.deepEqual(await page.evaluate(()=>({y:scrollY,scale:visualViewport!.scale,dpr:devicePixelRatio})),scrollBefore);
   record('Ctrl-wheel zoom anchors pointer and does not zoom/scroll page');await fit(page);
  }
  const node=page.locator(`#scene .node[data-node="${id}"]`);
  const before=await node.getAttribute('transform'),view=await page.locator('#graph').getAttribute('viewBox');
  const incident=latest.edges.find((e:any)=>e.source===id||e.target===id)!;
  const path=page.locator(`#scene .edge-hit[data-edge="${incident.id}"]`),pathBefore=await path.getAttribute('d');
  const pos=await center(page,node),dx=mobile?45:85,dy=mobile?-45:-55;
  const cdp=await context.newCDPSession(page);
  const touch=async(type:string,points:any[])=>cdp.send('Input.dispatchTouchEvent' as any,{type,touchPoints:points.map((p,i)=>({id:i,x:p.x,y:p.y,radiusX:2,radiusY:2,force:1}))});
  // Sample the actual SVG on animation frames, not only the dragged node.
  const snapshot=()=>page.locator('#scene .node').evaluateAll(ns=>Object.fromEntries(ns.map(n=>{const m=(n as SVGGElement).transform.baseVal.consolidate()!.matrix;return [n.getAttribute('data-node')!,{x:m.e,y:m.f}];})));
  const allBefore=await snapshot();
  const neighbors=[...new Set<string>(latest.edges.filter((e:any)=>e.source===id||e.target===id).flatMap((e:any)=>[e.source,e.target]))].filter(x=>x!==id);
  assert(neighbors.length>=2,'gesture must target a connected hub');
  await page.evaluate(()=>{
   const w=window as any;w.__physicsProbe={frames:[],last:0,events:[],running:true};
   const probe=()=>{const p=w.__physicsProbe;if(!p.running)return;const t=performance.now();if(p.last)p.frames.push(t-p.last);p.last=t;requestAnimationFrame(probe);};requestAnimationFrame(probe);
   document.querySelector('#graph')!.addEventListener('pointermove',()=>{const start=performance.now();requestAnimationFrame(()=>w.__physicsProbe.events.push(performance.now()-start));});
  });
  if(mobile)await touch('touchStart',[pos]);else{await page.mouse.move(pos.x,pos.y);await page.mouse.down();}
  const dragStart=Date.now();const samples:any[]=[];
  for(let i=1;i<=24;i++){
   const target={x:pos.x+dx*i/24,y:pos.y+dy*i/24};
   if(mobile)await touch('touchMove',[target]);else await page.mouse.move(target.x,target.y);
   await page.waitForTimeout(35);
   const actual=await center(page,node);if(i>=3)assert(Math.abs(actual.x-target.x)<1&&Math.abs(actual.y-target.y)<1,'pinned node must follow input');
   samples.push({positions:await snapshot(),path:await path.getAttribute('d')});
  }
  await page.waitForTimeout(400);
  const held=await snapshot(),heldTransform=await node.getAttribute('transform');
  const otherMovement=neighbors.map(n=>Math.hypot(held[n].x-allBefore[n].x,held[n].y-allBefore[n].y));
  assert(otherMovement.filter(d=>d>1).length>=2,'at least two neighbors must move while pointer held');
  assert(neighbors.some(n=>Math.hypot(samples[5].positions[n].x-allBefore[n].x,samples[5].positions[n].y-allBefore[n].y)>.5),'neighbors must react early in the gesture, not only on release');
  const distance=(s:any,a:string,b:string)=>Math.hypot(s[a].x-s[b].x,s[a].y-s[b].y);
  const pairChanges=neighbors.slice(1).map(n=>Math.abs(distance(held,neighbors[0],n)-distance(allBefore,neighbors[0],n)));
  assert(Math.max(...pairChanges)>1,'non-dragged neighbors must rearrange relative to each other');
  assert.equal(await page.locator('#graph').getAttribute('viewBox'),view);
  assert.equal(await node.getAttribute('aria-pressed'),'false');
  assert(new Set(samples.map(s=>s.path)).size>20,'incident edges must update throughout the gesture');
  assert.notEqual(heldTransform,before);assert.notEqual(await path.getAttribute('d'),pathBefore);
  const movedHeld=await center(page,node);
  if(mobile)await touch('touchEnd',[]);else await page.mouse.up();
  const releasedAt=Date.now();await page.waitForTimeout(250);const relaxing=await snapshot();
  assert(neighbors.some(n=>Math.hypot(relaxing[n].x-held[n].x,relaxing[n].y-held[n].y)>.1),'release must continue relaxation');
  await expect(page.locator('#graph')).toHaveAttribute('data-physics','idle',{timeout:10000});
  const settled=await snapshot();await page.waitForTimeout(150);assert.deepEqual(await snapshot(),settled,'simulation stops after settling');
  const perf=await page.evaluate(()=>{const p=(window as any).__physicsProbe;p.running=false;const stats=(xs:number[])=>{xs.sort((a,b)=>a-b);return {count:xs.length,median_ms:xs[Math.floor(xs.length*.5)],p95_ms:xs[Math.floor(xs.length*.95)],max_ms:Math.max(...xs)};};return {raf_intervals:stats(p.frames),input_to_next_frame:stats(p.events)};});
  const after=await node.getAttribute('transform'),moved=await center(page,node);
  record(`${mobile?'touch':'mouse'} live coupled hub drag and release`,{before,held:heldTransform,settled:after,screen_delta_while_held:{x:movedHeld.x-pos.x,y:movedHeld.y-pos.y},non_dragged_neighbors:neighbors.length,neighbors_moved_while_held:otherMovement.filter(d=>d>1).length,max_neighbor_pair_distance_change:Math.max(...pairChanges),continuous_edge_samples:new Set(samples.map(s=>s.path)).size,drag_ms:releasedAt-dragStart,release_to_idle_ms:Date.now()-releasedAt,view_unchanged:true,performance:perf});
  await page.screenshot({path:join(out,mobile?'mobile-drag.png':'desktop-drag.png')});
  if(mobile)await page.touchscreen.tap(moved.x,moved.y);else await page.mouse.click(moved.x,moved.y);
  await expect(node).toHaveAttribute('aria-pressed','true');await expect(page.locator('#detail h2')).not.toBeEmpty();assert(await page.locator('#scene .edge.connected').count()>0);
  assert(await page.locator('#scene .node.dimmed').count()>0||await page.locator('#scene .node.connected').count()===await page.locator('#scene .node').count());
  record(`${mobile?'touch':'mouse'} tap selects and highlights actual adjacency`,{connected_edges:await page.locator('#scene .edge.connected').count(),connected_nodes:await page.locator('#scene .node.connected').count()});
  if(mobile){
   await expect(page.locator('#close-detail')).toBeInViewport();assert((await page.locator('#inspector').boundingBox())!.height<=844*.53);await page.locator('#close-detail').tap();await expect(page.locator('#inspector')).toBeHidden();await page.locator('#show-detail').tap();await expect(page.locator('#inspector')).toBeVisible();
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
  const stable=await node.getAttribute('transform');assert.equal(stable,after);record('Fit and zoom controls preserve settled positions');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(mobile){
   const b=(await page.locator('#graph').boundingBox())!;assert(b.width>=380&&b.height>450);record('mobile full-view graph fills available screen; controls reachable; no horizontal overflow',{graph_box:b,actual_phone:false});
  }
  await page.locator('#expand-map').click();
  await readGraph(page,()=>page.locator('#refresh').click());assert.equal(await node.getAttribute('transform'),after);record('Unchanged manual refresh retains settled coordinates');
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
  if(mobile){
   // Real CDP touch cancellation and a second finger joining an active node drag.
   const hub=await nodeForGesture(page);let p=await center(page,hub);
   await touch('touchStart',[p]);await touch('touchMove',[{x:p.x+20,y:p.y-20}]);await touch('touchCancel',[]);
   await expect(hub).toHaveAttribute('aria-pressed','false');
   await expect(page.locator('#graph')).toHaveAttribute('data-physics','idle',{timeout:10000});
   p=await center(page,hub);const v=await page.locator('#graph').getAttribute('viewBox');
   await touch('touchStart',[p]);await touch('touchMove',[{x:p.x+20,y:p.y}]);
   await touch('touchStart',[{x:p.x+20,y:p.y},{x:p.x+70,y:p.y}]);
   await touch('touchMove',[{x:p.x-5,y:p.y},{x:p.x+95,y:p.y}]);await touch('touchEnd',[]);
   assert.notEqual(await page.locator('#graph').getAttribute('viewBox'),v);
   await expect(hub).toHaveAttribute('aria-pressed','false');
   await expect(page.locator('#graph')).toHaveAttribute('data-physics','idle',{timeout:10000});
   record('Touch cancellation and node-drag-to-pinch release physics without selection or stuck pin');
  }
  assert.deepEqual(await page.evaluate(()=>({l:localStorage.length,s:sessionStorage.length,c:document.cookie})),{l:0,s:0,c:''});
  const video=page.video();await context.close();if(video)await video.saveAs(join(out,mobile?'mobile.webm':'desktop.webm'));
 }
 assert.deepEqual(errors,[]);
 const report={result:'pass',run_at:new Date().toISOString(),origin:new URL(url).origin,live_persisted_data:live,synthetic_fixture:!live,actual_phone:false,browser:browser.version(),checks,responseCounts,page_errors:errors,screenshots:['desktop-drag.png','desktop-inspect.png','mobile-drag.png','mobile-inspect.png']};
 await Bun.write(join(out,'interactions.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();if(server)await server.stop(true);if(f)f.store.close();if(dir)rmSync(dir,{recursive:true,force:true});}
