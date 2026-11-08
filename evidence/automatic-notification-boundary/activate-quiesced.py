"""Stopped-custody, worker-disabled activation for t_cb043bca. No provider probes."""
import datetime, hashlib, json, os, shutil, sqlite3, stat, subprocess, time, urllib.request
from pathlib import Path

ROOT = Path('/home/alex/work/projects/the-atlas')
OUT = ROOT / 'evidence/automatic-notification-boundary'
DATA = Path('/home/alex/.local/share/the-atlas')
DB = DATA / 'atlas.sqlite'
UNIT = 'the-atlas.service'
COMMIT = '0d20bbd8eabf4b90f7050764af7483efa2fcd0c1'
TREE = '4baebfc13d142fd535c7701520d0ea8902f33d5b'
RECEIPT = OUT / 'activation.json'
BASELINE = OUT / 'baseline.json'
RELEVANT = ['memory_0911c79b-da38-443c-a0b0-8c34e1ba751d', 'memory_213a6666-082d-4815-b1ca-a829407058a1']
REPORTED = ['memory_78c9e372-417b-405b-943e-35b9dc9497da', 'memory_3577584f-90ea-4a8d-a315-e3eb52cfd62d',
            'memory_0395458a-c8f0-4809-b1a0-5c56cb5c4f43', 'memory_3af8444d-f11f-4da3-bd8d-674f604ae5b6',
            'memory_23f92c66-8cf4-404d-a1cc-06f8c0445e6e']
QUERY = ('There is nothing useful for the brain in events, tasks or tool calls. This is communication only. '
         'Exclude automatic status notifications from Atlas durable communication memory; preserve genuine Alex '
         'and agent-to-agent discussion. What is the current relevant communication requirement for task t_cb043bca?')
os.chdir(ROOT)
assert not RECEIPT.exists() and not BASELINE.exists(), 'Reconcile existing activation; do not replay lifecycle'

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def cmd(*args): return subprocess.check_output(args, text=True).strip()
def state():
    keys = ['MainPID','InvocationID','ActiveState','SubState','ExecMainStartTimestamp','ExecMainStatus','Result','NRestarts']
    return dict(x.split('=',1) for x in cmd('systemctl','--user','show',UNIT,*['-p'+k for k in keys]).splitlines())
def digest_rows(rows):
    return hashlib.sha256('\n'.join(sorted(json.dumps(x,default=str,ensure_ascii=True,separators=(',',':')) for x in rows)).encode()).hexdigest()
def digest_where(c, table, column, values):
    if not values: return digest_rows([])
    quoted = table.replace('"','""')
    marks = ','.join('?' for _ in values)
    return digest_rows(c.execute(f'SELECT * FROM "{quoted}" WHERE {column} IN ({marks})',values).fetchall())
def api(path, body, credential, key=None):
    headers = {'Authorization':'Bearer '+credential['token'],'Content-Type':'application/json'}
    if key: headers['Idempotency-Key'] = key
    request = urllib.request.Request('http://127.0.0.1:8787'+path,data=json.dumps(body).encode(),headers=headers,method='POST')
    with opener.open(request,timeout=30) as response: return json.load(response)['data']
def recall(credential, key):
    result = api('/v1/recall', {'agent_id':'default','thread_id':'t_cb043bca-notification-verification','query':QUERY,
        'recent_context':[],'token_budget':500}, credential, key)
    return {'recall_id':result['recall_id'],'memory_ids':[m['id'] for m in result['memories']],
        'tokens_used':result['tokens_used'],'token_budget':result['token_budget'],'pending_included':result['freshness']['pending_included'],
        'pending_events_count':len(result['pending_events']),'semantic_status':result['retrieval']['semantic_status'],
        'service_ms':result['retrieval']['service_ms'],'context_sha256':hashlib.sha256(result['context'].encode()).hexdigest(),
        'query_sha256':hashlib.sha256(QUERY.encode()).hexdigest()}

assert cmd('git','rev-parse','HEAD') == COMMIT
assert cmd('git','rev-parse',COMMIT+'^{tree}') == TREE
assert cmd('git','merge-base','--is-ancestor','222e831ff61205e60666bb57506bac0026b9aa9a',COMMIT) == ''
assert not cmd('git','diff','--name-only','--','src','ui')
audit = json.loads((OUT/'audit-pre-activation.json').read_text())
candidates = audit['candidates']
assert audit['candidate_count'] == len(candidates) == 26 and all(x['reviewable'] for x in candidates)
assert all(x['source'] for x in candidates)
ids = [x['memory_id'] for x in candidates]
event_ids = [x['source']['event_pk'] for x in candidates]
job_ids = [x['source']['job_id'] for x in candidates]
assert all(item['reviewable'] for item in audit['reported'])
assert set(x['memory_id'] for x in audit['reported']) == set(REPORTED)
admin = json.loads((DATA/'admin.credentials.json').read_text())
default = json.loads(Path('/mnt/c/Users/alexb/AppData/Local/hermes/atlas/credential.json').read_text())
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
protected = [DATA/'service.env', DATA/'admin.credentials.json', Path.home()/'.config/systemd/user/the-atlas.service',
             Path('/mnt/d/Work/Operations/hermes/atlas-native/atlas_client.py')]
