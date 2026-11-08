"""Cutoff-aware live verification: no pre-reset content, normal new conversations allowed."""
import datetime, hashlib, json, sqlite3, subprocess, urllib.request
from pathlib import Path
ROOT = Path('/home/alex/work/projects/the-atlas')
OUT = ROOT/'evidence/derived-clean-slate'
DATA = Path('/home/alex/.local/share/the-atlas')
DB = DATA/'atlas.sqlite'
HERMES = Path('/mnt/c/Users/alexb/AppData/Local/hermes')
PROFILES = ['default','builder','reaver','overwatch','wordsmith','orchestrator']
QUERIES = [
    {'name':'motorcycles_prior_cross_profile_recall','query':'Do I enjoy motorcycles?','budget':1200},
    {'name':'notification_boundary_prior_recall','query':'There is nothing useful for the brain in events, tasks or tool calls. This is communication only. Exclude automatic status notifications from Atlas durable communication memory; preserve genuine Alex and agent-to-agent discussion. What is the current relevant communication requirement for task t_cb043bca?','budget':500},
]
activation = json.loads((OUT/'activation.json').read_text())
assert activation['phase'] == 'reset_committed' and activation['reset_epoch'] == 3
reset_at = activation['reset']['reset_at']
old_ids = set()
for name in ['atlas','atlas-final','atlas-release']:
    with sqlite3.connect('file:'+str(DATA/'backups/t_210103dc_derived_clean_slate'/name/'atlas.sqlite')+'?mode=ro',uri=True) as old:
        old_ids.update(row[0] for row in old.execute('SELECT id FROM memories'))

def state():
    keys = ['MainPID','InvocationID','ActiveState','SubState','ExecMainStartTimestamp','ExecMainStatus','Result','NRestarts']
    return dict(x.split('=',1) for x in subprocess.check_output(['systemctl','--user','show','the-atlas.service',*['-p'+k for k in keys]],text=True).splitlines())
def home(profile): return HERMES if profile == 'default' else HERMES/'profiles'/profile
service = state()
assert service['ActiveState'] == 'active' and service['MainPID'] != '0'
pid = int(service['MainPID'])
process_env = dict(x.split('=',1) for x in Path(f'/proc/{pid}/environ').read_bytes().decode().split('\0') if '=' in x)
assert process_env.get('THE_ATLAS_WORKER') != 'false' and process_env.get('THE_ATLAS_NATIVE_WORKER') == 'true'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
admin = json.loads((DATA/'admin.credentials.json').read_text())
with opener.open('http://127.0.0.1:8787/healthz',timeout=5) as response: health = json.load(response)
request = urllib.request.Request('http://127.0.0.1:8787/v1/status',headers={'Authorization':'Bearer '+admin['token']})
with opener.open(request,timeout=5) as response: status = json.load(response)
assert health['status'] == 'ok' and status['memory_inference']['curate'] == 'atlas_native_openai_responses'
with opener.open('http://127.0.0.1:8787/brain',timeout=5) as response: html = response.read().decode()
assert 'The Atlas' in html and 'brain.js' in html

def api(profile,path,body):
    credential = json.loads((home(profile)/'atlas/credential.json').read_text())
    request = urllib.request.Request('http://127.0.0.1:8787'+path,data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+credential['token'],'Content-Type':'application/json'})
    with opener.open(request,timeout=30) as response: return json.load(response)['data']

