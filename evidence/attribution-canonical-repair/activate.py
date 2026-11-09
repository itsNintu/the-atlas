"""Targeted t_aa47fb9a activation. No secret output; one affected-job retry at most."""
import hashlib, json, os, shutil, sqlite3, subprocess, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path('/home/alex/work/projects/the-atlas')
OUT=ROOT/'evidence/attribution-canonical-repair'
DATA=Path('/home/alex/.local/share/the-atlas')
DB=DATA/'atlas.sqlite'
UNIT='the-atlas.service'
URL='http://127.0.0.1:8787'
COMMIT='6191527ca8e39f32bbcf75bd444731a45950ba98'
JOB='mjob_811b3150-0eca-4f0b-912c-0c4e00b91232'
EVENT='native:default:48ec91b40bde4396970d03a36a260f72:part:0'
CREDENTIAL=Path('/mnt/c/Users/alexb/AppData/Local/hermes/atlas/credential.json')
ADAPTER=Path('/mnt/d/Work/Operations/hermes/atlas-native/atlas_client.py')
TOKEN=json.loads(CREDENTIAL.read_text())['token']
OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}))
PROGRESS=OUT/'activation-progress.json'

def utc(): return datetime.now(timezone.utc).isoformat()
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def cmd(*args): return subprocess.check_output(args,text=True).strip()
def save_progress(value): PROGRESS.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
def state():
 keys=['MainPID','ActiveState','SubState','NRestarts','ExecMainStartTimestamp']
 return dict(x.split('=',1) for x in cmd('systemctl','--user','show',UNIT,*['-p'+k for k in keys]).splitlines())
def post(path,body,key=None,timeout=30):
 headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'}
 if key: headers['Idempotency-Key']=key
 request=urllib.request.Request(URL+path,data=json.dumps(body).encode(),headers=headers,method='POST')
 started=time.perf_counter()
 with OPENER.open(request,timeout=timeout) as response: payload=json.load(response)
 return payload['data'],round((time.perf_counter()-started)*1000,3)
def health():
 with OPENER.open(URL+'/healthz',timeout=5) as response: return response.status
def start_healthy(old_pid=None):
 subprocess.check_call(['systemctl','--user','start',UNIT])
 deadline=time.time()+90
 while time.time()<deadline:
  try:
   if health()==200 and state()['MainPID'] not in ('0',old_pid): return state()
  except Exception: pass
  time.sleep(1)
 raise RuntimeError('service did not become healthy')
def ro():
 c=sqlite3.connect(f'file:{DB}?mode=ro',uri=True); c.row_factory=sqlite3.Row; return c
def counts():
 c=ro()
 value={'jobs':dict(c.execute('SELECT status,COUNT(*) FROM memory_jobs WHERE reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1) GROUP BY status')),
  'holds':[dict(r) for r in c.execute('SELECT provider,reason,upstream_status,upstream_category,hold_until FROM memory_provider_holds ORDER BY provider')],
  'events':c.execute('SELECT COUNT(*) FROM memory_events').fetchone()[0],
  'quick_check':c.execute('PRAGMA quick_check').fetchone()[0]}
 c.close(); return value
def job():
 c=ro(); row=c.execute('SELECT id,status,attempts,max_attempts,error_code,completed_at FROM memory_jobs WHERE id=?',(JOB,)).fetchone(); c.close(); return dict(row)
def compact_recall(name,query):
 body={'agent_id':'default','thread_id':'t_aa47fb9a-activated-check','query':query,'recent_context':[],'token_budget':1200}
 data,elapsed=post('/v1/recall',body)
 return {'name':name,'query':query,'http_ms':elapsed,'tokens_used':data.get('tokens_used'),'service_ms':data.get('retrieval',{}).get('service_ms'),'embedding_ms':data.get('retrieval',{}).get('embedding_ms'),'semantic_status':data.get('retrieval',{}).get('semantic_status'),'memories':[{'id':m['id'],'scope':m['scope'],'subject':m['subject'],'predicate':m['predicate'],'object':m['object'],'historical':m.get('historical',False)} for m in data.get('memories') or []]}
def recalls():
 return [compact_recall('work','What are my current work trial, interview, remote and onsite arrangements with Paradev and Retell?'),
  compact_recall('blog_exclusion','What blog functionality did I exclude from platform features?'),
  compact_recall('dog_name',"What is Alex's dog's name?")]
def graph(query):
 data,elapsed=post('/v1/memory/graph',{'agent_id':'default','query':query,'include_history':False,'limit':100})
 return {'http_ms':elapsed,'nodes':[{'id':n['id'],'label':n['label'],'kind':n['kind'],'types':n.get('types') or []} for n in data['nodes']],
  'edges':[{'id':e['id'],'predicate':e['predicate'],'object':e.get('object'),'status':e['status'],'source':e['source'],'target':e['target'],'sources':len(e.get('sources') or [])} for e in data['edges']], 'truncated':data['truncated']}
