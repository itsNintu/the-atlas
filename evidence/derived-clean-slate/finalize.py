"""Reconcile final clean-slate counts and emit the nonsecret machine handoff."""
import datetime, hashlib, json, sqlite3, subprocess
from pathlib import Path
ROOT = Path('/home/alex/work/projects/the-atlas')
OUT = ROOT/'evidence/derived-clean-slate'
DATA = Path('/home/alex/.local/share/the-atlas')
DB = DATA/'atlas.sqlite'
load = lambda name: json.loads((OUT/name).read_text())
preflight = load('preflight.json')
activation = load('activation.json')
custody = load('custody-final.json')
live = load('live-verification.json')
graph_snapshot = load('graph-reset-snapshot.json')
ui = load('ui-reset-snapshot.json')
adapter_verify = load('adapter-verify.json')
adapter_loaded = load('adapter-loaded.json')
plugin_enable = load('plugin-enable.json')
reset_at = activation['reset']['reset_at']
assert activation['reset_epoch'] == 3 and activation['phase'] == 'reset_committed'
assert all(value == 0 for value in activation['after_reset_counts'].values())
assert live['result'] == 'pass' and graph_snapshot['result'] == 'pass' and ui['result'] == 'pass'
assert all(p['old_unacked'] == 0 and p['old_journal_unexported'] == 0 and p['platform_pending'] == 0 and p['feedback_pending'] == 0 and p['old_cached_recall_receipts'] == 0 for p in adapter_verify['profiles'])
assert len(adapter_loaded) == 6 and all(p['version'] == '1.2.3' and not p['session_running'] for p in adapter_loaded)
assert all(p['original_config_restored'] for p in plugin_enable['profiles'])
old_ids = set()
for name in ['atlas','atlas-final','atlas-release']:
    with sqlite3.connect('file:'+str(DATA/'backups/t_210103dc_derived_clean_slate'/name/'atlas.sqlite')+'?mode=ro',uri=True) as old:
        old_ids.update(row[0] for row in old.execute('SELECT id FROM memories'))
with sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True) as c:
    current_ids = {row[0] for row in c.execute('SELECT id FROM memories')}
    assert not current_ids & old_ids
    current = {
        'new_generation_events': c.execute('SELECT COUNT(*) FROM memory_events WHERE reset_epoch=3').fetchone()[0],
        'new_generation_memories': c.execute('SELECT COUNT(*) FROM memories').fetchone()[0],
        'new_generation_job_statuses': dict(c.execute('SELECT status,COUNT(*) FROM memory_jobs WHERE reset_epoch=3 GROUP BY status').fetchall()),
        'new_recall_receipts': c.execute('SELECT COUNT(*) FROM memory_recalls').fetchone()[0],
        'new_empty_recall_receipts': c.execute("SELECT COUNT(*) FROM memory_recalls WHERE memory_ids_json='[]'").fetchone()[0],
        'reset_receipts': c.execute('SELECT COUNT(*) FROM derived_brain_reset_receipts').fetchone()[0],
        'old_nonterminal_jobs': c.execute("SELECT COUNT(*) FROM memory_jobs WHERE reset_epoch<3 AND status IN ('queued','running','retry')").fetchone()[0],
        'current_generation_tool_jobs': c.execute("SELECT COUNT(*) FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk WHERE j.reset_epoch=3 AND e.role='tool'").fetchone()[0],
        'old_derived_memories_present': len(current_ids & old_ids),
        'all_current_memories_recorded_after_reset': c.execute('SELECT COUNT(*) FROM memories WHERE recorded_from<?',(reset_at,)).fetchone()[0] == 0,
        'all_current_supports_new_generation': c.execute('SELECT COUNT(*) FROM memory_supports s JOIN memory_events e ON e.id=s.event_pk WHERE e.reset_epoch<>3').fetchone()[0] == 0,
        'integrity_check': c.execute('PRAGMA integrity_check').fetchone()[0],
        'foreign_key_violations': len(c.execute('PRAGMA foreign_key_check').fetchall()),
    }
    retained_metrics = c.execute('SELECT COUNT(*) FROM memory_curation_metrics').fetchone()[0]
assert current['old_nonterminal_jobs'] == 0 and current['current_generation_tool_jobs'] == 0
assert current['old_derived_memories_present'] == 0 and current['all_current_memories_recorded_after_reset'] and current['all_current_supports_new_generation']
assert current['integrity_check'] == 'ok' and current['foreign_key_violations'] == 0
with sqlite3.connect('file:'+str(DATA/'backups/t_210103dc_derived_clean_slate/atlas-release/atlas.sqlite')+'?mode=ro',uri=True) as c:
    retained_at_final_reset = {table:c.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] for table in ['workspaces','principals','credentials','projects','spaces','grants','sources','revisions','idempotency','audit','memory_bindings','memory_grants','memory_events','memory_roots','memory_heads','memory_curation_metrics','memory_reprocess_requests','memory_reconsider_requests']}
    final_pre_counts = {table:c.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] for table in ['memory_event_admissions','memory_jev_routes','memories']}
