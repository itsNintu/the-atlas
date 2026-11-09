import { canonical, hash, id, now, Store } from './store.ts';
import { currentResetEpoch } from './reset-state.ts';
import { activeChanges } from './memory-truth.ts';
import { Memory, MemoryWorker } from './memory.ts';
import { gluedOwnerDisplayLabel, ownerAttributedEvent } from './memory-attribution.ts';
import { operationalStatusCategory } from './memory-operational.ts';
import { fail } from './errors.ts';
import type { Decision } from './inference.ts';

const OPERATION = 'canonical_graph_repair_v1';
const CUSTODY_TABLES = [
  'workspaces', 'principals', 'credentials', 'memory_bindings', 'memory_grants',
  'memory_events', 'memory_roots', 'memory_heads', 'memory_jobs',
  'memory_provider_holds', 'memory_curation_metrics', 'memory_reprocess_requests',
  'memory_reconsider_requests', 'derived_brain_reset_state',
] as const;

const norm = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const vector = (row: any) => row.embedding_json ? JSON.parse(row.embedding_json) : undefined;
const withoutGeneratedAt = ({ generated_at, proof_sha256, ...plan }: any) => plan;

function custody(store: Store) {
  return Object.fromEntries(CUSTODY_TABLES.map((table) => [table, store.all(`SELECT * FROM "${table}" ORDER BY rowid`)]));
}

function supports(store: Store, memoryId: string) {
  return store.all(`SELECT e.*,j.status AS job_status,j.reset_epoch AS job_reset_epoch FROM memory_supports s
    JOIN memory_events e ON e.id=s.event_pk JOIN memory_heads h ON h.event_pk=e.id
    LEFT JOIN memory_jobs j ON j.id=e.job_id AND j.event_pk=e.id
    WHERE s.memory_id=? AND e.status NOT IN ('forgotten','deleted','superseded') ORDER BY e.accepted_at,e.id`, memoryId);
}

function reviewable(sources: any[]) {
  return sources.filter((source) => source.job_id && ((source.job_status === 'succeeded' && source.status === 'processed') || (source.job_status === 'failed' && source.status === 'pending')));
}

function memoryProof(store: Store, row: any) {
  const { embedding_json, ...memory } = row;
  return hash(canonical({
    memory: { ...memory, embedding_sha256: hash(embedding_json ?? '') },
    supports: supports(store, row.id).map((source) => ({
      id: source.id, event_id: source.event_id, revision: source.revision, job_id: source.job_id,
      job_status: source.job_status, status: source.status, role: source.role, author_id: source.author_id,
      occurred_at: source.occurred_at, accepted_at: source.accepted_at, body_hash: source.body_hash,
    })),
    changes: activeChanges(store, row.id),
    demotions: store.all('SELECT * FROM memory_admission_demotions WHERE memory_id=? ORDER BY recorded_at,review_id', row.id),
    targets: store.all('SELECT * FROM memory_entity_targets WHERE memory_id=?', row.id),
  }));
}

function operationProof(store: Store, row: any, source: any, extra: Record<string, unknown> = {}) {
  return {
    memory_id: row.id, scope: row.scope, source_event_pk: source.id,
    source_event_id: source.event_id, source_revision: source.revision, job_id: source.job_id,
    memory_proof_sha256: memoryProof(store, row), ...extra,
  };
}

function hasChildren(store: Store, memoryId: string) {
  return Boolean(store.one('SELECT 1 FROM memory_lineage WHERE parent_id=? LIMIT 1', memoryId));
}

function blogExclusion(row: any) {
  if (row.scope !== 'business:alex' || row.derived) return false;
  if (!['excludes', 'excludes_from_platform_features', 'prefers_excluding', 'blog_functionality_policy'].includes(norm(row.predicate).replaceAll('-', '_'))) return false;
  if (!['alex', 'creator platform'].includes(norm(row.subject)) && !gluedOwnerDisplayLabel(row.subject)) return false;
  const object = String(row.object ?? '').toLowerCase();
  return /blog/.test(object) && /(?:platform|creator)/.test(object) && !/\bmay[ _]include\b|\ballow(?:s|ed)?\b/.test(object);
}

