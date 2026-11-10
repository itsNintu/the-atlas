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
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas repair',
      predicate: 'assistant_sent_focused_repair_directive_to_builder', object: 'The assistant sent a task update.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas repair',
      predicate: 'assistant_reported_scope_error', object: 'The assistant reported that the work was over-scoped.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas repair',
      predicate: 'reported', object: 'The assistant reported the task implementation status.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas recall',
      predicate: 'recall_issue_observed', object: 'The recall query returned unrelated records.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas hosting migration',
      predicate: 'plans_to_route_deployment', object: 'Route Builder to deploy Atlas and verify the hosted service.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas hosting migration',
      predicate: 'plans_to_check_and_route', object: 'Check the project and route the migration to Builder.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Builder task',
      predicate: 'reports_builder_task_running', object: 'Builder is running the assigned task.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas',
      predicate: 'reported_adding_requirement_to_builder_task',
      object: 'Atlas said it was adding automatic recall that follows live conversation topic shifts, including a dog-to-work test requiring relevant current work details and excluding irrelevant dog or family memories.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas recall',
      predicate: 'stated_requirement_status',
      object: 'The assistant stated that an approximately 1.5-second pre-answer recall budget was established as an Alex requirement before later latency changes were stopped; this records that stated requirement, not a current verified latency result.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Builder',
      predicate: 'reported_builder_status', object: 'Builder reported implementation progress.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas memory graph repair task',
      predicate: 'reported_regression_test_and_fix_scope',
      object: 'Builder reported test scope and said that Alex requires genuine memory; this was a reported plan, not verified completion.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas memory graph repair task',
      predicate: 'reported', object: 'The task report says Alex requires … when summarized in a task report; completion was not verified.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'builder agent',
      predicate: 'reports_implemented', object: 'Builder reports implemented fixes and regression tests.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas repair',
      predicate: 'assistant_reported_repair_status', object: 'The assistant reported that repair verification passed.',
    }),
  ], 'assistant', 'I added the regression case and am checking activation status.');
  try {
    expect(await status.worker.runOnce()).toBe(true);
    expect(status.store.one('SELECT status FROM memory_jobs WHERE id=?', status.receipt.job_id).status).toBe('succeeded');
    expect(status.store.all('SELECT predicate,object,kind FROM memories ORDER BY object')).toEqual([
      {
        predicate: 'had_owner_requirement',
        object: 'an approximately 1.5-second pre-answer recall budget was established as an Alex requirement before later latency changes were stopped',
        kind: 'assertion',
      },
      {
        predicate: 'has_owner_requirement',
        object: 'automatic recall that follows live conversation topic shifts, including a dog-to-work test requiring relevant current work details and excluding irrelevant dog or family memories',
        kind: 'assertion',
      },
      { predicate: 'has_owner_requirement', object: 'genuine memory', kind: 'assertion' },
    ]);
    expect(status.store.one("SELECT COUNT(*) AS n FROM memories WHERE predicate NOT IN ('has_owner_requirement','had_owner_requirement')").n).toBe(0);
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
    decision('native:default:synthetic-message:part:0', {
      kind: 'hypothesis', scope: 'agent:default', subject: 'Atlas', predicate: 'reported_card_requirement',
      object: 'A new session needs compact profile and recent-topic context before the model starts; recall should remain silent.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'hypothesis', scope: 'agent:default', subject: 'Assistant', predicate: 'reported_atlas_conversation_filter_design',
      object: 'Atlas admits genuine conversation while rejecting tool output and automatic status notifications before curation.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas recall',
      predicate: 'assistant_sent_focused_repair_directive_to_builder',
      object: 'Alex requires automatic topic-sensitive recall with relevant current work details and unrelated dog or family memories excluded.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas recall', predicate: 'reported',
      object: 'The task report summarizes that Alex requires automatic topic-sensitive recall with relevant current work details and unrelated dog or family memories excluded.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas recall', predicate: 'recall_issue_observed',
      object: 'The issue report preserves that Alex requires automatic topic-sensitive recall with relevant current work details and unrelated dog or family memories excluded.',
    }),
    decision('native:default:synthetic-message:part:0', {
      kind: 'episode', scope: 'agent:default', subject: 'Atlas pre-answer recall',
      predicate: 'assistant_sent_focused_repair_directive_to_builder',
      object: '"Preserve one silent pre-answer recall"',
    }),
  ], 'assistant', 'Durable design knowledge and the owner goal: keep pre-answer recall silent with session-start continuity.');
  try {
    expect(await substantive.worker.runOnce()).toBe(true);
    expect(substantive.store.all('SELECT predicate FROM memories ORDER BY predicate').map((row) => row.predicate)).toEqual([
      'assistant_stated_follow_up_goal', 'has_owner_requirement', 'has_owner_requirement', 'recommends_for_memory_design',
      'reported_atlas_conversation_filter_design', 'reported_card_requirement', 'reported_location',
    ]);
    const requirement = substantive.store.one("SELECT id,object,kind FROM memories WHERE predicate='has_owner_requirement' AND subject='Atlas recall'");
    expect(requirement).toMatchObject({
      kind: 'assertion',
      object: 'automatic topic-sensitive recall with relevant current work details and unrelated dog or family memories excluded',
    });
    expect(substantive.store.one('SELECT COUNT(*) AS n FROM memory_supports WHERE memory_id=?', requirement.id).n).toBe(1);
    expect(substantive.store.one("SELECT object FROM memories WHERE subject='Atlas pre-answer recall'").object).toBe('Preserve one silent pre-answer recall');
    for (const memory of substantive.store.all('SELECT id FROM memories')) {
      expect(() => substantive.memory.reviewAdmission(
        substantive.actor, 'default', substantive.receipt.job_id, memory.id, 1, 'operational_status_owner_exclusion',
      )).toThrow('Operational-status exclusion requires operational-only direct support');
    }
  } finally { substantive.store.close(); }
});

