"""Windows-native Atlas adapter custody/fence helper for t_210103dc.

Runs against the six existing profile homes. It never reads message bodies into
logs, never calls Atlas/providers, and never alters the native messages table.
"""
import argparse, contextlib, datetime, hashlib, json, os, shutil, sqlite3, time
from pathlib import Path

HERMES = Path('C:/Users/alexb/AppData/Local/hermes')
PROFILES = ['default', 'builder', 'reaver', 'overwatch', 'wordsmith', 'orchestrator']
OUT = Path('D:/Projects/TheAtlas/.engineering')
RECALL_RECEIPTS = ('recall', 'injected', 'actual_use_feedback', 'recall_rejected')

def home(profile):
    return HERMES if profile == 'default' else HERMES / 'profiles' / profile

def connect(path, readonly=False):
    if readonly:
        c = sqlite3.connect('file:' + path.as_posix() + '?mode=ro', uri=True, timeout=15)
    else:
        c = sqlite3.connect(str(path), timeout=30)
    c.execute('PRAGMA busy_timeout=30000')
    return c

def count(c, table):
    return c.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def iso_timestamp(value):
    try:
        return datetime.datetime.fromtimestamp(float(value), datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except (TypeError, ValueError, OverflowError):
        return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def inspect(profile):
    h = home(profile)
    outbox = h / 'atlas/outbox.sqlite'
    native = h / 'state.db'
    item = {'profile': profile, 'home': str(h), 'files': {}, 'protected_sha256': {}}
    for path in [outbox, native]:
        item['files'][path.name] = {'path': str(path), 'size': path.stat().st_size}
    for relative in ['config.yaml', 'atlas/config.json', 'atlas/credential.json']:
        item['protected_sha256'][relative] = sha(h / relative)
    with contextlib.closing(connect(outbox, True)) as c:
        item['outbox'] = {
            'identities': count(c, 'identities'),
            'unacked_active': c.execute('SELECT COUNT(*) FROM outbox WHERE acked=0 AND superseded=0').fetchone()[0],
            'unacked_superseded': c.execute('SELECT COUNT(*) FROM outbox WHERE acked=0 AND superseded=1').fetchone()[0],
            'platform_pending': c.execute('SELECT COUNT(*) FROM platform_pending WHERE handled=0').fetchone()[0],
            'feedback_pending': c.execute('SELECT COUNT(*) FROM feedback_queue WHERE sent=0').fetchone()[0],
            'cached_recall_receipts': c.execute(f"SELECT COUNT(*) FROM receipts WHERE kind IN ({','.join('?' * len(RECALL_RECEIPTS))})", RECALL_RECEIPTS).fetchone()[0],
            'receipts': count(c, 'receipts'),
            'max_rowid': c.execute('SELECT COALESCE(MAX(rowid),0) FROM outbox').fetchone()[0],
            'max_receipt_sequence': c.execute('SELECT COALESCE(MAX(sequence),0) FROM receipts').fetchone()[0],
        }
    with contextlib.closing(connect(native, True)) as c:
        item['native'] = {
            'messages': count(c, 'messages'),
            'journal_unexported': c.execute('SELECT COUNT(*) FROM atlas_capture_v1 WHERE exported=0').fetchone()[0],
            'journal_total': count(c, 'atlas_capture_v1'),
            'journal_cutoff': c.execute('SELECT COALESCE(MAX(sequence),0) FROM atlas_capture_v1').fetchone()[0],
        }
    return item

def preflight():
    return {'mode': 'windows_read_only_preflight', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'profiles': [inspect(p) for p in PROFILES]}

def backup_and_fence(root, staging):
    root.mkdir(parents=True, exist_ok=False)
    staging.mkdir(parents=True, exist_ok=False)
    result = {'mode': 'windows_backup_and_fence', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'backup_root': str(root), 'profiles': []}
    for profile in PROFILES:
        h = home(profile)
        before = inspect(profile)
        target = root / profile
        target.mkdir(mode=0o700)
        local = staging / profile
        local.mkdir()
        # Back up to local NTFS first. SQLite page-by-page backup over the WSL
        # UNC bridge is not a safe/time-bounded transport; stream verified files
        # to protected WSL custody afterward, then remove the local sensitive copy.
        for name in ['outbox.sqlite', 'state.db']:
            source_path = h / ('atlas/outbox.sqlite' if name == 'outbox.sqlite' else name)
            with contextlib.closing(connect(source_path, True)) as source, contextlib.closing(sqlite3.connect(str(local / name))) as destination:
                source.backup(destination)
            with contextlib.closing(connect(local / name, True)) as check:
                if check.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise RuntimeError('backup quick_check failed for ' + profile + '/' + name)
            shutil.copy2(local / name, target / name)
            if sha(local / name) != sha(target / name):
                raise RuntimeError('custody copy digest mismatch for ' + profile + '/' + name)
        for relative in ['config.yaml', 'atlas/config.json', 'atlas/credential.json']:
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(h / relative, destination)
        backup_hashes = {name: sha(target / name) for name in ['outbox.sqlite', 'state.db', 'config.yaml', 'atlas/config.json', 'atlas/credential.json']}
        shutil.rmtree(local)
        outbox_path = h / 'atlas/outbox.sqlite'
        native_path = h / 'state.db'
        outbox_cutoff = before['outbox']['max_rowid']
        receipt_cutoff = before['outbox']['max_receipt_sequence']
        journal_cutoff = before['native']['journal_cutoff']
        with contextlib.closing(connect(native_path)) as c:
            rows = c.execute("SELECT id,message_uid,session_id,timestamp FROM messages WHERE role IN ('user','assistant') ORDER BY id").fetchall()
        placeholders = []
        for row_id, uid, session, timestamp in rows:
            identity = 'native:' + profile + ':' + (uid or 'row:' + str(row_id)) + ':part:0'
            placeholders.append((identity, 0, 'derived_brain_reset', session, iso_timestamp(timestamp)))
        with contextlib.closing(connect(outbox_path)) as c:
            c.execute('BEGIN IMMEDIATE')
            c.executemany('INSERT OR IGNORE INTO identities(id,revision,digest,thread,occurred) VALUES(?,?,?,?,?)', placeholders)
            identity_placeholders = c.total_changes
            fenced_outbox = c.execute("UPDATE outbox SET acked=1,superseded=1,body='{}',receipt=NULL,error='derived_brain_reset' WHERE acked=0").rowcount
            fenced_platform = c.execute("UPDATE platform_pending SET handled=1,payload='{}' WHERE handled=0").rowcount
            fenced_feedback = c.execute("UPDATE feedback_queue SET sent=1,body='{}' WHERE sent=0").rowcount
            placeholders_sql = ','.join('?' * len(RECALL_RECEIPTS))
            fenced_recalls = c.execute(f"UPDATE receipts SET details=? WHERE kind IN ({placeholders_sql}) AND sequence<=?", ('{"derived_brain_reset":"cached_recall_projection_removed"}', *RECALL_RECEIPTS, receipt_cutoff)).rowcount
            c.execute('INSERT INTO receipts(kind,session,details,created) VALUES(?,?,?,?)', ('derived_brain_reset', '', json.dumps({'journal_cutoff': journal_cutoff, 'outbox_cutoff': outbox_cutoff, 'identity_placeholders': identity_placeholders}, sort_keys=True), time.time()))
            old_unacked = c.execute('SELECT COUNT(*) FROM outbox WHERE rowid<=? AND acked=0 AND superseded=0', (outbox_cutoff,)).fetchone()[0]
            old_platform = c.execute('SELECT COUNT(*) FROM platform_pending WHERE handled=0').fetchone()[0]
            old_feedback = c.execute('SELECT COUNT(*) FROM feedback_queue WHERE sent=0').fetchone()[0]
            if old_unacked or old_platform or old_feedback:
                raise RuntimeError('adapter fence verification failed for ' + profile)
            c.commit()
        with contextlib.closing(connect(native_path)) as c:
            c.execute('BEGIN IMMEDIATE')
            fenced_journal = c.execute("UPDATE atlas_capture_v1 SET exported=1,snapshot='{}' WHERE exported=0 AND sequence<=?", (journal_cutoff,)).rowcount
            remaining = c.execute('SELECT COUNT(*) FROM atlas_capture_v1 WHERE exported=0 AND sequence<=?', (journal_cutoff,)).fetchone()[0]
            if remaining:
                raise RuntimeError('native journal fence verification failed for ' + profile)
            c.commit()
        result['profiles'].append({
            'profile': profile, 'before': before, 'backup_sha256': backup_hashes,
            'journal_cutoff': journal_cutoff, 'outbox_cutoff': outbox_cutoff, 'receipt_cutoff': receipt_cutoff,
            'identity_placeholders': identity_placeholders, 'fenced_outbox': fenced_outbox,
            'fenced_platform': fenced_platform, 'fenced_feedback': fenced_feedback,
            'fenced_cached_recall_receipts': fenced_recalls, 'fenced_journal': fenced_journal,
            'native_messages_preserved': before['native']['messages'],
        })
        (OUT / 'adapter-fence-progress.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({'profile': profile, 'backup_complete': True, 'fenced_outbox': fenced_outbox, 'fenced_journal': fenced_journal}), flush=True)
    return result

def verify(receipt):
    checks = []
    for prior in receipt['profiles']:
        profile = prior['profile']
        current = inspect(profile)
        h = home(profile)
        with contextlib.closing(connect(h / 'atlas/outbox.sqlite', True)) as c:
            old_unacked = c.execute('SELECT COUNT(*) FROM outbox WHERE rowid<=? AND acked=0 AND superseded=0', (prior['outbox_cutoff'],)).fetchone()[0]
            old_cached_recalls = c.execute(f"SELECT COUNT(*) FROM receipts WHERE kind IN ({','.join('?' * len(RECALL_RECEIPTS))}) AND sequence<=? AND details NOT LIKE '%derived_brain_reset%'", (*RECALL_RECEIPTS, prior['receipt_cutoff'])).fetchone()[0]
            platform_pending = c.execute('SELECT COUNT(*) FROM platform_pending WHERE handled=0').fetchone()[0]
            feedback_pending = c.execute('SELECT COUNT(*) FROM feedback_queue WHERE sent=0').fetchone()[0]
        with contextlib.closing(connect(h / 'state.db', True)) as c:
            old_journal = c.execute('SELECT COUNT(*) FROM atlas_capture_v1 WHERE exported=0 AND sequence<=?', (prior['journal_cutoff'],)).fetchone()[0]
        protected = {relative: sha(h / relative) for relative in ['config.yaml', 'atlas/config.json', 'atlas/credential.json']}
        checks.append({'profile': profile, 'old_unacked': old_unacked, 'old_cached_recall_receipts': old_cached_recalls, 'platform_pending': platform_pending, 'feedback_pending': feedback_pending, 'old_journal_unexported': old_journal, 'protected_sha256': protected, 'current': current})
    return {'mode': 'windows_read_only_verify', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'profiles': checks}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['preflight', 'backup-fence', 'verify'])
    parser.add_argument('--root')
    parser.add_argument('--staging')
    parser.add_argument('--receipt')
    args = parser.parse_args()
    if args.mode == 'preflight':
        result = preflight(); path = OUT / 'adapter-preflight.json'
    elif args.mode == 'backup-fence':
        if not args.root or not args.staging: parser.error('--root and --staging required')
        result = backup_and_fence(Path(args.root), Path(args.staging)); path = OUT / 'adapter-fence.json'
    else:
        if not args.receipt: parser.error('--receipt required')
        result = verify(json.loads(Path(args.receipt).read_text())); path = OUT / 'adapter-verify.json'
    path.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'mode': result['mode'], 'receipt': str(path), 'profiles': [
        {k: v for k, v in p.items() if k in ['profile','outbox','native','fenced_outbox','fenced_platform','fenced_feedback','fenced_cached_recall_receipts','fenced_journal','identity_placeholders','old_unacked','old_cached_recall_receipts','platform_pending','feedback_pending','old_journal_unexported']}
        for p in result['profiles']
    ]}, indent=2))

if __name__ == '__main__':
    main()
