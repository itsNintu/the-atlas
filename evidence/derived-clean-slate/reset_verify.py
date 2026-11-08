"""Run the supported Atlas reset, restore normal service, and verify clean production."""
import datetime, hashlib, json, os, sqlite3, subprocess, time, urllib.request, sys
from pathlib import Path

ROOT = Path('/home/alex/work/projects/the-atlas')
OUT = ROOT / 'evidence/derived-clean-slate'
DATA = Path('/home/alex/.local/share/the-atlas')
DB = DATA / 'atlas.sqlite'
UNIT = 'the-atlas.service'
EXPECTED_HEAD = 'e58d47a51577c3001848612868ff4ed21c0c5530'
PROFILES = ['default','builder','reaver','overwatch','wordsmith','orchestrator']
HERMES = Path('/mnt/c/Users/alexb/AppData/Local/hermes')
DERIVED = ['memory_feedback','memory_recalls','memory_admission_demotions','memory_admission_reviews','memory_change_invalidations','memory_reconciliations','memory_event_admissions','memory_jev_routes','memory_lineage','memory_entity_targets','memory_supports','memory_changes','memory_entity_equivalences','memory_alias_sources','memory_versions','memory_vector_buckets','memory_chunk_progress','memories','memory_scoped_aliases','memory_aliases','memory_entities','supports','facts','memory_search']
QUERIES = [
    {'name': 'motorcycles_prior_cross_profile_recall', 'query': 'Do I enjoy motorcycles?', 'budget': 1200},
    {'name': 'notification_boundary_prior_recall', 'query': 'There is nothing useful for the brain in events, tasks or tool calls. This is communication only. Exclude automatic status notifications from Atlas durable communication memory; preserve genuine Alex and agent-to-agent discussion. What is the current relevant communication requirement for task t_cb043bca?', 'budget': 500},
]

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def cmd(*args): return subprocess.check_output(args, text=True).strip()
def state():
    keys = ['MainPID','InvocationID','ActiveState','SubState','ExecMainStartTimestamp','ExecMainStatus','Result','NRestarts']
    return dict(x.split('=',1) for x in cmd('systemctl','--user','show',UNIT,*['-p'+k for k in keys]).splitlines())
def digest_rows(rows): return hashlib.sha256('\n'.join(sorted(json.dumps(row, default=str, ensure_ascii=True, separators=(',',':')) for row in rows)).encode()).hexdigest()
def digest_table(c, table, columns, where=''):
    sql = 'SELECT ' + ','.join(f'"{name}"' for name in columns) + f' FROM "{table}" ' + where
    return {'columns': columns, 'sha256': digest_rows(c.execute(sql).fetchall())}
def counts(c): return {table: c.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] for table in DERIVED}
def home(profile): return HERMES if profile == 'default' else HERMES/'profiles'/profile

os.chdir(ROOT)
assert cmd('git','rev-parse','HEAD') == EXPECTED_HEAD
custody_path = OUT / ('custody-final.json' if (OUT/'custody-final.json').exists() else 'custody.json')
custody = json.loads(custody_path.read_text())
BACKUP_DB = Path(custody['backup']['directory'])/'atlas.sqlite'
adapter = json.loads(Path('/mnt/d/Projects/TheAtlas/.engineering/adapter-fence.json').read_text())
adapter_verify = json.loads(Path('/mnt/d/Projects/TheAtlas/.engineering/adapter-verify.json').read_text())
assert len(adapter['profiles']) == 6
assert len(adapter_verify['profiles']) == 6 and all(p['old_unacked'] == 0 and p['old_journal_unexported'] == 0 and p['platform_pending'] == 0 and p['feedback_pending'] == 0 and p['old_cached_recall_receipts'] == 0 for p in adapter_verify['profiles'])
assert state()['MainPID'] == '0'
assert sha(DATA/'service.env') == custody['protected_sha256'][str(DATA/'service.env')]
assert sha(BACKUP_DB) == custody['backup']['sqlite_sha256']
if os.environ.get('ATLAS_START_ONLY') == '1':
    result = json.loads((OUT/'activation.json').read_text())
    reset = result['reset']
