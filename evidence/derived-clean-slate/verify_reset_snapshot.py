"""Verify the graph read model at the exact empty reset snapshot, before new traffic."""
import json, urllib.request
from pathlib import Path
OUT = Path('/home/alex/work/projects/the-atlas/evidence/derived-clean-slate')
reset_at = json.loads((OUT/'activation.json').read_text())['reset']['reset_at']
HERMES = Path('/mnt/c/Users/alexb/AppData/Local/hermes')
rows = []
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for profile in ['default','builder','reaver','overwatch','wordsmith','orchestrator']:
    home = HERMES if profile == 'default' else HERMES/'profiles'/profile
    credential = json.loads((home/'atlas/credential.json').read_text())
    body = {'agent_id':profile,'query':'','include_history':True,'limit':100,'valid_at':reset_at,'recorded_at':reset_at}
    request = urllib.request.Request('http://127.0.0.1:8787/v1/memory/graph',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+credential['token'],'Content-Type':'application/json'})
    with opener.open(request,timeout=30) as response: graph = json.load(response)['data']
    row = {'profile':profile,'snapshot':graph['snapshot'],'nodes':len(graph['nodes']),'edges':len(graph['edges']),'changes':len(graph['changes']),'scopes':graph['scopes']}
    assert row['nodes'] == 0 and row['edges'] == 0 and row['changes'] == 0
    rows.append(row)
result = {'result':'pass','reset_at':reset_at,'profiles':rows,'note':'Exact graph/UI read-model snapshot at reset completion; later genuine new-conversation nodes are separate.'}
(OUT/'graph-reset-snapshot.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
