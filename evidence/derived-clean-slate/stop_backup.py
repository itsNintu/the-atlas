"""Stopped Atlas custody before the authorized derived-brain reset."""
import datetime, hashlib, json, os, shutil, sqlite3, subprocess, time, sys
from pathlib import Path

ROOT = Path('/home/alex/work/projects/the-atlas')
OUT = ROOT / 'evidence/derived-clean-slate'
DATA = Path('/home/alex/.local/share/the-atlas')
DB = DATA / 'atlas.sqlite'
UNIT = 'the-atlas.service'
EXPECTED_HEAD = 'e58d47a51577c3001848612868ff4ed21c0c5530'
BACKUP_ROOT = DATA / 'backups/t_210103dc_derived_clean_slate'
PRIVATE = Path(sys.argv[1]) if len(sys.argv) > 1 else BACKUP_ROOT / 'atlas'
CUSTODY_OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else OUT / 'custody.json'
RAW = ['workspaces','principals','credentials','projects','spaces','grants','sources','revisions','idempotency','audit','memory_bindings','memory_grants','memory_events','memory_roots','memory_heads','memory_curation_metrics','memory_reprocess_requests','memory_reconsider_requests']
DERIVED = ['memory_feedback','memory_recalls','memory_admission_demotions','memory_admission_reviews','memory_change_invalidations','memory_reconciliations','memory_event_admissions','memory_jev_routes','memory_lineage','memory_entity_targets','memory_supports','memory_changes','memory_entity_equivalences','memory_alias_sources','memory_versions','memory_vector_buckets','memory_chunk_progress','memories','memory_scoped_aliases','memory_aliases','memory_entities','supports','facts','memory_search']

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def cmd(*args): return subprocess.check_output(args, text=True).strip()
def state():
    keys = ['MainPID','InvocationID','ActiveState','SubState','ExecMainStartTimestamp','ExecMainStatus','Result','NRestarts']
    return dict(x.split('=',1) for x in cmd('systemctl','--user','show',UNIT,*['-p'+k for k in keys]).splitlines())
def digest_rows(rows):
    return hashlib.sha256('\n'.join(sorted(json.dumps(row, default=str, ensure_ascii=True, separators=(',',':')) for row in rows)).encode()).hexdigest()
def digest_table(c, table, where=''):
    columns = [row[1] for row in c.execute(f'PRAGMA table_info("{table}")')]
    sql = 'SELECT ' + ','.join(f'"{name}"' for name in columns) + f' FROM "{table}" ' + where
    return {'columns': columns, 'sha256': digest_rows(c.execute(sql).fetchall())}

os.chdir(ROOT)
assert cmd('git','rev-parse','HEAD') == EXPECTED_HEAD
assert not cmd('git','diff','--name-only','--','src','ui')
assert not PRIVATE.exists(), 'custody already exists; reconcile rather than replaying'
before = state()
assert (before['ActiveState'] == 'active' and before['MainPID'] != '0') or before['MainPID'] == '0'
protected = [DATA/'service.env', DATA/'admin.credentials.json', Path.home()/'.config/systemd/user/the-atlas.service', Path('/mnt/d/Work/Operations/hermes/atlas-native/atlas_client.py')]
result = {'task': 't_210103dc', 'phase': 'stop_backup', 'at': utc(), 'source_commit': EXPECTED_HEAD, 'before': before,
          'protected_sha256': {str(path): sha(path) for path in protected},
          'serving_sha256': {str(path.relative_to(ROOT)): sha(path) for folder in ['src','ui'] for path in (ROOT/folder).rglob('*') if path.is_file()},
          'db_identity': [DB.stat().st_dev, DB.stat().st_ino]}
if before['MainPID'] != '0':
    subprocess.run(['systemctl','--user','kill','--kill-whom=main','--signal=SIGTERM',UNIT], check=True)
    start = time.monotonic()
    while state()['MainPID'] == before['MainPID'] and time.monotonic()-start < 180: time.sleep(1)
    subprocess.run(['systemctl','--user','stop',UNIT], check=True)
result['stopped'] = state()
assert result['stopped']['MainPID'] == '0' and result['stopped']['ExecMainStatus'] == '0'
remaining = subprocess.run(['pgrep','-af','bun.*src/server.ts'], capture_output=True, text=True)
assert remaining.returncode == 1, 'another Atlas server process remains: ' + remaining.stdout
PRIVATE.mkdir(mode=0o700)
with sqlite3.connect(DB) as c:
    assert c.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    result['raw_digests'] = {table: digest_table(c, table) for table in RAW}
    result['terminal_job_digests'] = {
        'jobs': digest_table(c, 'jobs', "WHERE status IN ('succeeded','failed','cancelled')"),
        'memory_jobs': digest_table(c, 'memory_jobs', "WHERE status IN ('succeeded','failed','cancelled','skipped')"),
    }
    result['provider_hold_digest'] = digest_rows(c.execute('SELECT provider,reason,upstream_status,upstream_category,hold_until,created_at,updated_at FROM memory_provider_holds ORDER BY provider').fetchall())
    result['derived_counts'] = {table: c.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] for table in DERIVED}
    result['job_statuses'] = {table: dict(c.execute(f'SELECT status,COUNT(*) FROM "{table}" GROUP BY status').fetchall()) for table in ['jobs','memory_jobs']}
    with sqlite3.connect(PRIVATE/'atlas.sqlite') as backup:
        c.backup(backup)
for path in protected[:3]:
    shutil.copy2(path, PRIVATE/path.name)
result['backup'] = {'directory': str(PRIVATE), 'sqlite_sha256': sha(PRIVATE/'atlas.sqlite'), 'service_env_sha256': sha(PRIVATE/'service.env'), 'admin_credential_sha256': sha(PRIVATE/'admin.credentials.json'), 'full_stopped_sqlite_backup': True}
with sqlite3.connect(PRIVATE/'atlas.sqlite') as c:
    assert c.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
result['backup_quick_check'] = 'ok'
result['at'] = utc()
CUSTODY_OUT.write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps({'phase': result['phase'], 'stopped': result['stopped'], 'backup': result['backup'], 'derived_counts': result['derived_counts'], 'job_statuses': result['job_statuses'], 'receipt': str(CUSTODY_OUT)}, indent=2))