function canonicalBlog(rows: any[], store: Store) {
  return [...rows].sort((a, b) => {
    const score = (row: any) => {
      const sources = supports(store, row.id);
      return [
        norm(row.subject) === 'alex' ? 1 : 0,
        norm(row.predicate) === 'excludes' ? 1 : 0,
        /external[- ]blog/.test(String(row.object).toLowerCase()) ? 1 : 0,
        sources.some((source) => source.role === 'user') ? 1 : 0,
        sources.length,
        String(row.object).length,
      ];
    };
    const aa = score(a), bb = score(b);
    for (let index = 0; index < aa.length; index++) if (aa[index] !== bb[index]) return bb[index] - aa[index];
    return a.recorded_from.localeCompare(b.recorded_from) || a.id.localeCompare(b.id);
  })[0];
}

function activeRows(store: Store, memory: Memory, at: string) {
  return store.all('SELECT * FROM memories ORDER BY id').filter((row) => memory.effective(row, at, at));
}

function groupProof(store: Store, rows: any[]) {
  return hash(canonical(rows.map((row) => [row.id, memoryProof(store, row)])));
}

function duplicateGroup(store: Store, rows: any[], category: string) {
  if (rows.length < 2 || rows.some((row) => row.derived || hasChildren(store, row.id))) return null;
  const canonicalRow = category === 'blog_exclusion' ? canonicalBlog(rows, store) : [...rows].sort((a, b) =>
    supports(store, b.id).length - supports(store, a.id).length || a.recorded_from.localeCompare(b.recorded_from) || a.id.localeCompare(b.id))[0];
  const sources = reviewable(supports(store, canonicalRow.id));
  const authority = sources[0] ?? rows.flatMap((row) => reviewable(supports(store, row.id)))[0];
  if (!authority) return null;
  return {
    category, canonical_memory_id: canonicalRow.id,
    duplicate_memory_ids: rows.filter((row) => row.id !== canonicalRow.id).map((row) => row.id).sort(),
    source_event_pk: authority.id, source_event_id: authority.event_id,
    source_revision: authority.revision, job_id: authority.job_id,
    group_proof_sha256: groupProof(store, rows),
  };
}

function wrongEquivalenceRows(store: Store, at = now()) {
  return store.all(`SELECT q.*,e.canonical AS entity_label,c.canonical AS canonical_label FROM memory_entity_equivalences q
    JOIN memory_entities e ON e.id=q.entity_id JOIN memory_entities c ON c.id=q.canonical_id
    JOIN memory_events x ON x.id=q.event_pk JOIN memory_heads h ON h.event_pk=x.id
    WHERE x.status NOT IN ('forgotten','deleted','superseded') AND NOT EXISTS(SELECT 1 FROM memory_entity_equivalence_invalidations i WHERE i.workspace_id=q.workspace_id AND i.scope=q.scope AND i.entity_id=q.entity_id AND i.canonical_id=q.canonical_id AND i.event_pk=q.event_pk AND i.recorded_at<=?)
    ORDER BY q.scope,q.entity_id,q.canonical_id,q.event_pk`, at)
    .filter((row) => norm(row.entity_label) === 'alex' && gluedOwnerDisplayLabel(row.canonical_label));
}

