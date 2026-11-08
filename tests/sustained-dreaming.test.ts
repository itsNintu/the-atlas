import { test, expect } from 'bun:test';
import { Store, id, now } from '../src/store.ts';
import { Memory, MemoryWorker } from '../src/memory.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const at = '2026-01-01T00:00:00.000Z';
const answer = (choice: string) => ({ choice, confidence: .9, probabilities: { [choice]: .9, other: .1 }, model: 'jev-double', elapsed_ms: 1, usage: { input_tokens: 1, output_tokens: 1 } });
function fixture(path = ':memory:') {
  const s = new Store(path), b = s.bootstrap('Fictional sustained dreaming regression'), a = s.authenticate(b.token);
  const inputs: any[] = [], audits: any[] = [], areas: any[] = [], relationships: any[] = [];
  let admission = (content: string) => content.includes('session instruction') ? 'session_context' : content.includes('session fact') ? 'session_episode' : content.includes('noise') ? 'noise' : 'durable_candidate';
  const inf = {
    async curate(i: any) { inputs.push(structuredClone(i)); return { decisions: [{ kind: 'nothing' as const }] }; },
    async audit(i: any) { audits.push(structuredClone(i)); return answer(admission(i.latest.content)); },
    async routeGraphArea(i: any) { areas.push(structuredClone(i)); return answer(i.areas.length ? 'area_0' : 'uncertain'); },
    async auditRelationship(i: any) { relationships.push(structuredClone(i)); return answer(i.candidate.object.includes('unrelated') ? 'irrelevant' : 'relevant'); },
    async embed(texts: string[]) { return { vectors: texts.map(() => [1, 0]), model: 'sustained-double' }; },
  };
  const m = new Memory(s, inf), w = new MemoryWorker(s, inf); m.bind(a, a.id, 'default');
  const event = (event_id: string, extra: any = {}) => m.event(a, {
    client_id: 'sustained', event_id, revision: 1, operation: 'upsert', agent_id: 'default', thread_id: 'owner',
    role: 'user', author_id: 'alex', occurred_at: at, observed_at: now(), content: 'Fictional owner evidence', metadata: {}, ...extra,
  });
  const legacyJob = (event_id: string) => {
    const e = s.one('SELECT * FROM memory_events WHERE event_id=?', event_id);
    if (e.job_id) return e.job_id;
    const job = id('mjob');
    s.run("INSERT INTO memory_jobs (id,event_pk,status,available_at,created_at) VALUES (?,?,'queued',?,?)", job, e.id, Date.now(), e.accepted_at);
    s.run("UPDATE memory_events SET status='pending',job_id=? WHERE id=?", job, e.id);
    return job;
  };
  const seed = (event_id: string, object = 'Fictional shared preference', scope = 'user:alex') => {
    event(event_id, { content: object });
    const e = s.one('SELECT * FROM memory_events WHERE event_id=?', event_id);
    const memory = w.apply(e, { kind: 'assertion', scope, subject: 'Alex', predicate: 'instruction', object, valid_from: at, valid_to: null, importance: .8, confidence: .9, evidence_event_ids: [event_id] }, [1, 0], 'sustained-double', [scope]);
    s.run("UPDATE memory_jobs SET status='succeeded',completed_at=? WHERE id=?", now(), e.job_id);
    s.run("UPDATE memory_events SET status='processed',processed_at=? WHERE id=?", now(), e.id);
    return { e, memory };
  };
  return { s, a, b, m, w, inf, inputs, audits, areas, relationships, event, legacyJob, seed, setAdmission: (fn: any) => { admission = fn; } };
}