def affected():
 c=ro(); rows=[dict(r) for r in c.execute('''SELECT m.id,m.scope,m.kind,m.subject,m.predicate,m.object,m.valid_from,m.valid_to,m.recorded_from,
  (SELECT canonical FROM memory_entities WHERE id=(SELECT entity_id FROM memory_entity_targets WHERE memory_id=m.id)) AS object_entity
  FROM memory_supports s JOIN memory_events e ON e.id=s.event_pk JOIN memories m ON m.id=s.memory_id WHERE e.event_id=? ORDER BY m.id''',(EVENT,))]
 old=['memory_6a2370ed-7b78-4592-95d8-7c3560017e25','memory_cc3f1afb-d6f3-4ea7-ae18-5734d9d5b8da','memory_e0ffec92-44bb-4152-9cbb-830b9d1efadb','memory_5142ea16-6549-4f80-a28f-01c9292e8c71']
 repairs=[dict(r) for r in c.execute('''SELECT c.target_id AS old_memory_id,o.subject AS old_subject,c.type,c.replacement_id,n.subject AS new_subject,n.predicate,n.object
  FROM memory_changes c JOIN memories o ON o.id=c.target_id LEFT JOIN memories n ON n.id=c.replacement_id WHERE c.target_id IN (?,?,?,?) ORDER BY c.target_id,c.recorded_at''',old)]
 source=[dict(r) for r in c.execute('SELECT event_id,job_id,status,revision FROM memory_events WHERE event_id=?',(EVENT,))]
 c.close(); return {'source_event':source,'event_memories':rows,'four_owner_repairs':repairs}

assert cmd('git','-C',str(ROOT),'rev-parse','HEAD')==COMMIT
assert cmd('git','-C',str(ROOT),'diff','--name-only','--','src','tests')==''
progress=json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {}
before_service=state(); assert before_service['ActiveState']=='active'
protected={'service.env':sha(DATA/'service.env'),'adapter':sha(ADAPTER),'unit':sha(Path.home()/'.config/systemd/user/the-atlas.service')}
if 'before' not in progress:
 progress['before']={'at':utc(),'commit':COMMIT,'service':before_service,'counts':counts(),'job':job(),'recalls':recalls()}
 save_progress(progress)
before=progress['before']; assert before['job']['status'] in ('failed','retry') or progress.get('retry_receipt')
backup=Path(progress.get('backup') or DATA/'backups'/f't_aa47fb9a-{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")}')
if 'repair' not in progress:
 subprocess.check_call(['systemctl','--user','stop',UNIT])
 deadline=time.time()+240
 while time.time()<deadline and state()['ActiveState']!='inactive': time.sleep(1)
 assert state()['ActiveState']=='inactive'
 if not backup.exists(): backup.mkdir(parents=True,exist_ok=False)
 for src in [Path(str(DB)+s) for s in ('','-wal','-shm')]+[DATA/'service.env',Path.home()/'.config/systemd/user/the-atlas.service',ADAPTER]:
  if src.exists(): shutil.copy2(src,backup/src.name)
 progress['backup']=str(backup); progress['stopped']=state(); save_progress(progress)
 try:
  preview=subprocess.run(['bun','src/cli.ts','repair-canonical-graph','--db',str(DB),'--preview'],cwd=ROOT,text=True,capture_output=True,check=True)
  (OUT/'live-preview.json').write_text(preview.stdout)
  proof=json.loads(preview.stdout)['proof_sha256']
  applied=subprocess.run(['bun','src/cli.ts','repair-canonical-graph','--db',str(DB),'--expected-proof',proof],cwd=ROOT,text=True,capture_output=True,check=True)
  (OUT/'live-repair.json').write_text(applied.stdout)
  progress['repair']=json.loads(applied.stdout); save_progress(progress)
 finally:
  progress['after_start']=start_healthy(before_service['MainPID']); save_progress(progress)
else:
 assert state()['ActiveState']=='active'
 backup=Path(progress['backup'])

if 'retry_receipt' not in progress:
 progress['retry_attempted_at']=utc(); save_progress(progress)
 receipt,elapsed=post(f'/v1/memory/jobs/{JOB}/retry',{'agent_id':'default'},key='t_aa47fb9a-affected-job-retry')
 progress['retry_receipt']={**receipt,'http_ms':elapsed}; save_progress(progress)

deadline=time.time()+600
while time.time()<deadline:
 current=job()
 if current['status']=='succeeded': break
 if current['status']=='failed': raise RuntimeError(f"affected job failed: {current}")
 time.sleep(2)
else: raise RuntimeError(f"affected job did not settle: {job()}")
after={'at':utc(),'service':state(),'counts':counts(),'job':job(),'recalls':recalls(),
 'graphs':{name:graph(name) for name in ('Alex','Paradev','Retell','Ghosty','Nona','Lia')},'affected':affected()}
progress['after']=after; progress['protected_sha256']=protected; save_progress(progress)
assert after['job']['status']=='succeeded'
assert after['job']['attempts']==1, after['job']
assert len(after['affected']['source_event'])==1 and after['affected']['source_event'][0]['job_id']==JOB
assert after['counts']['holds']==before['counts']['holds']
assert after['counts']['quick_check']=='ok'
assert protected=={'service.env':sha(DATA/'service.env'),'adapter':sha(ADAPTER),'unit':sha(Path.home()/'.config/systemd/user/the-atlas.service')}
receipt={'commit':COMMIT,'backup':str(backup),'before':before,'repair':progress['repair'],'followup_repair':progress.get('followup_repair'),'blog_repair':progress.get('blog_repair'),'status_repair':progress.get('status_repair'),'retry':progress['retry_receipt'],'after':after,'protected_sha256':protected,'raw_history_preserved':True}
(OUT/'activation.json').write_text(json.dumps(receipt,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'commit':COMMIT,'backup':str(backup),'repair':{'before':progress['repair']['before'],'after':progress['repair']['after'],'operations':len(progress['repair']['operations'])},'job':after['job'],'event_memories':after['affected']['event_memories'],'recalls':after['recalls'],'service':after['service'],'holds_unchanged':True,'adapter_unchanged':True},indent=2,ensure_ascii=False))