export function canonicalGraphRepairPlan(store: Store) {
  const memory = new Memory(store, {} as any);
  const generated_at = now(), rows = activeRows(store, memory, generated_at);
  const blogRows = rows.filter(blogExclusion);
  const blogIds = new Set(blogRows.map((row) => row.id));
  const ownerRepairs: any[] = [];
  const ownerEntitySources = new Map<string, any>();

  for (const row of rows) {
    if (!gluedOwnerDisplayLabel(row.subject)) continue;
    const source = reviewable(supports(store, row.id))[0];
    if (!source || !ownerAttributedEvent(source)) continue;
    ownerEntitySources.set(`${row.scope}:${row.subject_id}`, source);
    if (blogIds.has(row.id) || row.derived || hasChildren(store, row.id)) continue;
    ownerRepairs.push(operationProof(store, row, source, { canonical_subject: 'Alex', category: 'owner_subject' }));
  }
  ownerRepairs.sort((a, b) => a.memory_id.localeCompare(b.memory_id));

  const equivalenceInvalidations = wrongEquivalenceRows(store, generated_at).flatMap((row) => {
    const repair = ownerEntitySources.get(`${row.scope}:${row.canonical_id}`);
    return repair ? [{
      workspace_id: row.workspace_id, scope: row.scope, entity_id: row.entity_id,
      canonical_id: row.canonical_id, event_pk: row.event_pk, repair_event_pk: repair.id,
      reason_code: 'owner_display_id_reversal', original_recorded_at: row.recorded_at,
    }] : [];
  });
  const canonicalEquivalences = [...ownerEntitySources].map(([key, source]) => {
    const separator = key.lastIndexOf(':');
    const scope = key.slice(0, separator), entity_id = key.slice(separator + 1);
    return { workspace_id: source.workspace_id, scope, entity_id, canonical_label: 'Alex', repair_event_pk: source.id };
  }).sort((a, b) => a.scope.localeCompare(b.scope) || a.entity_id.localeCompare(b.entity_id));

  const workRelationships: any[] = [];
  for (const row of rows) {
    if (norm(row.predicate) !== 'has_final_call_to_discuss' || row.derived || hasChildren(store, row.id)) continue;
    const source = reviewable(supports(store, row.id))[0];
    if (!source || source.role !== 'user') continue;
    const object = String(row.object).toLowerCase();
    if (!/compensation/.test(object) || !/work trial/.test(object)) continue;
    const company = rows.find((candidate) => candidate.scope === row.scope && norm(candidate.predicate) === 'interviewing_with' &&
      supports(store, candidate.id).some((support) => support.id === source.id) &&
      store.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=? AND entity_id IS NOT NULL', candidate.id) &&
      object.includes(String(candidate.object).toLowerCase()));
    if (!company) continue;
    const target = store.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=? AND entity_id IS NOT NULL', company.id);
    const canonicalSubject = memory.canonicalEntity(row.workspace_id, row.scope, row.subject_id, generated_at);
    if (norm(store.one('SELECT canonical FROM memory_entities WHERE id=?', canonicalSubject)?.canonical) !== 'alex') continue;
    workRelationships.push({
      ...operationProof(store, row, source, {
        category: 'atomic_work_relationships', company_memory_id: company.id,
        company_entity_id: target.entity_id, company: company.object,
        company_proof_sha256: memoryProof(store, company),
        relations: ['discussing_compensation_with', 'has_final_call_with', 'plans_work_trial_with'],
      }),
    });
  }
  workRelationships.sort((a, b) => a.memory_id.localeCompare(b.memory_id));

  const duplicateGroups: any[] = [];
  const blog = duplicateGroup(store, blogRows, 'blog_exclusion');
  if (blog) duplicateGroups.push(blog);
  const exact = new Map<string, any[]>();
  for (const row of rows) {
    if (blogIds.has(row.id) || row.derived || hasChildren(store, row.id)) continue;
    const sources = supports(store, row.id);
    if ((sources.length && sources.every((source) => operationalStatusCategory(row, source))) || !String(row.object ?? '').trim()) continue;
    const target = store.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=?', row.id);
    const key = hash(canonical({ workspace_id: row.workspace_id, scope: row.scope, kind: row.kind,
      subject: norm(row.subject), predicate: norm(row.predicate), object: norm(row.object),
      object_entity_id: target?.entity_id ?? null, valid_from: row.valid_from, valid_to: row.valid_to }));
    exact.set(key, [...(exact.get(key) ?? []), row]);
  }
  for (const group of exact.values()) {
    const duplicate = duplicateGroup(store, group, 'exact_claim');
    if (duplicate) duplicateGroups.push(duplicate);
  }
  duplicateGroups.sort((a, b) => a.canonical_memory_id.localeCompare(b.canonical_memory_id));

  const operationalDemotions: any[] = [], placeholders: any[] = [];
  for (const row of rows) {
    const sources = supports(store, row.id), source = reviewable(sources)[0];
    if (!source) continue;
    const categories = [...new Set(sources.map((support) => operationalStatusCategory(row, support)))];
    if (sources.length && categories.every(Boolean)) {
      operationalDemotions.push(operationProof(store, row, source, { category: 'operational_status', operational_categories: categories.sort() }));
    } else if (!String(row.object ?? '').trim()) {
      placeholders.push(operationProof(store, row, source, { category: 'empty_object_placeholder' }));
    }
  }
  operationalDemotions.sort((a, b) => a.memory_id.localeCompare(b.memory_id));
  placeholders.sort((a, b) => a.memory_id.localeCompare(b.memory_id));

  const plan: any = {
    operation: OPERATION, schema_version: 1, reset_epoch: currentResetEpoch(store), generated_at,
    before: {
      active_total: rows.length,
      malformed_owner_active: rows.filter((row) => gluedOwnerDisplayLabel(row.subject)).length,
      blog_exclusion_active: blogRows.length,
      operational_status_active: operationalDemotions.length,
      empty_object_active: placeholders.length,
      wrong_owner_equivalences_active: equivalenceInvalidations.length,
    },
    owner_repairs: ownerRepairs,
    work_relationships: workRelationships,
    equivalence_invalidations: equivalenceInvalidations,
    canonical_equivalences: canonicalEquivalences,
    duplicate_groups: duplicateGroups,
    operational_demotions: operationalDemotions,
    empty_object_demotions: placeholders,
    affected_memory_ids: [...new Set([
      ...ownerRepairs.map((row) => row.memory_id), ...workRelationships.map((row) => row.memory_id),
      ...duplicateGroups.flatMap((row) => [row.canonical_memory_id, ...row.duplicate_memory_ids]),
      ...operationalDemotions.map((row) => row.memory_id), ...placeholders.map((row) => row.memory_id),
    ])].sort(),
  };
  plan.proof_sha256 = hash(canonical(withoutGeneratedAt(plan)));
  return plan;
}

