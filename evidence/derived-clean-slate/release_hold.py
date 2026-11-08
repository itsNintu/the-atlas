"""Hold all six native drain locks while fencing every current old queue.

The lock is the adapter's own cross-process drain_guard. Holding it covers the
old context threads that plugin disable does not stop; flush then has no old
rows to deliver when Atlas starts. Original native messages are never changed.
"""
import contextlib, datetime, json, shutil, sqlite3, threading, time
from pathlib import Path
from hermes_cli.auth import _file_lock
from clean_slate_adapter import PROFILES, RECALL_RECEIPTS, home, inspect, connect, sha, OUT

ROOT = Path('//wsl.localhost/Ubuntu/home/alex/.local/share/the-atlas/backups/t_210103dc_derived_clean_slate/adapter-state-release')
STAGING = Path('D:/Projects/TheAtlas/.engineering/adapter-release-staging')
RELEASE = OUT / 'adapter-release-request'
READY = OUT / 'adapter-release-ready.json'
ERROR = OUT / 'adapter-release-error.json'

def backup_custody(profile, h, target):
    local = STAGING / profile
    local.mkdir()
    target.mkdir()
    with contextlib.closing(connect(h/'atlas/outbox.sqlite', True)) as source, contextlib.closing(sqlite3.connect(str(local/'outbox.sqlite'))) as destination:
        source.backup(destination)
    shutil.copy2(local/'outbox.sqlite', target/'outbox.sqlite')
    assert sha(local/'outbox.sqlite') == sha(target/'outbox.sqlite')
    with contextlib.closing(connect(h/'state.db', True)) as source:
        schema = source.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='atlas_capture_v1'").fetchone()[0]
        columns = [row[1] for row in source.execute('PRAGMA table_info(atlas_capture_v1)')]
        rows = source.execute('SELECT * FROM atlas_capture_v1 ORDER BY sequence').fetchall()
    with contextlib.closing(sqlite3.connect(str(local/'atlas-capture.sqlite'))) as destination:
        destination.execute(schema)
        destination.executemany(f"INSERT INTO atlas_capture_v1 VALUES({','.join('?'*len(columns))})", rows)
        destination.commit()
    shutil.copy2(local/'atlas-capture.sqlite', target/'atlas-capture.sqlite')
    assert sha(local/'atlas-capture.sqlite') == sha(target/'atlas-capture.sqlite')
    shutil.rmtree(local)
    return {'outbox_sha256': sha(target/'outbox.sqlite'), 'atlas_capture_sha256': sha(target/'atlas-capture.sqlite'), 'native_journal_rows': len(rows), 'full_native_state_custody': '../adapter-state/' + profile + '/state.db'}

def fence(profile):
    h = home(profile)
    before = inspect(profile)
    outbox_cutoff = before['outbox']['max_rowid']; receipt_cutoff = before['outbox']['max_receipt_sequence']; journal_cutoff = before['native']['journal_cutoff']
    with contextlib.closing(connect(h/'state.db')) as c:
        rows = c.execute("SELECT id,message_uid,session_id,timestamp FROM messages WHERE role IN ('user','assistant') ORDER BY id").fetchall()
    from clean_slate_adapter import iso_timestamp
    placeholders = [('native:'+profile+':'+(uid or 'row:'+str(row_id))+':part:0',0,'derived_brain_reset',session,iso_timestamp(timestamp)) for row_id,uid,session,timestamp in rows]
    with contextlib.closing(connect(h/'atlas/outbox.sqlite')) as c:
        c.execute('BEGIN IMMEDIATE')
        c.executemany('INSERT OR IGNORE INTO identities(id,revision,digest,thread,occurred) VALUES(?,?,?,?,?)', placeholders)
        identity_placeholders = c.total_changes
        fenced_outbox = c.execute("UPDATE outbox SET acked=1,superseded=1,body='{}',receipt=NULL,error='derived_brain_reset' WHERE acked=0").rowcount
        fenced_platform = c.execute("UPDATE platform_pending SET handled=1,payload='{}' WHERE handled=0").rowcount
        fenced_feedback = c.execute("UPDATE feedback_queue SET sent=1,body='{}' WHERE sent=0").rowcount
        marks = ','.join('?'*len(RECALL_RECEIPTS))
        fenced_recalls = c.execute(f"UPDATE receipts SET details=? WHERE kind IN ({marks}) AND sequence<=?", ('{"derived_brain_reset":"cached_recall_projection_removed"}',*RECALL_RECEIPTS,receipt_cutoff)).rowcount
        c.execute('INSERT INTO receipts(kind,session,details,created) VALUES(?,?,?,?)',('derived_brain_reset','',json.dumps({'final_hold':True,'journal_cutoff':journal_cutoff,'outbox_cutoff':outbox_cutoff},sort_keys=True),time.time()))
        assert c.execute('SELECT COUNT(*) FROM outbox WHERE rowid<=? AND acked=0 AND superseded=0',(outbox_cutoff,)).fetchone()[0] == 0
        assert c.execute('SELECT COUNT(*) FROM platform_pending WHERE handled=0').fetchone()[0] == 0
        assert c.execute('SELECT COUNT(*) FROM feedback_queue WHERE sent=0').fetchone()[0] == 0
        c.commit()
    with contextlib.closing(connect(h/'state.db')) as c:
        c.execute('BEGIN IMMEDIATE')
        fenced_journal = c.execute("UPDATE atlas_capture_v1 SET exported=1,snapshot='{}' WHERE exported=0 AND sequence<=?",(journal_cutoff,)).rowcount
        assert c.execute('SELECT COUNT(*) FROM atlas_capture_v1 WHERE exported=0 AND sequence<=?',(journal_cutoff,)).fetchone()[0] == 0
        c.commit()
    return {'profile':profile,'before':before,'journal_cutoff':journal_cutoff,'outbox_cutoff':outbox_cutoff,'receipt_cutoff':receipt_cutoff,'identity_placeholders':identity_placeholders,'fenced_outbox':fenced_outbox,'fenced_platform':fenced_platform,'fenced_feedback':fenced_feedback,'fenced_cached_recall_receipts':fenced_recalls,'fenced_journal':fenced_journal,'native_messages_preserved':before['native']['messages']}

