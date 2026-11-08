import { test, expect } from 'bun:test';
import { App } from '../src/app.ts';
import { Store, now } from '../src/store.ts';
import { Memory, MemoryWorker } from '../src/memory.ts';

const at = '2026-01-01T00:00:00.000Z';
function fixture() {
  const store = new Store(':memory:'), credential = store.bootstrap('Synthetic communication boundary'), actor = store.authenticate(credential.token);
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
  return { store, actor, credential, memory, worker, inputs, audits, event };
}

const executionAssertion = (event_id: string, object: string, scope: string) => ({
  kind: 'assertion' as const, scope, subject: 'Execution residual', predicate: 'output', object,
  valid_from: at, valid_to: null, importance: .8, confidence: .9, evidence_event_ids: [event_id],
});
function failedExecution(f: ReturnType<typeof fixture>, eventId: string, object: string, scope = 'user:alex') {
  const submitted = f.event(eventId, { thread_id: eventId, role: 'assistant', author_id: 'agent:default', content: object });
  f.store.run("UPDATE memory_events SET role='tool',author_id='tool' WHERE event_id=?", eventId);
  const source = f.store.one('SELECT * FROM memory_events WHERE event_id=?', eventId);
  const memory = f.worker.apply(source, executionAssertion(eventId, object, scope), [1, 0], 'communication-double', [scope]);
  f.store.run("UPDATE memory_jobs SET status='failed',error_code='curator_target_violation',completed_at=? WHERE id=?", now(), submitted.job_id);
  return { job_id: submitted.job_id, source, memory, object, scope };
}
function communicationSupport(f: ReturnType<typeof fixture>, eventId: string, target: ReturnType<typeof failedExecution>, role: 'user' | 'assistant' | 'inter_agent') {
  const author_id = role === 'user' ? 'alex' : role === 'inter_agent' ? 'agent:other' : 'agent:default';
  const submitted = f.event(eventId, { thread_id: eventId, role, author_id, content: target.object });
  const source = f.store.one('SELECT * FROM memory_events WHERE event_id=?', eventId);
  expect(f.worker.apply(source, executionAssertion(eventId, target.object, target.scope), [1, 0], 'communication-double', [target.scope])).toBe(target.memory);
  f.store.run("UPDATE memory_jobs SET status='succeeded',completed_at=? WHERE id=?", now(), submitted.job_id);
  f.store.run("UPDATE memory_events SET status='processed',processed_at=? WHERE id=?", now(), source.id);
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

test('failed current execution sources demote deterministically without provider, retry or base-row mutation and retain restoration semantics', async () => {
  const f = fixture();
  try {
    const shared = failedExecution(f, 'failed-current-shared', 'SYNTHETIC_FAILED_SHARED');
    const privateMemory = f.worker.apply(shared.source, executionAssertion('failed-current-shared', 'SYNTHETIC_FAILED_PRIVATE', 'agent:default'), [1, 0], 'communication-double', ['agent:default']);
    const own = { ...shared, memory: privateMemory, object: 'SYNTHETIC_FAILED_PRIVATE', scope: 'agent:default' };
    const before = now(); await Bun.sleep(3);
    const tables = ['memory_events', 'memory_jobs', 'memories', 'memory_supports', 'memory_versions'];
    const snapshots = Object.fromEntries(tables.map(table => [table, f.store.all(`SELECT * FROM ${table} ORDER BY rowid`)]));

    const sharedReview = await f.memory.reviewAdmission(f.actor, 'default', shared.job_id, shared.memory, 1, 'execution_content_owner_exclusion');
    const privateReview = await f.memory.reviewAdmission(f.actor, 'default', shared.job_id, own.memory, 1, 'execution_content_owner_exclusion');
    expect(sharedReview.demoted).toBe(true); expect(sharedReview.model).toBe('owner_directive');
    expect(privateReview.demoted).toBe(true); expect(privateReview.model).toBe('owner_directive');
    const replay = await f.memory.reviewAdmission(f.actor, 'default', shared.job_id, shared.memory, 1, 'execution_content_owner_exclusion');
    expect(replay.review_id).toBe(sharedReview.review_id); expect(replay.proof_sha256).toBe(sharedReview.proof_sha256);
    expect(f.store.one('SELECT COUNT(*) AS n FROM memory_admission_reviews').n).toBe(2);
    expect(f.store.one('SELECT COUNT(*) AS n FROM memory_admission_demotions').n).toBe(2);
    expect(f.store.one('SELECT job_id,event_pk,memory_id,model FROM memory_admission_reviews WHERE id=?', sharedReview.review_id)).toEqual({ job_id: shared.job_id, event_pk: shared.source.id, memory_id: shared.memory, model: 'owner_directive' });
    for (const target of [shared, own]) {
      const row = f.store.one('SELECT * FROM memories WHERE id=?', target.memory);
      expect(f.memory.effective(row, at, before)).not.toBeNull();
      expect(f.memory.effective(row, at, now())).toBeNull();
    }
    expect(f.inputs).toHaveLength(0); expect(f.audits).toHaveLength(0);
    expect(() => f.memory.retry(f.actor, 'default', shared.job_id)).toThrow('Current memory job not found');
    expect(() => f.memory.reprocess(f.actor, 'default', shared.job_id, 1, 'execution_content_owner_exclusion')).toThrow('communication');
    for (const table of tables) expect(f.store.all(`SELECT * FROM ${table} ORDER BY rowid`)).toEqual(snapshots[table]);
    expect(f.store.one('SELECT COUNT(*) AS n FROM memory_reprocess_requests').n).toBe(0);
    const demotedAt = now();
    for (const target of [shared, own]) expect(f.memory.effective(f.store.one('SELECT * FROM memories WHERE id=?', target.memory), at, demotedAt)).toBeNull();
    await Bun.sleep(3);

    communicationSupport(f, 'later-assistant-shared', shared, 'assistant');
    communicationSupport(f, 'later-assistant-own', own, 'assistant');
    expect(f.memory.effective(f.store.one('SELECT * FROM memories WHERE id=?', shared.memory), at, now())).toBeNull();
    expect(f.memory.effective(f.store.one('SELECT * FROM memories WHERE id=?', own.memory), at, now())).not.toBeNull();
    expect(f.memory.effective(f.store.one('SELECT * FROM memories WHERE id=?', own.memory), at, demotedAt)).toBeNull();
    communicationSupport(f, 'later-user-shared', shared, 'user');
    expect(f.memory.effective(f.store.one('SELECT * FROM memories WHERE id=?', shared.memory), at, now())).not.toBeNull();
    expect(f.memory.effective(f.store.one('SELECT * FROM memories WHERE id=?', shared.memory), at, demotedAt)).toBeNull();
  } finally { f.store.close(); }
});

test('admission-review HTTP returns and replays the persisted owner-directive receipt', async () => {
  const f = fixture();
  const app = new App(f.store);
  app.memory = f.memory;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => app.fetch(request) });
  try {
    const target = failedExecution(f, 'http-receipt', 'SYNTHETIC_HTTP_RECEIPT');
    const key = 'synthetic-admission-review-receipt';
    const body = {
      agent_id: 'default', memory_id: target.memory, expected_revision: 1,
      reason_code: 'execution_content_owner_exclusion',
    };
    const call = async () => {
      const response = await fetch(new URL(`/v1/memory/jobs/${target.job_id}/admission-review`, server.url), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${f.credential.token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as any };
    };

    const first = await call();
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({
      memory_id: target.memory, decision: 'session_context', model: 'owner_directive',
      confidence: 1, demoted: true,
    });
    expect(first.body.data.review_id).toStartWith('admissionreview_');
    expect(first.body.data.proof_sha256).toMatch(/^[a-f0-9]{64}$/);
    const persisted = f.store.one('SELECT response_json FROM idempotency WHERE principal_id=? AND key=?', f.actor.id, key);
    expect(JSON.parse(persisted.response_json)).toEqual(first.body.data);

    const replay = await call();
    expect(replay.status).toBe(200);
    const { idempotent_replay, ...replayedReceipt } = replay.body.data;
    expect(idempotent_replay).toBe(true);
    expect(replayedReceipt).toEqual(first.body.data);
    expect(f.store.one('SELECT response_json FROM idempotency WHERE principal_id=? AND key=?', f.actor.id, key).response_json).toBe(persisted.response_json);
    expect(f.store.one('SELECT COUNT(*) AS n FROM memory_admission_reviews').n).toBe(1);
    expect(f.store.one('SELECT COUNT(*) AS n FROM memory_admission_demotions').n).toBe(1);
    expect(f.inputs).toHaveLength(0); expect(f.audits).toHaveLength(0);
  } finally { await server.stop(true); f.store.close(); }
});

