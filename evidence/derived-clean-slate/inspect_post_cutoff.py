"""Non-content inspection of new-generation events after the final cutoff."""
import json, sqlite3
from pathlib import Path
c = sqlite3.connect('file:/home/alex/.local/share/the-atlas/atlas.sqlite?mode=ro', uri=True)
c.row_factory = sqlite3.Row
result = {
    'events': [dict(row) for row in c.execute("SELECT agent_id,role,author_id,status,accepted_at,occurred_at,COUNT(*) AS count FROM memory_events WHERE reset_epoch=3 GROUP BY agent_id,role,author_id,status,accepted_at,occurred_at ORDER BY accepted_at")],
    'jobs': [dict(row) for row in c.execute("SELECT status,COUNT(*) AS count FROM memory_jobs WHERE reset_epoch=3 GROUP BY status")],
    'admissions': [dict(row) for row in c.execute("SELECT model,decision,COUNT(*) AS count FROM memory_event_admissions WHERE job_id IN (SELECT id FROM memory_jobs WHERE reset_epoch=3) GROUP BY model,decision")],
    'memories': c.execute('SELECT COUNT(*) FROM memories').fetchone()[0],
    'routes': c.execute('SELECT COUNT(*) FROM memory_jev_routes').fetchone()[0],
}
Path('/home/alex/work/projects/the-atlas/evidence/derived-clean-slate/post-cutoff-events.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result, indent=2))