test('JEV filters only complete context/noise; truncated negatives and useful session episodes reach Luna', async () => {
  const f = fixture();
  try {
    const long = f.event('long-noise', { role: 'tool', author_id: 'tool', content: 'noise '.repeat(5000) });
    const question = f.event('assistant-context', { role: 'assistant', author_id: 'agent:default', content: 'Which fictional detail matters?' });
    f.setAdmission((content: string) => content.includes('Which fictional') ? 'noise' : content.includes('session instruction') ? 'session_context' : content.includes('session fact') ? 'session_episode' : content.includes('noise') ? 'noise' : 'durable_candidate');
    const instruction = f.event('session-instruction', { content: 'For this session instruction only, ask one question at a time.' });
    const session = f.event('session-fact', { content: 'A useful session fact about the fictional task.' });
    const durable = f.event('durable', { content: 'A durable fictional owner preference.' });
    for (let n = 0; n < 12; n++) await f.w.runOnce();
    expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?', long.job_id).status).toBe('succeeded');
    expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?', question.job_id).status).toBe('skipped');
    expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?', instruction.job_id).status).toBe('skipped');
    expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?', session.job_id).status).toBe('succeeded');
    expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?', durable.job_id).status).toBe('succeeded');
    expect(new Set(f.inputs.map((i: any) => i.event.event_id))).toEqual(new Set(['long-noise', 'session-fact', 'durable']));
    expect(f.inputs.find((i: any) => i.event.event_id === 'session-fact').jev.admission).toBe('session_episode');
    expect(f.s.one("SELECT length(content) n FROM memory_events WHERE event_id='long-noise'").n).toBe(30_000);
    expect(f.s.one('SELECT COUNT(*) n FROM memory_event_admissions').n).toBe(5);
  } finally { f.s.close(); }
});

test('capture-filtered source supports audited reconsideration without changing old history', async () => {
  const f = fixture();
  try {
    const r = f.event('filtered', { content: 'For this session instruction only, ask one question at a time.' });
    await f.w.runOnce();
    expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?', r.job_id).status).toBe('skipped');
    const before = f.s.one('SELECT * FROM memory_jobs WHERE id=?', r.job_id), source = f.s.one('SELECT * FROM memory_events WHERE id=(SELECT event_pk FROM memory_jobs WHERE id=?)', r.job_id);
    f.setAdmission(() => 'durable_candidate');
    const reconsider = f.m.reprocess(f.a, 'default', r.job_id, 1, 'admission_context_reconsider');
    expect(reconsider.reconsidered).toBe(true); await f.w.runOnce();
    expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?', reconsider.job_id).status).toBe('succeeded');
    expect(f.s.one('SELECT * FROM memory_jobs WHERE id=?', r.job_id)).toEqual(before);
    expect(f.s.one('SELECT previous_captured_at FROM memory_reconsider_requests WHERE job_id=?', reconsider.job_id).previous_captured_at).toBe(source.accepted_at);
    expect(f.s.one('SELECT content FROM memory_events WHERE id=?', source.id).content).toBe(source.content);
  } finally { f.s.close(); }
});

test('graph-area and each relationship use separate typed calls and only irrelevant candidates are removed', async () => {
  const f = fixture();
  try {
    const seeded = f.seed('prior', 'Fictional unrelated candidate', 'agent:default');
    f.event('latest', { content: 'Durable fictional owner preference.' });
    await f.w.runOnce();
    expect(f.areas).toHaveLength(1); expect(f.relationships.length).toBeGreaterThan(0);
    for (const call of f.relationships) expect(Object.keys(call.candidate)).toEqual(['id', 'scope', 'subject', 'predicate', 'object', 'valid_from', 'valid_to']);
    expect(f.inputs[0].candidates.map((c: any) => c.id)).not.toContain(seeded.memory);
    expect(f.s.one("SELECT COUNT(*) n FROM memory_jev_routes WHERE kind='relationship'").n).toBe(f.relationships.length);
  } finally { f.s.close(); }
});

test('unavailable JEV routing is audited as uncertain and never blocks Luna from retained candidates', async () => {
  const f = fixture();
  try {
    const seeded = f.seed('prior-relevant', 'Fictional relevant candidate', 'agent:default');
    f.inf.routeGraphArea = async () => { throw new Error('routing unavailable'); };
    f.inf.auditRelationship = async () => { throw new Error('relationship unavailable'); };
    f.event('latest', { content: 'Durable fictional owner preference.' });
    await f.w.runOnce();
    expect(f.inputs).toHaveLength(1);
    expect(f.s.one("SELECT status FROM memory_jobs WHERE event_pk=?", seeded.e.id).status).toBe('succeeded');
    expect(f.s.one("SELECT decision FROM memory_jev_routes WHERE kind='graph_area'").decision).toBe('unavailable');
    expect(f.s.one("SELECT decision FROM memory_jev_routes WHERE kind='relationship'").decision).toBe('unavailable');
    expect(f.inputs[0].jev.graph_area).toBe('uncertain');
  } finally { f.s.close(); }
});

