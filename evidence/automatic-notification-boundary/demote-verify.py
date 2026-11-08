"""Bounded supported notification-only demotion, verification, and normal restart."""
import datetime, hashlib, json, os, sqlite3, subprocess, time, urllib.error, urllib.request
from pathlib import Path
ROOT = Path('/home/alex/work/projects/the-atlas')
OUT = ROOT / 'evidence/automatic-notification-boundary'
DATA = Path('/home/alex/.local/share/the-atlas')
DB = DATA/'atlas.sqlite'
UNIT = 'the-atlas.service'
REASON = 'automatic_notification_owner_exclusion'
RELEVANT = ['memory_0911c79b-da38-443c-a0b0-8c34e1ba751d','memory_213a6666-082d-4815-b1ca-a829407058a1']
QUERY = ('There is nothing useful for the brain in events, tasks or tool calls. This is communication only. '
         'Exclude automatic status notifications from Atlas durable communication memory; preserve genuine Alex '
         'and agent-to-agent discussion. What is the current relevant communication requirement for task t_cb043bca?')
os.chdir(ROOT)
activation = json.loads((OUT/'activation.json').read_text())
baseline = json.loads((OUT/'baseline.json').read_text())
assert activation['phase'] in ['quiesced_ready','demotion_in_progress','verified_quiesced'] and activation['service_starts'] == 1
assert activation['source_commit'] == '0d20bbd8eabf4b90f7050764af7483efa2fcd0c1'
candidates = json.loads((OUT/'audit-pre-activation.json').read_text())['candidates']
ids = [x['memory_id'] for x in candidates]
event_ids = [x['source']['event_pk'] for x in candidates]
job_ids = [x['source']['job_id'] for x in candidates]
admin = json.loads((DATA/'admin.credentials.json').read_text())
default = json.loads(Path('/mnt/c/Users/alexb/AppData/Local/hermes/atlas/credential.json').read_text())
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def cmd(*args): return subprocess.check_output(args,text=True).strip()
def state():
    keys = ['MainPID','InvocationID','ActiveState','SubState','ExecMainStartTimestamp','ExecMainStatus','Result','NRestarts']
    return dict(x.split('=',1) for x in cmd('systemctl','--user','show',UNIT,*['-p'+k for k in keys]).splitlines())
def digest_rows(rows): return hashlib.sha256('\n'.join(sorted(json.dumps(x,default=str,ensure_ascii=True,separators=(',',':')) for x in rows)).encode()).hexdigest()
def digest_where(c,table,column,values):
    if not values:return digest_rows([])
    marks = ','.join('?' for _ in values)
    return digest_rows(c.execute(f'SELECT * FROM "{table}" WHERE {column} IN ({marks})',values).fetchall())
def hashes(c): return {
    'events':digest_where(c,'memory_events','id',event_ids),'jobs':digest_where(c,'memory_jobs','id',job_ids),
    'memories':digest_where(c,'memories','id',ids),'supports':digest_where(c,'memory_supports','memory_id',ids),
    'versions':digest_where(c,'memory_versions','memory_id',ids),
    'provider_holds':digest_rows(c.execute('SELECT * FROM memory_provider_holds').fetchall()),
    'terminal_native_quota':digest_rows(c.execute("SELECT * FROM memory_jobs WHERE status='failed' AND error_code='native_quota'").fetchall()),
    'event_admissions':digest_rows(c.execute('SELECT * FROM memory_event_admissions').fetchall()),
    'jev_routes':digest_rows(c.execute('SELECT * FROM memory_jev_routes').fetchall()),
    'reconciliations':digest_rows(c.execute('SELECT * FROM memory_reconciliations').fetchall()),
}
def api(path,body,key=None):
    headers = {'Authorization':'Bearer '+default['token'],'Content-Type':'application/json'}
    if key:headers['Idempotency-Key'] = key
    request = urllib.request.Request('http://127.0.0.1:8787'+path,data=json.dumps(body).encode(),headers=headers,method='POST')
    with opener.open(request,timeout=30) as response:return json.load(response)['data']
