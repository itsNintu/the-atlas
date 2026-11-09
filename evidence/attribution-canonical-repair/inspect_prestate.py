"""Private, read-only Atlas prestate snapshot and targeted audit. No credentials."""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/home/alex/work/projects/the-atlas')
OUT = ROOT / 'evidence/attribution-canonical-repair'
PRIVATE = ROOT / '.private/t_aa47fb9a'
DB = Path('/home/alex/.local/share/the-atlas/atlas.sqlite')
SNAPSHOT = PRIVATE / 'prestate.sqlite'
JOB = 'mjob_811b3150-0eca-4f0b-912c-0c4e00b91232'
EVENT = 'native:default:48ec91b40bde4396970d03a36a260f72:part:0'
MEMORIES = [
    'memory_6a2370ed-7b78-4592-95d8-7c3560017e25',
    'memory_cc3f1afb-d6f3-4ea7-ae18-5734d9d5b8da',
    'memory_e0ffec92-44bb-4152-9cbb-830b9d1efadb',
    'memory_5142ea16-6549-4f80-a28f-01c9292e8c71',
]
OUT.mkdir(parents=True, exist_ok=True)
PRIVATE.mkdir(parents=True, exist_ok=True)
for suffix in ('', '-wal', '-shm'):
    p = Path(str(SNAPSHOT) + suffix)
    if p.exists():
        p.unlink()
source = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
dest = sqlite3.connect(SNAPSHOT)
source.backup(dest)
dest.close()
source.close()


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


c = sqlite3.connect(f'file:{SNAPSHOT}?mode=ro', uri=True)
c.row_factory = sqlite3.Row


def rows(sql: str, args=()):
    return [dict(r) for r in c.execute(sql, args)]


def one(sql: str, args=()):
    r = c.execute(sql, args).fetchone()
    return dict(r) if r else None


def without_large(value):
    if isinstance(value, list):
        return [without_large(v) for v in value]
    if not isinstance(value, dict):
        return value
    return {k: without_large(v) for k, v in value.items()
            if k not in {'embedding_json', 'content', 'roots_json', 'causal_json'}}


