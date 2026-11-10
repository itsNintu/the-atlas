"""Read-only hosted inventory of operational-looking active graph predicates.

No source excerpts, memory objects, credentials, or raw event content are written.
"""
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path('/home/alex/work/projects/the-atlas')
OUT = ROOT / 'evidence/operational-memory-bloat'
URL = 'https://atlas.creator.gg'
PROFILES = ['default', 'builder', 'overwatch', 'wordsmith', 'orchestrator', 'reaver']
QUERIES = [
    'reports_builder_task_running', 'plans_to_route_deployment',
    'plans_to_check_and_route', 'reported_adding_requirement_to_builder_task',
    'reported_builder_status', 'assistant_reported_repair_status',
    'assistant_reported_graph_result_limit', 'task', 'routing', 'route',
    'progress', 'implementation', 'test', 'audit', 'deployment', 'repair',
    'status', 'reported', 'plans_to', 'reports_', 'checking',
]

def credential(profile):
    base = Path('/mnt/c/Users/alexb/AppData/Local/hermes')
    path = base / 'atlas/credential.json' if profile == 'default' else base / 'profiles' / profile / 'atlas/credential.json'
    return json.loads(path.read_text())['token']

def post(token, path, body):
    request = urllib.request.Request(URL + path, data=json.dumps(body).encode(), method='POST', headers={
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'Hermes-Atlas/1.2.6',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)['data']

def main():
    edges = {}
    scans = []
    for profile in PROFILES:
        token = credential(profile)
        for query in QUERIES:
            data = post(token, '/v1/memory/graph', {
                'agent_id': profile, 'query': query, 'include_history': False, 'limit': 100,
            })
            scans.append({'agent_id': profile, 'query': query, 'edges': len(data['edges']), 'truncated': data['truncated']})
            for edge in data['edges']:
                prior = edges.get(edge['id'])
                record = {
                    'id': edge['id'], 'predicate': edge['predicate'], 'scope': edge['scope'],
                    'status': edge['status'], 'sources': [{
                        'event_id': source.get('event_id'), 'job_id': source.get('job_id'),
                        'revision': source.get('revision'), 'role': source.get('role'),
                        'author_id': source.get('author_id'), 'agent_id': source.get('agent_id'),
                    } for source in edge.get('sources') or []],
                    'visible_to': sorted(set((prior or {}).get('visible_to', []) + [profile])),
                    'matched_queries': sorted(set((prior or {}).get('matched_queries', []) + [query])),
                }
                edges[edge['id']] = record
            time.sleep(0.03)
    result = {
        'endpoint': URL, 'mode': 'read_only_active_graph_inventory',
        'raw_content_included': False, 'credentials_included': False,
        'queries': QUERIES, 'scans': scans, 'unique_edges': len(edges),
        'edges': sorted(edges.values(), key=lambda edge: (edge['scope'], edge['predicate'], edge['id'])),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'hosted-baseline.json').write_text(json.dumps(result, indent=2) + '\n')
    counts = {}
    for edge in edges.values():
        counts[edge['predicate']] = counts.get(edge['predicate'], 0) + 1
    print(json.dumps({'unique_edges': len(edges), 'predicate_counts': dict(sorted(counts.items()))}, indent=2))

if __name__ == '__main__':
    main()