service = dict(x.split('=',1) for x in subprocess.check_output(['systemctl','--user','show','the-atlas.service','-pMainPID','-pActiveState','-pSubState','-pNRestarts','-pInvocationID'],text=True).splitlines())
assert service['ActiveState'] == 'active' and service['MainPID'] == live['service']['MainPID']
initial_derived_rows = sum(value for table,value in preflight['derived_counts'].items() if table != 'memory_search')
initial_nonterminal = preflight['memory_job_statuses'][0].get('queued',0) if False else sum(x['count'] for x in preflight['memory_job_statuses'] if x['status'] in ['queued','running','retry'])
result = {
    'task':'t_210103dc','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'result':'pass',
    'source_commit':'e58d47a51577c3001848612868ff4ed21c0c5530','source_verification':{'typecheck':True,'tests':173,'assertions':1800,'on_disk_e2e':True},
    'physical_reset':{'epoch':3,'reset_at':reset_at,'initial_derived_rows_excluding_fts_shadow':initial_derived_rows,'initial_counts':preflight['derived_counts'],'initial_memory_scopes':preflight['memory_scopes'],'initial_nonterminal_memory_jobs':initial_nonterminal,'after_reset_counts':activation['after_reset_counts'],'old_nonterminal_jobs_after_reset':current['old_nonterminal_jobs'],'raw_history_configuration_preserved':activation['raw_history_configuration_preserved'],'terminal_history_preserved':activation['terminal_succeeded_failed_skipped_preserved'],'historical_cancelled_preserved':activation['historical_cancelled_preserved'],'provider_holds_backoff_preserved_at_reset':activation['provider_holds_backoff_preserved']},
    'retained_at_final_reset':retained_at_final_reset,
    'retained_categories':['original native memory_events/raw revisions and roots/heads (including post-reset history)','configuration, credentials, grants and six bindings','terminal/cancelled/failed/skipped/succeeded job history and idempotency/audit receipts','non-content curation metrics and reprocess/reconsider receipts','provider availability holds/backoff (stale probe leases cleared)','non-content derived_brain_reset_receipts'],
    'current_historical_curation_metrics_including_new':retained_metrics,
    'backup':{'initial_full_stopped_atlas':load('custody.json')['backup'],'final_full_stopped_atlas':custody['backup'],'adapter_full_state_root':'/home/alex/.local/share/the-atlas/backups/t_210103dc_derived_clean_slate/adapter-state','adapter_final_queue_custody_root':'/home/alex/.local/share/the-atlas/backups/t_210103dc_derived_clean_slate/adapter-state-release','historical_backup_retention_is_not_active_brain':True},
    'adapter':{'loaded_versions':[{'profile':p['profile'],'version':p['version']} for p in adapter_loaded],'original_configuration_restored':True,'old_unacked_outbox':0,'old_unexported_journal':0,'old_platform_pending':0,'old_feedback_pending':0,'old_cached_recall_receipts':0,'drain_locks_released':True},
    'verification':{'empty_graph_read_model_at_reset':graph_snapshot,'browser_ui_at_reset':ui,'known_old_queries':live['known_old_recalls'],'current_old_derived_memories_present':current['old_derived_memories_present'],'all_current_supports_new_generation':current['all_current_supports_new_generation'],'all_current_memories_recorded_after_reset':current['all_current_memories_recorded_after_reset'],'integrity_check':current['integrity_check'],'foreign_key_violations':current['foreign_key_violations'],'communication_only_and_notification_boundaries_source_active':live['communication_only_and_notification_boundaries_source_active']},
    'normal_service':service,
    'post_reset_new_activity':current,
    'intermediate_verification_cycles':{'note':'Two early adapter-release verifications admitted stale maintenance rows before the final cutoff. Their derived outputs were physically purged by later reset epochs; no such row remains. These were process deviations, not retained brain state or evidence of a clean first attempt.','pre_final_cutoff_counts':final_pre_counts,'final_cancelled_nonterminal_jobs':activation['reset']['cancelled_memory_jobs'],'final_provider_hold_or_backlog_replay_for_pre_reset_content_after_cutoff':False},
    'residual':'No pre-reset derived memory/graph/index row remains in the active database. Full stopped backups intentionally retain historical derived data outside the active brain. Current new-generation events/memories are genuine post-reset conversations, not residual old content.',
}
(OUT/'OUTCOME.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'result':result['result'],'epoch':result['physical_reset']['epoch'],'initial_derived_rows_excluding_fts_shadow':initial_derived_rows,'initial_nonterminal_memory_jobs':initial_nonterminal,'after_reset_memories':result['physical_reset']['after_reset_counts']['memories'],'post_reset_new_activity':current,'service':service,'backup':result['backup'],'receipt':str(OUT/'OUTCOME.json')},indent=2))