for profile in ['default','builder','reaver','overwatch','wordsmith','orchestrator']:
    home = Path('/mnt/c/Users/alexb/AppData/Local/hermes') if profile == 'default' else Path('/mnt/c/Users/alexb/AppData/Local/hermes/profiles')/profile
    protected.extend([home/'config.yaml',home/'atlas/config.json',home/'atlas/credential.json'])
before = state()
assert before['ActiveState'] == 'active' and before['MainPID'] != '0'
r = {'task':'t_cb043bca','phase':'preflight','at':utc(),'source_commit':COMMIT,'source_tree':TREE,
     'receipt_base':'222e831ff61205e60666bb57506bac0026b9aa9a','candidate_count':len(candidates),
     'candidate_ids':ids,'reported_ids':REPORTED,'before':before,'service_stops':0,'service_starts':0,
     'provider_probe_requests':0,'job_retries':0,'source_or_action_replays':0}
r['serving_sha256'] = {str(p.relative_to(ROOT)):sha(p) for folder in ['src','ui'] for p in (ROOT/folder).rglob('*') if p.is_file()}
r['protected_before'] = {str(p):sha(p) for p in protected}
r['service_env_original_sha256'] = sha(DATA/'service.env')
RECEIPT.write_text(json.dumps(r,indent=2)+'\n')
subprocess.run(['systemctl','--user','kill','--kill-whom=main','--signal=SIGTERM',UNIT],check=True)
drain = time.monotonic()
while state()['MainPID'] == before['MainPID'] and time.monotonic()-drain < 180: time.sleep(1)
r['main_only_drain_seconds'] = round(time.monotonic()-drain,3)
subprocess.run(['systemctl','--user','stop',UNIT],check=True)
r['service_stops'] = 1
r['stopped'] = state()
assert r['stopped']['MainPID'] == '0' and r['stopped']['ExecMainStatus'] == '0'
private = DATA/'backups/t_cb043bca_automatic_notification_activation'
private.mkdir(mode=0o700,exist_ok=False); private.chmod(0o700)
with sqlite3.connect(DB) as c:
    assert c.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    r['target_before'] = {
        'events':digest_where(c,'memory_events','id',event_ids),'jobs':digest_where(c,'memory_jobs','id',job_ids),
        'memories':digest_where(c,'memories','id',ids),'supports':digest_where(c,'memory_supports','memory_id',ids),
        'versions':digest_where(c,'memory_versions','memory_id',ids),
        'provider_holds':digest_rows(c.execute('SELECT * FROM memory_provider_holds').fetchall()),
        'terminal_native_quota':digest_rows(c.execute("SELECT * FROM memory_jobs WHERE status='failed' AND error_code='native_quota'").fetchall()),
        'event_admissions':digest_rows(c.execute('SELECT * FROM memory_event_admissions').fetchall()),
        'jev_routes':digest_rows(c.execute('SELECT * FROM memory_jev_routes').fetchall()),
        'reconciliations':digest_rows(c.execute('SELECT * FROM memory_reconciliations').fetchall()),
    }
    r['subjects'] = {x['memory_id']:c.execute('SELECT subject FROM memories WHERE id=?',(x['memory_id'],)).fetchone()[0] for x in candidates}
    assert all(len(x) <= 300 for x in r['subjects'].values())
    r['table_counts'] = {table:c.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] for table in
        ['memory_events','memory_jobs','memories','memory_supports','memory_versions','memory_event_admissions','memory_jev_routes','memory_reconciliations']}
    with sqlite3.connect(private/'atlas.sqlite') as backup: c.backup(backup)
for path in [DATA/'service.env',DATA/'admin.credentials.json']: shutil.copy2(path,private/path.name)
r['backup'] = {'directory':str(private),'sqlite_sha256':sha(private/'atlas.sqlite'),'quick_check':'ok',
               'full_stopped_sqlite_backup':True,'service_env_and_admin_credential_copied':True}