tables = [r['name'] for r in rows("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
schema = {t: rows(f'PRAGMA table_info({t})') for t in tables if t.startswith('memory_') or t in {'memories'}}

job = one('SELECT * FROM memory_jobs WHERE id=?', (JOB,))
event = one('SELECT * FROM memory_events WHERE job_id=? OR (event_id=? AND agent_id=?)', (JOB, EVENT, 'default'))
reported = []
for memory_id in MEMORIES:
    m = one('SELECT * FROM memories WHERE id=?', (memory_id,))
    if not m:
        reported.append({'id': memory_id, 'present': False})
        continue
    m.pop('embedding_json', None)
    m['present'] = True
    m['supports'] = rows('''SELECT s.*,e.client_id,e.event_id,e.revision,e.role,e.author_id,e.agent_id,
        e.thread_id,e.occurred_at,e.accepted_at,e.processed_at,e.status,e.job_id,j.status AS job_status,
        j.error_code,j.attempts FROM memory_supports s JOIN memory_events e ON e.id=s.event_pk
        LEFT JOIN memory_jobs j ON j.event_pk=e.id WHERE s.memory_id=? ORDER BY e.accepted_at,e.event_id''', (memory_id,))
    m['changes'] = rows('''SELECT ch.*,e.event_id,e.revision,e.role,e.author_id,e.agent_id
        FROM memory_changes ch JOIN memory_events e ON e.id=ch.event_pk
        WHERE ch.target_id=? OR ch.replacement_id=? ORDER BY ch.recorded_at,ch.id''', (memory_id, memory_id))
    m['entity_target'] = one('SELECT * FROM memory_entity_targets WHERE memory_id=?', (memory_id,))
    m['sources'] = rows('''SELECT DISTINCT e.* FROM memory_events e
        WHERE e.id IN (SELECT event_pk FROM memory_supports WHERE memory_id=?)
        OR e.id IN (SELECT event_pk FROM memory_changes WHERE target_id=? OR replacement_id=?)
        ORDER BY e.accepted_at,e.event_id''', (memory_id, memory_id, memory_id))
    reported.append(m)

malformed = rows('''SELECT id,scope,kind,subject,subject_id,predicate,object,valid_from,valid_to,
    recorded_from,derived,version FROM memories
    WHERE subject GLOB 'Alex[0-9]*' OR object GLOB 'Alex[0-9]*'
       OR subject_id IN (SELECT id FROM memory_entities WHERE canonical GLOB 'Alex[0-9]*')
    ORDER BY scope,subject,predicate,id''') if 'memory_entities' in tables else rows('''SELECT id,scope,kind,subject,subject_id,predicate,object,valid_from,valid_to,
    recorded_from,derived,version FROM memories
    WHERE subject GLOB 'Alex[0-9]*' OR object GLOB 'Alex[0-9]*' ORDER BY scope,subject,predicate,id''')

operational = rows('''SELECT id,scope,kind,subject,subject_id,predicate,object,valid_from,valid_to,
    recorded_from,derived,version FROM memories
    WHERE lower(predicate) GLOB '*assistant*' OR lower(predicate) GLOB '*reported*'
       OR lower(predicate) GLOB '*test*' OR lower(predicate) GLOB '*audit*'
       OR lower(predicate) GLOB '*activation*' OR lower(predicate) GLOB '*recall*'
       OR lower(predicate) GLOB '*regression*' OR lower(predicate) GLOB '*assessed*'
       OR lower(predicate) GLOB '*task*' OR lower(predicate) GLOB '*implementation*'
    ORDER BY scope,subject,predicate,id''')

blog = rows('''SELECT id,scope,kind,subject,subject_id,predicate,object,valid_from,valid_to,
    recorded_from,derived,version FROM memories
    WHERE lower(subject||' '||predicate||' '||object) GLOB '*blog*'
    ORDER BY scope,subject,predicate,object,id''')

entities = {}
for table in ('memory_entities', 'memory_entity_targets', 'memory_scoped_aliases', 'memory_alias_sources', 'memory_entity_equivalences'):
    if table in tables:
        entities[table] = rows(f'SELECT * FROM {table} ORDER BY rowid')

# Broad relationship candidates are kept private for classification, not public evidence.
relations = rows('''SELECT id,scope,kind,subject,subject_id,predicate,object,valid_from,valid_to,
    recorded_from,derived,version FROM memories
    WHERE lower(subject||' '||predicate||' '||object) GLOB '*paradev*'
       OR lower(subject||' '||predicate||' '||object) GLOB '*retell*'
       OR lower(subject||' '||predicate||' '||object) GLOB '*remote*'
       OR lower(subject||' '||predicate||' '||object) GLOB '*trial*'
       OR lower(subject||' '||predicate||' '||object) GLOB '*interview*'
       OR lower(subject||' '||predicate||' '||object) GLOB '*ghost*'
       OR lower(subject||' '||predicate||' '||object) GLOB '*nona*'
       OR lower(subject||' '||predicate||' '||object) GLOB '*lia*'
    ORDER BY scope,subject,predicate,id''')

job_related = {
    'job': job,
    'event': event,
    'metrics': rows('SELECT * FROM memory_curation_metrics WHERE job_id=? ORDER BY created_at', (JOB,)),
    'reconciliations': rows('SELECT * FROM memory_reconciliations WHERE job_id=? ORDER BY rowid', (JOB,)) if 'memory_reconciliations' in tables else [],
    'admissions': rows('SELECT * FROM memory_event_admissions WHERE job_id=? ORDER BY rowid', (JOB,)) if 'memory_event_admissions' in tables else [],
    'routes': rows('SELECT * FROM memory_jev_routes WHERE job_id=? ORDER BY rowid', (JOB,)) if 'memory_jev_routes' in tables else [],
    'reprocess': rows('SELECT * FROM memory_reprocess_requests WHERE job_id=? OR previous_job_id=?', (JOB, JOB)) if 'memory_reprocess_requests' in tables else [],
}

private = {
    'at': datetime.now(timezone.utc).isoformat(),
    'snapshot': str(SNAPSHOT),
    'snapshot_sha256': sha(SNAPSHOT),
    'quick_check': c.execute('PRAGMA quick_check').fetchone()[0],
    'tables': tables,
    'schema': schema,
    'job_related': job_related,
    'reported_memories': reported,
    'malformed': malformed,
    'operational_candidates': operational,
    'blog_candidates': blog,
    'entities': entities,
    'relationship_candidates': relations,
    'current_epoch': one('SELECT * FROM derived_brain_reset_state WHERE singleton=1'),
    'job_counts': rows('SELECT status,COUNT(*) AS count FROM memory_jobs WHERE reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1) GROUP BY status'),
    'provider_holds': rows('SELECT provider,reason,upstream_status,upstream_category,hold_until,created_at,updated_at FROM memory_provider_holds'),
}
(PRIVATE / 'prestate-audit.json').write_text(json.dumps(private, indent=2, ensure_ascii=False) + '\n')

# Public/nonsecret evidence contains counts and opaque identities only, never source bodies or memory text.
public = {
    'at': private['at'],
    'mode': 'consistent_sqlite_readonly_backup_then_readonly_audit',
    'snapshot_sha256': private['snapshot_sha256'],
    'quick_check': private['quick_check'],
    'job': without_large(job),
    'event': without_large(event),
    'reported_memories': [{k: v for k, v in without_large(m).items() if k not in {'object', 'supports', 'changes', 'sources'}} | {
        'support_count': len(m.get('supports', [])),
        'change_count': len(m.get('changes', [])),
        'source_count': len(m.get('sources', [])),
    } for m in reported],
    'candidate_counts': {
        'malformed': len(malformed),
        'operational_broad_candidates': len(operational),
        'blog_broad_candidates': len(blog),
        'relationship_broad_candidates': len(relations),
    },
    'current_epoch': private['current_epoch'],
    'job_counts': private['job_counts'],
    'provider_holds': private['provider_holds'],
}
(OUT / 'prestate-summary.json').write_text(json.dumps(public, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({
    'snapshot': str(SNAPSHOT),
    'snapshot_sha256': private['snapshot_sha256'],
    'quick_check': private['quick_check'],
    'job': without_large(job),
    'event': without_large(event),
    'candidate_counts': public['candidate_counts'],
    'reported': public['reported_memories'],
    'private_audit': str(PRIVATE / 'prestate-audit.json'),
}, indent=2, ensure_ascii=False))
c.close()