def get_status():
    request = urllib.request.Request('http://127.0.0.1:8787/v1/status',headers={'Authorization':'Bearer '+admin['token']})
    with opener.open(request,timeout=5) as response:return json.load(response)
def graph(memory_id,recorded_at=None,history=False):
    body = {'agent_id':'default','scopes':[next(x['scope'] for x in candidates if x['memory_id']==memory_id)],
        'query':baseline['subjects'][memory_id],'include_history':history,'limit':100}
    if recorded_at:body['recorded_at'] = recorded_at
    result = api('/v1/memory/graph',body)
    return {'target_present':any(e['id']==memory_id for e in result['edges']),'snapshot':result['snapshot'],
        'target_status':next((e.get('status') for e in result['edges'] if e['id']==memory_id),None),
        'edge_count':len(result['edges']),'truncated':result['truncated']}
def recall(key):
    result = api('/v1/recall',{'agent_id':'default','thread_id':'t_cb043bca-notification-verification','query':QUERY,
        'recent_context':[],'token_budget':500},key)
    return {'recall_id':result['recall_id'],'memory_ids':[m['id'] for m in result['memories']],
        'tokens_used':result['tokens_used'],'token_budget':result['token_budget'],'pending_included':result['freshness']['pending_included'],
        'pending_events_count':len(result['pending_events']),'semantic_status':result['retrieval']['semantic_status'],
        'service_ms':result['retrieval']['service_ms'],'context_sha256':hashlib.sha256(result['context'].encode()).hexdigest(),
        'query_sha256':hashlib.sha256(QUERY.encode()).hexdigest()}
def prior_review(c,memory_id):
    c.row_factory = sqlite3.Row
    row = c.execute('SELECT r.*,d.reason_code,d.recorded_at AS demoted_at FROM memory_admission_reviews r JOIN memory_admission_demotions d ON d.review_id=r.id WHERE r.memory_id=?',(memory_id,)).fetchone()
    c.row_factory = None
    return dict(row) if row else None

def save_progress(phase,receipts):
    activation['phase'] = phase; activation['at'] = utc(); activation['review_receipts'] = receipts
    (OUT/'activation.json').write_text(json.dumps(activation,indent=2)+'\n')

before_state = state()
assert before_state['MainPID'] == str(activation['runtime_quiesced']['pid']) and before_state['ActiveState'] == 'active'
process_env = dict(x.split('=',1) for x in Path(f"/proc/{before_state['MainPID']}/environ").read_bytes().decode().split('\0') if '=' in x)
assert process_env.get('THE_ATLAS_WORKER') == 'false'
subprocess.run(['bun','run',str(OUT/'audit-readonly.ts'),str(DB),str(OUT/'audit-at-demotion.json')],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
current_audit = json.loads((OUT/'audit-at-demotion.json').read_text())
remaining_map = {x['memory_id']:x for x in current_audit['candidates']}
with sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True) as c:
    assert hashes(c) == activation['target_before'], 'target/job/provider state changed before review'
    priors = {memory_id:prior_review(c,memory_id) for memory_id in ids}
for target in candidates:
    memory_id = target['memory_id']; prior = priors[memory_id]
    if prior:
        assert prior['reason_code'] == REASON and prior['job_id'] == target['source']['job_id'] and prior['event_pk'] == target['source']['event_pk']
        assert prior['model'] == 'owner_directive' and prior['decision'] == 'session_context' and prior['proof_sha256']
    else:
        current = remaining_map.get(memory_id)
        assert current and current['reviewable'] and current['source'] == target['source'], f'current provenance changed for {memory_id}'
