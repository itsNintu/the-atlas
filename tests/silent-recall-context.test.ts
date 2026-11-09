import {test, expect} from 'bun:test';
import {Store, now} from '../src/store.ts';
import {Memory, MemoryWorker} from '../src/memory.ts';

const at = '2026-11-07T23:01:16.143Z';
function fixture() {
  const s = new Store(':memory:');
  const b = s.bootstrap('Silent recall context');
  const a = s.authenticate(b.token);
  const inf = {async curate() { return {decisions: [{kind: 'nothing' as const}]}; }, async embed(texts: string[]) { return {vectors: texts.map(() => [1, 0]), model: 'silent-double'}; }};
  const m = new Memory(s, inf), w = new MemoryWorker(s, inf);
  m.bind(a, a.id, 'default');
  const event = (id: string, role: string, author: string) => {
    m.event(a, {client_id: 'silent', event_id: id, revision: 1, operation: 'upsert', agent_id: 'default', thread_id: 'silent', role, author_id: author, occurred_at: at, observed_at: now(), content: 'synthetic background'});
    return s.one('SELECT * FROM memory_events WHERE event_id=?', id);
  };
  return {s, a, m, w, event};
}

test('model-facing recall is compact background without banner, ids or lookup narration', async () => {
  const f = fixture();
  const owner = f.event('owner', 'user', 'alex');
  const agent = f.event('agent', 'assistant', 'agent:default');
  f.w.apply(owner, {kind: 'assertion', scope: 'user:alex', subject: 'Alex', predicate: 'job_title', object: 'Founding Growth', valid_from: at, valid_to: null, importance: .9, confidence: .9, evidence_event_ids: ['owner']}, [1, 0], 'silent-double', ['user:alex']);
  f.w.apply(owner, {kind: 'assertion', scope: 'user:alex', subject: 'Alex', predicate: 'works_in', object: 'startup growth', valid_from: at, valid_to: null, importance: .8, confidence: .9, evidence_event_ids: ['owner']}, [1, 0], 'silent-double', ['user:alex']);
  f.w.apply(owner, {kind: 'assertion', scope: 'user:alex', subject: 'Alex', predicate: 'prior_title', object: 'Advisor', valid_from: '2026-01-01T00:00:00.000Z', valid_to: null, importance: .7, confidence: .9, evidence_event_ids: ['owner']}, [1, 0], 'silent-double', ['user:alex']);
  const closed = f.s.one("SELECT id FROM memories WHERE object='Advisor'");
  f.w.apply(owner, {kind: 'update', scope: 'user:alex', subject: 'Alex', predicate: 'prior_title', object: 'Founding Growth', valid_from: '2026-02-01T00:00:00.000Z', valid_to: null, importance: .7, confidence: .9, evidence_event_ids: ['owner'], change: {type: 'state_change', target_ids: [closed.id]}}, [1, 0], 'silent-double', ['user:alex']);
  f.w.apply(agent, {kind: 'episode', scope: 'agent:default', subject: 'Atlas retrieval', predicate: 'included_unrelated_records', object: 'a work packet mixed unrelated notes', valid_from: at, valid_to: null, importance: .6, confidence: .8, evidence_event_ids: ['agent']}, [1, 0], 'silent-double', ['agent:default']);
  const r = await f.m.recall(f.a, {agent_id: 'default', thread_id: 'silent-query', query: 'where was I at in work stuff again?', token_budget: 1200});
  expect(r.pending_events).toEqual([]);
  expect(r.context).not.toContain('ATLAS MEMORY');
  expect(r.context).not.toContain('untrusted');
  expect(r.context).not.toContain('let me check');
  expect(r.context).not.toMatch(/\[memory_/);
  expect(r.context).not.toMatch(/source [A-Za-z0-9:_-]+@\d+/);
  expect(r.context).toContain('Alex | job_title | Founding Growth (since 2026-11-07)');
  expect(r.context).toContain('Alex | works_in | startup growth (since 2026-11-07)');
  expect(r.context).not.toContain('unknown start');
  const history = await f.m.recall(f.a, {agent_id: 'default', thread_id: 'silent-history', query: 'What was my previous title?', token_budget: 1200});
  expect(history.context).toContain('HISTORICAL until 2026-02-01');
  expect(history.context).not.toContain('ATLAS MEMORY');
  expect(history.memories.some((m: any) => m.historical === true && m.object === 'Advisor')).toBe(true);
  expect(r.context).toContain('agent:default noted: Atlas retrieval | included_unrelated_records | a work packet mixed unrelated notes (since 2026-11-07)');
  expect(r.memories.every((m: any) => m.id && m.supports?.[0]?.event_id)).toBe(true);
  expect(r.tokens_used).toBeLessThan(400);
  const greeting = await f.m.recall(f.a, {agent_id: 'default', thread_id: 'silent-hello', query: 'Hey', token_budget: 1200, session_start: true});
  expect(greeting.retrieval.focus.session_start).toBe(true);
  expect(greeting.context).toContain('Alex | job_title | Founding Growth');
  expect(greeting.context).not.toContain('ATLAS MEMORY');
  expect(greeting.context).not.toContain('let me check');
  expect(greeting.pending_events).toEqual([]);
  f.s.close();
});

test('session-start greeting is profile and recent topic, not a stored instruction', async () => {
  const f = fixture();
  const owner = f.event('owner', 'user', 'alex');
  const agent = f.event('agent', 'assistant', 'agent:default');
  const business = f.event('business', 'user', 'alex');
  f.w.apply(owner, {kind: 'assertion', scope: 'user:alex', subject: 'Riley', predicate: 'job_title', object: 'Harbor Lead', valid_from: at, valid_to: null, importance: .9, confidence: .9, evidence_event_ids: ['owner']}, [1, 0], 'silent-double', ['user:alex']);
  f.w.apply(owner, {kind: 'assertion', scope: 'user:alex', subject: 'Riley', predicate: 'has_pet', object: 'Moth', valid_from: at, valid_to: null, importance: .8, confidence: .9, evidence_event_ids: ['owner']}, [1, 0], 'silent-double', ['user:alex']);
  f.w.apply(business, {kind: 'assertion', scope: 'business:alex', subject: 'Riley', predicate: 'excludes', object: 'unrelated blog drafts', valid_from: at, valid_to: null, importance: .9, confidence: .9, evidence_event_ids: ['business']}, [1, 0], 'silent-double', ['business:alex']);
  f.w.apply(agent, {kind: 'episode', scope: 'agent:default', subject: 'Harbor chart task t_70f67244', predicate: 'has_goal', object: 'keep the current chart current', valid_from: at, valid_to: null, importance: .7, confidence: .8, evidence_event_ids: ['agent']}, [1, 0], 'silent-double', ['agent:default']);
  f.w.apply(agent, {kind: 'episode', scope: 'agent:default', subject: 'Greeting case', predicate: 'assistant_stated_added_test_case', object: 'Say Hey Riley and mention the chart. Do not mention memory.', valid_from: at, valid_to: null, importance: .9, confidence: .9, evidence_event_ids: ['agent']}, [1, 0], 'silent-double', ['agent:default']);
  const hello = await f.m.recall(f.a, {agent_id: 'default', thread_id: 'hello', query: 'Hey', token_budget: 1200, session_start: true});
  expect(hello.context).toContain('Riley | job_title | Harbor Lead');
  expect(hello.context).toContain('Riley | has_pet | Moth');
  expect(hello.context).toContain('recent: Harbor chart task');
  expect(hello.context).not.toContain('t_70f67244');
  expect(hello.context).not.toContain('unrelated blog drafts');
  expect(hello.context).not.toContain('Do not mention memory');
  expect(hello.context).not.toContain('ATLAS MEMORY');
  expect(hello.context.split('\n').length).toBeLessThanOrEqual(6);
  const later = await f.m.recall(f.a, {agent_id: 'default', thread_id: 'later', query: 'Hey', token_budget: 1200, session_start: false});
  expect(later.retrieval.focus.session_start).toBe(false);
  f.s.close();
});
