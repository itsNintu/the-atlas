/* Read-only graph. Credential lives only in this closure, never browser storage. */
(() => {
  const $ = (id) => document.getElementById(id);
  let token = "", agent = "", data = null, focus = null, selected = null, generation = 0, controller;
  let view = { x: 0, y: 0, w: 1100, h: 700 }, positions = new Map();
  const ns = "http://www.w3.org/2000/svg";
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const svg = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k,v] of Object.entries(attrs)) e.setAttribute(k,v); if (text !== undefined) e.textContent = text; return e; };
  const short = (s, n=28) => s.length > n ? s.slice(0,n-1) + "…" : s;
  const label = (id) => data?.nodes.find(n => n.id === id)?.label || id;
  const meaning = (e) => `${label(e.source)} → ${e.predicate} → ${label(e.target)}`;
  const button = (text, fn, cls) => { const b=el("button",text,cls); b.type="button"; b.onclick=fn; return b; };
  function clear() {
    data=null; focus=null; selected=null; positions.clear(); $("scene").replaceChildren(); $("relations").replaceChildren(); $("changes").replaceChildren();
    $("detail").replaceChildren(el("h2","No graph loaded")); $("counts").textContent=""; $("processing").textContent="";
  }
  async function load(initial=false) {
    const seq=++generation; controller?.abort(); controller=new AbortController();
    $("error").textContent=""; $("status").textContent="Reading persisted knowledge…";
    const scopes=[...$("scopes").querySelectorAll("input:checked")].map(x=>x.value);
    try {
      if (!initial && !scopes.length) throw Error("Select at least one authorized scope.");
      const body={ agent_id:agent, query:$("query").value.trim(), limit:Number($("limit").value), include_history:$("history").checked,
        ...(!initial ? {scopes}:{}), ...($("valid").value.trim()?{valid_at:$("valid").value.trim()}:{}), ...($("recorded").value.trim()?{recorded_at:$("recorded").value.trim()}:{}), };
      const r=await fetch("/v1/memory/graph", {method:"POST", headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body),signal:controller.signal});
      const reply=await r.json(); if(seq!==generation)return;
      if(!r.ok) throw Error(`${reply.error.code}: ${reply.error.message}`);
      data=reply.data;
      if(initial){
        $("scopes").replaceChildren(el("legend","Authorized scopes"),...data.available_scopes.map(s=>{const l=el("label",undefined,"check"), i=el("input");i.type="checkbox";i.value=s;i.checked=true;i.onchange=()=>load();l.append(i,document.createTextNode(s));return l;}));
      }
      $("connect").hidden=true; $("workspace").hidden=false; $("disconnect").hidden=false; $("identity").textContent=agent;
      const jobs=data.processing.jobs; const pending=jobs.filter(j=>["queued","running","retry"].includes(j.status)).reduce((n,j)=>n+j.count,0), failed=jobs.filter(j=>j.status==="failed").reduce((n,j)=>n+j.count,0);
      $("processing").textContent=`${pending} awaiting / processing · ${failed} failed · ${data.processing.note}`;
      $("counts").textContent=`${data.nodes.length} nodes / ${data.edges.length} relationships`;
      $("status").textContent=`${data.truncated?"Bounded / incomplete results — narrow search or scope. ":""}Snapshot: valid ${data.snapshot.valid_at} · known ${data.snapshot.recorded_at}`;
      if(focus&&!data.nodes.some(n=>n.id===focus))focus=null;
      if(selected&&!data.edges.some(e=>e.id===selected))selected=null;
      render(); if(selected)inspectEdge(data.edges.find(e=>e.id===selected));
    } catch(e){ if(seq!==generation||e.name==="AbortError")return; clear(); $("status").textContent="Graph not loaded. No stale knowledge is displayed."; $("error").textContent=e.message; $("live").checked=false; }
  }
  function layout(nodes, edges) {
    const p=nodes.map((n,i)=>({id:n.id,x:550+310*Math.cos(i*2.39996)*Math.sqrt((i+1)/nodes.length),y:350+240*Math.sin(i*2.39996)*Math.sqrt((i+1)/nodes.length)}));
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
      p.forEach((n,i)=>{n.x+=Math.max(-10,Math.min(10,f[i].x+(550-n.x)*.008));n.y+=Math.max(-10,Math.min(10,f[i].y+(350-n.y)*.008));});
    }
    // Pack disconnected components separately so an unrelated scope cannot
    // visually sit on another relationship. This adds no edges or semantics.
    const neighbours=new Map(nodes.map(n=>[n.id,new Set()]));
    for(const e of edges){neighbours.get(e.source).add(e.target);neighbours.get(e.target).add(e.source);}
    const seen=new Set(),components=[];
    for(const n of nodes){if(seen.has(n.id))continue;const todo=[n.id],part=[];while(todo.length){const id=todo.pop();if(seen.has(id))continue;seen.add(id);part.push(by.get(id));for(const next of neighbours.get(id))todo.push(next);}components.push(part);}
    components.sort((a,b)=>b.length-a.length);
    if(components.length>1){
      const largest=components[0];const width=Math.max(600,Math.max(...largest.map(n=>n.x))-Math.min(...largest.map(n=>n.x))+240);
      components.forEach((part,i)=>{const cx=(Math.min(...part.map(n=>n.x))+Math.max(...part.map(n=>n.x)))/2,cy=(Math.min(...part.map(n=>n.y))+Math.max(...part.map(n=>n.y)))/2;
        const destX=i===0?width/2:width+220+Math.floor((i-1)/2)*450,destY=i===0?350:170+((i-1)%2)*360;
        for(const n of part){n.x+=destX-cx;n.y+=destY-cy;}
      });
    }
    positions=new Map(p.map(n=>[n.id,n]));
  }
  function fit(){
    const p=[...positions.values()];if(!p.length)view={x:0,y:0,w:1100,h:700};else{const minX=Math.min(...p.map(p=>p.x))-135,maxX=Math.max(...p.map(p=>p.x))+135,minY=Math.min(...p.map(p=>p.y))-80,maxY=Math.max(...p.map(p=>p.y))+80;view={x:minX,y:minY,w:Math.max(450,maxX-minX),h:Math.max(300,maxY-minY)};}
    applyView();
  }
  function applyView(){$("graph").setAttribute("viewBox",`${view.x} ${view.y} ${view.w} ${view.h}`);}
  function zoom(factor){const w=Math.max(150,Math.min(6000,view.w*factor)),h=view.h*w/view.w;view={x:view.x+(view.w-w)/2,y:view.y+(view.h-h)/2,w,h};applyView();}
  function render(){
    if(!data)return;
    const edges=focus?data.edges.filter(e=>e.source===focus||e.target===focus):data.edges;
    const ids=new Set(edges.flatMap(e=>[e.source,e.target]));const nodes=data.nodes.filter(n=>ids.has(n.id));layout(nodes,edges);
    const scene=$("scene");scene.replaceChildren();
    const parallel=new Map();
    for(const e of edges){
      const a=positions.get(e.source),b=positions.get(e.target),dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy));
      const key=[e.source,e.target].sort().join("|");const idx=parallel.get(key)||0;parallel.set(key,idx+1);
      const bend=idx*35;const mx=(a.x+b.x)/2-dy/d*bend,my=(a.y+b.y)/2+dx/d*bend;
      const path=a===b?`M${a.x-15} ${a.y-12} C${a.x-90} ${a.y-110},${a.x+90} ${a.y-110},${a.x+15} ${a.y-12}`:`M${a.x+dx/d*19} ${a.y+dy/d*19} Q${mx} ${my} ${b.x-dx/d*23} ${b.y-dy/d*23}`;
      const line=svg("path",{d:path,class:`edge ${e.status!=="active"&&e.status!=="conflict"?"history":""} ${selected===e.id?"selected":""}`});
      const hit=svg("path",{d:path,class:"edge-hit","data-edge":e.id});hit.onclick=()=>inspectEdge(e);
      const txt=svg("text",{x:mx,y:a===b?a.y-75:my-8,class:"edge-label"},short(e.predicate.replaceAll("_"," "),23));txt.onclick=()=>inspectEdge(e);txt.append(svg("title",{},meaning(e)));scene.append(line,hit,txt);
    }
    for(const n of nodes){const p=positions.get(n.id),g=svg("g",{transform:`translate(${p.x},${p.y})`,class:`node ${n.kind} ${focus===n.id?"selected":""}`,tabindex:"0",role:"button","aria-label":`${n.label}, ${n.kind}, ${n.scope}`,"data-node":n.id});g.append(svg("circle",{r:n.kind==="entity"?18:12}),svg("text",{y:39},short(n.label)),svg("title",{},`${n.label} · ${n.kind} · ${n.scope}`));g.onclick=()=>inspectNode(n);g.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();inspectNode(n);}};scene.append(g);}
    $("empty").hidden=edges.length>0;
    $("relations").replaceChildren(...edges.map(e=>{const b=button(meaning(e),()=>inspectEdge(e),"relation");b.dataset.edge=e.id;b.append(el("small",`${e.scope} · ${e.kind} · ${e.status}`));return b;}));
    const evolution=data.changes.map(c=>el("div",`${c.type} · ${c.recorded_at}\nEffective ${c.effective_at} · ${data.edges.find(e=>e.id===c.target_id)?meaning(data.edges.find(e=>e.id===c.target_id)):c.target_id} · event ${c.client_id}:${c.event_id}@${c.revision} · ${c.role}/${c.author_id}`,"change"));
    for(const e of data.edges)for(const v of e.versions)evolution.push(el("div",`v${v.version} ${v.reason} · ${v.recorded_at} · ${meaning(e)}`,"change"));
    $("changes").replaceChildren(...(evolution.length?evolution:[el("p","No recorded changes or versions in these results.","muted")]));fit();
  }
  function inspectNode(n){
    selected=null;const detail=$("detail");detail.replaceChildren(el("p",n.scope,"eyebrow"),el("h2",n.label),el("p",n.kind==="entity"?"Persisted entity identity in this scope.":"Literal text endpoint. No entity identity or hidden relationship is assumed."));
    detail.append(button("Focus this neighborhood",()=>{focus=n.id;render();inspectNode(n);}));
    for(const e of data.edges.filter(e=>e.source===n.id||e.target===n.id))detail.append(button(meaning(e),()=>inspectEdge(e),"relation"));
  }
  function inspectEdge(e){
    selected=e.id;const d=$("detail");d.replaceChildren(el("p",`${e.scope} / ${e.kind}`,"eyebrow"),el("h2",e.predicate.replaceAll("_"," ")),el("p",meaning(e)));
    const dl=el("dl");for(const [k,v] of Object.entries({Status:e.status,"Valid from":e.historical_start_unknown?`Unknown start (initial observation ${e.valid_from})`:e.valid_from,"Valid until":e.valid_to||"Open interval","Recorded from":e.recorded_from,"Memory ID":e.id,Confidence:e.confidence,Importance:e.importance})){dl.append(el("dt",k),el("dd",String(v)));}d.append(dl,el("h3","Attributed sources"));
    for(const s of e.sources){const block=el("div",undefined,"source");block.append(el("strong",`${s.role} / ${s.author_id}`),el("p",`${s.client_id}:${s.event_id}@${s.revision} · agent ${s.agent_id}`),el("p",`Occurred ${s.occurred_at} · accepted ${s.accepted_at}`));block.append(s.excerpt?el("blockquote",s.excerpt):el("p","No safe supported excerpt retained. Attribution remains available."));block.append(el("p",`Evidence roots: ${s.evidence_root_ids.join(", ")}`));d.append(block);}
    if(e.sources_truncated)d.append(el("p","Source list bounded to 20 entries."));
    d.append(el("h3","Persisted versions"));for(const v of e.versions)d.append(el("p",`v${v.version} · ${v.reason} · ${v.recorded_at}`));
    if(e.versions_truncated)d.append(el("p","Version list bounded to 20 entries."));
    d.append(el("h3","Changes to this claim"));for(const c of data.changes.filter(c=>c.target_id===e.id))d.append(el("p",`${c.type} · effective ${c.effective_at} · known ${c.recorded_at}${c.replacement_id?" · replacement "+c.replacement_id:""}`));
  }
  $("login").onsubmit=async e=>{e.preventDefault();token=$("token").value;$("token").value="";agent=$("agent").value.trim();await load(true);if(!data)token="";};
  $("disconnect").onclick=()=>{token="";++generation;controller?.abort();clear();location.reload();};
  $("controls").onsubmit=e=>{e.preventDefault();focus=null;load();};
  $("history").onchange=()=>load();$("limit").onchange=()=>load();
  $("fit").onclick=fit;$("zoom-in").onclick=()=>zoom(.8);$("zoom-out").onclick=()=>zoom(1.25);$("clear-focus").onclick=()=>{focus=null;render();};
  setInterval(()=>{if(token&&$("live").checked&&!document.hidden)load();},15000);
  let drag=null;
  $("graph").addEventListener("wheel",e=>{e.preventDefault();zoom(e.deltaY>0?1.12:.89);},{passive:false});
  $("graph").addEventListener("pointerdown",e=>{if(e.target.closest(".node,.edge-hit,.edge-label"))return;drag={x:e.clientX,y:e.clientY,v:{...view}};$("graph").setPointerCapture(e.pointerId);});
  $("graph").addEventListener("pointermove",e=>{if(!drag)return;const rect=$("graph").getBoundingClientRect();view={...drag.v,x:drag.v.x-(e.clientX-drag.x)*drag.v.w/rect.width,y:drag.v.y-(e.clientY-drag.y)*drag.v.h/rect.height};applyView();});
  $("graph").addEventListener("pointerup",()=>drag=null);$("graph").addEventListener("pointercancel",()=>drag=null);
})();