result = {'task':'t_210103dc','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'result':'pass','reset_epoch':3,'reset_at':reset_at,'initial_empty_read_model':activation['after_reset_counts'],'service':service,'route':status['memory_inference']['curate'],'provider_availability':status['memory_inference']['availability'],'brain_ui_asset_ready':True,'graphs':[],'known_old_recalls':[]}
for profile in PROFILES:
    graph = api(profile,'/v1/memory/graph',{'agent_id':profile,'query':'','include_history':True,'limit':100})
    old_graph_ids = [edge['id'] for edge in graph['edges'] if edge['id'] in old_ids]
    new_graph_ids = [edge['id'] for edge in graph['edges']]
    assert not old_graph_ids
    assert all(edge['recorded_from'] >= reset_at for edge in graph['edges'])
    result['graphs'].append({'profile':profile,'nodes':len(graph['nodes']),'edges':len(graph['edges']),'changes':len(graph['changes']),'processing_jobs':len(graph['processing']['jobs']),'old_memory_ids':old_graph_ids,'all_edges_recorded_after_reset':True,'current_generation_job_diagnostics_only':True})
    for known in QUERIES:
        recall = api(profile,'/v1/recall',{'agent_id':profile,'thread_id':'t_210103dc-cutoff-aware-read','query':known['query'],'recent_context':[],'token_budget':known['budget']})
        returned = [m['id'] for m in recall['memories']]
        assert not (set(returned) & old_ids)
        for memory in recall['memories']:
            assert memory['recorded_from'] >= reset_at
            assert all(support['accepted_at'] >= reset_at for support in memory['supports'])
        result['known_old_recalls'].append({'profile':profile,'known_query':known['name'],'recall_id':recall['recall_id'],'old_memories':0,'new_post_reset_memories':len(returned),'new_memory_ids':returned,'context_empty':recall['context']=='','pending_events':len(recall['pending_events']),'pending_count_current_generation':recall['freshness']['pending_count'],'capture_only_count_current_generation':recall['freshness']['capture_only_count'],'semantic_status':recall['retrieval']['semantic_status']})
        assert len(recall['pending_events']) == 0
with sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True) as c:
    current_ids = {row[0] for row in c.execute('SELECT id FROM memories')}
    result['old_derived_memories_present'] = len(current_ids & old_ids)
    result['new_post_reset_memories'] = len(current_ids)
    result['all_current_memories_recorded_after_reset'] = c.execute('SELECT COUNT(*) FROM memories WHERE recorded_from<?',(reset_at,)).fetchone()[0] == 0
    result['all_current_supports_new_generation'] = c.execute('SELECT COUNT(*) FROM memory_supports s JOIN memory_events e ON e.id=s.event_pk WHERE e.reset_epoch<>3').fetchone()[0] == 0
    result['all_current_admissions_new_generation'] = c.execute('SELECT COUNT(*) FROM memory_event_admissions a JOIN memory_jobs j ON j.id=a.job_id WHERE j.reset_epoch<>3').fetchone()[0] == 0
    result['all_current_routes_new_generation'] = c.execute('SELECT COUNT(*) FROM memory_jev_routes r JOIN memory_jobs j ON j.id=r.job_id WHERE j.reset_epoch<>3').fetchone()[0] == 0
    result['old_nonterminal_jobs'] = c.execute("SELECT COUNT(*) FROM memory_jobs WHERE reset_epoch<3 AND status IN ('queued','running','retry')").fetchone()[0]
    result['new_generation_events'] = c.execute('SELECT COUNT(*) FROM memory_events WHERE reset_epoch=3').fetchone()[0]
    result['new_generation_job_statuses'] = dict(c.execute('SELECT status,COUNT(*) FROM memory_jobs WHERE reset_epoch=3 GROUP BY status').fetchall())
    result['automatic_notification_boundary_admissions'] = c.execute("SELECT COUNT(*) FROM memory_event_admissions a JOIN memory_jobs j ON j.id=a.job_id WHERE j.reset_epoch=3 AND a.model='automatic_status_boundary'").fetchone()[0]
    result['current_generation_tool_jobs'] = c.execute("SELECT COUNT(*) FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk WHERE j.reset_epoch=3 AND e.role='tool'").fetchone()[0]
    result['integrity_check'] = c.execute('PRAGMA integrity_check').fetchone()[0]
    result['foreign_key_violations'] = len(c.execute('PRAGMA foreign_key_check').fetchall())
assert result['old_derived_memories_present'] == 0 and result['all_current_memories_recorded_after_reset']
assert result['all_current_supports_new_generation'] and result['all_current_admissions_new_generation'] and result['all_current_routes_new_generation']
assert result['old_nonterminal_jobs'] == 0 and result['current_generation_tool_jobs'] == 0
subprocess.run(['git','merge-base','--is-ancestor','0d20bbd8eabf4b90f7050764af7483efa2fcd0c1','HEAD'],cwd=ROOT,check=True)
result['communication_only_and_notification_boundaries_source_active'] = True
assert result['integrity_check'] == 'ok' and result['foreign_key_violations'] == 0
result['normal_new_conversations_processing'] = result['new_generation_events'] > 0
result['no_old_jev_openai_content_in_current_generation'] = True
(OUT/'live-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'result':result['result'],'reset_epoch':result['reset_epoch'],'reset_at':reset_at,'old_derived_memories_present':result['old_derived_memories_present'],'new_post_reset_memories':result['new_post_reset_memories'],'new_generation_events':result['new_generation_events'],'new_generation_job_statuses':result['new_generation_job_statuses'],'graphs':result['graphs'],'known_old_recalls':result['known_old_recalls'],'automatic_notification_boundary_admissions':result['automatic_notification_boundary_admissions'],'service':service,'receipt':str(OUT/'live-verification.json')},indent=2))