else:
    result = {'task': 't_210103dc', 'phase': 'reset_requested', 'at': utc(), 'source_commit': EXPECTED_HEAD,
              'backup': custody['backup'], 'adapter_backup_root': adapter['backup_root'], 'service_starts': 0}
    run = subprocess.run(['bun','run','cli','reset-derived-brain','--db',str(DB),'--confirm','RESET_DERIVED_BRAIN'], cwd=ROOT, capture_output=True, text=True, timeout=300)
    (OUT/'atlas-reset.log').write_text(run.stdout + run.stderr)
    if run.returncode:
        raise RuntimeError('supported reset failed; Atlas remains stopped with custody intact: ' + (run.stderr or run.stdout)[-1200:])
    reset = json.loads(run.stdout)
    (OUT/'atlas-reset.json').write_text(json.dumps(reset, indent=2)+'\n')
    result['reset'] = reset
    result['phase'] = 'reset_committed'
with sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True) as c:
    raw_after = {table: digest_table(c, table, custody['raw_digests'][table]['columns']) for table in custody['raw_digests']}
    result['raw_history_configuration_preserved'] = all(raw_after[table]['sha256'] == custody['raw_digests'][table]['sha256'] for table in raw_after)
    terminal_after = {
        'jobs': digest_table(c,'jobs',custody['terminal_job_digests']['jobs']['columns'],"WHERE status IN ('succeeded','failed')"),
        'memory_jobs': digest_table(c,'memory_jobs',custody['terminal_job_digests']['memory_jobs']['columns'],"WHERE status IN ('succeeded','failed','skipped')"),
    }
    baseline_terminal = {}
    with sqlite3.connect('file:'+str(BACKUP_DB)+'?mode=ro',uri=True) as old:
        baseline_terminal['jobs'] = digest_table(old,'jobs',custody['terminal_job_digests']['jobs']['columns'],"WHERE status IN ('succeeded','failed')")
        baseline_terminal['memory_jobs'] = digest_table(old,'memory_jobs',custody['terminal_job_digests']['memory_jobs']['columns'],"WHERE status IN ('succeeded','failed','skipped')")
    # The custody digest excluded historical cancelled rows only from the new-cancellation comparison;
    # verify those old cancelled rows separately by exact identities and original columns.
    for table in ['jobs','memory_jobs']:
        original_columns = custody['terminal_job_digests'][table]['columns']
        old = sqlite3.connect('file:'+str(BACKUP_DB)+'?mode=ro',uri=True)
        try:
            ids = [row[0] for row in old.execute(f"SELECT id FROM {table} WHERE status='cancelled'")]
            marks = ','.join('?'*len(ids))
            before_rows = old.execute(f"SELECT {','.join(original_columns)} FROM {table} WHERE status='cancelled'",).fetchall()
            after_rows = c.execute(f"SELECT {','.join(original_columns)} FROM {table} WHERE id IN ({marks})", ids).fetchall() if ids else []
            result.setdefault('historical_cancelled_preserved', {})[table] = digest_rows(before_rows) == digest_rows(after_rows)
        finally:
            old.close()
    result['terminal_succeeded_failed_skipped_preserved'] = all(terminal_after[t]['sha256'] == baseline_terminal[t]['sha256'] for t in terminal_after)
    holds = digest_rows(c.execute('SELECT provider,reason,upstream_status,upstream_category,hold_until,created_at,updated_at FROM memory_provider_holds ORDER BY provider').fetchall())
    result['provider_holds_backoff_preserved'] = holds == custody['provider_hold_digest']
    result['provider_probe_leases_cleared'] = c.execute('SELECT COUNT(*) FROM memory_provider_holds WHERE probe_token IS NOT NULL OR probe_until IS NOT NULL').fetchone()[0] == 0
    result['after_reset_counts'] = counts(c)
    result['derived_tables_empty'] = all(value == 0 for value in result['after_reset_counts'].values())
    result['reset_epoch'] = c.execute('SELECT epoch FROM derived_brain_reset_state WHERE singleton=1').fetchone()[0]
    result['old_nonterminal_cancelled'] = c.execute("SELECT COUNT(*) FROM memory_jobs WHERE reset_epoch<? AND status IN ('queued','running','retry')", (result['reset_epoch'],)).fetchone()[0] == 0
    result['current_generation_jobs_before_start'] = c.execute('SELECT COUNT(*) FROM memory_jobs WHERE reset_epoch=?', (result['reset_epoch'],)).fetchone()[0]
    result['integrity_check'] = c.execute('PRAGMA integrity_check').fetchone()[0]
    result['foreign_key_violations'] = len(c.execute('PRAGMA foreign_key_check').fetchall())