receipts = []
for target in candidates:
    memory_id = target['memory_id']; source = target['source']; prior = priors[memory_id]
    if prior:
        receipts.append({'memory_id':memory_id,'review_id':prior['id'],'proof_sha256':prior['proof_sha256'],
            'recorded_at':prior['demoted_at'],'reconciled_existing_without_post':True,'http_200':0})
        continue
    body = {'agent_id':source['agent_id'],'memory_id':memory_id,'expected_revision':source['revision'],'reason_code':REASON}
    key = 't_cb043bca-automatic-notification:'+memory_id
    try:
        result = api('/v1/memory/jobs/'+source['job_id']+'/admission-review',body,key)
    except urllib.error.HTTPError as error:
        detail = error.read().decode()[:1000]
        save_progress('demotion_in_progress',receipts)
        raise RuntimeError(f'admission review failed for {memory_id}: HTTP{error.code} {detail}') from None
    assert result and result.get('demoted') is True and result.get('model') == 'owner_directive'
    assert result.get('memory_id') == memory_id and result.get('decision') == 'session_context'
    assert result.get('review_id') and result.get('proof_sha256') and result.get('recorded_at')
    with sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True) as c:
        persisted = prior_review(c,memory_id)
    assert persisted and persisted['id'] == result['review_id'] and persisted['proof_sha256'] == result['proof_sha256']
    assert persisted['job_id'] == source['job_id'] and persisted['event_pk'] == source['event_pk'] and persisted['reason_code'] == REASON
    receipts.append({'memory_id':memory_id,'review_id':result['review_id'],'proof_sha256':result['proof_sha256'],
        'recorded_at':result['recorded_at'],'reconciled_existing_without_post':False,'http_200':1})
    save_progress('demotion_in_progress',receipts)
activation['demotion_post_requests'] = sum(x['http_200'] for x in receipts)
activation['demotion_model_calls'] = 0
activation['demotion_reconciled_without_post'] = sum(1 for x in receipts if x['reconciled_existing_without_post'])
assert len(receipts) == len(candidates)
with sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True) as c:
    after_hashes = hashes(c)
    assert after_hashes == activation['target_before'], 'original rows/provider holds/jobs changed during demotion'
    counts = {table:c.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] for table in ['memory_admission_reviews','memory_admission_demotions']}
    assert c.execute("SELECT COUNT(*) FROM memory_admission_demotions WHERE reason_code=?",(REASON,)).fetchone()[0] == len(candidates)
activation['original_rows_unchanged_after_demotion'] = True
activation['review_table_counts'] = counts
current_graph = {}; historical_graph = {}
for memory_id in ids:
    current_graph[memory_id] = graph(memory_id)
    assert not current_graph[memory_id]['target_present'], f'{memory_id} remains in current graph'
    snapshot = baseline['graph'][memory_id]['snapshot']['recorded_at']
    historical_graph[memory_id] = graph(memory_id,snapshot,True)
    assert historical_graph[memory_id]['target_present'], f'{memory_id} missing from pre-demotion history'
after_recall = recall('t_cb043bca-live-after-500')
assert not any(x in after_recall['memory_ids'] for x in ids), 'notification candidate remains in current recall'
assert any(x in after_recall['memory_ids'] for x in RELEVANT), 'genuine Atlas requirement did not survive compact recall'
assert after_recall['pending_included'] == 0 and after_recall['pending_events_count'] == 0
subprocess.run(['bun','run',str(OUT/'audit-readonly.ts'),str(DB),str(OUT/'audit-after.json')],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
after_audit = json.loads((OUT/'audit-after.json').read_text())
assert after_audit['candidate_count'] == 0 and all(x['already_demoted'] for x in after_audit['reported'])
with sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True) as c:
    assert c.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
