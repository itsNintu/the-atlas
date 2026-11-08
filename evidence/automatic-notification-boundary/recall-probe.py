"""Read-only semantic recall probe; credential is used only in memory, never emitted."""
import datetime, hashlib, json, sys, urllib.request
from pathlib import Path
ROOT = Path('/home/alex/work/projects/the-atlas')
OUT = ROOT / 'evidence/automatic-notification-boundary'
budget = int(sys.argv[1]) if len(sys.argv) > 1 else 1072
credential = json.loads(Path('/mnt/c/Users/alexb/AppData/Local/hermes/atlas/credential.json').read_text())
query = ('There is nothing useful for the brain in events, tasks or tool calls. This is communication only. '
         'Exclude automatic status notifications from Atlas durable communication memory; preserve genuine Alex '
         'and agent-to-agent discussion. What is the current relevant communication requirement for task t_cb043bca?')
body = {'agent_id': 'default', 'thread_id': 't_cb043bca-notification-verification', 'query': query,
        'recent_context': [], 'token_budget': budget}
request = urllib.request.Request('http://127.0.0.1:8787/v1/recall', data=json.dumps(body).encode(), method='POST',
    headers={'Authorization': 'Bearer ' + credential['token'], 'Content-Type': 'application/json', 'Idempotency-Key': f't_cb043bca-recall-probe-v1-{budget}'})
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
with opener.open(request, timeout=30) as response:
    result = json.load(response)['data']
receipt = {
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'query_sha256': hashlib.sha256(query.encode()).hexdigest(),
    'query': query, 'recall_id': result['recall_id'], 'memory_ids': [m['id'] for m in result['memories']],
    'tokens_used': result['tokens_used'], 'token_budget': result['token_budget'],
    'pending_included': result['freshness']['pending_included'], 'pending_events_count': len(result['pending_events']),
    'semantic_status': result['retrieval']['semantic_status'], 'service_ms': result['retrieval']['service_ms'],
    'context_sha256': hashlib.sha256(result['context'].encode()).hexdigest(),
}
path = OUT / f'recall-probe-{budget}.json'
path.write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