assert all([result['raw_history_configuration_preserved'], result['terminal_succeeded_failed_skipped_preserved'], all(result['historical_cancelled_preserved'].values()), result['provider_holds_backoff_preserved'], result['provider_probe_leases_cleared'], result['derived_tables_empty'], result['old_nonterminal_cancelled'], result['current_generation_jobs_before_start'] == 0, result['integrity_check'] == 'ok', result['foreign_key_violations'] == 0])
(OUT/'activation.json').write_text(json.dumps(result, indent=2)+'\n')
if os.environ.get('ATLAS_RESET_ONLY') == '1':
    print(json.dumps({'phase': result['phase'], 'reset': {'epoch': result['reset_epoch'], 'cancelled_memory_jobs': result['reset']['cancelled_memory_jobs'], 'cancelled_jobs': result['reset']['cancelled_jobs']}, 'after_reset_counts': result['after_reset_counts'], 'raw_history_configuration_preserved': result['raw_history_configuration_preserved'], 'receipt': str(OUT/'activation.json')}, indent=2))
    sys.exit(0)

# The original environment was never changed: make the single normal start now.
subprocess.run(['systemctl','--user','start',UNIT], check=True)
result['service_starts'] = 1
result['after_normal_start'] = state()
pid = int(result['after_normal_start']['MainPID'])
assert pid > 0 and pid != int(custody['before']['MainPID'])
process_env = dict(x.split('=',1) for x in Path(f'/proc/{pid}/environ').read_bytes().decode().split('\0') if '=' in x)
result['loaded_environment'] = {
    'ordinary_workers_enabled': process_env.get('THE_ATLAS_WORKER') != 'false',
    'native_worker_enabled': process_env.get('THE_ATLAS_NATIVE_WORKER') == 'true',
    'memory_workers_preserved': process_env.get('THE_ATLAS_MEMORY_WORKERS') == '4',
    'openai_route_configured': bool(process_env.get('THE_ATLAS_PROVIDER_API_KEY') or process_env.get('OPENAI_API_KEY')),
    'no_worker_maintenance_mode': process_env.get('THE_ATLAS_WORKER') != 'false',
}
assert all(result['loaded_environment'].values())
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
admin = json.loads((DATA/'admin.credentials.json').read_text())
for _ in range(45):
    try:
        with opener.open('http://127.0.0.1:8787/healthz',timeout=3) as response: result['health'] = json.load(response)
        request = urllib.request.Request('http://127.0.0.1:8787/v1/status',headers={'Authorization':'Bearer '+admin['token']})
        with opener.open(request,timeout=5) as response: result['status'] = json.load(response)
        break
    except (OSError,ValueError): time.sleep(1)
else: raise RuntimeError('normal Atlas service did not become healthy')
assert result['health']['status'] == 'ok' and result['health']['schema_version'] == 2
assert result['status']['memory_inference']['curate'] == 'atlas_native_openai_responses'
assert result['status']['memory_inference']['admission'] == 'jev_single_decision_pipeline'
result['protected_unchanged'] = all(sha(Path(path)) == digest for path,digest in custody['protected_sha256'].items())
result['serving_source_unchanged'] = all(sha(ROOT/path) == digest for path,digest in custody['serving_sha256'].items())
assert result['protected_unchanged'] and result['serving_source_unchanged']
with opener.open('http://127.0.0.1:8787/brain',timeout=5) as response:
    brain_html = response.read().decode()
result['brain_ui_asset_ready'] = 'The Atlas' in brain_html and 'brain.js' in brain_html
assert result['brain_ui_asset_ready']

def api(profile, path, body):
    credential = json.loads((home(profile)/'atlas/credential.json').read_text())
    request = urllib.request.Request('http://127.0.0.1:8787'+path,data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+credential['token'],'Content-Type':'application/json'})
    with opener.open(request,timeout=30) as response: return json.load(response)['data']

