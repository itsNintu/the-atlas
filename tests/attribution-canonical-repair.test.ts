import { expect, test } from 'bun:test';
import { Memory, MemoryWorker } from '../src/memory.ts';
import { Store, now } from '../src/store.ts';

const at = '2026-11-09T16:57:07.532Z';
const remoteTrialReply = `[Replying to: "Retell gives you a proven precedent for that long-cycle hybrid cadence. Is the work trial itself planned as remote too?"]\n\nYeah probably I doubt they want to spend all the money to get me over there for the trial. I'm expecting trial remote and then if things work out well we will do an in person session at some point in the future`;

function fixture(decisions: any[], role: 'user' | 'assistant' | 'inter_agent' = 'user', content = remoteTrialReply) {
  const store = new Store(':memory:');
  const owner = store.bootstrap('Synthetic attribution and canonical repair');
  const actor = store.authenticate(owner.token);
  const inputs: any[] = [];
  const inference = {
    async curate(input: any) { inputs.push(structuredClone(input)); return { decisions }; },
    async embed(texts: string[]) { return { vectors: texts.map(() => [1, 0]), model: 'attribution-double' }; },
  };
  const memory = new Memory(store, inference);
  const worker = new MemoryWorker(store, inference);
  memory.bind(actor, actor.id, 'default');
  const receipt = memory.event(actor, {
    client_id: 'hermes', event_id: 'native:default:synthetic-message:part:0', revision: 1,
    operation: 'upsert', agent_id: 'default', thread_id: 'synthetic-discord-thread', role,
    author_id: role === 'user' ? 'alex' : role === 'assistant' ? 'agent:default' : 'native:kanban:synthetic',
    occurred_at: at, observed_at: now(), content,
    metadata: {
      boundary: role === 'user' ? 'input' : 'assistant_claim_or_attempt', native_source: role === 'inter_agent' ? 'kanban' : 'discord',
      native_author_id: role === 'user' ? '129654325378023424' : undefined,
      platform_message_id: role === 'user' ? '1569395426069844109' : null,
    },
  });
  const source = store.one('SELECT * FROM memory_events WHERE id=(SELECT event_pk FROM memory_jobs WHERE id=?)', receipt.job_id);
  return { store, actor, memory, worker, receipt, source, inputs };
}

function decision(eventId: string, extra: Record<string, unknown> = {}) {
  return {
    kind: 'assertion', scope: 'user:alex', subject: 'Alex', predicate: 'expects_work_trial',
    object: 'Remote initially, followed by an in-person session if the fit is good', object_entity: false,
    valid_from: at, valid_to: null, importance: .8, confidence: .85, evidence_event_ids: [eventId], ...extra,
  };
}

test('a genuine owner tentative plan may be a hypothesis in an authorized owner scope', async () => {
  const f = fixture([decision('native:default:synthetic-message:part:0', { kind: 'hypothesis' })]);
  try {
    expect(await f.worker.runOnce()).toBe(true);
    expect(f.store.one('SELECT status,error_code FROM memory_jobs WHERE id=?', f.receipt.job_id)).toEqual({ status: 'succeeded', error_code: null });
    const rows = f.store.all('SELECT subject,predicate,object,kind,scope FROM memories');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subject: 'Alex', kind: 'hypothesis', scope: 'user:alex', predicate: 'expects_work_trial' });
    expect(f.inputs[0].event.content).toContain('[Replying to:');
  } finally { f.store.close(); }
});

test('attributed owner display IDs canonicalize without a fixture-specific ID exception', async () => {
  const glued = 'Alex98765432101234567';
  const content = `OWNER BLOGGING EXCLUSION — ${glued}/thread1568224793881223341: "We don't use blog functionality in platform features. Remove those". Preserve external-blog marketing and original history.`;
  const f = fixture([
    decision('native:default:synthetic-message:part:0', {
      scope: 'business:alex', subject: glued, predicate: 'excludes',
      object: 'blog functionality from platform features, including building, hosting, native posts, comments, and moderation',
      valid_from: '2026-11-09T02:59:18.944Z',
    }),
  ], 'inter_agent', content);
  try {
    expect(await f.worker.runOnce()).toBe(true);
    const row = f.store.one('SELECT m.*,e.canonical FROM memories m JOIN memory_entities e ON e.id=m.subject_id');
    expect(row.subject).toBe('Alex');
    expect(row.canonical).toBe('Alex');
    expect(f.store.one("SELECT COUNT(*) AS n FROM memory_entity_equivalences q JOIN memory_entities e ON e.id=q.entity_id WHERE e.canonical='Alex' AND q.canonical_id<>q.entity_id").n).toBe(0);
    expect(f.store.one('SELECT content FROM memory_events WHERE id=?', f.source.id).content).toBe(content);
  } finally { f.store.close(); }
});

test('routine assistant status is not stored, while substantive agent knowledge remains eligible', async () => {
  const status = fixture([
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas memory integration',
      predicate: 'assistant_stated_added_test_case', object: 'Add the exact bad packet as a regression case.',
    }),
  ], 'assistant', 'I added the regression case and am checking activation status.');
  try {
    expect(await status.worker.runOnce()).toBe(true);
    expect(status.store.one('SELECT status FROM memory_jobs WHERE id=?', status.receipt.job_id).status).toBe('succeeded');
    expect(status.store.all('SELECT * FROM memories')).toEqual([]);
  } finally { status.store.close(); }

  const substantive = fixture([
    decision('native:default:synthetic-message:part:0', {
      kind: 'hypothesis', scope: 'agent:default', subject: 'Atlas', predicate: 'recommends_for_memory_design',
      object: 'Use entity-centric relationships while retaining source provenance and correction history.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'hypothesis', scope: 'agent:default', subject: 'Atlas', predicate: 'assistant_stated_follow_up_goal',
      object: 'Keep pre-answer recall silent and preserve session-start continuity.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'hypothesis', scope: 'agent:default', subject: 'Atlas recall', predicate: 'reported_location',
      object: 'The supported recall injection lives in the native plugin boundary.',
    }),
  ], 'assistant', 'Durable design knowledge and the owner goal: keep pre-answer recall silent with session-start continuity.');
  try {
    expect(await substantive.worker.runOnce()).toBe(true);
    expect(substantive.store.all('SELECT predicate FROM memories ORDER BY predicate').map((row) => row.predicate)).toEqual([
      'assistant_stated_follow_up_goal', 'recommends_for_memory_design', 'reported_location',
    ]);
  } finally { substantive.store.close(); }
});

test('an assistant hypothesis still cannot become shared owner truth', async () => {
  const f = fixture([decision('native:default:synthetic-message:part:0', { kind: 'hypothesis' })], 'assistant', 'Perhaps Alex wants a remote trial.');
  try {
    expect(await f.worker.runOnce()).toBe(true);
    expect(f.store.one('SELECT status,error_code FROM memory_jobs WHERE id=?', f.receipt.job_id)).toEqual({ status: 'retry', error_code: 'curator_attribution_violation' });
    expect(f.store.all('SELECT * FROM memories')).toEqual([]);
  } finally { f.store.close(); }
});
