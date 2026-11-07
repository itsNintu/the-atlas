"""Read-only production reconciliation; private SQLite backup, never production writes."""
import datetime,hashlib,json,pathlib,sqlite3
root=pathlib.Path('/home/alex/work/projects/the-atlas')
out=root/'evidence/original-truth-repair';out.mkdir(exist_ok=True)
private=root/'.private/original-truth-repair';private.mkdir(mode=0o700,exist_ok=True)
receipt=json.loads(pathlib.Path('/mnt/d/Work/Operations/hermes/atlas-native/activation/phase-repair/OUTCOME-RECEIPT.json').read_text())
originals=receipt['final_job_custody']['jobs'][:4]
s=sqlite3.connect('file:/home/alex/.local/share/the-atlas/atlas.sqlite?mode=ro',uri=True);s.row_factory=sqlite3.Row;s.execute('PRAGMA query_only=ON')
copy=private/'current.sqlite';assert not copy.exists()
d=sqlite3.connect(copy);s.backup(d);d.close();s.close();copy.chmod(0o600)
c=sqlite3.connect('file:'+str(copy)+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
rows=[]
for r in originals:
 e=dict(c.execute('SELECT * FROM memory_events WHERE id=?',(r['event']['id'],)).fetchone())
 jobs=[dict(x) for x in c.execute('SELECT id,event_pk,status,attempts,max_attempts,error_code,created_at,completed_at FROM memory_jobs WHERE event_pk=?',(e['id'],))]
 rows.append({'index':r['index'],'event_id':e['event_id'],'event_pk':e['id'],'job_id':e['job_id'],'original_fields_equal':all(e[k]==r['event'][k] for k in ['id','revision','content','roots_json','body_hash','role','author_id','occurred_at','accepted_at','credential_id','principal_id']),'jobs':jobs})
ids=['memory_36a62b9d-b757-48ed-8f92-7a65303eabbd','memory_a826fdb2-4310-40e3-8b39-387d212bbc63','memory_94163b5d-e2de-4cfe-950c-e2d56fac632b','memory_2d4241ab-1aea-41d4-a69e-e8e28bbd87d8']
state={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'read_only_production':True,'private_snapshot_sha256':hashlib.sha256(copy.read_bytes()).hexdigest(),'originals':rows,'targets':[{'memory':dict(c.execute('SELECT id,subject,predicate,object,valid_from,valid_to FROM memories WHERE id=?',(i,)).fetchone()),'changes':[dict(x) for x in c.execute('SELECT * FROM memory_changes WHERE target_id=?',(i,))]} for i in ids]}
(out/'READONLY-CURRENT.json').write_text(json.dumps(state,indent=2));print(json.dumps(state,indent=2));c.close()