test('direct owner corrections and explicitly attributed owner requirements bypass operational filtering', async () => {
  const owner = fixture([decision('native:default:synthetic-message:part:0', {
    subject: 'Alex', predicate: 'reported_builder_status',
    object: 'Alex corrected the durable requirement: deployment must remain on the existing Cloudflare service.',
  })], 'user', 'Correction: deployment must remain on the existing Cloudflare service.');
  try {
    expect(await owner.worker.runOnce()).toBe(true);
    expect(owner.store.all('SELECT predicate FROM memories').map((row) => row.predicate)).toEqual(['reported_builder_status']);
  } finally { owner.store.close(); }

  const attributed = fixture([decision('native:default:synthetic-message:part:0', {
    scope: 'business:alex', subject: 'Alex', predicate: 'reported_adding_requirement_to_builder_task',
    object: 'Alex requires silent pre-answer recall and preservation of genuine family knowledge.',
  })], 'inter_agent', 'Owner requirement: Alex requires silent pre-answer recall and preservation of genuine family knowledge.');
  try {
    expect(await attributed.worker.runOnce()).toBe(true);
    expect(attributed.store.all('SELECT predicate FROM memories').map((row) => row.predicate)).toEqual(['reported_adding_requirement_to_builder_task']);
  } finally { attributed.store.close(); }
});

test('owner-attributed task cards retain directives but not status-only claims', async () => {
  const f = fixture([
    decision('native:default:synthetic-message:part:0', {
      scope: 'agent:default', subject: 'Atlas task', predicate: 'has_status', object: 'running; assigned to builder',
    }),
    decision('native:default:synthetic-message:part:0', {
      scope: 'agent:default', subject: 'Codex publish-creator-updates', predicate: 'status', object: 'paused',
    }),
    decision('native:default:synthetic-message:part:0', {
      scope: 'agent:default', subject: 'Creator Updates item', predicate: 'publication_status',
      object: 'already published; do not queue, duplicate, or republish',
    }),
    decision('native:default:synthetic-message:part:0', {
      scope: 'agent:default', subject: 'builder agent', predicate: 'received_operational_constraints_for_task_t_051148b3',
      object: 'Preserve the original publication hook and exact recovery mode; never redeploy or reannounce.',
    }),
  ], 'inter_agent', 'Owner request: Alex supplied this task. Preserve the publication directives; routine status fields are not durable knowledge.');
  try {
    expect(await f.worker.runOnce()).toBe(true);
    expect(f.store.all('SELECT predicate FROM memories ORDER BY predicate').map((row) => row.predicate)).toEqual([
      'publication_status', 'received_operational_constraints_for_task_t_051148b3',
    ]);
  } finally { f.store.close(); }
});

test('invalid placeholder owner requirements are demoted without deleting source history', async () => {
  const f = fixture([
    decision('native:default:synthetic-message:part:0', {
      kind: 'assertion', scope: 'agent:default', subject: 'Atlas recall',
      predicate: 'has_owner_requirement', object: 'genuine memory',
    }),
  ], 'assistant');
  try {
    await f.worker.runOnce();
    const memory = f.store.one('SELECT * FROM memories');
    f.store.run('UPDATE memories SET object=? WHERE id=?', '… when summarized in a task report; completion was not verified', memory.id);
    const result = f.memory.reviewAdmission(f.actor, 'default', f.receipt.job_id, memory.id, 1, 'invalid_placeholder_owner_exclusion');
    expect(result.demoted).toBe(true);
    expect(f.memory.effective(f.store.one('SELECT * FROM memories WHERE id=?', memory.id), new Date().toISOString(), new Date().toISOString())).toBeNull();
    expect(f.store.one('SELECT COUNT(*) AS n FROM memory_events').n).toBe(1);
    expect(f.store.one('SELECT COUNT(*) AS n FROM memory_admission_demotions WHERE memory_id=?', memory.id).n).toBe(1);
  } finally { f.store.close(); }
});

test('an assistant hypothesis still cannot become shared owner truth', async () => {
  const f = fixture([decision('native:default:synthetic-message:part:0', { kind: 'hypothesis' })], 'assistant', 'Perhaps Alex wants a remote trial.');
  try {
    expect(await f.worker.runOnce()).toBe(true);
    expect(f.store.one('SELECT status,error_code FROM memory_jobs WHERE id=?', f.receipt.job_id)).toEqual({ status: 'retry', error_code: 'curator_attribution_violation' });
    expect(f.store.all('SELECT * FROM memories')).toEqual([]);
  } finally { f.store.close(); }
});