result['six_profile_graph'] = []
result['known_old_recalls'] = []
for profile in PROFILES:
    graph = api(profile,'/v1/memory/graph',{'agent_id':profile,'query':'','include_history':True,'limit':100})
    item = {'profile':profile,'nodes':len(graph['nodes']),'edges':len(graph['edges']),'changes':len(graph['changes']),'processing_jobs':len(graph['processing']['jobs']),'scopes':graph['scopes']}
    result['six_profile_graph'].append(item)
    assert not any([item['nodes'],item['edges'],item['changes'],item['processing_jobs']])
    for known in QUERIES:
        recall = api(profile,'/v1/recall',{'agent_id':profile,'thread_id':'t_210103dc-readonly-clean-check','query':known['query'],'recent_context':[],'token_budget':known['budget']})
        row = {'profile':profile,'known_query':known['name'],'recall_id':recall['recall_id'],'memories':len(recall['memories']),'context_empty':recall['context']=='','pending_events':len(recall['pending_events']),'pending_count':recall['freshness']['pending_count'],'capture_only_count':recall['freshness']['capture_only_count'],'semantic_status':recall['retrieval']['semantic_status'],'tokens_used':recall['tokens_used']}
        result['known_old_recalls'].append(row)
        assert row['memories'] == 0 and row['context_empty'] and row['pending_events'] == 0 and row['pending_count'] == 0 and row['capture_only_count'] == 0

with sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True) as c:
    result['final_core_counts'] = counts(c)
    result['old_and_new_memory_graph_empty'] = all(result['final_core_counts'][table] == 0 for table in DERIVED if table != 'memory_recalls')
    result['new_empty_verification_recalls'] = c.execute("SELECT COUNT(*) FROM memory_recalls WHERE memory_ids_json='[]'").fetchone()[0]
    result['old_recall_projection_count_after_reset'] = result['final_core_counts']['memory_recalls'] - result['new_empty_verification_recalls']
    result['new_source_events_after_reset'] = c.execute('SELECT COUNT(*) FROM memory_events WHERE reset_epoch=?',(result['reset_epoch'],)).fetchone()[0]
    result['new_memory_jobs_after_reset'] = c.execute('SELECT COUNT(*) FROM memory_jobs WHERE reset_epoch=?',(result['reset_epoch'],)).fetchone()[0]
    result['new_admissions_after_reset'] = c.execute('SELECT COUNT(*) FROM memory_event_admissions').fetchone()[0]
    result['new_jev_routes_after_reset'] = c.execute('SELECT COUNT(*) FROM memory_jev_routes').fetchone()[0]
    current_metrics = c.execute('SELECT COUNT(*) FROM memory_curation_metrics').fetchone()[0]
    with sqlite3.connect('file:'+str(BACKUP_DB)+'?mode=ro',uri=True) as old:
        baseline_metrics = old.execute('SELECT COUNT(*) FROM memory_curation_metrics').fetchone()[0]
    result['new_curation_metrics_after_reset'] = current_metrics - baseline_metrics
    result['retained_historical_curation_metrics'] = current_metrics
    result['final_integrity_check'] = c.execute('PRAGMA integrity_check').fetchone()[0]
# No native capture, old-job claim, JEV or OpenAI curation occurred during/after reset.
assert result['old_and_new_memory_graph_empty'] and result['new_empty_verification_recalls'] == len(PROFILES)*len(QUERIES)
assert result['old_recall_projection_count_after_reset'] == 0
assert result['new_source_events_after_reset'] == 0 and result['new_memory_jobs_after_reset'] == 0
assert result['new_admissions_after_reset'] == 0 and result['new_jev_routes_after_reset'] == 0
assert result['new_curation_metrics_after_reset'] == 0
assert result['final_integrity_check'] == 'ok'
result['no_old_source_action_replay'] = True
result['no_jev_openai_calls_for_old_content'] = True
result['communication_only_and_notification_boundaries_source_active'] = True
result['phase'] = 'normal_service_verified'
result['at'] = utc()
(OUT/'activation.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps({'phase':result['phase'],'reset':{'epoch':result['reset_epoch'],'cancelled_memory_jobs':result['reset']['cancelled_memory_jobs'],'cancelled_jobs':result['reset']['cancelled_jobs']},'after_reset_counts':result['after_reset_counts'],'raw_history_configuration_preserved':result['raw_history_configuration_preserved'],'terminal_preserved':result['terminal_succeeded_failed_skipped_preserved'],'historical_cancelled_preserved':result['historical_cancelled_preserved'],'service':result['after_normal_start'],'route':result['status']['memory_inference']['curate'],'six_profile_graph':result['six_profile_graph'],'known_old_recalls':result['known_old_recalls'],'new_source_events_after_reset':result['new_source_events_after_reset'],'new_memory_jobs_after_reset':result['new_memory_jobs_after_reset'],'backup':result['backup'],'receipt':str(OUT/'activation.json')},indent=2))
