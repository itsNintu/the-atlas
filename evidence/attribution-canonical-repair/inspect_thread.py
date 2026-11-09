"""Print the private affected-thread source shapes from the consistent prestate copy."""
import json
import sqlite3
from pathlib import Path

DB = Path('/home/alex/work/projects/the-atlas/.private/t_aa47fb9a/prestate.sqlite')
OUT = DB.parent / 'affected-thread.json'
c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
c.row_factory = sqlite3.Row
rows = [dict(r) for r in c.execute('''SELECT e.id,e.event_id,e.revision,e.agent_id,e.thread_id,e.role,e.author_id,
 e.occurred_at,e.accepted_at,e.processed_at,e.status,e.content,e.metadata_json,e.roots_json,
 j.id AS job_id,j.status AS job_status,j.attempts,j.error_code
 FROM memory_events e LEFT JOIN memory_jobs j ON j.event_pk=e.id
 WHERE e.thread_id=? ORDER BY e.occurred_at,e.accepted_at,e.event_id''', ('20261109_233735_3d6471f2',))]
OUT.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + '\n')
for r in rows:
    print(json.dumps(r, ensure_ascii=False))
print('count', len(rows), 'private', OUT)
c.close()