test('unavailable admission transport is audited and Luna still decides the captured source', async () => {
  const f = fixture();
  try {
    f.inf.audit = async () => { throw new Error('admission unavailable'); };
    const r = f.event('latest', { content: 'Durable fictional owner preference.' });
    await f.w.runOnce();
    expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?', r.job_id).status).toBe('succeeded');
    expect(f.s.one('SELECT decision FROM memory_event_admissions WHERE job_id=?', r.job_id).decision).toBe('unavailable');
    expect(f.inputs).toHaveLength(1);
  } finally { f.s.close(); }
});

test('owner-directed demotion hides shared recall but preserves history and allows later user-supported restoration', async () => {
  const f = fixture();
  try {
    const seeded = f.seed('session-pref', 'Ask one question at a time for this session');
    const before = now(); await Bun.sleep(3);
    const reviewed = await f.m.reviewAdmission(f.a, 'default', seeded.e.job_id, seeded.memory, 1, 'session_local_owner_correction');
    expect(reviewed.demoted).toBe(true); expect(reviewed.model).toBe('owner_directive');
    expect(f.m.effective(f.s.one('SELECT * FROM memories WHERE id=?', seeded.memory), at, now())).toBeNull();
    expect(f.m.effective(f.s.one('SELECT * FROM memories WHERE id=?', seeded.memory), at, before)).not.toBeNull();
    expect(f.s.one('SELECT content FROM memory_events WHERE id=?', seeded.e.id).content).toBe(seeded.e.content);
    expect(f.s.one('SELECT status FROM memory_jobs WHERE id=?', seeded.e.job_id).status).toBe('succeeded');
    expect((await f.m.recall(f.a, { agent_id: 'default', thread_id: 'owner', query: 'question at a time' })).context).toBe('');
    await Bun.sleep(3);
    f.seed('standing-pref', 'Ask one question at a time for this session');
    expect(f.m.effective(f.s.one('SELECT * FROM memories WHERE id=?', seeded.memory), at, now())).not.toBeNull();
  } finally { f.s.close(); }
});

test('bounded conversation focus drains coherent owner turns and rotates without starving inherited work', () => {
  const f = fixture();
  try {
    for (let n = 0; n < 64; n++) {
      f.event(`inherited-${n}`, { thread_id: `inherited-${n}`, role: 'tool', author_id: 'tool', content: 'Fictional inherited tool', occurred_at: at });
      const job = f.legacyJob(`inherited-${n}`);
      f.s.run('UPDATE memory_events SET accepted_at=? WHERE event_id=?', at, `inherited-${n}`);
      f.s.run('UPDATE memory_jobs SET created_at=? WHERE id=?', at, job);
    }
    for (const thread of ['owner-a', 'owner-b']) for (let n = 0; n < 20; n++) {
      f.event(`${thread}-question-${n}`, { thread_id: thread, role: 'assistant', author_id: 'agent:default', content: `Which fictional detail ${n}?` });
      f.event(`${thread}-fact-${n}`, { thread_id: thread, content: `Fictional useful detail ${n}.` });
    }
    const sequence: string[] = [];
    for (let n = 0; n < 240; n++) {
      const remaining = f.s.one("SELECT COUNT(*) n FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk WHERE e.thread_id IN ('owner-a','owner-b') AND j.status IN ('queued','retry','running')").n;
      if (!remaining) break;
      const j = f.w.claim()!; expect(j).not.toBeNull();
      sequence.push(f.s.one('SELECT event_id FROM memory_events WHERE id=?', j.event_pk).event_id);
      f.w.finish(j, 'succeeded');
    }
    for (const thread of ['owner-a', 'owner-b']) {
      const facts = sequence.map((x, i) => [x, i] as const).filter(([x]) => x.startsWith(`${thread}-fact-`));
      expect(facts.map(([x]) => x)).toEqual(Array.from({ length: 20 }, (_, n) => `${thread}-fact-${n}`));
      for (let n = 1; n < facts.length; n++) expect(facts[n]![1] - facts[n - 1]![1]).toBeLessThanOrEqual(48);
    }
    expect(sequence.filter(x => x.startsWith('inherited-')).length).toBeGreaterThanOrEqual(10);
    expect(f.s.one('SELECT COUNT(*) n FROM memory_events').n).toBe(144);
  } finally { f.s.close(); }
});
