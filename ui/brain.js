/* Read-only graph. Human authentication uses an HttpOnly session. */
(() => {
  const $ = (id) => document.getElementById(id);
  const idleDetail=$("detail").cloneNode(true);
  let token = "", agent = "", data = null, focus = null, selected = null, generation = 0, controller;
  let humanSession = null, logoutPending = false;
  let offset=0, remoteFocus=null, selectedNode=null, fitNext=true, navigationSnapshot=null, lastCriteria="";
  let view = { x: 0, y: 0, w: 1100, h: 700 }, positions = new Map();
  const ns = "http://www.w3.org/2000/svg";
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const svg = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k,v] of Object.entries(attrs)) e.setAttribute(k,v); if (text !== undefined) e.textContent = text; return e; };
  const short = (s, n=28) => s.length > n ? s.slice(0,n-1) + "…" : s;
  const label = (id) => data?.nodes.find(n => n.id === id)?.label || id;
  const meaning = (e) => `${label(e.source)} → ${e.predicate} → ${label(e.target)}`;
  const button = (text, fn, cls) => { const b=el("button",text,cls); b.type="button"; b.onclick=fn; return b; };
  function clear() {
    resetGesture();stopPhysics();data=null; focus=null; selected=null; positions.clear();nodeDraw.clear();edgeDraw.clear();nodeDegree.clear();connectedNodes.clear();connectedEdges.clear(); selectedNode=null; remoteFocus=null; navigationSnapshot=null; offset=0; closeDetail(); $("scene").replaceChildren(); $("relations").replaceChildren(); $("changes").replaceChildren();
    $("detail").replaceChildren(el("h2","No graph loaded")); $("counts").textContent=""; $("processing").textContent="";
  }
  async function load(initial=false) {
    const seq=++generation; controller?.abort(); controller=new AbortController();
    $("error").textContent=""; $("status").textContent="Reading persisted knowledge…";
    const scopes=[...$("scopes").querySelectorAll("input:checked")].map(x=>x.value);
    try {
      if (!initial && !scopes.length) throw Error("Select at least one authorized scope.");
      const body={ agent_id:agent, offset, ...(remoteFocus?{focus:remoteFocus}:{}), query:$("query").value.trim(), limit:Number($("limit").value), include_history:$("history").checked,
        ...(!initial ? {scopes}:{}), ...($("valid").value.trim()?{valid_at:$("valid").value.trim()}:{}), ...($("recorded").value.trim()?{recorded_at:$("recorded").value.trim()}:{}), ...(navigationSnapshot||{}), };
      const r=await fetch("/v1/memory/graph", {method:"POST", credentials:"same-origin", headers:{...(token?{Authorization:`Bearer ${token}`} : {}),"Content-Type":"application/json"},body:JSON.stringify(body),signal:controller.signal});
      const reply=await r.json(); if(seq!==generation)return;
      if(!r.ok) { if(r.status===401 && humanSession) loggedOut(); throw Error(`${reply.error.code}: ${reply.error.message}`); }
      data=reply.data;
      $("previous").disabled=offset===0;
      $("next").disabled=data.page.next_offset===null;
      $("page-label").textContent=`${data.edges.length?offset+1:0}–${offset+data.edges.length} loaded${remoteFocus?` · ${remoteFocus.label} / ${remoteFocus.scope}`:""}`;
      $("clear-focus").disabled=!remoteFocus && !focus;
      $("clear-focus").textContent=remoteFocus?"Back to overview":"All results";
      if(initial){
        $("scopes").replaceChildren(el("legend","Authorized scopes"),...data.available_scopes.map(s=>{const l=el("label",undefined,"check"), i=el("input");i.type="checkbox";i.value=s;i.checked=true;i.onchange=()=>resetLoad();l.append(i,document.createTextNode(s));return l;}));
      }
      $("connect").hidden=true; $("workspace").hidden=false; $("disconnect").hidden=false; $("identity").textContent=humanSession?`${humanSession.account.workspace_name} / ${agent}`:agent;
      const jobs=data.processing.jobs; const pending=jobs.filter(j=>["queued","running","retry"].includes(j.status)).reduce((n,j)=>n+j.count,0), failed=jobs.filter(j=>j.status==="failed").reduce((n,j)=>n+j.count,0);
      $("processing").textContent=`${pending} awaiting / processing · ${failed} failed · ${data.processing.note}`;
      $("counts").textContent=`${data.nodes.length} nodes / ${data.edges.length} relationships`;
      $("status").textContent=`${data.truncated?"Bounded / incomplete results — narrow search or scope. ":""}Snapshot: valid ${data.snapshot.valid_at} · known ${data.snapshot.recorded_at}`;
      if(focus&&!data.nodes.some(n=>n.id===focus))focus=null;
      if(selected&&!data.edges.some(e=>e.id===selected))selected=null;
      if(selectedNode&&!data.nodes.some(n=>n.id===selectedNode))selectedNode=null;
      lastCriteria=criteria();
      render(); if(selected)inspectEdge(data.edges.find(e=>e.id===selected));
      else if(selectedNode)inspectNode(data.nodes.find(n=>n.id===selectedNode));
      else { $("detail").replaceChildren(...Array.from(idleDetail.childNodes,n=>n.cloneNode(true))); closeDetail(); }
    } catch(e){ if(seq!==generation||e.name==="AbortError")return; clear(); $("status").textContent="Graph not loaded. No stale knowledge is displayed."; $("error").textContent=e.message; $("live").checked=false; }
  }
  function layout(nodes, edges) {
    const p=nodes.map((n,i)=>positions.get(n.id)||({id:n.id,x:550+310*Math.cos(i*2.39996)*Math.sqrt((i+1)/nodes.length),y:350+240*Math.sin(i*2.39996)*Math.sqrt((i+1)/nodes.length)}));
    if(nodes.every(n=>positions.has(n.id))){positions=new Map(p.map(n=>[n.id,n]));return;}
    const by=new Map(p.map(n=>[n.id,n]));
    // Finite deterministic spring layout. Coordinates arrange persisted edges;
    // they do not encode inferred strength, causality or entity similarity.
    for(let t=0;t<180;t++){
      const f=p.map(()=>({x:0,y:0}));
      for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){
        const dx=p[i].x-p[j].x,dy=p[i].y-p[j].y,d=Math.max(10,Math.hypot(dx,dy)),force=Math.min(15,15000/(d*d));
        f[i].x+=dx/d*force;f[i].y+=dy/d*force;f[j].x-=dx/d*force;f[j].y-=dy/d*force;
      }
      for(const e of edges){const a=by.get(e.source),b=by.get(e.target);if(a===b)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),force=(d-190)*.025;const i=p.indexOf(a),j=p.indexOf(b);f[i].x+=dx/d*force;f[i].y+=dy/d*force;f[j].x-=dx/d*force;f[j].y-=dy/d*force;}
      p.forEach((n,i)=>{if(positions.has(n.id))return;n.x+=Math.max(-10,Math.min(10,f[i].x+(550-n.x)*.008));n.y+=Math.max(-10,Math.min(10,f[i].y+(350-n.y)*.008));});
    }
    // Pack disconnected components separately so an unrelated scope cannot
    // visually sit on another relationship. This adds no edges or semantics.
    const neighbours=new Map(nodes.map(n=>[n.id,new Set()]));
    for(const e of edges){neighbours.get(e.source).add(e.target);neighbours.get(e.target).add(e.source);}
    const seen=new Set(),components=[];
    for(const n of nodes){if(seen.has(n.id))continue;const todo=[n.id],part=[];while(todo.length){const id=todo.pop();if(seen.has(id))continue;seen.add(id);part.push(by.get(id));for(const next of neighbours.get(id))todo.push(next);}components.push(part);}
    components.sort((a,b)=>b.length-a.length);
    if(components.length>1 && !nodes.some(n=>positions.has(n.id))){
      // Pack component boxes in two dimensions. A long strip makes global Fit
      // technically complete but unusably tiny, especially on a phone.
      const boxes=components.map(part=>{
        const x=Math.min(...part.map(n=>n.x)),y=Math.min(...part.map(n=>n.y));
        return {part,x,y,w:Math.max(...part.map(n=>n.x))-x+160,h:Math.max(...part.map(n=>n.y))-y+160};
      });
      const rect=$("graph").getBoundingClientRect(),ratio=rect.width/Math.max(1,rect.height);
      const width=Math.max(...boxes.map(b=>b.w),Math.sqrt(boxes.reduce((a,b)=>a+b.w*b.h,0)*ratio));
      let x=0,y=0,rowHeight=0;
      for(const b of boxes){
        if(x && x+b.w>width){x=0;y+=rowHeight;rowHeight=0;}
        for(const n of b.part){n.x+=x+80-b.x;n.y+=y+80-b.y;}
        x+=b.w;rowHeight=Math.max(rowHeight,b.h);
      }
    }
    positions=new Map(p.map(n=>[n.id,n]));
  }
  // Live spring/charge physics over the loaded graph (at most 200 endpoints).
  // SVG retains accessible nodes and precise hit targets; only geometry changes
  // per frame. Forces never change stored knowledge or the camera transform.
  let physicsFrame=0, physicsAlpha=0, physicsTime=0, physicsAccumulator=0, physicsSpeed=0, pinned=null;
  let springs=[], particles=[];
  function stopPhysics(){
    cancelAnimationFrame(physicsFrame);physicsFrame=0;physicsAlpha=0;pinned=null;
    $("graph").dataset.physics="idle";
  }
  function preparePhysics(edges){
    stopPhysics();particles=[...positions.values()];
    const degree=new Map();
    for(const e of edges)for(const id of [e.source,e.target])degree.set(id,(degree.get(id)||0)+1);
    for(const n of particles){n.vx=0;n.vy=0;n.homeX=n.x;n.homeY=n.y;}
    springs=edges.filter(e=>e.source!==e.target).map(e=>{
      const a=positions.get(e.source),b=positions.get(e.target),da=degree.get(a.id),db=degree.get(b.id);
      return {a,b,bias:da/(da+db),strength:.09/Math.sqrt(Math.min(da,db))};
    });
  }
  function physicsStep(){
    const target=pinned ? .42 : 0;
    physicsAlpha+=(target-physicsAlpha)*(pinned ? .1 : .025);
    const alpha=physicsAlpha;
    // Equal/opposite repulsion and collision keep nearby nodes responsive too.
    for(let i=0;i<particles.length;i++)for(let j=i+1;j<particles.length;j++){
      const a=particles[i],b=particles[j];let dx=b.x-a.x,dy=b.y-a.y;
      if(!dx&&!dy){dx=.01*(i+1);dy=.01;}
      const d=Math.max(1,Math.hypot(dx,dy));
      const force=(Math.min(6,2200/(d*d))+Math.max(0,52-d)*.12)*alpha;
      const fx=dx/d*force,fy=dy/d*force;a.vx-=fx;a.vy-=fy;b.vx+=fx;b.vy+=fy;
    }
    for(const {a,b,bias,strength} of springs){
      const dx=b.x+b.vx-a.x-a.vx,dy=b.y+b.vy-a.y-a.vy,d=Math.max(1,Math.hypot(dx,dy));
      const force=(d-190)*strength*alpha,fx=dx/d*force,fy=dy/d*force;
      a.vx+=fx*(1-bias);a.vy+=fy*(1-bias);b.vx-=fx*bias;b.vy-=fy*bias;
    }
    let speed=0;
    for(const n of particles){
      if(n.id===pinned){n.vx=0;n.vy=0;continue;}
      // Very weak home force preserves disconnected component packing without
      // freezing neighbors. Damping dissipates energy after pointer release.
      n.vx=(n.vx+(n.homeX-n.x)*.0008*alpha)*.78;
      n.vy=(n.vy+(n.homeY-n.y)*.0008*alpha)*.78;
      n.x+=n.vx;n.y+=n.vy;speed=Math.max(speed,Math.hypot(n.vx,n.vy));
    }
    return speed;
  }
  function animatePhysics(time){
    physicsAccumulator+=Math.min(50,time-physicsTime);physicsTime=time;
    while(physicsAccumulator>=1000/60){physicsSpeed=physicsStep();physicsAccumulator-=1000/60;}
    geometry();
    if(!pinned&&physicsAlpha<.012&&physicsSpeed<.035){
      for(const n of particles){n.vx=0;n.vy=0;}
      physicsFrame=0;$("graph").dataset.physics="idle";return;
    }
    physicsFrame=requestAnimationFrame(animatePhysics);
  }
  function reheat(){
    physicsAlpha=Math.max(physicsAlpha,.65);
    if(!physicsFrame){physicsTime=performance.now();physicsAccumulator=0;$("graph").dataset.physics="active";physicsFrame=requestAnimationFrame(animatePhysics);}
  }
  function releaseNode(){
    if(!pinned)return;
    const n=positions.get(pinned);if(n){n.homeX=n.x;n.homeY=n.y;}
    pinned=null;if(physicsFrame)reheat();
  }
  function fit(){
    const p=[...positions.values()],rect=$("graph").getBoundingClientRect(),width=Math.max(1,rect.width),height=Math.max(1,rect.height);
    if(!p.length)view={x:0,y:0,w:1100,h:1100*height/width};
    else {
      // Reserve CSS-pixel space for the floating tools and lower affordances.
      // A fixed world-space margin disappears when a dense graph is fitted.
      const minX=Math.min(...p.map(p=>p.x)),maxX=Math.max(...p.map(p=>p.x)),minY=Math.min(...p.map(p=>p.y)),maxY=Math.max(...p.map(p=>p.y));
      const top=82,bottom=56,side=width<600?32:54,availableH=Math.max(80,height-top-bottom);
      const unit=Math.max(300/width,(maxX-minX)/Math.max(80,width-side*2),(maxY-minY)/availableH);
      const w=unit*width,h=unit*height;
      view={x:(minX+maxX-w)/2,y:minY-top*unit-(availableH*unit-(maxY-minY))/2,w,h};
    }
    applyView();
  }
  function applyView(){
    $("graph").setAttribute("viewBox",`${view.x} ${view.y} ${view.w} ${view.h}`);
    const unit=view.w/Math.max(1,$("graph").getBoundingClientRect().width);
    $("zoom-level").textContent=`${Math.round(100/unit)}%`;
    for(const [id,g] of nodeDraw){
      const r=nodeRadius(id);g.querySelector(".node-core").setAttribute("r",r*unit);
      g.querySelector(".node-hit").setAttribute("r",Math.max(17,r+6)*unit);
    }
    placeLabels();
  }
  // Transform through the SVG CTM, not its bounding box: letterboxing matters.
  function world(x,y){return new DOMPoint(x,y).matrixTransform($("graph").getScreenCTM().inverse());}
  function zoom(factor,client){
    const a=client?world(client.x,client.y):{x:view.x+view.w/2,y:view.y+view.h/2};
    const f=Math.max(120,Math.min(12000,view.w*factor))/view.w;
    view={x:a.x+(view.x-a.x)*f,y:a.y+(view.y-a.y)*f,w:view.w*f,h:view.h*f};applyView();
  }
  const edgeDraw=new Map(),nodeDraw=new Map(),nodeDegree=new Map();
  let hoverNode=null,hoverEdge=null,connectedNodes=new Set(),connectedEdges=new Set();
  const labelMeasure=document.createElement("canvas").getContext("2d"),labelWidths=new Map();
  function nodeRadius(id){return Math.min(10,4.5+Math.log2((nodeDegree.get(id)||0)+1)*1.2);}
  function textWidth(text,edge=false){
    const key=`${edge}:${text}`;
    if(!labelWidths.has(key)){
      labelMeasure.font=edge?'10px "IBM Plex Mono",monospace':'500 11.5px "Space Grotesk",Arial,sans-serif';
      labelWidths.set(key,labelMeasure.measureText(text).width+8);
    }
    return labelWidths.get(key);
  }
  // Labels are laid out in CSS pixels, independent of world zoom. The bounded
  // greedy pass reserves every visible node, then labels by interaction/degree.
  // A label never earns visibility just because it exists in the loaded page.
  function placeLabels(){
    const rect=$("graph").getBoundingClientRect();if(!rect.width||!rect.height)return;
    const unit=view.w/rect.width,width=rect.width,height=rect.height;
    const screen=p=>({x:(p.x-view.x)/unit,y:(p.y-view.y)/unit});
    const occupied=[];
    const overlaps=b=>occupied.some(a=>b.x<a.x+a.w&&b.x+b.w>a.x&&b.y<a.y+a.h&&b.y+b.h>a.y);
    const within=b=>b.x>=10&&b.x+b.w<=width-10&&b.y>=64&&b.y+b.h<=height-38;
    const active=!!(selectedNode||selected||hoverNode||hoverEdge);
    for(const [id,g] of nodeDraw){
      const t=g.querySelector("text");t.classList.remove("label-visible");g.querySelector(".label-leader").classList.remove("label-visible");
      t.setAttribute("font-size",11.5*unit);t.setAttribute("stroke-width",4*unit);
      const p=screen(positions.get(id)),r=nodeRadius(id)+3;
      if(p.x+r>0&&p.x-r<width&&p.y+r>0&&p.y-r<height)occupied.push({x:p.x-r,y:p.y-r,w:r*2,h:r*2});
    }
    const rank=id=>id===selectedNode?10000:id===hoverNode?9000:connectedNodes.has(id)?5000+(nodeDegree.get(id)||0):nodeDegree.get(id)||0;
    const ordered=[...nodeDraw].sort((a,b)=>rank(b[0])-rank(a[0])||a[0].localeCompare(b[0]));
    const budget=Math.max(8,Math.floor(width*height/12500));let shown=0;
    for(const [id,g] of ordered){
      const degree=nodeDegree.get(id)||0,local=connectedNodes.has(id),primary=id===selectedNode||id===hoverNode;
      if(active&&!local)continue;
      if(!local&&!(unit<.8||(degree>=2&&unit<1.45)||(degree>=3&&unit<2.8)||(degree>=6&&unit<14)))continue;
      if(!primary&&shown>=budget)continue;
      const t=g.querySelector("text"),p=screen(positions.get(id)),w=textWidth(t.firstChild.textContent),h=17,r=nodeRadius(id)+8;
      // Nearby slots first. Important hubs/focus may use a short neutral leader
      // rather than silently losing their name inside a crowded neighborhood.
      const options=[];
      for(const gap of primary||degree>=6?[r,r+18,r+36,r+60]:[r])options.push(
        {x:p.x+gap,y:p.y-h/2,a:"start",tx:gap,ty:4,gap},
        {x:p.x-gap-w,y:p.y-h/2,a:"end",tx:-gap,ty:4,gap},
        {x:p.x-w/2,y:p.y+gap,a:"middle",tx:0,ty:gap+12,gap},
        {x:p.x-w/2,y:p.y-gap-h,a:"middle",tx:0,ty:-gap-4,gap},
        {x:p.x+gap,y:p.y-gap-h,a:"start",tx:gap,ty:-gap-4,gap},
        {x:p.x-gap-w,y:p.y-gap-h,a:"end",tx:-gap,ty:-gap-4,gap});
      const b=options.find(b=>within({...b,w,h})&&!overlaps({...b,w,h}));
      if(!b)continue;
      occupied.push({...b,w,h});shown++;
      t.setAttribute("text-anchor",b.a);t.setAttribute("x",b.tx*unit);t.setAttribute("y",b.ty*unit);t.classList.add("label-visible");
      if(b.gap>r){
        const leader=g.querySelector(".label-leader"),x=Math.max(b.x,Math.min(p.x,b.x+w))-p.x,y=Math.max(b.y,Math.min(p.y,b.y+h))-p.y;
        leader.setAttribute("d",`M0 0 L${x*unit} ${y*unit}`);leader.classList.add("label-visible");
      }
    }
    let edgeShown=0;
    const edges=[...edgeDraw].sort((a,b)=>Number(b[0]===selected||b[0]===hoverEdge)-Number(a[0]===selected||a[0]===hoverEdge));
    for(const [id,d] of edges){
      const t=d.txt;t.classList.remove("label-visible");t.setAttribute("font-size",10*unit);t.setAttribute("stroke-width",5*unit);
      const primary=id===selected||id===hoverEdge;
      if(!d.labelPoint||(!primary&&!(connectedEdges.has(id)||(!active&&unit<.6))))continue;
      if(!primary&&edgeShown>=(active?10:14))continue;
      const p=screen(d.labelPoint),w=textWidth(t.firstChild.textContent,true),h=15;
      const options=[-11,9,-27].map(dy=>({x:p.x-w/2,y:p.y+dy-h/2,w,h,dy}));
      const b=options.find(b=>within(b)&&!overlaps(b));if(!b)continue;
      occupied.push(b);edgeShown++;
      t.setAttribute("x",d.labelPoint.x);t.setAttribute("y",d.labelPoint.y+(b.dy+3)*unit);t.classList.add("label-visible");
    }
  }
  function geometry(){
    const parallel=new Map();
    for(const e of data?.edges||[]){
      const draw=edgeDraw.get(e.id);if(!draw)continue;
      const a=positions.get(e.source),b=positions.get(e.target),dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy));
      const key=[e.source,e.target].sort().join("|"),idx=parallel.get(key)||0;parallel.set(key,idx+1);
      const bend=idx*30,mx=(a.x+b.x)/2-dy/d*bend,my=(a.y+b.y)/2+dx/d*bend;
      const path=a===b?`M${a.x} ${a.y} C${a.x-90} ${a.y-110},${a.x+90} ${a.y-110},${a.x} ${a.y}`:`M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`;
      draw.line.setAttribute("d",path);draw.hit.setAttribute("d",path);
      draw.labelPoint=a===b?{x:a.x,y:a.y-82.5}:{x:(a.x+b.x)/4+mx/2,y:(a.y+b.y)/4+my/2};
    }
    for(const [id,g] of nodeDraw){const p=positions.get(id);g.setAttribute("transform",`translate(${p.x},${p.y})`);}
    placeLabels();
  }
  function highlight(){
    connectedNodes=new Set();connectedEdges=new Set();
    for(const id of [selectedNode,hoverNode])if(id){
      connectedNodes.add(id);
      for(const e of data?.edges||[])if(e.source===id||e.target===id){connectedNodes.add(e.source);connectedNodes.add(e.target);connectedEdges.add(e.id);}
    }
    for(const id of [selected,hoverEdge])if(id){const e=data?.edges.find(e=>e.id===id);if(e){connectedNodes.add(e.source);connectedNodes.add(e.target);connectedEdges.add(e.id);}}
    const active=!!(selected||selectedNode||hoverNode||hoverEdge);
    for(const [id,g] of nodeDraw){g.classList.toggle("selected",id===selectedNode);g.classList.toggle("hovered",id===hoverNode);g.classList.toggle("connected",active&&connectedNodes.has(id));g.classList.toggle("dimmed",active&&!connectedNodes.has(id));g.setAttribute("aria-pressed",String(id===selectedNode));}
    for(const [id,d] of edgeDraw)for(const part of [d.line,d.txt]){part.classList.toggle("selected",id===selected);part.classList.toggle("hovered",id===hoverEdge);part.classList.toggle("connected",connectedEdges.has(id));part.classList.toggle("dimmed",active&&!connectedEdges.has(id));}
    placeLabels();
  }
  function render(){
    if(!data)return;
    const edges=focus?data.edges.filter(e=>e.source===focus||e.target===focus):data.edges;
    const ids=new Set(edges.flatMap(e=>[e.source,e.target]));const nodes=data.nodes.filter(n=>ids.has(n.id));layout(nodes,edges);
    preparePhysics(edges);
    const scene=$("scene");scene.replaceChildren();edgeDraw.clear();nodeDraw.clear();
    for(const e of edges){
      const line=svg("path",{class:`edge ${!["active","conflict"].includes(e.status)?"history":""}`});
      const hit=svg("path",{class:"edge-hit","data-edge":e.id});
      const txt=svg("text",{class:"edge-label","data-edge":e.id},short(e.predicate.replaceAll("_"," "),23));txt.append(svg("title",{},meaning(e)));
      scene.append(line,hit,txt);edgeDraw.set(e.id,{line,hit,txt});
    }
    hoverNode=null;hoverEdge=null;nodeDegree.clear();labelWidths.clear();
    for(const e of edges)for(const id of [e.source,e.target])nodeDegree.set(id,(nodeDegree.get(id)||0)+1);
    for(const n of nodes){
      const g=svg("g",{class:`node ${n.kind} ${(nodeDegree.get(n.id)||0)>2?"hub":""}`,tabindex:"0",role:"button","aria-label":`${n.label}, ${n.kind}, ${n.scope}`,"data-node":n.id});
      g.append(svg("path",{class:"label-leader","aria-hidden":"true"}),svg("circle",{class:"node-core",r:nodeRadius(n.id),"data-radius":nodeRadius(n.id)}),svg("circle",{class:"node-hit",r:17,"aria-hidden":"true"}),svg("text",{},short(n.label,36)),svg("title",{},`${n.label} · ${n.kind} · ${n.scope}`));
      // Space belongs exclusively to camera panning; Enter is the node action.
      g.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();inspectNode(n);}};scene.append(g);nodeDraw.set(n.id,g);
    }
    geometry();highlight();applyView();
    $("empty").hidden=edges.length>0;
    $("relations").replaceChildren(...edges.map(e=>{const b=button(meaning(e),()=>inspectEdge(e),"relation");b.dataset.edge=e.id;b.append(el("small",`${e.scope} · ${e.kind} · ${e.status}`));return b;}));
    const evolution=data.changes.map(c=>el("div",`${c.type}${c.invalidated_at?` — INVALIDATED PROCESSING DECISION (${c.invalidation_reason}, known ${c.invalidated_at}); not a domain state change`:''} · ${c.recorded_at}\nEffective ${c.effective_at} · ${data.edges.find(e=>e.id===c.target_id)?meaning(data.edges.find(e=>e.id===c.target_id)):c.target_id} · event ${c.client_id}:${c.event_id}@${c.revision} · ${c.role}/${c.author_id}`,"change"));
    for(const e of data.edges)for(const v of e.versions)evolution.push(el("div",`v${v.version} ${v.reason} · ${v.recorded_at} · ${meaning(e)}`,"change"));
    $("changes").replaceChildren(...(evolution.length?evolution:[el("p","No recorded changes or versions in these results.","muted")]));if(fitNext){fit();fitNext=false;}
  }
  function openDetail(){ $("inspector").classList.add("open");$("show-detail").hidden=false; }
  function closeDetail(){ $("inspector").classList.remove("open"); }
  function criteria(){return JSON.stringify([$("query").value.trim(),$("limit").value,$("history").checked,$("valid").value,$("recorded").value,[...$("scopes").querySelectorAll("input:checked")].map(i=>i.value)]);}
  function resetLoad(){const changed=criteria()!==lastCriteria||remoteFocus||offset;offset=0;focus=null;selected=null;selectedNode=null;remoteFocus=null;navigationSnapshot=null;if(changed){fitNext=true;positions.clear();}return load();}
  function inspectNode(n){
    selected=null;selectedNode=n.id;highlight();openDetail();const detail=$("detail");detail.replaceChildren(el("p",n.scope,"eyebrow"),el("h2",n.label),el("p",n.kind==="entity"?"Persisted entity identity in this scope.":"Literal text endpoint. No entity identity or hidden relationship is assumed."));
    detail.append(button("Focus this neighborhood",()=>{focus=n.id;fitNext=true;render();$("clear-focus").disabled=false;inspectNode(n);}));
    detail.append(button("Explore all matching connections",()=>{remoteFocus={scope:n.scope,label:n.label};navigationSnapshot=null;offset=0;focus=null;selected=null;selectedNode=null;$("query").value="";fitNext=true;closeDetail();load();}));
    detail.append(el("p","Explore queries stored endpoints with this exact label in this scope, beyond the loaded page. It does not merge aliases or people across scopes.","muted"));
    for(const e of data.edges.filter(e=>e.source===n.id||e.target===n.id))detail.append(button(meaning(e),()=>inspectEdge(e),"relation"));
  }
  function inspectEdge(e){
    selected=e.id;selectedNode=null;highlight();openDetail();const d=$("detail");d.replaceChildren(el("p",`${e.scope} / ${e.kind}`,"eyebrow"),el("h2",e.predicate.replaceAll("_"," ")),el("p",meaning(e)));
    const dl=el("dl");for(const [k,v] of Object.entries({Status:e.status,"Valid from":e.historical_start_unknown?`Unknown start (initial observation ${e.valid_from})`:e.valid_from,"Valid until":e.valid_to||"Open interval","Recorded from":e.recorded_from,"Memory ID":e.id,Confidence:e.confidence,Importance:e.importance})){dl.append(el("dt",k),el("dd",String(v)));}d.append(dl,el("h3","Attributed sources"));
    for(const s of e.sources){const block=el("div",undefined,"source");block.append(el("strong",`${s.role} / ${s.author_id}`),el("p",`${s.client_id}:${s.event_id}@${s.revision} · agent ${s.agent_id}`),el("p",`Occurred ${s.occurred_at} · accepted ${s.accepted_at}`));block.append(s.excerpt?el("blockquote",s.excerpt):el("p","No safe supported excerpt retained. Attribution remains available."));block.append(el("p",`Evidence roots: ${s.evidence_root_ids.join(", ")}`));d.append(block);}
    if(e.sources_truncated)d.append(el("p","Source list bounded to 20 entries."));
    d.append(el("h3","Persisted versions"));for(const v of e.versions)d.append(el("p",`v${v.version} · ${v.reason} · ${v.recorded_at}`));
    if(e.versions_truncated)d.append(el("p","Version list bounded to 20 entries."));
    d.append(el("h3","Changes to this claim"));for(const c of data.changes.filter(c=>c.target_id===e.id))d.append(el("p",`${c.type}${c.invalidated_at?` — INVALIDATED PROCESSING DECISION (${c.invalidation_reason}, known ${c.invalidated_at}); not a domain state change`:''} · effective ${c.effective_at} · known ${c.recorded_at}${c.replacement_id?" · replacement "+c.replacement_id:""}`));
  }
  function resetAgent() {
    ++generation;controller?.abort();clear();$("live").checked=false;$("scopes").replaceChildren();
    for(const key of ["query","valid","recorded"])$(key).value="";
    $("history").checked=false;fitNext=true;lastCriteria="";
  }
  function loggedOut() {
    token="";agent="";humanSession=null;clear();$("live").checked=false;
    $("workspace").hidden=true;$("account-panel").hidden=true;$("connect").hidden=false;$("disconnect").hidden=true;
    $("account-name").textContent="";$("agents").replaceChildren();$("identity").textContent="";
  }
  async function restore() {
    const seq=generation;
    try {
      const r=await fetch("/auth/session",{credentials:"same-origin",cache:"no-store"});const s=await r.json();
      if(seq!==generation)return;
      if(!r.ok)throw Error(s.error?.message||"Sign-in could not be restored. Try again.");
      if(!s.authenticated)return;
      humanSession=s;logoutPending=false;token="";$("connect").hidden=true;$("disconnect").hidden=false;$("disconnect").textContent="Sign out";$("account-panel").hidden=false;
      $("account-name").textContent=`${s.account.workspace_name} / ${s.account.user_id}`;
      $("agents").replaceChildren(...s.agents.map(a=>{const o=el("option",`${a.name} / ${a.agent_id}`);o.value=a.agent_id;return o;}));
      $("agent-picker").hidden=!s.agents.length;$("onboarding").hidden=!!s.agents.length;
      if(s.agents.length){agent=s.agents[0].agent_id;resetAgent();await load(true);}
    } catch(e) { if(seq===generation)$("error").textContent=e.message; }
  }
  $("agents").onchange=async()=>{agent=$("agents").value;resetAgent();await load(true);};
  $("login").onsubmit=async e=>{e.preventDefault();++generation;humanSession=null;token=$("token").value;$("token").value="";agent=$("agent").value.trim();$("disconnect").textContent="Disconnect machine";resetAgent();await load(true);if(!data)token="";};
  $("disconnect").onclick=async()=>{
    const human=!!humanSession||logoutPending;++generation;controller?.abort();loggedOut();
    if(human)try{logoutPending=true;const r=await fetch("/auth/logout",{method:"POST",credentials:"same-origin"});const b=await r.json();if(!r.ok)throw Error(b.error?.message||"Sign out failed; try again.");logoutPending=false;if(b.creator_revocation==="unconfirmed")$("error").textContent="Signed out of Atlas. Creator grant revocation could not be confirmed.";}
    catch(e){$("error").textContent="Sign out could not be confirmed. "+e.message;$("disconnect").hidden=false;$("disconnect").textContent="Retry sign out";}
  };
  $("controls").onsubmit=e=>{e.preventDefault();$("filters").open=false;resetLoad();};
  $("history").onchange=()=>resetLoad();$("limit").onchange=()=>resetLoad();
  $("fit").onclick=fit;$("zoom-in").onclick=()=>zoom(.8);$("zoom-out").onclick=()=>zoom(1.25);
  $("clear-focus").onclick=()=>{if(remoteFocus){resetLoad();return;}focus=null;fitNext=true;render();};
  $("previous").onclick=()=>{navigationSnapshot=data.snapshot;offset=Math.max(0,offset-Number($("limit").value));focus=null;fitNext=true;load();};
  $("next").onclick=()=>{if(data?.page.next_offset!=null){navigationSnapshot=data.snapshot;offset=data.page.next_offset;focus=null;fitNext=true;load();}};
  $("close-detail").onclick=()=>{closeDetail();$("show-detail").focus();};
  $("show-detail").onclick=openDetail;
  $("expand-map").onclick=()=>{const expanded=$("explorer").classList.toggle("expanded");$("expand-map").textContent=expanded?"Exit full view":"Full view";requestAnimationFrame(fit);};
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){$("filters").open=false;$("graph-help").open=false;closeDetail();if($("explorer").classList.contains("expanded"))$("expand-map").click();}});
  document.addEventListener("pointerdown",e=>{for(const id of ["filters","graph-help"]){const panel=$(id);if(panel.open&&!panel.contains(e.target))panel.open=false;}});
  setInterval(()=>{if((token||humanSession)&&agent&&$("live").checked&&!document.hidden&&!pointers.size)load();},15000);
  const graph=$("graph"),pointers=new Map();let gesture=null,suppressClick=false,spaceDown=false;
  function gestureCursor(){
    graph.classList.toggle("space-pan",spaceDown);
    graph.classList.toggle("is-panning",!!gesture&&(gesture.type==="pan"||gesture.type==="pinch"));
    graph.classList.toggle("is-dragging",!!gesture&&gesture.type==="node"&&gesture.moved);
  }
  function pointerNode(x,y){
    const p=world(x,y),unit=view.w/Math.max(1,graph.getBoundingClientRect().width);let nearest=null,distance=17*unit;
    // Expanded hit circles can overlap at overview zoom. Resolve by distance,
    // not SVG paint order, so a neighbor's invisible target cannot steal a node.
    for(const [id,g] of nodeDraw){const n=positions.get(id),d=Math.hypot(n.x-p.x,n.y-p.y);if(d<distance){distance=d;nearest=g;}}
    return nearest;
  }
  function setHover(target,x,y){
    const node=(x===undefined?target?.closest?.(".node"):pointerNode(x,y))?.dataset.node||null,edge=node?null:target?.closest?.("[data-edge]")?.dataset.edge||null;
    if(node===hoverNode&&edge===hoverEdge)return;hoverNode=node;hoverEdge=edge;highlight();
  }
  function resetGesture(){
    spaceDown=false;releaseNode();gesture=null;suppressClick=true;
    const ids=[...pointers.keys()];pointers.clear();
    for(const id of ids)if(graph.hasPointerCapture(id))graph.releasePointerCapture(id);
    setHover(null);gestureCursor();
  }
  function typingTarget(target){return target instanceof Element&&!!target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox'],.cm-editor,.monaco-editor");}
  // Capture Space before SVG node handlers. Typing controls retain native Space.
  document.addEventListener("keydown",e=>{
    if((e.code!=="Space"&&e.key!==" ")||typingTarget(e.target)||e.altKey||e.metaKey||e.ctrlKey)return;
    if($("workspace").hidden)return;
    spaceDown=true;
    // Native toolbar actions still activate with Space when no graph drag
    // follows. Pointerdown moves focus to the graph before Space is released.
    if(!e.target.closest?.("button,summary,a"))e.preventDefault();
    if(gesture&&gesture.type==="node"){
      releaseNode();suppressClick=true;const p=[...pointers.values()][0];
      gesture={type:"pan",x:p.x,y:p.y,anchor:world(p.x,p.y),v:{...view},moved:false,spacePan:true};
    }
    gestureCursor();
  },true);
  document.addEventListener("keyup",e=>{if(e.code==="Space"||e.key===" "){spaceDown=false;gestureCursor();}},true);
  window.addEventListener("blur",resetGesture);
  document.addEventListener("visibilitychange",()=>{if(document.hidden)resetGesture();});
  graph.addEventListener("focusin",e=>setHover(e.target));
  graph.addEventListener("focusout",e=>{if(!graph.contains(e.relatedTarget))setHover(null);});
  graph.addEventListener("pointerleave",()=>{if(!pointers.size)setHover(null);});
  function startGesture(){
    const points=[...pointers.values()];
    if(points.length>=2){
      releaseNode();suppressClick=true;const [a,b]=points;
      gesture={type:"pinch",moved:true,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),v:{...view},anchor:world((a.x+b.x)/2,(a.y+b.y)/2)};
      gestureCursor();
    }
  }
  // A non-passive handler also owns Ctrl+wheel: never browser/page zoom here.
  graph.addEventListener("wheel",e=>{e.preventDefault();zoom(Math.exp(Math.max(-.25,Math.min(.25,e.deltaY*(e.deltaMode===1?.035:.002)))),{x:e.clientX,y:e.clientY});},{passive:false});
  graph.addEventListener("pointerdown",e=>{
    if(e.button!==0)return;
    e.preventDefault();graph.focus({preventScroll:true});graph.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    setHover(null);
    if(pointers.size>=2){startGesture();return;}
    suppressClick=spaceDown;
    const node=spaceDown?null:pointerNode(e.clientX,e.clientY),edge=spaceDown?null:e.target.closest("[data-edge]");
    if(node)$("scene").append(node);
    const p=world(e.clientX,e.clientY),id=node?.dataset.node;
    if(id)pinned=id;
    gesture={type:id?"node":"pan",id,edge:edge?.dataset.edge,x:e.clientX,y:e.clientY,anchor:p,v:{...view},origin:id?{...positions.get(id)}:null,moved:false,spacePan:spaceDown};
    gestureCursor();
  });
  graph.addEventListener("pointermove",e=>{
    if(!pointers.has(e.pointerId)||!gesture){if(e.pointerType!=="touch"&&!spaceDown)setHover(e.target,e.clientX,e.clientY);return;}
    e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(gesture.type==="pinch"){
      const [a,b]=[...pointers.values()];if(!b)return;
      const f=Math.max(120,Math.min(12000,gesture.v.w*gesture.distance/Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))))/gesture.v.w;
      view={...gesture.v};applyView();const mid=world((a.x+b.x)/2,(a.y+b.y)/2);
      view={x:gesture.anchor.x+(gesture.v.x-mid.x)*f,y:gesture.anchor.y+(gesture.v.y-mid.y)*f,w:gesture.v.w*f,h:gesture.v.h*f};applyView();suppressClick=true;return;
    }
    if(Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>6)gesture.moved=true;
    if(!gesture.moved)return;
    suppressClick=true;gestureCursor();
    if(gesture.type==="node"){
      const p=world(e.clientX,e.clientY),n=positions.get(gesture.id);n.x=gesture.origin.x+p.x-gesture.anchor.x;n.y=gesture.origin.y+p.y-gesture.anchor.y;n.vx=0;n.vy=0;pinned=n.id;reheat();geometry();
    }else{
      view={...gesture.v};applyView();const p=world(e.clientX,e.clientY);view.x=gesture.v.x+gesture.anchor.x-p.x;view.y=gesture.v.y+gesture.anchor.y-p.y;applyView();
    }
  });
  function endPointer(e){
    if(!pointers.has(e.pointerId))return;
    const g=gesture;releaseNode();pointers.delete(e.pointerId);
    if(e.type==="pointerup"&&g&&!g.moved&&!suppressClick&&!g.spacePan&&g.type!=="pinch"){
      if(g.id)inspectNode(data.nodes.find(n=>n.id===g.id));else if(g.edge)inspectEdge(data.edges.find(edge=>edge.id===g.edge));
      else {selected=null;selectedNode=null;highlight();closeDetail();}
    }
    gesture=null;
    if(pointers.size){
      suppressClick=true;
      if(pointers.size>=2)startGesture();
      else {const p=[...pointers.values()][0];gesture={type:"pan",x:p.x,y:p.y,anchor:world(p.x,p.y),v:{...view},moved:true};}
    }
    gestureCursor();
  }
  graph.addEventListener("pointerup",endPointer);graph.addEventListener("pointercancel",endPointer);
  graph.addEventListener("lostpointercapture",e=>{if(pointers.has(e.pointerId))endPointer(e);});
  new ResizeObserver(()=>{const r=graph.getBoundingClientRect();if(!r.width||!r.height)return;const h=view.w*r.height/r.width;view.y+=(view.h-h)/2;view.h=h;applyView();}).observe(graph);
  document.fonts?.ready.then(()=>{labelWidths.clear();placeLabels();});
  restore();
})();