def main():
    if ROOT.exists() or STAGING.exists(): raise RuntimeError('final custody/staging already exists; reconcile before replay')
    ROOT.mkdir(parents=True); STAGING.mkdir()
    result = {'mode':'windows_backup_and_fence','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'backup_root':str(ROOT),'profiles':[]}
    with contextlib.ExitStack() as stack:
        for profile in PROFILES:
            holder = threading.local()
            stack.enter_context(_file_lock(home(profile)/'atlas/drain.lock',holder,180,'waiting for old Atlas drain before final clean slate'))
            print(json.dumps({'drain_lock_acquired':profile}),flush=True)
        # With every drain stopped, each profile is backed up and fenced before
        # the next one is inspected. Already-fenced profiles cannot drain again.
        for profile in PROFILES:
            h = home(profile); target = ROOT/profile
            backup = backup_custody(profile,h,target)
            item = fence(profile); item['backup_sha256'] = backup
            result['profiles'].append(item)
            (OUT/'adapter-fence.json').write_text(json.dumps(result,indent=2)+'\n')
            print(json.dumps({'profile_fenced':profile,'fenced_outbox':item['fenced_outbox'],'fenced_journal':item['fenced_journal']}),flush=True)
        READY.write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'profiles':len(result['profiles']),'receipt':'adapter-fence.json'})+'\n')
        print(json.dumps({'ready':True,'waiting_for_release':str(RELEASE)}),flush=True)
        while not RELEASE.exists(): time.sleep(.5)
        print(json.dumps({'release_observed':True,'final_fence':'cover every maintenance event through this cutoff'}),flush=True)
        # Unlike the earlier attempt, do NOT leave post-cutoff maintenance rows
        # for the restarted workers. Fence every queue again at the release
        # boundary, after reset and adapter verification, while Atlas is stopped.
        release_result = {'mode':'windows_backup_and_fence','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'backup_root':str(ROOT),'profiles':[]}
        for profile in PROFILES:
            item = fence(profile)
            release_result['profiles'].append(item)
            (OUT/'adapter-fence.json').write_text(json.dumps(release_result,indent=2)+'\n')
            print(json.dumps({'release_fenced':profile,'fenced_outbox':item['fenced_outbox'],'fenced_journal':item['fenced_journal']}),flush=True)
        (OUT/'adapter-release-fence.json').write_text(json.dumps(release_result,indent=2)+'\n')
        READY.write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'profiles':len(release_result['profiles']),'receipt':'adapter-release-fence.json','released':True})+'\n')
    STAGING.rmdir()
    print(json.dumps({'locks_released':True,'profiles':len(result['profiles'])}),flush=True)

if __name__ == '__main__':
    try: main()
    except Exception as exc:
        ERROR.write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'type':type(exc).__name__,'error':str(exc)[:1500]},indent=2)+'\n')
        raise
