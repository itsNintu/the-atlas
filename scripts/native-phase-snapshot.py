"""Read-only original job reconciliation and private isolated SQLite copy. No production writes."""
import datetime, hashlib, json, pathlib, sqlite3, sys
root=pathlib.Path('/home/alex/work/projects/the-atlas')
out=root/'evidence/native-phase-repair'; out.mkdir(exist_ok=True)
private=root/'.private/native-phase-repair'; private.mkdir(mode=0o700,exist_ok=True)
receipts=pathlib.Path('/mnt/d/Work/Operations/hermes/atlas-native/activation/reconciliation')
repairs=[json.loads(p.read_text()) for p in sorted(receipts.glob('repair-*.json'))]
final=json.loads((receipts/'final.json').read_text())

custody=pathlib.Path('/home/alex/.local/share/the-atlas/backups/t_b3950651/atlas.sqlite')
assert hashlib.sha256(custody.read_bytes()).hexdigest()=='5adb6b50257db8d993e163c31f77bc39d75ef4c898b9492401ac28cd55ec3356'
s=sqlite3.connect('file:/home/alex/.local/share/the-atlas/atlas.sqlite?mode=ro',uri=True);s.row_factory=sqlite3.Row
s.execute('PRAGMA query_only=ON')
if '--current-only' in sys.argv:
 c=s;c.execute('BEGIN')
else:
 copy=private/'native.sqlite'
 if copy.exists(): copy=private/('native-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.sqlite')
 d=sqlite3.connect(copy);s.backup(d);d.close();copy.chmod(0o600)
 c=sqlite3.connect('file:'+str(copy)+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
rows=[]
for r in repairs:
 event=dict(c.execute('SELECT * FROM memory_events WHERE id=?',(r['original_event']['id'],)).fetchone())
 job=dict(c.execute('SELECT id,event_pk,status,attempts,max_attempts,error_code,created_at,completed_at FROM memory_jobs WHERE id=?',(r['response']['data']['job_id'],)).fetchone())
 fields=['id','workspace_id','client_id','event_id','revision','operation','agent_id','thread_id','role','author_id','occurred_at','observed_at','accepted_at','content','metadata_json','causal_json','roots_json','body_hash','principal_id','credential_id']
 rows.append({'index':r['index'],'event_id':event['event_id'],'job':job,'source_fields_equal':{k:event[k]==r['original_event'][k] for k in fields},'current_job_id':event['job_id'],'reconciliation_count':c.execute('SELECT count(*) FROM memory_reconciliations WHERE job_id=?',(job['id'],)).fetchone()[0]})
ids=['memory_36a62b9d-b757-48ed-8f92-7a65303eabbd','memory_a826fdb2-4310-40e3-8b39-387d212bbc63']
state={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'production_access':'sqlite mode=ro + query_only; private backup copy only','custody_sha256':hashlib.sha256(custody.read_bytes()).hexdigest(),'originals':rows,'known_stale_changes':{id:[dict(x) for x in c.execute('SELECT type,effective_at,replacement_id FROM memory_changes WHERE target_id=?',(id,))] for id in ids}}
(out/('READONLY-LATEST.json' if '--current-only' in sys.argv else 'READONLY-CURRENT.json')).write_text(json.dumps(state,indent=2))
print(json.dumps(state,indent=2));s.close();c.close()