function previousReceipt(store: Store, proof: string) {
  for (const row of store.all("SELECT disposition_json FROM memory_reconciliations WHERE disposition_json LIKE '%canonical_graph_repair_v1%'")) {
    try {
      const value = JSON.parse(row.disposition_json);
      if (value.operation === OPERATION && value.proof_sha256 === proof && value.receipt) return { ...value.receipt, idempotent_replay: true };
    } catch {}
  }
  return null;
}

function repairActor(store: Store, source: any) {
  const actor = store.one(`SELECT p.*,c.id AS credential_id FROM principals p JOIN credentials c ON c.principal_id=p.id
    WHERE p.id=? AND c.id=? AND c.revoked_at IS NULL`, source.principal_id, source.credential_id);
  if (!actor) fail(409, 'repair_credential_unavailable', 'A current source credential is required for admission repair');
  return actor;
}

function sourceEvent(store: Store, eventPk: string) {
  const source = store.one(`SELECT e.*,j.status AS job_status FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id
    JOIN memory_jobs j ON j.id=e.job_id AND j.event_pk=e.id WHERE e.id=? AND ((e.status='processed' AND j.status='succeeded') OR (e.status='pending' AND j.status='failed'))`, eventPk);
  if (!source) fail(409, 'repair_source_changed', 'Repair source is no longer a current completed event');
  return source;
}

function supersede(store: Store, source: any, targetId: string, replacementId: string, at: string) {
  store.run('INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)', id('change'), source.id, targetId, replacementId, 'superseded', source.occurred_at, at);
}

function audit(store: Store, source: any, memoryId: string, disposition: any, at: string) {
  store.run('INSERT INTO memory_reconciliations VALUES (?,?,?,?,?)', source.job_id, source.id, memoryId, JSON.stringify(disposition), at);
}

function replacementDecision(store: Store, row: any, source: any, subject: string, predicate = row.predicate, object = row.object, objectEntity?: boolean): Decision {
  const target = store.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=?', row.id);
  return {
    kind: row.kind, scope: row.scope, subject, predicate, object,
    object_entity: objectEntity ?? (target ? Boolean(target.entity_id) : undefined),
    valid_from: row.valid_from, valid_to: row.valid_to, importance: row.importance, confidence: row.confidence,
    evidence_event_ids: [source.event_id],
    entity_aliases: gluedOwnerDisplayLabel(row.subject) ? [{ canonical: 'Alex', aliases: ['Alex', row.subject] }] : undefined,
  } as Decision;
}