test('failed-current execution demotion retains exact current job, revision, direct support, grant and status fences', async () => {
  const f = fixture();
  try {
    const target = failedExecution(f, 'failed-current-fences', 'SYNTHETIC_FAILED_FENCES');
    const other = failedExecution(f, 'failed-current-other', 'SYNTHETIC_OTHER_SUPPORT');
    expect(() => f.memory.reviewAdmission(f.actor, 'default', target.job_id, target.memory, 1, 'session_local_owner_correction')).toThrow('Only a completed source job');
    expect(() => f.memory.reviewAdmission(f.actor, 'default', target.job_id, target.memory, 2, 'execution_content_owner_exclusion')).toThrow('Memory event revision changed');
    expect(() => f.memory.reviewAdmission(f.actor, 'default', target.job_id, other.memory, 1, 'execution_content_owner_exclusion')).toThrow('Memory with direct source support');

    f.store.run("DELETE FROM memory_grants WHERE principal_id=? AND scope='user:alex' AND action='write'", f.actor.id);
    expect(() => f.memory.reviewAdmission(f.actor, 'default', target.job_id, target.memory, 1, 'execution_content_owner_exclusion')).toThrow('Memory read/write grant required');
    f.store.run("INSERT INTO memory_grants VALUES (?,?,?)", f.actor.id, 'user:alex', 'write');

    f.store.run('UPDATE memory_events SET job_id=? WHERE id=?', other.job_id, target.source.id);
    expect(() => f.memory.reviewAdmission(f.actor, 'default', other.job_id, target.memory, 1, 'execution_content_owner_exclusion')).toThrow('Memory with direct source support');
    const replacement = 'mjob_failed_current_replacement';
    f.store.run("INSERT INTO memory_jobs (id,event_pk,status,available_at,created_at) VALUES (?,?,'queued',?,?)", replacement, target.source.id, Date.now(), now());
    f.store.run('UPDATE memory_events SET job_id=? WHERE id=?', replacement, target.source.id);
    expect(() => f.memory.reviewAdmission(f.actor, 'default', target.job_id, target.memory, 1, 'execution_content_owner_exclusion')).toThrow('Current source job not found');
    expect(() => f.memory.reviewAdmission(f.actor, 'default', replacement, target.memory, 1, 'execution_content_owner_exclusion')).toThrow('Only a completed source job');
    f.store.run("UPDATE memory_jobs SET status='failed',completed_at=? WHERE id=?", now(), replacement);
    f.store.run("UPDATE memory_events SET status='processed',processed_at=? WHERE id=?", now(), target.source.id);
    expect(() => f.memory.reviewAdmission(f.actor, 'default', replacement, target.memory, 1, 'execution_content_owner_exclusion')).toThrow('Only a completed source job');
    expect(f.store.one('SELECT COUNT(*) AS n FROM memory_admission_reviews').n).toBe(0);
    expect(f.store.one('SELECT COUNT(*) AS n FROM memory_admission_demotions').n).toBe(0);
    expect(f.inputs).toHaveLength(0); expect(f.audits).toHaveLength(0);
  } finally { f.store.close(); }
});