activation['current_graph'] = current_graph
activation['pre_demotion_graph'] = historical_graph
activation['after_recall'] = after_recall
activation['after_recall_notification_ids'] = []
activation['after_recall_relevant_ids'] = [x for x in after_recall['memory_ids'] if x in RELEVANT]
activation['after_audit'] = {'candidate_count':after_audit['candidate_count'],'reported_all_demoted':True}
activation['quick_check'] = 'ok'
save_progress('verified_quiesced',receipts)
# Restore the exact original environment while stopped, then make the one normal start.
subprocess.run(['systemctl','--user','kill','--kill-whom=main','--signal=SIGTERM',UNIT],check=True)
drain = time.monotonic()
while state()['MainPID'] == before_state['MainPID'] and time.monotonic()-drain < 180:time.sleep(1)
activation['final_drain_seconds'] = round(time.monotonic()-drain,3)
subprocess.run(['systemctl','--user','stop',UNIT],check=True)
activation['service_stops'] = 2
activation['stopped_before_normal'] = state()
assert activation['stopped_before_normal']['MainPID'] == '0'
backup_env = Path(activation['backup']['directory'])/'service.env'
temporary = DATA/f'.service.env.t_cb043bca-restore-{os.getpid()}.tmp'
temporary.write_bytes(backup_env.read_bytes()); temporary.chmod(0o600)
os.replace(temporary,DATA/'service.env')
assert sha(DATA/'service.env') == activation['service_env_original_sha256']
with sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True) as c:assert c.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
subprocess.run(['systemctl','--user','start',UNIT],check=True)
activation['service_starts'] = 2
activation['after_normal_start'] = state()
pid = int(activation['after_normal_start']['MainPID']); assert pid > 0 and str(pid) != before_state['MainPID']
process_env = dict(x.split('=',1) for x in Path(f'/proc/{pid}/environ').read_bytes().decode().split('\0') if '=' in x)
assert process_env.get('THE_ATLAS_WORKER') != 'false' and process_env.get('THE_ATLAS_NATIVE_WORKER') == 'true'
for _ in range(45):
    try:
        with opener.open('http://127.0.0.1:8787/healthz',timeout=3) as response:activation['final_health'] = json.load(response)
        status = get_status();break
    except (OSError,ValueError):time.sleep(1)
else:raise RuntimeError('normal service did not become healthy')
assert activation['final_health']['status'] == 'ok' and status['memory_inference']['curate'] == 'atlas_native_openai_responses'
assert status['memory_inference']['admission'] == 'jev_single_decision_pipeline'
activation['final_memory_inference'] = status['memory_inference']
activation['protected_unchanged'] = all(sha(Path(p)) == h for p,h in activation['protected_before'].items())
activation['serving_source_unchanged'] = all(sha(ROOT/p) == h for p,h in activation['serving_sha256'].items())
assert activation['protected_unchanged'] and activation['serving_source_unchanged']
with sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True) as c:
    final_hashes = hashes(c)
activation['original_target_rows_unchanged_after_normal_start'] = all(final_hashes[k] == activation['target_before'][k] for k in
    ['events','jobs','memories','supports','versions','event_admissions','jev_routes','reconciliations'])
activation['provider_holds_unchanged_during_cleanup_and_quiescence'] = after_hashes['provider_holds'] == activation['target_before']['provider_holds']
activation['terminal_native_quota_unchanged_during_cleanup_and_quiescence'] = after_hashes['terminal_native_quota'] == activation['target_before']['terminal_native_quota']
activation['terminal_native_quota_digest_same_after_normal_start'] = final_hashes['terminal_native_quota'] == activation['target_before']['terminal_native_quota']
activation['normal_worker_enabled'] = True
activation['result'] = 'pass'; activation['phase'] = 'complete'; activation['at'] = utc()
(OUT/'activation.json').write_text(json.dumps(activation,indent=2)+'\n')
summary = {'task':'t_cb043bca','at':activation['at'],'result':'pass','candidate_count':len(candidates),
    'demotion_post_requests':activation['demotion_post_requests'],'demotion_reconciled_without_post':activation['demotion_reconciled_without_post'],
    'demotion_model_calls':0,'job_retries':0,'source_or_action_replays':0,'current_graph_targets_present':0,
    'pre_demotion_history_targets_present':len(candidates),'after_recall':after_recall,
    'original_rows_unchanged':activation['original_rows_unchanged_after_demotion'],
    'provider_holds_unchanged_during_cleanup':activation['provider_holds_unchanged_during_cleanup_and_quiescence'],
    'terminal_native_quota_unchanged_during_cleanup':activation['terminal_native_quota_unchanged_during_cleanup_and_quiescence'],
    'backup':activation['backup'],'service_stops':activation['service_stops'],'service_starts':activation['service_starts'],
    'final_pid':pid,'final_route':status['memory_inference']['curate'],'final_availability':status['memory_inference']['availability'],
    'protected_unchanged':activation['protected_unchanged'],'serving_source_unchanged':activation['serving_source_unchanged']}
(OUT/'OUTCOME.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