function repairExisting(store: Store, worker: MemoryWorker, row: any, source: any, subject = 'Alex', predicate?: string, object?: string, objectEntity?: boolean) {
  const decision = replacementDecision(store, row, source, subject, predicate, object, objectEntity);
  return worker.apply(source, decision, vector(row), row.embedding_model ?? 'repair-disabled', [row.scope]);
}

function verifyHistory(store: Store, memory: Memory, plan: any) {
  const at = plan.generated_at;
  for (const memoryId of plan.affected_memory_ids) {
    const row = store.one('SELECT * FROM memories WHERE id=?', memoryId);
    if (row && !memory.effective(row, at, at)) fail(500, 'repair_history_changed', `Pre-repair current history changed for ${memoryId}`);
  }
}

export function applyCanonicalGraphRepair(store: Store, expectedProof: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedProof)) fail(400, 'repair_proof_required', 'Pass the exact SHA-256 preview proof');
  const previous = previousReceipt(store, expectedProof);
  if (previous) return previous;
  const memory = new Memory(store, {} as any), worker = new MemoryWorker(store, {} as any);
  const receipt = store.transaction(() => {
    const beforeCustody = custody(store), plan = canonicalGraphRepairPlan(store);
    if (plan.proof_sha256 !== expectedProof) fail(409, 'repair_conflict', 'Live repair candidates or source proofs changed; preview again');
    const at = now(), summaries: any[] = [];
    let summarySource: any = null, summaryMemory: string | null = null;

    for (const row of plan.equivalence_invalidations) {
      store.run('INSERT INTO memory_entity_equivalence_invalidations VALUES (?,?,?,?,?,?,?,?,?)',
        row.workspace_id, row.scope, row.entity_id, row.canonical_id, row.event_pk, row.repair_event_pk,
        row.reason_code, plan.proof_sha256, at);
    }
    for (const row of plan.canonical_equivalences) {
      const canonicalEntity = store.one('SELECT * FROM memory_entities WHERE workspace_id=? AND canonical=?', row.workspace_id, row.canonical_label) ??
        { id: id('entity') };
      if (!store.one('SELECT 1 FROM memory_entities WHERE id=?', canonicalEntity.id))
        store.run('INSERT INTO memory_entities VALUES (?,?,?)', canonicalEntity.id, row.workspace_id, row.canonical_label);
      store.run('INSERT OR IGNORE INTO memory_entity_equivalences VALUES (?,?,?,?,?,?)',
        row.workspace_id, row.scope, row.entity_id, canonicalEntity.id, row.repair_event_pk, at);
    }

    for (const operation of plan.owner_repairs) {
      const row = store.one('SELECT * FROM memories WHERE id=?', operation.memory_id), source = sourceEvent(store, operation.source_event_pk);
      const replacement = repairExisting(store, worker, row, source);
      supersede(store, source, row.id, replacement, at);
      audit(store, source, replacement, { operation: OPERATION, proof_sha256: plan.proof_sha256, repair: 'owner_subject', source_memory_id: row.id, duplicate_ids: [] }, at);
      summaries.push({ category: 'owner_subject', source_memory_id: row.id, canonical_memory_id: replacement });
      summarySource ??= source; summaryMemory ??= replacement;
    }

    for (const operation of plan.work_relationships) {
      const row = store.one('SELECT * FROM memories WHERE id=?', operation.memory_id), source = sourceEvent(store, operation.source_event_pk);
      const replacements: string[] = [];
      for (const relation of operation.relations) {
        const replacement = repairExisting(store, worker, row, source, 'Alex', relation, operation.company, true);
        replacements.push(replacement);
        audit(store, source, replacement, { operation: OPERATION, proof_sha256: plan.proof_sha256, repair: 'atomic_work_relationship', source_memory_id: row.id, predicate: relation, duplicate_ids: [] }, at);
        summarySource ??= source; summaryMemory ??= replacement;
      }
      supersede(store, source, row.id, replacements[0], at);
      summaries.push({ category: 'atomic_work_relationships', source_memory_id: row.id, canonical_memory_ids: replacements });
    }

    for (const group of plan.duplicate_groups) {
      const source = sourceEvent(store, group.source_event_pk), canonicalRow = store.one('SELECT * FROM memories WHERE id=?', group.canonical_memory_id);
      for (const duplicateId of group.duplicate_memory_ids) {
        // Combine every direct provenance row, not only the authority event.
        store.run(`INSERT OR IGNORE INTO memory_supports (memory_id,event_pk,roots_json,excerpt)
          SELECT ?,event_pk,roots_json,excerpt FROM memory_supports WHERE memory_id=?`, canonicalRow.id, duplicateId);
        supersede(store, source, duplicateId, canonicalRow.id, at);
      }
      audit(store, source, canonicalRow.id, { operation: OPERATION, proof_sha256: plan.proof_sha256, repair: group.category, duplicate_ids: group.duplicate_memory_ids }, at);
      summaries.push({ category: group.category, canonical_memory_id: canonicalRow.id, duplicate_memory_ids: group.duplicate_memory_ids });
      summarySource ??= source; summaryMemory ??= canonicalRow.id;
    }

    for (const [operations, reason] of [[plan.operational_demotions, 'operational_status_owner_exclusion'], [plan.empty_object_demotions, 'invalid_placeholder_owner_exclusion']] as const) {
      for (const operation of operations) {
        const source = sourceEvent(store, operation.source_event_pk), actor = repairActor(store, source);
        const result = memory.reviewAdmission(actor, source.agent_id, source.job_id, operation.memory_id, source.revision, reason);
        if (!result.demoted) fail(500, 'repair_demotion_failed', `Memory was not demoted: ${operation.memory_id}`);
        summaries.push({ category: operation.category, memory_id: operation.memory_id, review_id: result.review_id });
        summarySource ??= source; summaryMemory ??= operation.memory_id;
      }
    }

    verifyHistory(store, memory, plan);
    if (canonical(beforeCustody) !== canonical(custody(store))) fail(500, 'repair_custody_changed', 'Raw source/job/credential/configuration custody changed');
    if (store.all('PRAGMA foreign_key_check').length) fail(500, 'repair_foreign_key_violation', 'Repair would leave invalid references');
    const quickCheck = store.one('PRAGMA quick_check').quick_check;
    if (quickCheck !== 'ok') fail(500, 'repair_integrity_failed', 'Database quick_check failed');

    const afterAt = now(), active = activeRows(store, memory, afterAt);
    const after = {
      active_total: active.length,
      malformed_owner_active: active.filter((row) => gluedOwnerDisplayLabel(row.subject)).length,
      blog_exclusion_active: active.filter(blogExclusion).length,
      operational_status_active: active.filter((row) => {
        const sources = supports(store, row.id);
        return sources.length > 0 && sources.every((source) => operationalStatusCategory(row, source));
      }).length,
      empty_object_active: active.filter((row) => !String(row.object ?? '').trim()).length,
      wrong_owner_equivalences_active: wrongEquivalenceRows(store, afterAt).length,
    };
    if (after.malformed_owner_active || after.blog_exclusion_active > 1 || after.operational_status_active || after.empty_object_active || after.wrong_owner_equivalences_active)
      fail(500, 'repair_verification_failed', `Active graph verification failed: ${JSON.stringify({ ...after, residual_malformed_owner_ids: active.filter((row) => gluedOwnerDisplayLabel(row.subject)).map((row) => row.id) })}`);

    const result = {
      operation: OPERATION, proof_sha256: plan.proof_sha256, repair_recorded_at: at,
      before: plan.before, after, operations: summaries,
      raw_history_preserved: true, provider_calls: 0, foreign_key_check: 'ok', quick_check: quickCheck,
      idempotent_replay: false,
    };
    if (summarySource && summaryMemory) {
      audit(store, summarySource, summaryMemory, { operation: OPERATION, proof_sha256: plan.proof_sha256, receipt: result }, at);
    }
    return result;
  });
  return receipt;
}
