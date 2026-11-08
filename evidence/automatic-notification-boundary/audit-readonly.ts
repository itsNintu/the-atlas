import { Database } from 'bun:sqlite';
import { automaticStatusNotification } from '../../src/memory-admission.ts';

const [dbPath, outPath] = process.argv.slice(2);
if (!dbPath || !outPath) throw new Error('usage: audit-readonly.ts DB OUT');
const db = new Database(dbPath, { readonly: true });
db.run('PRAGMA query_only=ON');
const rows = db.query(`SELECT m.id AS memory_id,m.scope,m.recorded_from,
  s.event_pk,e.event_id,e.revision,e.agent_id,e.thread_id,e.role,e.author_id,e.content,e.metadata_json,
  e.status AS event_status,e.accepted_at,e.job_id AS current_job_id,j.status AS job_status,
  CASE WHEN h.event_pk IS NOT NULL THEN 1 ELSE 0 END AS current_head,
  CASE WHEN d.memory_id IS NOT NULL THEN 1 ELSE 0 END AS already_demoted
  FROM memories m JOIN memory_supports s ON s.memory_id=m.id JOIN memory_events e ON e.id=s.event_pk
  LEFT JOIN memory_heads h ON h.event_pk=e.id LEFT JOIN memory_jobs j ON j.id=e.job_id AND j.event_pk=e.id
  LEFT JOIN memory_admission_demotions d ON d.memory_id=m.id
  ORDER BY m.id,e.accepted_at,e.rowid`).all() as any[];
const grouped = new Map<string, any>();
for (const row of rows) {
  const item = grouped.get(row.memory_id) ?? { memory_id: row.memory_id, scope: row.scope, already_demoted: !!row.already_demoted, supports: [] };
  item.supports.push({
    event_pk: row.event_pk, event_id: row.event_id, revision: row.revision, agent_id: row.agent_id,
    role: row.role, event_status: row.event_status, job_id: row.current_job_id, job_status: row.job_status,
    current_head: !!row.current_head, automatic: automaticStatusNotification(row),
  });
  grouped.set(row.memory_id, item);
}
const reviewSource = (item: any) => item.supports.find((source: any) => source.current_head && source.job_id &&
  ((source.event_status === 'processed' && source.job_status === 'succeeded') ||
   (source.event_status === 'pending' && source.job_status === 'failed')));
const candidates = [...grouped.values()].filter((item: any) => !item.already_demoted && item.supports.length > 0 &&
  item.supports.every((source: any) => source.automatic)).map((item: any) => {
    const source = reviewSource(item);
    return {
      memory_id: item.memory_id, scope: item.scope, support_count: item.supports.length,
      reviewable: !!source,
      source: source ? { event_pk: source.event_pk, event_id: source.event_id, revision: source.revision,
        agent_id: source.agent_id, job_id: source.job_id, event_status: source.event_status, job_status: source.job_status } : null,
    };
  });
const prefixes = ['memory_78c9e372','memory_3577584f','memory_0395458a','memory_3af8444d','memory_23f92c66'];
const reported = prefixes.map(prefix => {
  const item = [...grouped.values()].find((entry: any) => entry.memory_id.startsWith(prefix));
  const candidate = candidates.find((entry: any) => entry.memory_id.startsWith(prefix));
  return { prefix, memory_id: item?.memory_id ?? null, found: !!item, already_demoted: item?.already_demoted ?? null,
    support_count: item?.supports.length ?? 0, all_supports_automatic: item ? item.supports.every((source: any) => source.automatic) : false,
    reviewable: candidate?.reviewable ?? false, source: candidate?.source ?? null };
});
const receipt = {
  at: new Date().toISOString(), database: 'readonly/query_only', classifier: 'automaticStatusNotification',
  candidate_count: candidates.length, reviewable_count: candidates.filter((item: any) => item.reviewable).length,
  unreviewable_count: candidates.filter((item: any) => !item.reviewable).length,
  candidates, reported,
};
await Bun.write(outPath, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ candidate_count: receipt.candidate_count, reviewable_count: receipt.reviewable_count,
  unreviewable_count: receipt.unreviewable_count, reported }, null, 2));
db.close();
