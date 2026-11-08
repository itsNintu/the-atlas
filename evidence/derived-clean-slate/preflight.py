"""Read-only production preflight; emits counts/hashes, never source content or secrets."""
import datetime, hashlib, json, os, sqlite3, subprocess, urllib.request
from pathlib import Path

ROOT = Path('/home/alex/work/projects/the-atlas')
OUT = ROOT / 'evidence/derived-clean-slate'
DATA = Path('/home/alex/.local/share/the-atlas')
DB = DATA / 'atlas.sqlite'
HERMES = Path('/mnt/c/Users/alexb/AppData/Local/hermes')
PROFILES = ['default', 'builder', 'reaver', 'overwatch', 'wordsmith', 'orchestrator']
DERIVED = [
    'memory_feedback','memory_recalls','memory_admission_demotions','memory_admission_reviews',
    'memory_change_invalidations','memory_reconciliations','memory_event_admissions','memory_jev_routes',
    'memory_lineage','memory_entity_targets','memory_supports','memory_changes','memory_entity_equivalences',
    'memory_alias_sources','memory_versions','memory_vector_buckets','memory_chunk_progress','memories',
    'memory_scoped_aliases','memory_aliases','memory_entities','supports','facts','memory_search',
]
RAW_CONFIG = [
    'workspaces','principals','credentials','projects','spaces','grants','sources','revisions','idempotency','audit',
    'memory_bindings','memory_grants','memory_events','memory_roots','memory_heads','memory_curation_metrics',
    'memory_reprocess_requests','memory_reconsider_requests',
]

def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def ro(path):
    return sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True)

def count(c, table):
    return c.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]

def home(profile):
    return HERMES if profile == 'default' else HERMES / 'profiles' / profile

OUT.mkdir(parents=True, exist_ok=True)
result = {'task': 't_210103dc', 'at': utc(), 'mode': 'read_only_preflight', 'source_head': subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip()}
result['service'] = dict(x.split('=', 1) for x in subprocess.check_output([
    'systemctl','--user','show','the-atlas.service',
    '-pMainPID','-pActiveState','-pSubState','-pNRestarts','-pInvocationID','-pExecMainStartTimestamp',
], text=True).splitlines())
result['protected_sha256'] = {}
for path in [DATA/'service.env', DATA/'admin.credentials.json', Path.home()/'.config/systemd/user/the-atlas.service', Path('/mnt/d/Work/Operations/hermes/atlas-native/atlas_client.py')]:
    result['protected_sha256'][str(path)] = sha(path)
with ro(DB) as c:
    result['quick_check'] = c.execute('PRAGMA quick_check').fetchone()[0]
    result['derived_counts'] = {table: count(c, table) for table in DERIVED}
    result['raw_config_counts'] = {table: count(c, table) for table in RAW_CONFIG}
    result['memory_scopes'] = [dict(scope=row[0], count=row[1]) for row in c.execute('SELECT scope,COUNT(*) FROM memories GROUP BY scope ORDER BY scope')]
    result['job_statuses'] = [dict(status=row[0], count=row[1]) for row in c.execute('SELECT status,COUNT(*) FROM jobs GROUP BY status ORDER BY status')]
    result['memory_job_statuses'] = [dict(status=row[0], count=row[1]) for row in c.execute('SELECT status,COUNT(*) FROM memory_jobs GROUP BY status ORDER BY status')]
    result['event_statuses'] = [dict(status=row[0], count=row[1]) for row in c.execute('SELECT status,COUNT(*) FROM memory_events GROUP BY status ORDER BY status')]
    result['provider_holds'] = [dict(provider=row[0], reason=row[1], hold_until=row[2], probe_active=bool(row[3])) for row in c.execute('SELECT provider,reason,hold_until,probe_token IS NOT NULL FROM memory_provider_holds ORDER BY provider')]
    result['bindings'] = [dict(agent_id=row[0], count=row[1]) for row in c.execute('SELECT agent_id,COUNT(*) FROM memory_bindings GROUP BY agent_id ORDER BY agent_id')]
result['db_file'] = {'path': str(DB), 'size': DB.stat().st_size, 'device': DB.stat().st_dev, 'inode': DB.stat().st_ino}
result['profiles'] = []
for profile in PROFILES:
    h = home(profile)
    item = {'profile': profile, 'home': str(h), 'protected_sha256': {}}
    for relative in ['config.yaml', 'atlas/config.json', 'atlas/credential.json']:
        path = h / relative
        item['protected_sha256'][relative] = sha(path)
    outbox = h / 'atlas/outbox.sqlite'
    item['outbox_file'] = {'path': str(outbox), 'size': outbox.stat().st_size}
    try:
        with ro(outbox) as c:
            item['outbox'] = {
                'identities': count(c, 'identities'),
                'unacked_active': c.execute('SELECT COUNT(*) FROM outbox WHERE acked=0 AND superseded=0').fetchone()[0],
                'unacked_superseded': c.execute('SELECT COUNT(*) FROM outbox WHERE acked=0 AND superseded=1').fetchone()[0],
                'platform_pending': c.execute('SELECT COUNT(*) FROM platform_pending WHERE handled=0').fetchone()[0],
                'feedback_pending': c.execute('SELECT COUNT(*) FROM feedback_queue WHERE sent=0').fetchone()[0],
                'recall_receipts': c.execute("SELECT COUNT(*) FROM receipts WHERE kind='recall'").fetchone()[0],
                'receipts': count(c, 'receipts'),
            }
    except sqlite3.Error as exc:
        item['outbox_error'] = type(exc).__name__
    native = h / 'state.db'
    item['native_file'] = {'path': str(native), 'size': native.stat().st_size}
    try:
        with ro(native) as c:
            item['native'] = {
                'messages': count(c, 'messages'),
                'journal_unexported': c.execute('SELECT COUNT(*) FROM atlas_capture_v1 WHERE exported=0').fetchone()[0],
                'journal_total': count(c, 'atlas_capture_v1'),
            }
    except sqlite3.Error as exc:
        item['native_error'] = type(exc).__name__ + '; Windows-native preflight is authoritative'
    result['profiles'].append(item)
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:8787/healthz', timeout=3) as response:
        result['health'] = json.load(response)
except Exception as exc:
    result['health_error'] = type(exc).__name__
path = OUT / 'preflight.json'
path.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({
    'at': result['at'], 'head': result['source_head'], 'service': result['service'],
    'derived_total': sum(result['derived_counts'].values()), 'derived_counts': result['derived_counts'],
    'memory_scopes': result['memory_scopes'], 'job_statuses': result['job_statuses'],
    'memory_job_statuses': result['memory_job_statuses'], 'raw_config_counts': result['raw_config_counts'],
    'profiles': [{**p, 'protected_sha256': '[hashed]'} for p in result['profiles']],
    'health': result.get('health'), 'health_error': result.get('health_error'), 'receipt': str(path),
}, indent=2))
