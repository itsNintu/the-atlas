"""Read-only lookup of the malformed display identity in the private prestate."""
import json
import sqlite3
from pathlib import Path

DB = Path('/home/alex/work/projects/the-atlas/.private/t_aa47fb9a/prestate.sqlite')
NEEDLE = '1568360644204298412'
c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
c.row_factory = sqlite3.Row
result = {
    'events': [dict(r) for r in c.execute('''SELECT id,event_id,thread_id,role,author_id,occurred_at,content,metadata_json
        FROM memory_events WHERE content LIKE ? OR metadata_json LIKE ? ORDER BY occurred_at''', (f'%{NEEDLE}%', f'%{NEEDLE}%'))],
    'entities': [dict(r) for r in c.execute('SELECT * FROM memory_entities WHERE canonical LIKE ?', (f'%{NEEDLE}%',))],
    'aliases': [dict(r) for r in c.execute('SELECT * FROM memory_aliases WHERE alias LIKE ?', (f'%{NEEDLE}%',))],
    'scoped_aliases': [dict(r) for r in c.execute('SELECT * FROM memory_scoped_aliases WHERE alias LIKE ?', (f'%{NEEDLE}%',))],
}
print(json.dumps(result, indent=2, ensure_ascii=False))
c.close()