r['phase'] = 'custody_complete'; RECEIPT.write_text(json.dumps(r,indent=2)+'\n')
original_env = (DATA/'service.env').read_text()
lines = [line for line in original_env.splitlines() if line and line.split('=',1)[0] != 'THE_ATLAS_WORKER']
lines.append('THE_ATLAS_WORKER=false')
temporary = DATA/f'.service.env.t_cb043bca-{os.getpid()}.tmp'
temporary.write_text('\n'.join(lines)+'\n'); temporary.chmod(0o600)
os.replace(temporary,DATA/'service.env'); (DATA/'service.env').chmod(0o600)
r['quiesced_environment'] = {'THE_ATLAS_WORKER':'false','all_other_lines_preserved':True,'mode':stat.S_IMODE((DATA/'service.env').stat().st_mode)}
subprocess.run(['systemctl','--user','start',UNIT],check=True)
r['service_starts'] = 1
r['after_quiesced_start'] = state()
pid = int(r['after_quiesced_start']['MainPID']); assert pid > 0 and str(pid) != before['MainPID']
process_env = dict(x.split('=',1) for x in Path(f'/proc/{pid}/environ').read_bytes().decode().split('\0') if '=' in x)
assert process_env.get('THE_ATLAS_WORKER') == 'false'
r['runtime_quiesced'] = {'pid':pid,'exe':os.readlink(f'/proc/{pid}/exe'),'cwd':os.readlink(f'/proc/{pid}/cwd'),
    'worker_disabled':True,'native_worker':process_env.get('THE_ATLAS_NATIVE_WORKER') == 'true'}
for _ in range(45):
    try:
        with opener.open('http://127.0.0.1:8787/healthz',timeout=3) as response: r['health'] = json.load(response)
        status_request = urllib.request.Request('http://127.0.0.1:8787/v1/status',headers={'Authorization':'Bearer '+admin['token']})
        with opener.open(status_request,timeout=5) as response: status = json.load(response)
        break
    except (OSError,ValueError): time.sleep(1)
else: raise RuntimeError('quiesced service did not become healthy')
r['status'] = status['memory_inference']
assert r['health']['status'] == 'ok' and status['memory_inference']['curate'] == 'atlas_native_openai_responses'
assert status['memory_inference']['admission'] == 'jev_single_decision_pipeline'
assert all(sha(p) == expected for p,expected in [(Path(p),h) for p,h in r['protected_before'].items() if not p.endswith('/service.env')])
assert all(sha(ROOT/p) == h for p,h in r['serving_sha256'].items())
with sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True) as c:
    current_hashes = {
        'events':digest_where(c,'memory_events','id',event_ids),'jobs':digest_where(c,'memory_jobs','id',job_ids),
        'memories':digest_where(c,'memories','id',ids),'supports':digest_where(c,'memory_supports','memory_id',ids),
        'versions':digest_where(c,'memory_versions','memory_id',ids),
        'provider_holds':digest_rows(c.execute('SELECT * FROM memory_provider_holds').fetchall()),
        'terminal_native_quota':digest_rows(c.execute("SELECT * FROM memory_jobs WHERE status='failed' AND error_code='native_quota'").fetchall()),
        'event_admissions':digest_rows(c.execute('SELECT * FROM memory_event_admissions').fetchall()),
        'jev_routes':digest_rows(c.execute('SELECT * FROM memory_jev_routes').fetchall()),
        'reconciliations':digest_rows(c.execute('SELECT * FROM memory_reconciliations').fetchall()),
    }
assert current_hashes == r['target_before'], 'quiesced startup changed protected/target/job/provider rows'
r['quiesced_no_job_or_provider_effects'] = True
baseline_graph = {}
for target in candidates:
    memory_id = target['memory_id']; scope = target['scope']
    result = api('/v1/memory/graph', {'agent_id':'default','scopes':[scope],'query':r['subjects'][memory_id],
        'include_history':False,'limit':100}, default)
    baseline_graph[memory_id] = {'present':any(e['id'] == memory_id for e in result['edges']),
        'snapshot':result['snapshot'],'edge_count':len(result['edges']),'truncated':result['truncated']}
baseline_recall = recall(default,'t_cb043bca-live-baseline-500')
BASELINE.write_text(json.dumps({'at':utc(),'graph':baseline_graph,'recall':baseline_recall,'relevant_ids':RELEVANT,
    'target_before':r['target_before'],'subjects':r['subjects']},indent=2)+'\n')
r['baseline_sha256'] = sha(BASELINE)
r['baseline_summary'] = {'reported_graph_present':{x:baseline_graph[x]['present'] for x in REPORTED},
    'recall_notification_ids':[x for x in baseline_recall['memory_ids'] if x in ids],
    'relevant_crowded_out':not any(x in baseline_recall['memory_ids'] for x in RELEVANT),
    'recall_id':baseline_recall['recall_id'],'tokens_used':baseline_recall['tokens_used']}
r['phase'] = 'quiesced_ready'; r['at'] = utc(); RECEIPT.write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({'phase':r['phase'],'pid':pid,'backup':r['backup'],'candidate_count':len(candidates),
    'baseline':r['baseline_summary'],'loaded_route':status['memory_inference']['curate'],
    'availability':status['memory_inference']['availability'],'service_stops':r['service_stops'],'service_starts':r['service_starts']},indent=2))
