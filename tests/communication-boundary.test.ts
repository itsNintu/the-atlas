import { test, expect } from 'bun:test';
import { Store, now } from '../src/store.ts';
import { Memory, MemoryWorker } from '../src/memory.ts';

const at = '2026-01-01T00:00:00.000Z';
function fixture() {
  const store = new Store(':memory:'), actor = store.authenticate(store.bootstrap('Synthetic communication boundary').token);
  const inputs: any[] = [], audits: any[] = [];
  const inference = {
    async curate(input: any) { inputs.push(structuredClone(input)); return { decisions: [{ kind: 'nothing' as const }] }; },
    async audit(input: any) { audits.push(structuredClone(input)); return { choice: 'durable_candidate', confidence: .9, probabilities: { durable_candidate: .9, other: .1 }, model: 'jev-double', elapsed_ms: 1, usage: { input_tokens: 1, output_tokens: 1 } }; },
    async embed(texts: string[]) { return { vectors: texts.map(() => [1, 0]), model: 'communication-double' }; },
  };
  const memory = new Memory(store, inference), worker = new MemoryWorker(store, inference);
  memory.bind(actor, actor.id, 'default');
  const event = (event_id: string, extra: any = {}) => memory.event(actor, {
    client_id: 'communication', event_id, revision: 1, operation: 'upsert', agent_id: 'default', thread_id: event_id,
    role: 'user', author_id: 'alex', occurred_at: at, observed_at: now(), content: `Fictional communication ${event_id}`, metadata: {}, ...extra,
  });
  return { store, actor, memory, worker, inputs, audits, event };
}

test('admission accepts only Alex/agent and agent/agent communication and creates no tool-event source or job', async () => {
  const f = fixture();
  try {
    expect(() => f.event('execution-feed', { role: 'tool', author_id: 'tool', content: 'execution output must not be admitted' })).toThrow('Invalid event role');
    expect(f.store.one('SELECT COUNT(*) AS n FROM memory_events').n).toBe(0);
    expect(f.store.one('SELECT COUNT(*) AS n FROM memory_jobs').n).toBe(0);
    for (const [role, author_id] of [['user', 'alex'], ['assistant', 'agent:default'], ['inter_agent', 'agent:other']])
      f.event(role, { role, author_id, thread_id: 'communication' });
    for (let n = 0; n < 3; n++) await f.worker.runOnce();
    expect(f.inputs.map((input: any) => input.event.role).sort()).toEqual(['assistant', 'inter_agent', 'user']);
    expect(f.store.one("SELECT COUNT(*) AS n FROM memory_jobs WHERE status='succeeded'").n).toBe(3);
    expect(f.audits.every((audit: any) => ['user', 'assistant', 'inter_agent'].includes(audit.latest.role))).toBe(true);
  } finally { f.store.close(); }
});

test('legacy execution rows stay unchanged and unclaimed, never enter provider context, and support proof-bound demotion', async () => {
  const f = fixture();
  try {
    const legacy = f.event('legacy-execution', { thread_id: 'shared', content: 'SYNTHETIC_EXECUTION_OUTPUT_SECRET' });
    f.store.run("UPDATE memory_events SET role='tool',author_id='tool' WHERE event_id='legacy-execution'");
    const source = f.store.one("SELECT * FROM memory_events WHERE event_id='legacy-execution'");
    const memoryId = f.worker.apply(source, {
      kind: 'assertion', scope: 'user:alex', subject: 'Legacy execution', predicate: 'output', object: 'SYNTHETIC_TOOL_ONLY_MEMORY',
      valid_from: at, valid_to: null, importance: .8, confidence: .9, evidence_event_ids: ['legacy-execution'],
    }, [1, 0], 'communication-double', ['user:alex']);
    const privateMemoryId = f.worker.apply(source, {
      kind: 'episode', scope: 'agent:default', subject: 'Agent legacy execution', predicate: 'observed', object: 'SYNTHETIC_PRIVATE_TOOL_MEMORY',
      valid_from: at, valid_to: null, importance: .8, confidence: .9, evidence_event_ids: ['legacy-execution'],
    }, [1, 0], 'communication-double', ['agent:default']);
    f.store.run("UPDATE memory_jobs SET status='succeeded',completed_at=? WHERE id=?", now(), legacy.job_id);
    f.store.run("UPDATE memory_events SET status='processed',processed_at=? WHERE id=?", now(), source.id);
    const queued = f.event('queued-execution', { thread_id: 'queued', content: 'SYNTHETIC_QUEUED_EXECUTION' });
    f.store.run("UPDATE memory_events SET role='tool',author_id='tool' WHERE event_id='queued-execution'");
    const legacyJob = f.store.one('SELECT * FROM memory_jobs WHERE id=?', legacy.job_id), queuedJob = f.store.one('SELECT * FROM memory_jobs WHERE id=?', queued.job_id);

    const latest = f.event('latest-communication', { thread_id: 'shared', content: 'Alex asks about SYNTHETIC_TOOL_ONLY_MEMORY in communication' });
    await f.worker.runOnce();
    expect(f.store.one('SELECT status FROM memory_jobs WHERE id=?', latest.job_id).status).toBe('succeeded');
    expect(f.audits).toHaveLength(1); expect(f.audits[0].previous).toEqual([]);
    expect(f.inputs).toHaveLength(1); expect(f.inputs[0].recent_events).toEqual([]); expect(f.inputs[0].candidates).toEqual([]);
    expect(JSON.stringify(f.audits[0])).not.toContain('SYNTHETIC_EXECUTION_OUTPUT_SECRET');
    expect(JSON.stringify(f.inputs[0].recent_events)).not.toContain('SYNTHETIC_EXECUTION_OUTPUT_SECRET');
    expect(JSON.stringify(f.inputs[0].candidates)).not.toContain('SYNTHETIC_TOOL_ONLY_MEMORY');
    expect(await f.worker.runOnce()).toBe(false);
    expect(f.store.one('SELECT * FROM memory_jobs WHERE id=?', queued.job_id)).toEqual(queuedJob);
    expect(f.store.one('SELECT * FROM memory_event_admissions WHERE job_id=?', queued.job_id)).toBeNull();
    expect(() => f.memory.reprocess(f.actor, 'default', legacy.job_id, 1, 'execution_content_owner_exclusion')).toThrow('communication');

    const review = await f.memory.reviewAdmission(f.actor, 'default', legacy.job_id, memoryId, 1, 'execution_content_owner_exclusion');
    expect(review.demoted).toBe(true); expect(review.model).toBe('owner_directive');
    expect(f.memory.effective(f.store.one('SELECT * FROM memories WHERE id=?', memoryId), at, now())).toBeNull();
    const privateReview = await f.memory.reviewAdmission(f.actor, 'default', legacy.job_id, privateMemoryId, 1, 'execution_content_owner_exclusion');
    expect(privateReview.demoted).toBe(true);
    expect(f.memory.effective(f.store.one('SELECT * FROM memories WHERE id=?', privateMemoryId), at, now())).toBeNull();
    expect(f.store.one('SELECT * FROM memory_jobs WHERE id=?', legacy.job_id)).toEqual(legacyJob);
    expect(f.store.one('SELECT content FROM memory_events WHERE id=?', source.id).content).toBe('SYNTHETIC_EXECUTION_OUTPUT_SECRET');
  } finally { f.store.close(); }
});
