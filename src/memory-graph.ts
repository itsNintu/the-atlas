import { Memory } from "./memory.ts";
import { type Actor, hash, now } from "./store.ts";
import { fail, integer, text, timestamp } from "./errors.ts";
import { redact } from "./inference.ts";

// A synchronous, read-only projection. No model calls, recall feedback, intake
// promotion or alternate authorization path lives in this module.
export function memoryGraph(memory: Memory, actor: Actor, body: any) {
  const allowed = memory.authorize(actor, body.agent_id);
  let scopes = allowed;
  if (body.scopes !== undefined) {
    if (!Array.isArray(body.scopes) || !body.scopes.length || body.scopes.some((s: unknown) => typeof s !== "string"))
      fail(400, "invalid_request", "scopes must be a nonempty string array");
    if (body.scopes.some((s: string) => !allowed.includes(s)))
      fail(403, "memory_grant_required", "Every requested scope must be authorized");
    scopes = [...new Set<string>(body.scopes)];
  }
  const at = now();
  const valid_at = body.valid_at === undefined ? at : timestamp(body.valid_at, "valid_at");
  const recorded_at = body.recorded_at === undefined ? at : timestamp(body.recorded_at, "recorded_at");
  if (body.include_history !== undefined && typeof body.include_history !== "boolean")
    fail(400, "invalid_request", "include_history must be boolean");
  const include_history = body.include_history === true;
  const limit = integer(body.limit, "limit", 1, 100, 60);
  const query = body.query === undefined || body.query === "" ? "" : text(body.query, "query", 300).trim();
  const store = memory.store;
  const slots = scopes.map(() => "?").join(",");
  // Bound synchronous inspection work independently of the display limit. Search
  // is literal, not SQL wildcard syntax. Disclose candidate exhaustion honestly.
  const rows = store.all(
    `SELECT * FROM memories WHERE workspace_id=? AND scope IN (${slots}) AND recorded_from<=? AND valid_from<=?
     AND (?='' OR instr(lower(subject||' '||predicate||' '||object),lower(?))>0)
     ORDER BY recorded_from DESC,id LIMIT 2001`,
    actor.workspace_id, ...scopes, recorded_at, valid_at, query, query,
  );
  let truncated = rows.length > 2000;
  const visible: any[] = [];
  for (const m of rows.slice(0, 2000)) {
    const effective = memory.effective(m, valid_at, recorded_at);
    if (effective) {
      visible.push({ ...effective, status: effective.conflict ? "conflict" : "active" });
    } else if (include_history) {
      const supports = memory.support(m, recorded_at);
      if (!supports.length) continue;
      const changes = store.all("SELECT type,effective_at FROM memory_changes WHERE target_id=? AND recorded_at<=? ORDER BY recorded_at,id", m.id, recorded_at);
      const invalidation = changes.find((c) => ["correction", "retraction"].includes(c.type));
      let end = m.valid_to;
      for (const c of changes) if (c.type === "state_change" && c.effective_at > m.valid_from && (!end || c.effective_at < end)) end = c.effective_at;
      // A derived assertion whose lineage is no longer effective is not a
      // historical truth merely because its own validity interval is open.
      const status = invalidation ? (invalidation.type === "correction" ? "corrected" : "retracted") : end && end <= valid_at ? "historical" : "inactive_lineage";
      visible.push({ ...m, valid_to: end, supports, status });
    }
    if (visible.length > limit) break;
  }
  if (visible.length > limit) truncated = true;
  const selected = visible.slice(0, limit);
  const nodes = new Map<string, any>();
  const node = (m: any, label: string, entity?: string) => {
    const id = (entity ? "entity:" : "literal:") + hash(JSON.stringify([actor.workspace_id, m.scope, entity ?? label]));
    if (!nodes.has(id)) nodes.set(id, { id, label, kind: entity ? "entity" : "literal", scope: m.scope });
    return id;
  };
  const edges = selected.map((m) => {
    const source = node(m, m.subject, m.subject_id);
    // Exact canonical identity only, recorded and supported in this scope.
    // An entity in a private/other scope cannot change the public node's kind.
    const targets = store.all(
      "SELECT * FROM memories WHERE workspace_id=? AND scope=? AND subject=? AND recorded_from<=? AND valid_from<=? ORDER BY id LIMIT 101",
      actor.workspace_id, m.scope, m.object, recorded_at, valid_at,
    );
    const targetEntity = targets.slice(0, 100).find((t) => memory.support(t, recorded_at).length > 0);
    if (targets.length > 100) truncated = true;
    const target = node(m, m.object, targetEntity?.subject_id);
    const supports = m.supports ?? memory.support(m, recorded_at);
    const versions = store.all("SELECT version,reason,recorded_at FROM memory_versions WHERE memory_id=? AND scope=? AND recorded_at<=? AND snapshot_json IS NOT NULL ORDER BY version DESC LIMIT 21", m.id, m.scope, recorded_at);
    return {
      id: m.id, source, target, predicate: m.predicate, scope: m.scope, kind: m.kind,
      valid_from: m.valid_from, valid_to: m.valid_to, recorded_from: m.recorded_from,
      status: m.status, confidence: m.confidence, importance: m.importance,
      sources: supports.slice(0, 20).map((s: any) => ({ ...s, excerpt: s.excerpt ? redact(s.excerpt).slice(0, 2000) : null })),
      sources_truncated: supports.length > 20,
      versions: versions.slice(0, 20), versions_truncated: versions.length > 20,
    };
  });
  const selectedIds = new Set(selected.map((m) => m.id));
  let changesTruncated = false;
  const changes = selected.flatMap((m) => {
    const rows = store.all(
    "SELECT c.id,c.type,c.target_id,c.replacement_id,c.effective_at,c.recorded_at,e.event_id,e.client_id,e.revision,e.role,e.author_id,e.agent_id FROM memory_changes c JOIN memory_events e ON e.id=c.event_pk WHERE c.target_id=? AND c.recorded_at<=? ORDER BY c.recorded_at DESC,c.id LIMIT 21", m.id, recorded_at,
    );
    if (rows.length > 20) changesTruncated = true;
    return rows.slice(0, 20);
  }).map((c) => ({ ...c, replacement_id: selectedIds.has(c.replacement_id) ? c.replacement_id : null }))
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at) || a.id.localeCompare(b.id));
  // Diagnostics deliberately cover only the caller-bound agent, never private
  // intake from another agent even when shared curated memory is readable.
  const processing = store.all(
    "SELECT j.status,COUNT(*) AS count,MIN(j.created_at) AS oldest_at FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk JOIN memory_heads h ON h.event_pk=e.id WHERE e.workspace_id=? AND e.agent_id=? AND e.operation='upsert' GROUP BY j.status", actor.workspace_id, body.agent_id,
  );
  return { nodes: [...nodes.values()], edges, changes: changes.slice(0, 200), snapshot: { valid_at, recorded_at }, truncated: truncated || changesTruncated || changes.length > 200,
    scopes, available_scopes: allowed, processing: { agent_id: body.agent_id, jobs: processing, note: "Caller-agent intake only. Pending intake is not graph knowledge; other agents' shared digestion may lag." },
    limits: { edges: limit, candidate_scan: 2000, sources_per_edge: 20, versions_per_edge: 20, changes: 200 },
  };
}
