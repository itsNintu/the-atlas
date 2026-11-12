import { Store, id, now, hash, canonical, type Actor } from "./store.ts";
import { fail, text, timestamp, integer, object, ApiError } from "./errors.ts";
import {
  Inference,
  CURATE_PROMPT,
  redact,
  validateDecisions,
  type MemoryInference,
  type Decision,
} from "./inference.ts";
import { setting, sleep } from "./config.ts";
import { getEncoding } from "js-tiktoken";
const tokenEncoding =
  setting("TOKEN_ENCODING") === "cl100k_base" ? "cl100k_base" : "o200k_base";
const tokenizer = getEncoding(tokenEncoding);
export const memoryTokens = (s: string) => tokenizer.encode(s, [], []).length;
function modelFacingLine(m: any) {
  const author = String(m.supports?.[0]?.author_id ?? "");
  const owner = !author || author === "alex" || author.endsWith("/alex");
  const speaker = owner ? "" : `${author} noted: `;
  const day = (value: unknown) => String(value ?? "").slice(0, 10);
  const time = recallTemporalQualifier(m) ?? (m.historical
    ? `HISTORICAL ${m.historical_start_unknown ? "unknown start, " : ""}until ${m.valid_to ?? "closed"}`
    : m.conflict
      ? (m.historical_start_unknown ? "conflicts with another record" : `conflicts with another record, since ${day(m.valid_from)}`)
      : (m.historical_start_unknown || !m.valid_from ? "" : `since ${day(m.valid_from)}`));
  const compact = (value: unknown) => String(value ?? "").replace(/\bt_[0-9a-f]{6,}\b/gi, "").replace(/\d{17,}/g, "").replace(/\s{2,}/g, " ").trim();
  return `${speaker}${compact(m.subject)} | ${m.predicate} | ${compact(m.object)}${time ? ` (${time})` : ""}${modelFacingCorrections(m.corrections ?? [])}`;
}
export const memoryPromptHash = (focused=true) => hash(focused ? canonical({extract:EXTRACT_PROMPT,identity:IDENTITY_PROMPT,reconcile:RECONCILE_PROMPT,task_schema:'atlas-reconciliation-v2'}) : CURATE_PROMPT);
import { cosine } from "./provider.ts";
import { indexedCandidates, queryTerms } from "./memory-index.ts";
import { claimMemoryJob } from "./memory-scheduler.ts";
import { beginJevRequest, isJevPayment, isLunaCapacity, providerRequestSucceeded, recordProviderHold, releaseProviderProbe } from './provider-availability.ts';
import { admissionProof, auditorState, routeRecord, communicationRole, automaticStatusNotification } from "./memory-admission.ts";
import { EXTRACT_PROMPT, RECONCILE_PROMPT, validateReconciliations, normalizeReconciliation, mergeReconciliations, type Reconciliation } from './memory-reconciliation.ts';
import { IDENTITY_PROMPT, identityResponseContract, resolvedIdentity, candidateIdentities } from './memory-identity.ts';
import { canonicalOwnerDecision } from './memory-attribution.ts';
import { decisionAfterOperationalFilter, isPlaceholderOwnerRequirement, operationalStatusCategory } from './memory-operational.ts';
import { correctionReplacements } from "./memory-correction-lookup.ts";
import { correctionEvidence, modelFacingCorrections } from "./memory-corrections.ts";
import { activeChanges, consistentReconciliation } from "./memory-truth.ts";
import { assertCurrentJobEpoch, currentResetEpoch } from "./reset-state.ts";
import { recallFocus, needsRecallContext, asksAboutRecallProcess, isContextAvailabilityNote } from "./recall-query.ts";
import { usesNamedRecallFocus, namedRecallFocus, matchesNamedRecallFocus, recallTemporalQualifier } from './recall-presentation.ts';
import { analyzeRecallQuery, recallQueryExpansion, memoryEntityInfo, directNameAnswer, matchesRequestedFacet, topicCompatible, diverseSelection, metaNarrative, historicalPredicate, continuityProfile, continuityProfileRank, continuityTopic, continuityTopicRank, topicLabel, ENTITY_TYPE_PREDICATES, normalizedPredicate, type MemoryEntityInfo } from "./entity-model.ts";

// Share a turn budget across recalls and workers. Promise/microtask yields alone
// do not let Bun service sockets or lease heartbeats during long packing loops.
let memoryTurnUntil = 0;
async function budgetTokens(s: string) {
  if (performance.now() >= memoryTurnUntil) {
    await sleep(1);
    memoryTurnUntil = performance.now() + 8;
  }
  return memoryTokens(s);
}

// Deployment names are data, not a source-code allowlist. Only an authenticated
// administrator can bind them; authorization still requires the exact binding.
const validAgent = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const own = (agent: string) => `agent:${agent}`;
const positiveSetting = (name: string, fallback: number) => {
  const value = Number(setting(name) ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};
const normalize = (s: string) =>
  s.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
const parse = (s: string | null, fallback: any = []) =>
  s ? JSON.parse(s) : fallback;
const terms = (s: string) => [
  ...new Set(s.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []),
];
const relevance = (q: string, s: string) => {
  const ts = terms(q);
  const h = s.toLocaleLowerCase();
  return ts.length ? ts.filter((t) => h.includes(t)).length / ts.length : 0;
};

export class Memory {
  constructor(
    public store: Store,
    public inference: MemoryInference = new Inference(),
  ) {}
  // Local privileged setup or authenticated administrator; never inferred from request.agent_id.
  bind(admin: Actor, principal_id: string, agent_id: string) {
    this.store.active(admin);
    this.store.admin(admin);
    if (!validAgent(agent_id))
      fail(400, "invalid_agent", "Agent must be a lowercase deployment slug of 1-64 characters");
    const p = this.store.one(
      "SELECT * FROM principals WHERE id=? AND workspace_id=?",
      principal_id,
      admin.workspace_id,
    );
    if (!p) fail(404, "not_found", "Principal not found");
    return this.store.transaction(() => {
      const old = this.store.one(
        "SELECT * FROM memory_bindings WHERE principal_id=?",
        principal_id,
      );
      if (old && old.agent_id !== agent_id)
        fail(
          409,
          "binding_conflict",
          "Principal already bound; use a dedicated principal for each agent",
        );
      this.store.run(
        "INSERT OR IGNORE INTO memory_bindings VALUES (?,?,?,?)",
        principal_id,
        admin.workspace_id,
        agent_id,
        now(),
      );
      for (const scope of [own(agent_id), "user:alex", "business:alex"])
        for (const action of ["read", "write", "delete"])
          this.store.run(
            "INSERT OR IGNORE INTO memory_grants VALUES (?,?,?)",
            principal_id,
            scope,
            action,
          );
      return {
        principal_id,
        agent_id,
        scopes: [own(agent_id), "user:alex", "business:alex"],
      };
    });
  }
  // The caller generates and privately retains the token. Only its SHA-256 hash
  // crosses this admin API; neither the receipt nor idempotency stores a secret.
  provision(admin: Actor, body: any) {
    this.store.active(admin);
    this.store.admin(admin);
    const b = object(body);
    if (Object.keys(b).some(key => !["agent_id", "name", "token_hash"].includes(key)))
      fail(400, "invalid_request", "Only agent_id, name and token_hash are accepted");
    if (!validAgent(b.agent_id))
      fail(400, "invalid_agent", "Agent must be a lowercase deployment slug of 1-64 characters");
    const name = text(b.name, "name");
    if (typeof b.token_hash !== "string" || !/^[0-9a-f]{64}$/.test(b.token_hash))
      fail(400, "invalid_request", "token_hash must be a lowercase SHA-256 hex digest");
    return this.store.transaction(() => {
      if (this.store.one("SELECT principal_id FROM memory_bindings WHERE workspace_id=? AND agent_id=?", admin.workspace_id, b.agent_id))
        fail(409, "binding_conflict", "Agent already has a principal; existing bindings are never replaced");
      if (this.store.one("SELECT id FROM credentials WHERE token_hash=?", b.token_hash))
        fail(409, "credential_conflict", "Credential hash already exists");
      const principal_id = id("prn"), credential_id = id("key"), at = now();
      this.store.run("INSERT INTO principals VALUES (?,?,?,?,0,?)", principal_id, admin.workspace_id, name, "agent", at);
      const binding = this.bind(admin, principal_id, b.agent_id);
      this.store.run("INSERT INTO credentials VALUES (?,?,?,?,NULL)", credential_id, principal_id, b.token_hash, at);
      return { ...binding, credential_id, workspace_id: admin.workspace_id };
    });
  }
  authorize(a: Actor, agent_id: unknown, action = "read") {
    this.store.active(a);
    const b = this.store.one(
      "SELECT * FROM memory_bindings WHERE principal_id=? AND workspace_id=?",
      a.id,
      a.workspace_id,
    );
    if (!b || b.agent_id !== agent_id)
      fail(
        403,
        "agent_binding_required",
        "Credential must be server-bound to the requested agent",
      );
    const allowed = [own(b.agent_id), "user:alex", "business:alex"];
    const scopes = this.store
      .all(
        "SELECT scope FROM memory_grants WHERE principal_id=? AND action=?",
        a.id,
        action,
      )
      .map((x) => x.scope)
      .filter((x) => allowed.includes(x));
    if (!scopes.includes(own(b.agent_id)))
      fail(403, "memory_grant_required", "Agent graph grant required");
    return scopes as string[];
  }
  event(a: Actor, body: any) {
    this.authorize(
      a,
      body.agent_id,
      body.operation === "delete" ? "delete" : "write",
    );
    const b = object(body),
      client_id = text(b.client_id, "client_id", 128),
      event_id = text(b.event_id, "event_id", 512),
      revision = integer(b.revision, "revision", 1, 2147483647);
    if (!["upsert", "delete"].includes(b.operation))
      fail(400, "invalid_event", "operation must be upsert or delete");
    if (!(communicationRole(b.role) || (b.operation === 'delete' && b.role === 'tool')))
      fail(400, "invalid_event", "Invalid event role; only user/assistant/inter_agent communication is admitted");
    const thread_id = text(b.thread_id, "thread_id", 512),
      author_id = text(b.author_id, "author_id", 128);
    const occurred_at = timestamp(b.occurred_at, "occurred_at"),
      observed_at = timestamp(b.observed_at, "observed_at");
    const content =
      b.operation === "delete"
        ? null
        : typeof b.content === "string" && b.content.length <= 100_000
          ? redact(b.content)
          : fail(
              400,
              "invalid_event",
              "content must be a string up to 100000 characters",
            );
    const ids = (xs: any, name: string) => {
      if (
        !Array.isArray(xs) ||
        xs.length > 64 ||
        xs.some((x) => typeof x !== "string" || !x || x.length > 512)
      )
        fail(
          400,
          "invalid_event",
          `${name} must contain at most 64 source identities`,
        );
      return [...new Set(xs)] as string[];
    };
    const causal = ids(b.causal_parent_ids ?? [], "causal_parent_ids"),
      roots = ids(b.evidence_root_ids ?? [], "evidence_root_ids");
    const metadata = redact(JSON.stringify(object(b.metadata ?? {})));
    if (metadata.length > 16_000)
      fail(400, "invalid_event", "metadata too large");
    if (b.operation === 'upsert' && automaticStatusNotification({ ...b, content }))
      fail(400, 'automatic_status_notification', 'Automatic status/delivery notification events are metadata, not durable communication');
    const body_hash = hash(canonical(b));
    return this.store.transaction(() => {
      const old = this.store.one(
        "SELECT e.* FROM memory_heads h JOIN memory_events e ON e.id=h.event_pk WHERE h.workspace_id=? AND h.client_id=? AND h.event_id=?",
        a.workspace_id,
        client_id,
        event_id,
      );
      if (old && old.agent_id !== b.agent_id)
        fail(
          409,
          "event_identity_conflict",
          "Event belongs to a different agent",
        );
      const exact = this.store.one(
        "SELECT * FROM memory_events WHERE workspace_id=? AND client_id=? AND event_id=? AND revision=?",
        a.workspace_id,
        client_id,
        event_id,
        revision,
      );
      if (exact) {
        if (exact.body_hash !== body_hash)
          fail(
            409,
            "event_revision_conflict",
            "Same revision has different content",
          );
        return {
          event_id,
          revision,
          status: old.revision > revision ? "stale" : "duplicate",
          durable: true,
          job_id: exact.job_id,
        };
      }
      if (old && revision < old.revision)
        return {
          event_id,
          revision,
          status: "stale",
          durable: true,
          job_id: null,
        };
      const pk = id("event"),
        at = now(),
        epoch = currentResetEpoch(this.store);
      let job_id = b.operation === "upsert" ? id("mjob") : null;
      const inputRoots = roots.length
        ? roots
        : (b.role === "assistant" || b.role === "inter_agent") && causal.length
          ? causal
          : [`${client_id}:${event_id}`];
      const resolvedRoots = this.resolveRoots(a.workspace_id, inputRoots);
      if (old) {
        // A replacement invalidates ALL prior source-derived memory before new extraction.
        const previous = this.store.all(
          "SELECT id FROM memory_events WHERE workspace_id=? AND client_id=? AND event_id=?",
          a.workspace_id,
          client_id,
          event_id,
        );
        for (const p of previous)
          this.removeEvidence(p.id, b.operation === "delete");
        this.store.run(
          "UPDATE memory_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE event_pk IN (SELECT id FROM memory_events WHERE workspace_id=? AND client_id=? AND event_id=?) AND status<>'succeeded'",
          a.workspace_id,
          client_id,
          event_id,
        );
        this.store.run(
          "UPDATE memory_events SET status='superseded' WHERE workspace_id=? AND client_id=? AND event_id=?",
          a.workspace_id,
          client_id,
          event_id,
        );
        if (b.operation === "delete")
          this.store.run(
            "UPDATE memory_events SET content=NULL,metadata_json=NULL WHERE workspace_id=? AND client_id=? AND event_id=?",
            a.workspace_id,
            client_id,
            event_id,
          );
      }
      this.store.run(
        "INSERT INTO memory_events (id,workspace_id,client_id,event_id,revision,operation,agent_id,thread_id,role,author_id,occurred_at,observed_at,accepted_at,content,metadata_json,causal_json,roots_json,body_hash,principal_id,credential_id,job_id,status,reset_epoch) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        pk,
        a.workspace_id,
        client_id,
        event_id,
        revision,
        b.operation,
        b.agent_id,
        thread_id,
        b.role,
        author_id,
        occurred_at,
        observed_at,
        at,
        content,
        metadata,
        JSON.stringify(causal),
        JSON.stringify(resolvedRoots),
        body_hash,
        a.id,
        a.credential_id,
        job_id,
        job_id ? "pending" : "deleted",
        epoch,
      );
      this.store.run(
        "INSERT INTO memory_heads VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,client_id,event_id) DO UPDATE SET event_pk=excluded.event_pk,revision=excluded.revision",
        a.workspace_id,
        client_id,
        event_id,
        pk,
        revision,
      );
      for (const root of resolvedRoots) {
        const previous = this.store.one(
          "SELECT r.*,e.client_id,e.event_id FROM memory_roots r LEFT JOIN memory_events e ON e.id=r.owner_event_pk WHERE r.workspace_id=? AND r.root_id=?",
          a.workspace_id,
          root,
        );
        if (!previous)
          this.store.run(
            "INSERT INTO memory_roots VALUES (?,?,?,?)",
            a.workspace_id,
            root,
            pk,
            b.operation === "delete" ? at : null,
          );
        else if (
          previous.client_id === client_id &&
          previous.event_id === event_id
        )
          this.store.run(
            "UPDATE memory_roots SET owner_event_pk=?,forgotten_at=? WHERE workspace_id=? AND root_id=?",
            pk,
            b.operation === "delete" ? at : null,
            a.workspace_id,
            root,
          );
      }
      if (
        b.operation === "upsert" &&
        resolvedRoots.some(
          (root) =>
            this.store.one(
              "SELECT forgotten_at FROM memory_roots WHERE workspace_id=? AND root_id=?",
              a.workspace_id,
              root,
            )?.forgotten_at,
        )
      ) {
        job_id = null;
        this.store.run(
          "UPDATE memory_events SET content=NULL,metadata_json=NULL,status='forgotten',job_id=NULL WHERE id=?",
          pk,
        );
      }
      if (job_id)
        this.store.run(
          "INSERT INTO memory_jobs (id,event_pk,status,available_at,created_at,reset_epoch) VALUES (?,?,'queued',?,?,?)",
          job_id,
          pk,
          Date.now(),
          at,
          epoch,
        );
      return { event_id, revision, status: "accepted", durable: true, job_id };
    });
  }
  deleteMemory(memory_id: string, reason: string, seen = new Set<string>()) {
    if (seen.has(memory_id)) return;
    seen.add(memory_id);
    for (const c of this.store.all(
      "SELECT child_id FROM memory_lineage WHERE parent_id=?",
      memory_id,
    ))
      this.deleteMemory(c.child_id, "parent_" + reason, seen);
    // Retain only a non-content version tombstone, not a shadow copy of forgotten text.
    this.store.run(
      "UPDATE memory_versions SET snapshot_json=NULL,reason=? WHERE memory_id=?",
      reason,
      memory_id,
    );
    this.store.run("DELETE FROM memories WHERE id=?", memory_id);
  }
  invalidateChildren(memory_id: string, reason: string) {
    for (const c of this.store.all(
      "SELECT child_id FROM memory_lineage WHERE parent_id=?",
      memory_id,
    ))
      this.deleteMemory(c.child_id, reason);
  }
  resolveRoots(workspace: string, roots: string[]) {
    return [
      ...new Set(
        roots.flatMap((root) => {
          const ref = this.store.one(
            "SELECT e.roots_json FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id WHERE e.workspace_id=? AND (e.event_id=? OR e.client_id||':'||e.event_id=?)",
            workspace,
            root,
            root,
          );
          return ref ? parse(ref.roots_json) : [root];
        }),
      ),
    ] as string[];
  }
  removeEvidence(event_pk: string, forget: boolean) {
    const origin = this.store.one(
      "SELECT * FROM memory_events WHERE id=?",
      event_pk,
    );
    const owned = this.store
      .all(
        "SELECT root_id FROM memory_roots WHERE workspace_id=? AND owner_event_pk=?",
        origin.workspace_id,
        event_pk,
      )
      .map((x) => x.root_id);
    this.store.run(
      "UPDATE memory_roots SET forgotten_at=? WHERE owner_event_pk=?",
      now(),
      event_pk,
    );
    this.store.run("DELETE FROM memory_chunk_progress WHERE event_pk=?", event_pk);
    const tainted = new Set<string>([event_pk]);
    for (const root of owned)
      for (const e of this.store.all(
        "SELECT id FROM memory_events WHERE workspace_id=? AND EXISTS(SELECT 1 FROM json_each(roots_json) WHERE value=?)",
        origin.workspace_id,
        root,
      ))
        tainted.add(e.id);
    const affected = new Set<string>();
    for (const source of tainted) {
      for (const c of this.store.all(
        "SELECT DISTINCT target_id FROM memory_changes WHERE event_pk=?",
        source,
      ))
        this.invalidateChildren(c.target_id, "change_repaired");
      this.store.run("DELETE FROM memory_changes WHERE event_pk=?", source);
      this.store.run('DELETE FROM memory_entity_equivalence_invalidations WHERE event_pk=? OR repair_event_pk=?',source,source);
      this.store.run('DELETE FROM memory_entity_equivalences WHERE event_pk=?',source);
      this.store.run('DELETE FROM memory_alias_sources WHERE event_pk=?',source);
      for (const x of this.store.all(
        "SELECT memory_id FROM memory_supports WHERE event_pk=?",
        source,
      ))
        affected.add(x.memory_id);
      this.store.run("DELETE FROM memory_supports WHERE event_pk=?", source);
      this.store.run(
        "DELETE FROM memory_feedback WHERE outcome_event_pk=?",
        source,
      );
      if (source !== event_pk) {
        this.store.run(
          "UPDATE memory_events SET content=NULL,metadata_json=NULL,status='forgotten' WHERE id=?",
          source,
        );
        this.store.run(
          "UPDATE memory_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE event_pk=?",
          source,
        );
      }
    }
    for (const memory_id of affected) {
      this.invalidateChildren(
        memory_id,
        forget ? "forgotten_parent" : "revised_parent",
      );
      if (
        !this.store.one(
          "SELECT 1 FROM memory_supports WHERE memory_id=?",
          memory_id,
        )
      )
        this.deleteMemory(memory_id, forget ? "forgotten" : "revised");
    }
    this.store.run(
      "DELETE FROM memory_aliases WHERE entity_id IN (SELECT id FROM memory_entities e WHERE NOT EXISTS(SELECT 1 FROM memories m WHERE m.subject_id=e.id) AND NOT EXISTS(SELECT 1 FROM memory_entity_targets t WHERE t.entity_id=e.id))",
    );
    this.store.run(
      "DELETE FROM memory_entities WHERE NOT EXISTS(SELECT 1 FROM memories m WHERE m.subject_id=memory_entities.id) AND NOT EXISTS(SELECT 1 FROM memory_entity_targets t WHERE t.entity_id=memory_entities.id)",
    );
    this.store.run('DELETE FROM memory_scoped_aliases WHERE NOT EXISTS(SELECT 1 FROM memory_alias_sources s WHERE s.workspace_id=memory_scoped_aliases.workspace_id AND s.scope=memory_scoped_aliases.scope AND s.alias=memory_scoped_aliases.alias AND s.entity_id=memory_scoped_aliases.entity_id)');
    this.store.run(
      "UPDATE memories SET use_count=(SELECT COUNT(*) FROM memory_feedback f,json_each(f.used_ids_json) u WHERE u.value=memories.id),last_used_at=(SELECT MAX(f.created_at) FROM memory_feedback f,json_each(f.used_ids_json) u WHERE u.value=memories.id)",
    );
    // No recalled-context cache exists. Recall receipts contain IDs only.
  }
  visibleEvent(e: any, agent: string, scopes: string[]) {
    return (
      (e.agent_id === agent && scopes.includes(own(agent))) ||
      (scopes.includes("user:alex") &&
        e.role === "user" &&
        e.author_id === "alex")
    );
  }
  safeEvent(e: any) {
    return {
      event_id: e.event_id,
      client_id: e.client_id,
      revision: e.revision,
      operation: e.operation,
      agent_id: e.agent_id,
      thread_id: e.thread_id,
      role: e.role,
      author_id: e.author_id,
      occurred_at: e.occurred_at,
      observed_at: e.observed_at,
      content: e.content,
      metadata: parse(e.metadata_json, {}),
      causal_parent_ids: parse(e.causal_json),
      evidence_root_ids: parse(e.roots_json),
    };
  }
  events(a: Actor, agent: string) {
    const scopes = this.authorize(a, agent);
    return this.store
      .all(
        "SELECT e.* FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id WHERE e.workspace_id=? ORDER BY e.accepted_at DESC",
        a.workspace_id,
      )
      .filter((e) => this.visibleEvent(e, agent, scopes));
  }
  eventCurrent(e: any) {
    const current = this.store.one(
      "SELECT e.* FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id WHERE e.id=?",
      e.id,
    );
    return current && canonical(this.safeEvent(current)) === canonical(this.safeEvent(e));
  }
  diagnostics(a: Actor, agent: string) {
    this.authorize(a, agent);
    return this.store.all(
      "SELECT j.id,j.status,j.attempts,j.max_attempts,j.available_at,j.lease_until,j.error_code,j.created_at,j.completed_at,e.event_id,e.revision,e.agent_id FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk WHERE e.workspace_id=? AND e.agent_id=? ORDER BY j.created_at DESC LIMIT 100",
      a.workspace_id,
      agent,
    );
  }
  retry(a: Actor, agent: string, job_id: string) {
    this.authorize(a, agent, "write");
    const j = this.store.one(
      "SELECT j.*,e.role,e.author_id,e.content,e.metadata_json FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk JOIN memory_heads h ON h.event_pk=e.id WHERE j.id=? AND e.workspace_id=? AND e.agent_id=? AND e.operation='upsert' AND e.role IN ('user','assistant','inter_agent')",
      job_id,
      a.workspace_id,
      agent,
    );
    if (!j) fail(404, "not_found", "Current memory job not found");
    assertCurrentJobEpoch(this.store, j.reset_epoch);
    if (automaticStatusNotification(j)) fail(409, 'automatic_status_notification', 'Automatic status/delivery notification events cannot be retried');
    if (!["failed", "retry"].includes(j.status))
      fail(409, "job_not_retryable", "Only failed/retry jobs can be retried");
    this.store.run(
      "UPDATE memory_jobs SET status='queued',attempts=0,error_code=NULL,completed_at=NULL,available_at=?,lease_token=NULL,lease_until=NULL WHERE id=?",
      Date.now(),
      job_id,
    );
    return { job_id, status: "queued" };
  }
  reprocess(a: Actor, agent: string, previous_job_id: string, expected_revision: unknown, reason_code: unknown) {
    this.authorize(a, agent, "write");
    const revision = integer(expected_revision, "expected_revision", 1, Number.MAX_SAFE_INTEGER);
    const reason = text(reason_code, "reason_code", 80);
    if (!/^[a-z0-9_-]+$/.test(reason)) fail(400, "invalid_request", "reason_code must be a non-content diagnostic identifier");
    return this.store.transaction(() => {
      const e = this.store.one(`SELECT e.*,j.status AS job_status,j.reset_epoch AS job_reset_epoch FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id JOIN memory_jobs j ON j.id=e.job_id
        WHERE j.id=? AND e.workspace_id=? AND e.agent_id=? AND e.operation='upsert'`, previous_job_id,a.workspace_id,agent);
      if (!e) fail(404, "not_found", "Current memory job not found");
      assertCurrentJobEpoch(this.store, e.reset_epoch, e.job_reset_epoch);
      if (!communicationRole(e.role)) fail(409, 'communication_only', 'Only communication events can be reprocessed');
      if (automaticStatusNotification(e)) fail(409, 'automatic_status_notification', 'Automatic status/delivery notification events cannot be reprocessed');
      if (e.revision !== revision) fail(409, "revision_conflict", "Memory event revision changed");
      const completed = e.job_status === "succeeded" && e.status === "processed";
      const reconsider = e.job_status === "skipped" && e.status === "captured";
      if (!completed && !reconsider) fail(409, "job_not_reprocessable", "Only a completed or capture-filtered current memory event can be reprocessed");
      if (!e.content || !this.eventCurrent(e)) fail(409, "source_unavailable", "Original memory content is no longer available");
      if (this.store.one(`SELECT 1 FROM memory_jobs j JOIN memory_events x ON x.id=j.event_pk WHERE x.workspace_id=? AND x.agent_id=? AND x.thread_id=? AND j.status='running'`,e.workspace_id,agent,e.thread_id))
        fail(409, "conversation_busy", "Conversation has active curation; retry after its current claim");
      const job_id = id("mjob"), at = now();
      this.store.run("INSERT INTO memory_jobs (id,event_pk,status,available_at,created_at,reset_epoch) VALUES (?,?,'queued',?,?,?)",job_id,e.id,Date.now(),at,currentResetEpoch(this.store));
      if (completed)
        this.store.run("INSERT INTO memory_reprocess_requests VALUES (?,?,?,?,?,?,?,?)",job_id,previous_job_id,e.id,a.id,reason,memoryPromptHash(!!this.inference.reconcile),e.processed_at,at);
      else
        this.store.run("INSERT INTO memory_reconsider_requests VALUES (?,?,?,?,?,?,?,?)",job_id,previous_job_id,e.id,a.id,reason,memoryPromptHash(!!this.inference.reconcile),e.accepted_at,at);
      // Keep source identity/content/roots, original accepted time, old job and
      // metrics, existing knowledge and recorded history. Only memory digestion
      // is queued; no original tool/action is executable through this route.
      this.store.run("UPDATE memory_events SET status='pending',job_id=? WHERE id=?",job_id,e.id);
      return {job_id,previous_job_id,event_id:e.event_id,revision:e.revision,status:"queued",memory_only:true,reconsidered:reconsider};
    });
  }
  reviewAdmission(a:Actor, agent:string, previous_job_id:string, memory_id:string, expected_revision:unknown, reason_code:unknown) {
    this.authorize(a,agent,'read'); this.authorize(a,agent,'write');
    const revision=integer(expected_revision,'expected_revision',1,Number.MAX_SAFE_INTEGER);
    const reason=text(reason_code,'reason_code',80);
    if(!/^[a-z0-9_-]+$/.test(reason))fail(400,'invalid_request','reason_code must be a non-content diagnostic identifier');
    if(!['session_local_owner_correction','execution_content_owner_exclusion','automatic_notification_owner_exclusion','operational_status_owner_exclusion','invalid_placeholder_owner_exclusion'].includes(reason))fail(400,'invalid_request','Unsupported owner-directed admission review reason');
    const executionExclusion=reason==='execution_content_owner_exclusion';
    const notificationExclusion=reason==='automatic_notification_owner_exclusion';
    const operationalExclusion=reason==='operational_status_owner_exclusion';
    const placeholderExclusion=reason==='invalid_placeholder_owner_exclusion';
    const contentExclusion=executionExclusion||notificationExclusion;
    const reviewScopes=(contentExclusion||operationalExclusion||placeholderExclusion)?['user:alex','business:alex',own(agent)]:['user:alex','business:alex'];
    const e=this.store.one(`SELECT e.*,j.status AS job_status,j.reset_epoch AS job_reset_epoch FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id JOIN memory_jobs j ON j.id=e.job_id AND j.event_pk=e.id WHERE j.id=? AND e.workspace_id=? AND e.agent_id=? AND e.operation='upsert'`,previous_job_id,a.workspace_id,agent);
    if(!e)fail(404,'not_found','Current source job not found');
    assertCurrentJobEpoch(this.store,e.reset_epoch,e.job_reset_epoch);
    if(e.revision!==revision)fail(409,'revision_conflict','Memory event revision changed');
    const completed=e.job_status==='succeeded'&&e.status==='processed';
    const failedContentExclusion=(contentExclusion||operationalExclusion||placeholderExclusion)&&e.job_status==='failed'&&e.status==='pending';
    if(!completed&&!failedContentExclusion)fail(409,'job_not_reviewable','Only a completed source job or a failed/pending content exclusion can be admission-reviewed');
    if(!this.eventCurrent(e))fail(409,'source_unavailable','Original memory source revision is no longer current');
    if(notificationExclusion&&!automaticStatusNotification(e))fail(409,'not_automatic_notification','Source is not an automatic status/delivery notification');
    const m=this.store.one(`SELECT m.* FROM memories m JOIN memory_supports s ON s.memory_id=m.id AND s.event_pk=? WHERE m.id=? AND m.workspace_id=? AND m.scope IN (${reviewScopes.map(()=>'?').join(',')})`,e.id,memory_id,a.workspace_id,...reviewScopes);
    if(!m)fail(404,'not_found','Memory with direct source support was not found');
    if(notificationExclusion){
      const supports=this.store.all('SELECT e.* FROM memory_supports s JOIN memory_events e ON e.id=s.event_pk WHERE s.memory_id=?',memory_id);
      if(!supports.length||supports.some(source=>!automaticStatusNotification(source)))fail(409,'notification_only_support_required','automatic_notification_owner_exclusion requires notification-only direct support');
    }
    if(operationalExclusion){
      const supports=this.store.all('SELECT e.* FROM memory_supports s JOIN memory_events e ON e.id=s.event_pk WHERE s.memory_id=?',memory_id);
      if(!supports.length||supports.some(source=>!operationalStatusCategory(m,source)))fail(409,'operational_only_support_required','Operational-status exclusion requires operational-only direct support');
    }
    if(placeholderExclusion&&m.object.trim()&&!isPlaceholderOwnerRequirement(m))fail(409,'not_empty_placeholder','Placeholder exclusion requires an empty/whitespace object or a placeholder owner requirement');
    const readable=this.authorize(a,agent,'read'),writable=this.authorize(a,agent,'write');
    if(!readable.includes(m.scope)||!writable.includes(m.scope))fail(403,'memory_grant_required','Memory read/write grant required');
    const previous=this.auditPrevious(e,readable,5);
    const result={choice:'session_context',confidence:1,model:'owner_directive',elapsed_ms:0};
    const proof=admissionProof('admission_review',e.job_id?{id:e.job_id}:{id:previous_job_id},e,previous,result,{memory_id,reason});
    return this.store.transaction(()=>{
      if(!this.eventCurrent(e))fail(409,'curation_context_changed','Source changed during admission review',true);
      const currentReadable=this.authorize(a,agent,'read'),currentWritable=this.authorize(a,agent,'write');
      if(!currentReadable.includes(m.scope)||!currentWritable.includes(m.scope))fail(403,'memory_grant_required','Memory grant changed');
      const prior=this.store.one('SELECT r.id,d.reason_code,d.recorded_at FROM memory_admission_reviews r JOIN memory_admission_demotions d ON d.review_id=r.id WHERE r.memory_id=? AND r.proof_sha256=?',memory_id,proof);
      if(prior)return{review_id:prior.id,memory_id,decision:result.choice,model:result.model,confidence:result.confidence,demoted:true,proof_sha256:proof,recorded_at:prior.recorded_at};
      if(this.store.one('SELECT 1 FROM memory_admission_demotions WHERE memory_id=?',memory_id))fail(409,'admission_already_demoted','Memory already has a supported admission demotion');
      const review_id=id('admissionreview'),at=now();
      this.store.run('INSERT INTO memory_admission_reviews VALUES (?,?,?,?,?,?,?,?,?,?,?)',review_id,previous_job_id,e.id,memory_id,a.id,result.choice,result.model,result.confidence,proof,result.elapsed_ms,at);
      const demoted=['session_context','noise'].includes(result.choice);
      if(demoted)this.store.run('INSERT INTO memory_admission_demotions VALUES (?,?,?,?,?)',memory_id,review_id,reason,proof,at);
      return{review_id,memory_id,decision:result.choice,model:result.model,confidence:result.confidence,demoted,proof_sha256:proof,recorded_at:at};
    });
  }
  auditPrevious(e:any, readable:string[], limit=5) {
    return this.store.all(
      "SELECT e.* FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id WHERE e.reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1) AND e.workspace_id=? AND e.agent_id=? AND e.thread_id=? AND e.accepted_at<=? AND e.rowid<(SELECT rowid FROM memory_events WHERE id=?) AND e.role IN ('user','assistant','inter_agent') AND e.content IS NOT NULL AND e.status NOT IN ('forgotten','deleted','superseded') ORDER BY e.accepted_at DESC,e.rowid DESC LIMIT ?",
      e.workspace_id,e.agent_id,e.thread_id,e.accepted_at,e.id,limit,
    ).filter(x=>!automaticStatusNotification(x)&&this.visibleEvent(x,e.agent_id,readable)).reverse();
  }
  canonicalEntity(workspace:string,scope:string,entity:string,recorded_at=now(),path:string[]=[]):string {
    if(path.includes(entity)||path.length>=16)return entity;
    const rows=this.store.all(`SELECT DISTINCT q.canonical_id FROM memory_entity_equivalences q JOIN memory_events e ON e.id=q.event_pk JOIN memory_heads h ON h.event_pk=e.id WHERE q.workspace_id=? AND q.scope=? AND q.entity_id=? AND q.recorded_at<=? AND e.status NOT IN ('forgotten','deleted','superseded') AND NOT EXISTS(SELECT 1 FROM memory_entity_equivalence_invalidations i JOIN memory_events re ON re.id=i.repair_event_pk JOIN memory_heads rh ON rh.event_pk=re.id WHERE i.workspace_id=q.workspace_id AND i.scope=q.scope AND i.entity_id=q.entity_id AND i.canonical_id=q.canonical_id AND i.event_pk=q.event_pk AND i.recorded_at<=? AND re.status NOT IN ('forgotten','deleted','superseded'))`,workspace,scope,entity,recorded_at,recorded_at);
    const roots=[...new Set<string>(rows.map(r=>this.canonicalEntity(workspace,scope,r.canonical_id,recorded_at,[...path,entity])))];
    return roots.length===1&&!path.includes(roots[0]) ? roots[0] : entity;
  }
  entity(
    workspace: string,
    label: string,
    aliases: { canonical: string; aliases: string[] }[] = [],
    scopes: string[] = [],
    source?:string,
  ) {
    let canonicalName = label;
    const found = aliases.find(
      (x) =>
        normalize(x.canonical) === normalize(label) ||
        x.aliases.some((a) => normalize(a) === normalize(label)),
    );
    if (found) canonicalName = found.canonical;
    // Scope is an identity fence, not merely a visibility filter. Never consult
    // the old workspace-global alias registry (retained for custody only).
    if (scopes.length !== 1) fail(503,'entity_scope_required','Entity resolution needs exactly one target scope',true);
    const scope = scopes[0];
    const existing = this.store.one(`SELECT e.* FROM memory_entities e JOIN memory_scoped_aliases a ON a.entity_id=e.id
      WHERE a.workspace_id=? AND a.scope=? AND a.alias=? AND EXISTS(SELECT 1 FROM memory_alias_sources p JOIN memory_events x ON x.id=p.event_pk JOIN memory_heads h ON h.event_pk=x.id WHERE p.workspace_id=a.workspace_id AND p.scope=a.scope AND p.alias=a.alias AND p.entity_id=a.entity_id AND x.status NOT IN ('forgotten','deleted','superseded'))`,workspace,scope,normalize(canonicalName)) ??
      this.store.one('SELECT * FROM memory_entities WHERE workspace_id=? AND canonical=?',workspace,canonicalName);
    const entity_id = existing?.id ?? id('entity');
    if (!existing) this.store.run('INSERT INTO memory_entities VALUES (?,?,?)',entity_id,workspace,canonicalName);
    for (const alias of [label, canonicalName, ...(found?.aliases ?? [])]) {
      this.store.run('INSERT OR IGNORE INTO memory_scoped_aliases VALUES (?,?,?,?)',workspace,scope,normalize(alias),entity_id);
      if(source)this.store.run('INSERT OR IGNORE INTO memory_alias_sources VALUES (?,?,?,?,?)',workspace,scope,normalize(alias),entity_id,source);
    }
    const resolved=this.canonicalEntity(workspace,scope,entity_id);
    return {id:resolved,label:this.store.one('SELECT canonical FROM memory_entities WHERE id=?',resolved).canonical};
  }
  support(m: any, recorded_at = now()) {
    return this.store
      .all(
        "SELECT s.roots_json,s.excerpt,e.event_id,j.id AS job_id,e.client_id,e.revision,e.agent_id,e.role,e.author_id,e.occurred_at,e.accepted_at FROM memory_supports s JOIN memory_events e ON e.id=s.event_pk JOIN memory_jobs j ON j.event_pk=e.id WHERE s.memory_id=? AND e.accepted_at<=?",
        m.id,
        recorded_at,
      )
      .map((s) => ({
        ...s,
        roots_json: undefined,
        evidence_root_ids: parse(s.roots_json),
      }));
  }
  effective(m: any, valid_at: string, recorded_at: string) {
    if (m.recorded_from > recorded_at) return null;
    const demoted = this.store.one('SELECT d.recorded_at,d.reason_code FROM memory_admission_demotions d WHERE d.memory_id=? AND d.recorded_at<=?',m.id,recorded_at);
    if (demoted) {
      const contentExclusion = ['execution_content_owner_exclusion','automatic_notification_owner_exclusion'].includes(demoted.reason_code);
      const restorationRoles = contentExclusion && m.scope.startsWith('agent:') ? "('user','assistant','inter_agent')" : "('user')";
      const later = this.store.all(`SELECT e.role,e.author_id,e.content,e.metadata_json FROM memory_supports s JOIN memory_events e ON e.id=s.event_pk WHERE s.memory_id=? AND e.role IN ${restorationRoles} AND e.accepted_at>? AND e.accepted_at<=?`,m.id,demoted.recorded_at,recorded_at);
      if (!later.some(source=>!automaticStatusNotification(source))) return null;
    }
    const support = this.support(m, recorded_at);
    if (!support.length) return null;
    const changes = activeChanges(this.store,m.id,recorded_at);
    const representation=changes.filter(c=>['superseded','restored'].includes(c.type)).sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at)||a.change_order-b.change_order).at(-1);
    if (changes.some((c) => ["correction", "retraction"].includes(c.type)) || representation?.type==='superseded')
      return null;
    let end = m.valid_to;
    for (const c of changes)
      if (
        c.type === "state_change" &&
        (!end || c.effective_at < end)
      )
        end = c.effective_at;
    if (m.valid_from > valid_at || (end && end <= valid_at)) return null;
    const lineage = this.store.all(
      "SELECT parent_id,parent_version FROM memory_lineage WHERE child_id=?",
      m.id,
    );
    // Derived material cannot outlive a changed/retracted parent or bypass its valid interval.
    for (const p of lineage) {
      const parent = this.store.one(
        "SELECT * FROM memories WHERE id=?",
        p.parent_id,
      );
      if (
        !parent ||
        parent.version !== p.parent_version ||
        !this.effective(parent, valid_at, recorded_at)
      )
        return null;
    }
    const subject_id = this.canonicalEntity(m.workspace_id, m.scope, m.subject_id, recorded_at);
    const subject = subject_id === m.subject_id ? m.subject : this.store.one('SELECT canonical FROM memory_entities WHERE id=?', subject_id)?.canonical ?? m.subject;
    const target = this.store.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=?', m.id);
    const target_id = target?.entity_id ? this.canonicalEntity(m.workspace_id, m.scope, target.entity_id, recorded_at) : null;
    const object = target_id && target_id !== target.entity_id ? this.store.one('SELECT canonical FROM memory_entities WHERE id=?', target_id)?.canonical ?? m.object : m.object;
    return {
      ...m,
      subject_id,
      subject,
      object,
      valid_to: end,
      ...(changes.some(c=>c.type==='start_unknown')?{historical_start_unknown:true}:{}),
      changes: changes.map((c) => ({
        type: c.type,
        effective_at: c.effective_at,
        replacement_id: c.replacement_id,
      })),
      conflict: changes.some((c) => c.type === "conflict"),
      lineage,
      supports: support,
      evidence_roots: [...new Set(support.flatMap((s) => s.evidence_root_ids))],
    };
  }
  communicationSupport(m: any) {
    const supports = this.support(m).filter((support: any) => communicationRole(support.role));
    if (!supports.length) return [];
    const automatic = new Set(this.store.all(
      'SELECT e.client_id,e.event_id,e.revision,e.role,e.author_id,e.content,e.metadata_json FROM memory_supports s JOIN memory_events e ON e.id=s.event_pk WHERE s.memory_id=?',
      m.id,
    ).filter(automaticStatusNotification).map((source:any)=>`${source.client_id}:${source.event_id}@${source.revision}`));
    return supports.filter((support:any)=>!automatic.has(`${support.client_id}:${support.event_id}@${support.revision}`));
  }
  entityInfo(m:any, valid_at=now(), recorded_at=now()):MemoryEntityInfo {
    const target=this.store.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=?',m.id);
    const types=(entity:string|undefined)=>entity?this.store.all(
      "SELECT * FROM memories WHERE workspace_id=? AND scope=? AND subject_id=? AND predicate IN ('is_a','instance_of','entity_type','has_type','type') LIMIT 24",
      m.workspace_id,m.scope,entity).filter(row=>this.effective(row,valid_at,recorded_at)).map(row=>row.object):[];
    return memoryEntityInfo(m,types(m.subject_id),types(target?.entity_id),Boolean(target?.entity_id));
  }
  candidateEntityMetadata(m:any) {
    const target=this.store.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=?',m.id);
    const info=this.entityInfo(m);
    return {subject_entity_id:m.subject_id,object_entity:target?Boolean(target.entity_id):undefined,object_entity_id:target?.entity_id??null,
      subject_types:info.subjectTypes,object_types:info.objectTypes,relationship_topics:info.topics};
  }
  candidates(workspace: string, scopes: string[], query: string, count = Math.min(12, positiveSetting("CURATION_CANDIDATE_LIMIT", 8)), rank?: (row:any)=>number) {
    return indexedCandidates(this.store, workspace, scopes, query, undefined, undefined, Math.max(24,count*2))
      .sort((a,b) => (rank ? rank(b)-rank(a) : relevance(query, `${b.subject} ${b.predicate} ${b.object}`) - relevance(query, `${a.subject} ${a.predicate} ${a.object}`)) || b.recorded_from.localeCompare(a.recorded_from))
      .map(m => ({ id: m.id, scope: m.scope, kind: m.kind, subject: m.subject,
        predicate: m.predicate, object: m.object, version: m.version,
        valid_from: m.valid_from, valid_to: m.valid_to, derived: m.derived,
        ...this.candidateEntityMetadata(m),
        supports: this.communicationSupport(m),
        changes: activeChanges(this.store,m.id).map(({type,effective_at,replacement_id})=>({type,effective_at,replacement_id})),
        lineage: this.store.all("SELECT parent_id,parent_version FROM memory_lineage WHERE child_id=?", m.id),
      }))
      .filter(candidate => candidate.supports.length > 0)
      .slice(0, Math.min(24,count));
  }
  async recall(a: Actor, b: any) {
    const started = performance.now();
    let scopes = this.authorize(a, b.agent_id);
    const query = redact(typeof b.query === "string" && b.query.length <= 16_000
      ? b.query : fail(400, "invalid_request", "query must be text up to 16000 characters"));
    const thread_id = text(b.thread_id, "thread_id", 512);
    // Concise default; explicit larger budgets remain supported. Relevance,
    // not allocation size, determines the indexed candidate pool.
    const requested = integer(b.token_budget, "token_budget", 0, 100_000, 1200);
    const budget = requested;
    const valid_at = timestamp(b.valid_at ?? now(), "valid_at");
    const recorded_at = timestamp(b.recorded_at ?? now(), "recorded_at");
    if (!Array.isArray(b.recent_context ?? []) || (b.recent_context ?? []).length > 32)
      fail(400, "invalid_request", "recent_context must have at most 32 messages");
    if (b.session_start != null && typeof b.session_start !== "boolean")
      fail(400, "invalid_request", "session_start must be boolean");
    const sessionStart = b.session_start === true;
    // Only ambiguous followups use bounded caller context for query resolution;
    // this is not evidence and never pulls a pending transcript into recall.
    for (const x of b.recent_context ?? []) {
      text(x.role, "role", 32); text(x.content, "content", 16_000);
    }
    const focus = recallFocus(query);
    const recentCandidates = (b.recent_context ?? []).filter((x:any) => ["user","assistant"].includes(x.role)).slice(-2)
      .map((x:any) => recallFocus(redact(x.content.slice(-600))))
      .filter((s:string) => s && normalize(s) !== normalize(focus));
    const plan = analyzeRecallQuery(focus, recentCandidates);
    const snippets = plan.context;
    const searchQuery = [focus, ...snippets].join("\n");
    const expansionQuery = recallQueryExpansion(plan);
    const processQuery = asksAboutRecallProcess(focus);
    let qvector: number[] | undefined, qmodel: string | undefined;
    let semantic_status = "not_requested", embedding_ms = 0;
    const greetingOnlySessionStart = sessionStart && /^(?:hey|hi|hello|yo)[!.\s]*$/i.test(query.trim());
    if (query.trim() && budget && !greetingOnlySessionStart) {
      const t = performance.now();
      try {
        const result = await this.inference.embed([searchQuery]);
        qvector = result.vectors[0]; qmodel = result.model;
        semantic_status = qvector ? "available" : "disabled";
      } catch (e) { semantic_status = e instanceof ApiError ? e.code : "embedding_failed"; }
      embedding_ms = performance.now() - t;
    }
    scopes = this.authorize(a, b.agent_id);
    const candidateRows = new Map<string,any>();
    const addCandidates=(rows:any[])=>{for(const row of rows)candidateRows.set(row.id,row);};
    if (budget) {
      addCandidates(indexedCandidates(this.store, a.workspace_id, scopes, searchQuery, qvector, qmodel));
      if (expansionQuery) addCandidates(indexedCandidates(this.store, a.workspace_id, scopes, `${searchQuery} ${expansionQuery}`, undefined, undefined));
      // Broad self/domain questions intentionally materialize a bounded, varied
      // candidate set. Narrow questions never become broad because budget remains.
      if (['profile','domain'].includes(plan.mode)) {
        const selectedScopes=plan.mode==='profile'?scopes.filter(s=>!s.startsWith('agent:')):scopes;
        for (const scope of selectedScopes) addCandidates(this.store.all(
          'SELECT * FROM memories WHERE workspace_id=? AND scope=? ORDER BY importance DESC,recorded_from DESC,id LIMIT ?',
          a.workspace_id,scope,plan.mode==='profile'?48:32,
        ));
      }
    }
    // Materialize bounded direct target properties for grounded entity slots.
    // All additions remain same-scope and pass effective/support checks below.
    for(const seed of [...candidateRows.values()].slice(0,96)) {
      const info=this.entityInfo(seed,valid_at,recorded_at);
      if(!plan.topics.length||!topicCompatible(plan,info))continue;
      const target=this.store.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=?',seed.id);
      if(target?.entity_id)addCandidates(this.store.all('SELECT * FROM memories WHERE workspace_id=? AND scope=? AND subject_id=? ORDER BY importance DESC,id LIMIT 12',a.workspace_id,seed.scope,target.entity_id));
    }
    const rows = [...candidateRows.values()];
    const infos=new Map<string,MemoryEntityInfo>();
    const info=(m:any)=>{if(!infos.has(m.id))infos.set(m.id,this.entityInfo(m,valid_at,recorded_at));return infos.get(m.id)!;};
    const focusedMatch=(m:any)=> {
      const i=info(m);
      if(plan.mode==='profile')return !m.scope.startsWith('agent:')&&!metaNarrative(m);
      if(plan.facets.includes('relationship'))return !metaNarrative(m)&&matchesRequestedFacet(m,plan,i);
      if(!plan.topics.length||!topicCompatible(plan,i)||metaNarrative(m))return false;
      if(!plan.includeHistory&&plan.topics.includes('work')&&historicalPredicate(m.predicate))return false;
      if(plan.mode==='narrow')return matchesRequestedFacet(m,plan,i);
      return i.topics.some(t=>plan.topics.includes(t));
    };
    const contextAnchors=new Set<string>();
    if(plan.context.length&&plan.facets.length) {
      const contextText=plan.context.join(' ').toLowerCase();
      for(const row of rows) {
        const target=this.store.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=?',row.id);
        for(const [entity,label] of [[row.subject_id,row.subject],[target?.entity_id,row.object]])
          if(entity&&label.length>=3&&contextText.includes(label.toLowerCase()))contextAnchors.add(`${row.scope}\n${entity}`);
      }
    }
    const contextGrounded=(m:any)=>contextAnchors.has(`${m.scope}\n${m.subject_id}`)||contextAnchors.has(`${m.scope}\n${this.store.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=?',m.id)?.entity_id}`);
    const ts = queryTerms(searchQuery);
    // Named topics contribute ranking specificity only. They must not change
    // lexical/semantic admission or require literal code repetition by aliases.
    const dated = query.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?/i)?.[0];
    const queryTime = dated ? Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(dated) ? dated : dated + 'Z') : NaN;
    // ISO date fragments such as 07t07 are not topic identifiers.
    const withoutDates = query.replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?/gi, ' ');
    // Only syntactically named topics receive a ranking hint, not every
    // incidental model/version code (e.g. 'For GPT4, explain the furnace').
    // Claim/support matches are optional bonuses, never eligibility fences.
    const anchors = [...withoutDates.matchAll(/\b(?:fictional|project|exercise|task|ticket|fixture)\s+([\p{L}_][\p{L}\p{N}_]*)/giu)]
      .map(x => x[1]!.normalize('NFKC').toLowerCase()).filter(t => /\p{N}/u.test(t));
    const anchored = (m:any) => {
      const words = new Set(`${m.subject} ${m.predicate} ${m.object}`.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
      // A supported alias/pronoun may omit the topic code in its concise claim.
      // Only already-authorized support excerpts can supply that anchor.
      return !anchors.length || anchors.some(t => words.has(t)) || this.support(m, recorded_at).some(s =>
        anchors.some(t => (s.excerpt ?? "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_]+/gu)?.includes(t)));
    };
    const wantsHistory = /\b(before|previous(?:ly)?|formerly|history|historical|used to|ever)\b/i.test(query);
    const recallStateOnly = (m:any) => {
      const current = this.effective(m, valid_at, recorded_at);
      if (current || !wantsHistory || m.valid_from > valid_at) return current;
      // Only closed states, not corrections/retractions. effective() still
      // applies recorded-time, lineage and current live-support fences.
      const prior = this.effective(m, m.valid_from, recorded_at);
      if (prior?.valid_to && prior.valid_to <= valid_at) return {...prior,historical:true};
      // A later source can establish an earlier handover boundary than the
      // initial claim's observation-time default. Do not invent its start.
      const changes=activeChanges(this.store,m.id,recorded_at);
      const end=changes.filter(c=>c.type==='state_change').map(c=>c.effective_at).sort()[0];
      const representation=changes.filter(c=>['superseded','restored'].includes(c.type)).at(-1);
      if(!m.derived && end && end<=m.valid_from && end<=valid_at && m.recorded_from<=recorded_at && representation?.type!=='superseded' && !changes.some(c=>['correction','retraction'].includes(c.type))){
        const supports=this.support(m,recorded_at);
        if(supports.length)return {...m,valid_to:end,historical:true,historical_start_unknown:true,supports,changes,lineage:[],conflict:false,evidence_roots:[...new Set(supports.flatMap(s=>s.evidence_root_ids))]};
      }
      return null;
    };
    const recallState=(m:any)=>{const state=recallStateOnly(m);return state?{...state,corrections:correctionEvidence(this,state,recorded_at)}:null;};
    const namedFocus=plan.mode==='profile'||!usesNamedRecallFocus(focus)?[]:namedRecallFocus(focus,rows.flatMap(row=>{
      const state=recallStateOnly(row);
      return state?[{...state,objectEntity:info(state).objectEntity}]:[];
    }),plan.owner);
    const namedMatch=(m:any)=>matchesNamedRecallFocus(m,namedFocus);
    const semanticMin = Math.min(1, positiveSetting("RECALL_SEMANTIC_MIN_MILLI", 420) / 1000);
    const words = new Map(rows.map(m => [m.id, queryTerms(`${m.subject} ${m.predicate} ${m.object}`)]));
    // Ordinary partial keyword coverage remains an independent admission path,
    // including longer notes with weak, absent or incompatible embeddings.
    const matches = (hay:string[], t:string) => hay.some(h => h === t || (t.length > 3 && h.startsWith(t)));
    // Atomic relations answer individual clauses, not every word of a multi-
    // question paragraph. Preserve ordinary whole-query admission; a facet can
    // additionally admit only with independent subject/object grounding.
    const facetContext=focus.match(/^(.*?)(?=\b(?:who|whom|what|when|which|how)\b)/iu)?.[1]??'';
    const facets=focus.split(/[?!;]+|,\s*(?:and\s+)?(?=(?:who|whom|what|when|which|how)\b)|\s+and\s+(?=(?:who|whom|what|when|which|how|does|did|is|was|has|had)\b)/iu).map(s=>queryTerms(`${facetContext} ${s}`)).filter(t=>t.length);
    const ranked = rows.map(m => {
      const hay = words.get(m.id)!;
      const coverage = ts.length ? ts.filter(t => matches(hay,t)).length / ts.length : 0;
      const fields=queryTerms(`${m.subject} ${m.object}`);
      const facetCoverage=Math.max(0,...facets.map(ft=>ft.filter(t=>matches(fields,t)).length/ft.length>=0.34 ? ft.filter(t=>matches(hay,t)).length/ft.length : 0));
      const lexical = Math.max(coverage,facetCoverage);
      const semantic = qvector && m.embedding_model === qmodel && m.embedding_json
        ? Math.max(0, cosine(qvector, parse(m.embedding_json))) : 0;
      return { ...m, lexical, semantic, direct: Math.max(lexical, semantic) };
    }).filter(m => focus && (focusedMatch(m) || m.lexical >= 0.34 || m.semantic >= semanticMin))
      .flatMap(m => {
        const effective=recallState(m);
        const corrected=effective?[effective]:correctionReplacements(this,m,valid_at,recorded_at).map(recallState).filter(Boolean);
        return corrected.map(effective=>({...effective,lexical:m.lexical,semantic:m.semantic,direct:m.direct,association:0}));
      })
      .filter(m => namedMatch(m)&&(processQuery || !isContextAvailabilityNote(m)));
    // Multiple old representations may resolve to one positive correction.
    // Keep strongest independently admitted evidence, never repeat its packet.
    ranked.sort((a,b)=>b.direct-a.direct);
    for(let i=ranked.length-1;i>=0;i--)if(ranked.findIndex(m=>m.id===ranked[i].id)!==i)ranked.splice(i,1);
    // Prominence only breaks relevance ties; it cannot admit irrelevant truth.
    const halfLife = positiveSetting("SALIENCE_HALF_LIFE_DAYS", 30);
    const weight = (key:string,fallback:number) => { const n=Number(setting("WEIGHT_"+key)??fallback);return Number.isFinite(n)&&n>=0?n:fallback; };
    const weights={relevance:weight("RELEVANCE",1),semantic:weight("SEMANTIC",1),association:weight("ASSOCIATION",.25),recency:weight("RECENCY",.02),importance:weight("IMPORTANCE",.03),usefulness:weight("USEFULNESS",.01)};
    for (const m of ranked) {
      const age = Math.max(0, (Date.now() - Date.parse(m.last_used_at ?? m.recorded_from)) / 86400000);
      // An explicit dated-event question targets source observation time, not
      // processing/last-used time and not 'newest wins'. It only ranks already
      // relevant, authorized, temporally eligible evidence.
      const distance = Math.min(...m.supports.map((s:any) => Math.abs(Date.parse(s.occurred_at) - queryTime)));
      const proximity = Number.isFinite(distance) ? 0.15 / (1 + distance / 300_000) : 0;
      const predicateWords = m.predicate.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const queryWords = ' ' + (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ') + ' ';
      const phrase = predicateWords.some((word:string,i:number) => i > 0 && queryWords.includes(` ${predicateWords[i-1]} ${word} `)) ? 0.1 : 0;
      const topic = anchors.length && anchored(m) ? 0.12 : 0;
      m.score = Math.max(weights.relevance * m.lexical, weights.semantic * m.semantic) + weights.importance * m.importance + weights.recency * Math.pow(0.5, age / halfLife) + weights.usefulness * Math.log1p(m.use_count) + proximity + phrase + topic;
    }
    const requestedPredicate=(m:any)=>{const ps=queryTerms(m.predicate.replaceAll('_',' '));return ps.length>0&&ps.every(p=>ts.some(t=>matches([p],t)));};
    // Pack requested atomic relationships before broad recap/narrative matches.
    // This is ranking after ordinary admission, not an author or name gate.
    ranked.sort((a, b) => Number(requestedPredicate(b))-Number(requestedPredicate(a)) || b.score - a.score || a.id.localeCompare(b.id));
    const strongest = Math.max(0, ...ranked.map(m=>m.direct));
    const leadingEntities = new Set(ranked.filter(m => m.direct >= strongest * 0.8).map(m => `${m.scope}\n${m.subject_id}`));
    // Query-relative relevance removes weaker same-project matches; importance
    // and spare tokens cannot rescue them. Do not let a strong match for one
    // requested facet erase an admitted relationship for another facet or the
    // same entity (e.g. maintains AND reports_to). This is not topic-code gating.
    const usefulFacet=(m:any)=>{
      const requested=queryTerms(m.predicate.replaceAll('_',' ')).some(p=>ts.some(t=>matches([p],t)));
      const fields=queryTerms(`${m.subject} ${m.object}`);
      const independentLexical=ts.length ? ts.filter(t=>matches(fields,t)).length/ts.length : 0;
      return requested&&(m.semantic>=semanticMin||independentLexical>=0.34);
    };
    for (let i = ranked.length - 1; i >= 0; i--)
      if (!focusedMatch(ranked[i]) && ranked[i].direct < strongest * 0.8 && ranked[i].lexical < 0.6 &&
          !leadingEntities.has(`${ranked[i].scope}\n${ranked[i].subject_id}`) &&
          !usefulFacet(ranked[i])) ranked.splice(i, 1);
    // One-hop useful relationships are a bounded indexed expansion from direct
    // seeds, never a workspace scan or an excuse to add every fact about Alex.
    const expanded: any[] = [];
    const seedIds = new Set(ranked.slice(0, 3).map(m => m.id));
    for (const seed of ranked.slice(0, 3)) {
      const linked = this.store.all("SELECT * FROM memories WHERE workspace_id=? AND scope=? AND subject=? ORDER BY importance DESC,id LIMIT 4", a.workspace_id, seed.scope, seed.object);
      // Another requested predicate on this grounded entity is a graph sibling,
      // not an unrelated semantic guess. Split predicate words so reports_to
      // can answer 'report to' even when its compact embedding misses lookup.
      const siblings = this.store.all("SELECT * FROM memories WHERE workspace_id=? AND scope=? AND subject_id=? ORDER BY importance DESC,id LIMIT 4",a.workspace_id,seed.scope,seed.subject_id)
        .filter(row => queryTerms(row.predicate.replaceAll('_',' ')).some(p => ts.some(t => matches([p],t))));
      linked.push(...siblings);
      for (const row of linked) {
        if (seedIds.has(row.id) || ranked.some(m => m.id === row.id) || expanded.some(m => m.id === row.id)) continue;
        // Exact authorized seed→entity edge establishes relationship relevance;
        // linked facts need not repeat the seed's topic identifier.
        const m = recallState(row);
        if (m && (processQuery || !isContextAvailabilityNote(m))) expanded.push({ ...m, lexical: 0, semantic: 0, direct: 0, association: 1, score: seed.score * 0.8 });
      }
    }
    // Domain slots and topic shifts suppress unrelated generic subject matches;
    // ordinary non-slot questions keep their existing relevance contract.
    const focused=['profile','domain'].includes(plan.mode)||plan.topics.length>0||plan.facets.includes('relationship');
    let eligible=focused?[...ranked,...expanded].filter(m=>focusedMatch(m)): [...ranked,...expanded];
    if(plan.mode==='narrow'&&contextAnchors.size&&eligible.some(contextGrounded))eligible=eligible.filter(contextGrounded);
    // A pronoun follow-up can name a facet the graph does not store. Stay on the
    // established topic instead of returning nothing or the previous topic.
    if(plan.mode==='narrow'&&!eligible.length&&plan.context.length&&plan.topics.length){
      const topical=rows.flatMap(row=>{
        const i=info(row);
        if(!topicCompatible(plan,i)||metaNarrative(row)||!namedMatch(row))return [];
        if(plan.topics.includes('work')&&!plan.includeHistory&&historicalPredicate(row.predicate))return [];
        const state=recallState(row);
        return state?[{...state,lexical:0,semantic:0,direct:0,association:0,score:row.importance??0}]:[];
      });
      eligible=contextAnchors.size&&topical.some(contextGrounded)?topical.filter(contextGrounded):topical;
    }
    eligible=eligible.filter(namedMatch);
    const allocation=plan.facets.includes('relationship')?8:plan.mode==='narrow'?3:plan.mode==='domain'?8:plan.mode==='profile'?12:plan.topics.length?6:100;
    let packet=focused?diverseSelection(eligible,allocation,plan,info):eligible;
    const topicIds=new Set<string>();
    if(sessionStart){
      const current=[...scopes.flatMap(scope=>this.store.all('SELECT * FROM memories WHERE workspace_id=? AND scope=? AND kind!=\'episode\' ORDER BY recorded_from DESC,id LIMIT 80',a.workspace_id,scope)),...scopes.flatMap(scope=>this.store.all('SELECT * FROM memories WHERE workspace_id=? AND scope=? AND kind=\'episode\' ORDER BY recorded_from DESC,id LIMIT 80',a.workspace_id,scope))].flatMap(row=>{const state=recallState(row);return state&&!state.historical?[state]:[];});
      const ranked=(pred:(m:any)=>boolean,limit:number)=>current.filter(pred).sort((a,b)=>continuityProfileRank(b,info(b))-continuityProfileRank(a,info(a))||String(a.object??'').length-String(b.object??'').length||String(b.recorded_from).localeCompare(String(a.recorded_from))||a.id.localeCompare(b.id)).slice(0,limit);
      const profile=[...ranked(m=>continuityProfile(m,info(m))&&continuityProfileRank(m,info(m))>=80,2),...ranked(m=>continuityProfile(m,info(m))&&continuityProfileRank(m,info(m))===70,2)];
      const seenLabel=new Set<string>();
      const topics=current.filter(m=>continuityTopic(m,info(m))).sort((a,b)=>continuityTopicRank(b,info(b))-continuityTopicRank(a,info(a))||String(b.recorded_from).localeCompare(String(a.recorded_from))||a.id.localeCompare(b.id)).filter(m=>{const label=topicLabel(m).toLowerCase();if(!label||seenLabel.has(label))return false;seenLabel.add(label);return true;}).slice(0,2);
      for(const m of topics)topicIds.add(m.id);
      const seen=new Set<string>();
      const continuity=[...profile,...topics].filter(m=>seen.has(m.id)?false:(seen.add(m.id),true));
      const thin=!plan.topics.length&&!plan.facets.length&&focus.trim().split(/\s+/).filter(Boolean).length<=8;
      packet=thin?continuity:[...continuity,...packet.filter(m=>!seen.has(m.id))];
    }
    const selected: any[] = [], snapshots = new Map<string, any>();
    for (const m of packet) {
      const { lexical, semantic, direct, association, score, ...snapshot } = m;
      snapshots.set(m.id, snapshot);
    }
    let context = "";
    for (const m of packet) {
      // Compact background fact. Provenance, IDs and supports stay in the typed
      // recall payload and receipts, not in this model-facing line.
      const line = topicIds.has(m.id) ? `recent: ${topicLabel(m)}` : modelFacingLine(m);
      const next = context ? context + "\n" + line : line;
      if (await budgetTokens(next) > budget) continue;
      context = next;
      const { embedding_json, embedding_model, fingerprint, ...safe } = m;
      selected.push(safe);
    }
    // Real event-loop yields above can admit forgetting/revocation. Fence exact
    // selected support identities, not merely memory versions or usage counters.
    const currentScopes = this.authorize(a, b.agent_id);
    const evidence = (m: any) => { if (!m) return null; const { use_count, last_used_at, ...rest } = m; return rest; };
    for (const m of selected) {
      const row = this.store.one("SELECT * FROM memories WHERE id=?", m.id);
      if (!currentScopes.includes(m.scope) || !row || canonical(evidence(recallState(row))) !== canonical(evidence(snapshots.get(m.id))))
        fail(409, "memory_context_changed", "Memory changed during recall; request fresh context", true);
    }
    const freshness = this.store.one(`SELECT MAX(e.accepted_at) AS latest_accepted_at,MAX(e.processed_at) AS latest_processed_at,
      COALESCE(SUM(CASE WHEN e.status='pending' AND e.operation='upsert' AND e.accepted_at<=? AND e.occurred_at<=? THEN 1 ELSE 0 END),0) AS pending_count,
      COALESCE(SUM(CASE WHEN e.status='captured' AND e.operation='upsert' AND e.accepted_at<=? AND e.occurred_at<=? THEN 1 ELSE 0 END),0) AS capture_only_count
      FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id
      WHERE e.reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1) AND e.workspace_id=? AND ((e.agent_id=? AND ?=1) OR (e.role='user' AND e.author_id='alex' AND ?=1))`,
      recorded_at, valid_at, recorded_at, valid_at, a.workspace_id, b.agent_id, Number(currentScopes.includes(own(b.agent_id))), Number(currentScopes.includes("user:alex")));
    const recall_id = id("recall");
    this.store.run("INSERT INTO memory_recalls VALUES (?,?,?,?,?,?)", recall_id, a.id, b.agent_id, thread_id, JSON.stringify(selected.map(m => m.id)), now());
    return {
      recall_id, context, memories: selected, pending_events: [] as any[],
      tokens_used: memoryTokens(context), token_budget: budget, requested_token_budget: requested,
      token_accounting: `${tokenEncoding} compact model-facing lines; provenance stays in typed memories and receipts`,
      valid_at, recorded_at,
      freshness: { ...freshness, pending_count: freshness.pending_count as number, pending_included: 0, pending_omitted: freshness.pending_count as number,
        consistency: "Durable intake precedes asynchronous selective graph curation; pending transcripts are not recalled. Queue diagnostics are separate." },
      retrieval: { focus: {mode:plan.mode,topics:plan.topics,facets:plan.facets,topic_shift:plan.topicShift,allocation,session_start:sessionStart}, semantic_status, embedding_model: qmodel ?? null,
        index: "fts5+random-hyperplane-lsh-v1", candidates_examined: rows.length, candidate_limit_per_index: 96,
        embedding_ms, service_ms: performance.now() - started, context_messages_used: snippets.length,
        semantic_min: semanticMin, weights, fading: "salience only; dormant truth remains eligible",
        specificity: { topic_identifiers: anchors, admission: 'whole-query or independently grounded facet lexical; configured semantic threshold unchanged; topic hints rank only',
          source_time_focus: Number.isFinite(queryTime) ? new Date(queryTime).toISOString() : null,
          source_time_weight: 0.15, predicate_phrase_weight: 0.1, topic_match_weight: 0.12 },
      },
    };
  }
  feedback(a: Actor, b: any) {
    this.authorize(a, b.agent_id, "write");
    const recall_id = text(b.recall_id, "recall_id"),
      outcome = text(b.outcome_event_id, "outcome_event_id", 512);
    const r = this.store.one(
      "SELECT * FROM memory_recalls WHERE id=? AND principal_id=? AND agent_id=?",
      recall_id,
      a.id,
      b.agent_id,
    );
    if (!r) fail(404, "not_found", "Recall not found");
    const allowed = parse(r.memory_ids_json);
    if (
      !Array.isArray(b.used_memory_ids) ||
      b.used_memory_ids.length > 100 ||
      b.used_memory_ids.some((x: any) => !allowed.includes(x))
    )
      fail(
        400,
        "invalid_feedback",
        "Used IDs must belong to authorized recall",
      );
    const e = this.store.one(
      "SELECT e.* FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id JOIN memory_jobs j ON j.event_pk=e.id WHERE e.workspace_id=? AND e.event_id=? AND e.agent_id=? AND e.principal_id=? AND e.thread_id=? AND e.operation='upsert' AND e.role IN ('assistant','inter_agent') AND e.accepted_at>=? ORDER BY e.accepted_at DESC LIMIT 1",
      a.workspace_id,
      outcome,
      b.agent_id,
      a.id,
      r.thread_id,
      r.created_at,
    );
    if (!e)
      fail(
        400,
        "invalid_feedback",
        "Feedback needs an actual subsequent output/outcome event in the recalled thread",
      );
    if (
      this.store.one(
        "SELECT 1 FROM memory_feedback WHERE recall_id=?",
        recall_id,
      )
    )
      fail(409, "feedback_exists", "Recall already has utility feedback");
    const used = [...new Set<string>(b.used_memory_ids)];
    this.store.run(
      "INSERT INTO memory_feedback VALUES (?,?,?,?)",
      recall_id,
      e.id,
      JSON.stringify(used),
      now(),
    );
    for (const memory_id of used)
      this.store.run(
        "UPDATE memories SET last_used_at=?,use_count=use_count+1 WHERE id=?",
        now(),
        memory_id,
      );
    return {
      recall_id,
      used_memory_ids: used,
      reinforced: used.length,
      evidence_added: false,
    };
  }
  retain() {
    const days = Number(setting("RAW_RETENTION_DAYS") ?? 30);
    if (!Number.isFinite(days) || days <= 0) return;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    this.store.run(
      "UPDATE memory_events SET content=NULL,metadata_json=NULL WHERE reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1) AND accepted_at<? AND (status IN ('processed','superseded','deleted') OR (status='captured' AND role='tool')) AND NOT EXISTS(SELECT 1 FROM memory_jobs j WHERE j.event_pk=memory_events.id AND j.status IN ('queued','running','retry','failed'))",
      cutoff,
    );
  }
}

export class MemoryWorker {
  memory: Memory;
  constructor(
    public store: Store,
    public inference: MemoryInference = new Inference(),
    public lease_ms = 120_000,
  ) {
    this.memory = new Memory(store, inference);
  }
  async callJev(j: any, request: () => Promise<any>) {
    const permit = beginJevRequest(this.store);
    if (!permit.allowed)
      throw new ApiError(503, 'jev_circuit_open', 'JEV provider hold is active', false);
    try {
      const result = await request();
      if (permit.probeToken) providerRequestSucceeded(this.store, 'jev', permit.probeToken);
      return result;
    } catch (error) {
      if (isJevPayment(error)) recordProviderHold(this.store, 'jev', error);
      if (permit.probeToken) releaseProviderProbe(this.store, 'jev', permit.probeToken);
      throw error;
    }
  }
  claim() {
    return claimMemoryJob(this.store, this.lease_ms);
  }
  live(j: any) {
    const e = this.store.one(
      "SELECT e.* FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id JOIN memory_jobs j ON j.event_pk=e.id JOIN credentials c ON c.id=e.credential_id AND c.revoked_at IS NULL WHERE j.id=? AND j.status='running' AND j.lease_token=? AND j.reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1) AND e.reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1) AND e.operation='upsert' AND e.role IN ('user','assistant','inter_agent')",
      j.id,
      j.lease_token,
    );
    if (!e) return null;
    const a = this.store.one(
      "SELECT p.*,c.id AS credential_id FROM principals p JOIN credentials c ON c.principal_id=p.id WHERE c.id=? AND c.revoked_at IS NULL",
      e.credential_id,
    );
    if (!a) return null;
    try {
      const scopes = this.memory.authorize(a, e.agent_id, "write");
      return { e, a, scopes };
    } catch {
      return null;
    }
  }
  async runOnce() {
    const j = this.claim();
    if (!j) return false;
    const hb = setInterval(
      () =>
        this.store.run(
          "UPDATE memory_jobs SET lease_until=? WHERE id=? AND lease_token=? AND status='running'",
          Date.now() + this.lease_ms,
          j.id,
          j.lease_token,
        ),
      Math.max(10, this.lease_ms / 3),
    );
    try {
      const live = this.live(j);
      if (!live) {
        this.finish(j, "cancelled");
        return true;
      }
      const { e, a, scopes } = live;
      const readable = this.memory.authorize(a, e.agent_id, "read");
      const auditPrevious = this.memory.auditPrevious(e, readable, 5);
      const auditState = auditorState(e, auditPrevious);
      if (automaticStatusNotification(e)) {
        const result = { choice:'noise', confidence:1, model:'automatic_status_boundary', elapsed_ms:0 };
        const proof = admissionProof('automatic_status_boundary',j,e,auditPrevious,result);
        this.store.transaction(() => {
          if (!this.live(j)) return;
          if (!this.store.one('SELECT 1 FROM memory_event_admissions WHERE job_id=?',j.id))
            this.store.run('INSERT INTO memory_event_admissions VALUES (?,?,?,?,?,?,?,?)',j.id,e.id,result.choice,result.model,result.confidence,proof,result.elapsed_ms,now());
          this.store.run("UPDATE memory_events SET status='captured',processed_at=NULL WHERE id=?",e.id);
          this.finish(j,'skipped');
        });
        return true;
      }
      let admission = this.store.one('SELECT * FROM memory_event_admissions WHERE job_id=?', j.id);
      if (!admission && this.inference.audit) {
        let result: any;
        try { result = await this.callJev(j, () => this.inference.audit!(auditState)); }
        catch (error) {
          if (error instanceof ApiError && error.code === 'jev_unconfigured') throw error;
          result = { choice:'unavailable', confidence:0, probabilities:{}, model:error instanceof ApiError?error.code:'jev_unavailable', elapsed_ms:0 };
        }
        if (result) {
          if (!['durable_candidate','session_episode','session_context','noise','uncertain','unavailable'].includes(result.choice))
            fail(503,'jev_invalid_decision','JEV admission decision is invalid',true);
          const proof = admissionProof('admission',j,e,auditPrevious,result);
          admission = { decision: result.choice, model: result.model, confidence: result.confidence, proof_sha256: proof, elapsed_ms: result.elapsed_ms };
          this.store.transaction(() => {
            if (!this.live(j)) return;
            this.store.run('INSERT INTO memory_event_admissions VALUES (?,?,?,?,?,?,?,?)',j.id,e.id,result.choice,result.model,result.confidence,proof,result.elapsed_ms,now());
            if (['session_context','noise'].includes(result.choice) && !auditState.latest.content_truncated) {
              this.store.run("UPDATE memory_events SET status='captured',processed_at=NULL WHERE id=?",e.id);
              this.finish(j,'skipped');
            }
          });
        }
      }
      if (admission && ['session_context','noise'].includes(admission.decision) && !auditState.latest.content_truncated) return true;
      if (!this.live(j)) return this.cancel(j);
      const started = performance.now();
      const offset = this.store.one("SELECT offset_chars FROM memory_chunk_progress WHERE event_pk=?", e.id)?.offset_chars ?? 0;
      const content: string = e.content ?? "";
      let end = Math.min(content.length, offset + 6000);
      // Prefer a coherent paragraph/sentence boundary; pathological single-line
      // events still advance. UTF-16 cursor is internal, never a source revision.
      if (end < content.length) {
        const region = content.slice(offset + 3000, end);
        const boundary = Math.max(region.lastIndexOf("\n"), region.lastIndexOf(". "));
        if (boundary >= 0) end = offset + 3000 + boundary + 1;
        if (/[\uD800-\uDBFF]/.test(content[end - 1] ?? "")) end--;
      }
      const recent = this.store.all(
        "SELECT e.* FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id WHERE e.reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1) AND e.workspace_id=? AND e.agent_id=? AND e.thread_id=? AND e.accepted_at<=? AND e.rowid<(SELECT rowid FROM memory_events WHERE id=?) AND e.role IN ('user','assistant','inter_agent') AND e.content IS NOT NULL AND e.status NOT IN ('forgotten','deleted','superseded') ORDER BY e.accepted_at DESC,e.rowid DESC LIMIT 2",
        e.workspace_id, e.agent_id, e.thread_id, e.accepted_at, e.id,
      ).filter(x => !automaticStatusNotification(x) && this.memory.visibleEvent(x, e.agent_id, readable)).reverse();
      const candidates = this.memory.candidates(e.workspace_id, readable, content.slice(offset, end) + " " + recent.map(x => x.content.slice(-600)).join(" "));
      const continuityIds = [e.id, ...recent.map(x => x.id)];
      const continuity = this.store.all(`SELECT DISTINCT m.* FROM memories m JOIN memory_supports s ON s.memory_id=m.id WHERE m.workspace_id=? AND m.scope IN (${readable.map(() => "?").join(",")}) AND s.event_pk IN (${continuityIds.map(() => "?").join(",")}) ORDER BY m.recorded_from DESC,m.id LIMIT 8`, e.workspace_id, ...readable, ...continuityIds);
      for (const m of continuity) {
        if (candidates.some(c => c.id === m.id)) continue;
        candidates.push({ id: m.id, scope: m.scope, kind: m.kind, subject: m.subject, predicate: m.predicate, object: m.object, version: m.version, valid_from: m.valid_from, valid_to: m.valid_to, derived: m.derived,
          ...this.memory.candidateEntityMetadata(m),
          supports: this.memory.communicationSupport(m), changes: activeChanges(this.store,m.id).map(({type,effective_at,replacement_id})=>({type,effective_at,replacement_id})),
          lineage: this.store.all("SELECT parent_id,parent_version FROM memory_lineage WHERE child_id=?", m.id) });
      }
      candidates.splice(12);
      let graphArea: string | null = null;
      const routedCandidateIds: string[] = [];
      if (this.inference.routeGraphArea && candidates.length) {
        const areas = candidates.slice(0,8).map((c,index)=>({id:`area_${index}`,label:`${c.scope}: ${c.subject} (${c.kind})`.slice(0,240),scope:c.scope,subject:c.subject}));
        let result: any;
        try { result = await this.callJev(j, () => this.inference.routeGraphArea!({state:auditState,areas:areas.map(({id,label})=>({id,label}))})); }
        catch (error) { result = { choice:'unavailable', confidence:0, probabilities:{}, model:error instanceof ApiError?error.code:'jev_unavailable', elapsed_ms:0 }; }
        if (result) {
          const valid = new Set([...areas.map(a=>a.id),'none','uncertain','unavailable']);
          if (!valid.has(result.choice)) fail(503,'jev_invalid_decision','JEV graph-area decision is invalid',true);
          graphArea = result.choice === 'unavailable' ? 'uncertain' : result.choice;
          const proof = admissionProof('graph_area',j,e,auditPrevious,result,areas.map(({id,label})=>({id,label})));
          this.store.transaction(() => {
            if (!this.live(j)) return;
            const route = routeRecord('graph_area',result.choice,result,proof);
            this.store.run('INSERT INTO memory_jev_routes VALUES (?,?,?,?,?,?,?,?,?,?,?)',id('jevroute'),j.id,e.id,route.kind,route.target_id,route.decision,route.model,route.confidence,route.proof_sha256,route.elapsed_ms,now());
          });
          if (result.choice !== 'uncertain' && result.choice !== 'none' && result.choice !== 'unavailable') {
            const selected = areas.find(a=>a.id===result.choice)!;
            candidates.sort((a,b)=>Number(b.scope===selected.scope&&b.subject===selected.subject)-Number(a.scope===selected.scope&&a.subject===selected.subject));
          }
        }
      }
      if (this.inference.auditRelationship && candidates.length) {
        const evaluated = candidates.slice(0,Math.min(6,candidates.length));
        const settled = await Promise.allSettled(evaluated.map(c=>this.callJev(j, () => this.inference.auditRelationship!({...auditState,candidate:{id:c.id,scope:c.scope,subject:c.subject,predicate:c.predicate,object:c.object,valid_from:c.valid_from,valid_to:c.valid_to}}))));
        const results = settled.map((result:any) => result.status === 'fulfilled' ? result.value : { choice:'unavailable', confidence:0, probabilities:{}, model:result.reason instanceof ApiError?result.reason.code:'jev_unavailable', elapsed_ms:0 });
        const rejected = new Set<string>();
        this.store.transaction(() => {
          if (!this.live(j)) return;
          for (let index=0;index<evaluated.length;index++) {
            const c=evaluated[index],result=results[index];
            if (!result) { routedCandidateIds.push(c.id); continue; }
            if (!['relevant','irrelevant','uncertain','unavailable'].includes(result.choice)) fail(503,'jev_invalid_decision','JEV relationship decision is invalid',true);
            const proof=admissionProof('relationship',j,e,auditPrevious,result,{id:c.id,scope:c.scope});
            const route=routeRecord('relationship',c.id,result,proof);
            this.store.run('INSERT INTO memory_jev_routes VALUES (?,?,?,?,?,?,?,?,?,?,?)',id('jevroute'),j.id,e.id,route.kind,route.target_id,route.decision,route.model,route.confidence,route.proof_sha256,route.elapsed_ms,now());
            if (result.choice==='irrelevant') rejected.add(c.id); else routedCandidateIds.push(c.id);
          }
        });
        if (rejected.size) for (let index=candidates.length-1;index>=0;index--) if (rejected.has(candidates[index].id)) candidates.splice(index,1);
      }
      if (!this.live(j)) return this.cancel(j);
      const knownRowid = this.store.one("SELECT COALESCE(MAX(rowid),0) AS n FROM memories").n;
      const cadence = positiveSetting("CONSOLIDATE_EVERY", 16);
      const processed = this.store.one("SELECT COUNT(*) AS n FROM memory_events WHERE workspace_id=? AND status='processed' AND reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1)", e.workspace_id).n;
      // Full roots, metadata and original content remain durable. The curator
      // sees only the focused fragment plus explicitly explanatory continuity.
      const input = {
        schema_version: 1, consolidation_due: candidates.length >= 3 && (processed + 1) % cadence === 0,
        jev: { admission: admission?.decision ?? 'not_evaluated', graph_area: graphArea, routed_candidate_ids: routedCandidateIds, source_excerpt_truncated: auditState.latest.content_truncated,
          session_contract: admission?.decision === 'session_episode' ? 'JEV suggests a session-scoped episode. Independently decide durable/session/history/correction/noise; do not globalize a session-local instruction unless the source explicitly supports a standing preference.' : null },
        system_prompt: this.inference.reconcile ? EXTRACT_PROMPT : CURATE_PROMPT,
        event: { event_id: e.event_id, agent_id: e.agent_id, role: e.role, author_id: e.author_id,
          occurred_at: e.occurred_at, observed_at: e.observed_at, content: content.slice(offset, end),
          metadata_excerpt: e.metadata_json?.slice(0,400) ?? null, metadata_truncated: (e.metadata_json?.length ?? 0)>400,
          chunk: { start: offset, end, total_chars: content.length, previous_context: content.slice(Math.max(0, offset - 500), offset) } },
        recent_events: recent.map(x => ({ event_id: x.event_id, client_id: x.client_id, role: x.role, author_id: x.author_id,
          occurred_at: x.occurred_at, content: x.content.slice(-800), context_truncated: x.content.length > 800 })),
        candidates: candidates.filter(c=>!this.inference.reconcile||c.supports.some(s=>s.occurred_at<=e.occurred_at)).map(({supports, ...c}) => ({ ...c,
          sources: supports.slice(0, 2).map(s => ({ event_id: s.event_id, role: s.role, author_id: s.author_id })) })),
        allowed_scopes: scopes,
      };
      const inputBudget = Math.min(4096, positiveSetting("CURATION_INPUT_TOKENS", 4096));
      // Leave room for each extracted atom plus its source in later phases.
      // This changes fragment size, never durable source custody/admission.
      const extractionBudget = this.inference.reconcile ? Math.min(inputBudget,Math.max(memoryTokens(EXTRACT_PROMPT)+512,Math.floor(inputBudget/2))) : inputBudget;
      const reconciliationScopes = new Set<string>();
      const contextCurrent = () => {
        const current = this.live(j);
        if (!current) return false;
        const reads = this.memory.authorize(a, e.agent_id, "read");
        const includedRecent = recent.filter((x) => input.recent_events.some(
          (sent) => sent.client_id === x.client_id && sent.event_id === x.event_id,
        ));
        if (
          scopes.some((scope) => !current.scopes.includes(scope)) ||
          [...reconciliationScopes].some(scope=>!reads.includes(scope)) ||
          candidates.filter(c => input.candidates.some(sent => sent.id === c.id)).some((c) => !reads.includes(c.scope)) ||
          includedRecent.some((x) => !this.memory.visibleEvent(x, e.agent_id, reads))
        ) fail(409, "curation_context_changed", "Memory grants changed", true);
        for (const old of [e, ...includedRecent])
          if (!this.memory.eventCurrent(old))
            fail(409, "curation_context_changed", "Context revision changed", true);
        for (const old of candidates.filter(c => input.candidates.some(sent => sent.id === c.id))) {
          const c = this.store.one("SELECT * FROM memories WHERE id=?", old.id);
          const changes = activeChanges(this.store,old.id).map(({type,effective_at,replacement_id})=>({type,effective_at,replacement_id}));
          if (
            !c || c.version !== old.version ||
            canonical(changes) !== canonical(old.changes) ||
            canonical(this.memory.communicationSupport(c)) !== canonical(old.supports)
          ) fail(409, "curation_context_changed", "Candidate changed during curation", true);
        }
        return true;
      };
      while (
        input.candidates.length &&
        (await budgetTokens(JSON.stringify(input))) > extractionBudget
      )
        input.candidates.pop();
      while (
        input.recent_events.length &&
        (await budgetTokens(JSON.stringify(input))) > extractionBudget
      )
        input.recent_events.shift();
      while ((await budgetTokens(JSON.stringify(input))) > extractionBudget && input.event.content.length > 64) {
        input.event.content = input.event.content.slice(0, Math.floor(input.event.content.length * 0.8));
        if (/[\uD800-\uDBFF]/.test(input.event.content.at(-1) ?? "")) input.event.content = input.event.content.slice(0, -1);
        end = offset + input.event.content.length;
        input.event.chunk.end = end;
      }
      const inputTokens = await budgetTokens(JSON.stringify(input));
      if (inputTokens > extractionBudget) fail(503, "curation_budget_too_small", "Configured window cannot fit curator framing", false);
      const included = candidates.filter(c => input.candidates.some(sent => sent.id === c.id));
      // No provider sees stale/forgotten input after a cooperative packing yield.
      if (!contextCurrent()) return this.cancel(j);
      const curated = await this.inference.curate(input);
      providerRequestSucceeded(this.store, 'luna', j.lease_token);
      const result = validateDecisions(curated);
      if (!contextCurrent()) return this.cancel(j);
      if (!this.live(j)) return this.cancel(j);
      const stillReadable = this.memory.authorize(a, e.agent_id, "read");
      if (candidates.some((c) => !stillReadable.includes(c.scope)))
        fail(
          409,
          "curation_context_changed",
          "Read grants changed during inference",
          true,
        );
      const nonempty = result.decisions
        .filter((d) => d.kind !== 'nothing')
        .map((d) => decisionAfterOperationalFilter(d, e))
        .filter((d): d is Decision => d !== null);
      this.validate(nonempty, e, scopes, included);
      for(const d of nonempty)if(stillReadable.includes(d.scope!))reconciliationScopes.add(d.scope!);
      const reconciled = this.inference.reconcile && nonempty.length
        ? await this.reconcileFragment(e, nonempty, candidates, input.event, input.recent_events, inputBudget, contextCurrent,stillReadable)
        : null;
      const embedding = await this.inference.embed(
        nonempty.map((d) => `${d.subject} ${d.predicate} ${d.object}`),
      );
      this.store.transaction(() => {
        const current = this.live(j);
        if (!current) return;
        for (const d of nonempty) {
          const labels = [
            d.subject!,
            ...(d.object_entity ? [d.object!] : []),
            ...(d.entity_aliases ?? []).flatMap((x) => [
              x.canonical,
              ...x.aliases,
            ]),
          ].map(normalize);
          const added = this.store.one(
            `SELECT 1 FROM memories WHERE rowid>? AND workspace_id=? AND scope=? AND (lower(subject) IN (${labels.map(() => "?").join(",")}) OR lower(object) IN (${labels.map(() => "?").join(",")})) LIMIT 1`,
            knownRowid, e.workspace_id, d.scope, ...labels, ...labels,
          );
          if (added)
            fail(
              409,
              "curation_context_changed",
              "Concurrent related belief requires fresh reconciliation",
              true,
            );
        }
        if (!contextCurrent()) return;
        if (reconciled) this.reconciliationCurrent(reconciled.candidates);
        nonempty.forEach((d, i) => {
          const disposition = reconciled?.items[i];
          const changes=disposition?.changes??(disposition?.change?[disposition.change]:[]);
          const changed = changes.length ? {...d,change:changes[0]} : d;
          const memoryId = this.apply(
            { ...e, content: input.event.content },
            changed,
            embedding.vectors[i],
            embedding.model,
            this.memory.authorize(a, e.agent_id, "read"),
          );
          for(const change of changes.slice(1))this.apply({...e,content:input.event.content},{...d,change},embedding.vectors[i],embedding.model,this.memory.authorize(a,e.agent_id,'read'));
          if (disposition) this.applyReconciliation(j,e,memoryId,disposition,reconciled!.candidates);
        });
        this.store.run("INSERT INTO memory_curation_metrics VALUES (?,?,?,?,?,?,?,?,?,?,?)", j.id, e.id, offset, end, inputTokens, Buffer.byteLength(JSON.stringify(input)), input.candidates.length, input.recent_events.length, nonempty.length, performance.now() - started, now());
        if (end < content.length) {
          this.store.run("INSERT INTO memory_chunk_progress VALUES (?,?) ON CONFLICT(event_pk) DO UPDATE SET offset_chars=excluded.offset_chars", e.id, end);
          // Successful chunk is atomically checkpointed with its selected graph
          // facts. A crash/retry never restarts already committed fragments.
          this.store.run("UPDATE memory_jobs SET status='queued',attempts=0,available_at=?,created_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?", Date.now(), now(), j.id, j.lease_token);
        } else {
          this.store.run("DELETE FROM memory_chunk_progress WHERE event_pk=?", e.id);
          this.store.run("UPDATE memory_events SET status='processed',processed_at=? WHERE id=?", now(), e.id);
          this.finish(j, "succeeded");
        }
      });
      if (
        !this.live(j) &&
        this.store.one("SELECT status FROM memory_jobs WHERE id=?", j.id)
          ?.status === "running"
      )
        this.finish(j, "cancelled");
      this.memory.retain();
    } catch (error) {
      if (isLunaCapacity(error)) {
        const holdUntil = recordProviderHold(this.store, 'luna', error);
        this.store.run(
          "UPDATE memory_jobs SET status='retry',attempts=MAX(0,attempts-1),error_code=?,available_at=?,completed_at=NULL,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status='running'",
          error.code, holdUntil, j.id, j.lease_token,
        );
        return true;
      }
      releaseProviderProbe(this.store, 'luna', j.lease_token);
      const retryable = error instanceof ApiError && error.retryable;
      const status =
        retryable && j.attempts < j.max_attempts ? "retry" : "failed";
      this.store.run(
        "UPDATE memory_jobs SET status=?,error_code=?,available_at=?,completed_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status='running'",
        status,
        error instanceof ApiError ? error.code : "curation_error",
        Date.now() + Math.min(30_000, 250 * 2 ** j.attempts),
        status === "failed" ? now() : null,
        j.id,
        j.lease_token,
      );
    } finally {
      clearInterval(hb);
    }
    return true;
  }
  reconciliationCurrent(candidates: any[]) {
    for (const old of candidates) {
      const current = this.store.one('SELECT * FROM memories WHERE id=?',old.id);
      const changes = activeChanges(this.store,old.id).map(({type,effective_at,replacement_id})=>({type,effective_at,replacement_id}));
      if (!current || current.version!==old.version || canonical(this.memory.communicationSupport(current))!==canonical(old.supports) || canonical(changes)!==canonical(old.changes))
        fail(409,'curation_context_changed','Reconciliation evidence changed',true);
    }
  }
  claimGroupTargets(targets:string[],candidates:any[]) {
    // Only explicit, live semantic-duplicate audit is equivalence proof.
    // Generic superseded (which can decompose a compound) is NOT equivalence.
    const byId=new Map(candidates.map(c=>[c.id,c])),links=new Map<string,Set<string>>();
    if(!byId.size)return targets;
    const rows=this.store.all(`SELECT r.memory_id,r.disposition_json,e.event_id,e.client_id,e.revision FROM memory_reconciliations r JOIN memory_events e ON e.id=r.event_pk JOIN memory_heads h ON h.event_pk=e.id WHERE r.memory_id IN (${[...byId].map(()=>'?').join(',')})`,...[...byId.keys()]);
    for(const row of rows){
      const c=byId.get(row.memory_id)!;
      if(!c.supports.some((s:any)=>s.event_id===row.event_id&&s.client_id===row.client_id&&s.revision===row.revision))continue;
      for(const other of parse(row.disposition_json,{}).duplicate_ids??[]){
        if(!byId.has(other)||byId.get(other)!.scope!==c.scope)continue;
        for(const [a,b] of [[c.id,other],[other,c.id]]){const edges=links.get(a)??new Set<string>();edges.add(b);links.set(a,edges);}
      }
    }
    const result=new Set(targets),queue=[...targets];
    for(const target of queue)for(const other of links.get(target)??[])if(!result.has(other)){result.add(other);queue.push(other);}
    return [...result];
  }
  async reconcileFragment(e: any, ds: Decision[], prior: any[], event: any, recent: any[], budget: number, live: ()=>boolean,readable:string[]) {
    const items: Reconciliation[] = [], snapshots = new Map<string,any>();
    for (let index=0;index<ds.length;index++) {
      let d=ds[index];
      // Indexed relation lookup, not whole graph/pending transcript. Include
      // opposite/inverse wording via the current source and exact identities.
      const relationRank=(c:any)=>3*relevance(d.predicate!.replaceAll('_',' '),c.predicate.replaceAll('_',' '))+relevance(`${d.subject} ${d.object}`,`${c.subject} ${c.object}`);
      const pool = readable.includes(d.scope!) ? [...prior,...this.memory.candidates(e.workspace_id,[d.scope!],`${d.subject} ${d.predicate} ${d.object}`,24,relationRank),...this.memory.candidates(e.workspace_id,[d.scope!],event.content,24,relationRank)] : [];
      const unique=[...new Map(pool.filter(c=>c.scope===d.scope).map(c=>[c.id,c])).values()];
      unique.sort((a,b)=>relationRank(b)-relationRank(a)||a.id.localeCompare(b.id));
      const remaining=unique.slice(),batches:Reconciliation[]=[];
      do {
      // Drain bounded indexed evidence windows. Packing can defer candidates,
      // never silently discard a retained original or normalized representation.
      const window=remaining.slice(0,4);
      const sources=new Map<string,any>();
      const input:any={schema_version:1,task_schema:'atlas-reconciliation-v2',phase:'reconcile',system_prompt:RECONCILE_PROMPT,event,recent_events:recent,
        response_contract:{decisions:[],item_indices:[0],assessments:'REQUIRED exactly one {id,disposition} per supplied candidate; disposition relative to incoming, not another candidate; effective_at only for later_*',dispositions:['duplicate','state_change','correction','retraction','conflict','superseded','later_state_change','later_correction','later_retraction','unaffected'],start_basis:'For historical candidates, assess explicit_source|event_default|unknown from original support; owned through a date supplies no historical start'},
        incoming:[d],source_relations:ds.filter(x=>x.scope===d.scope).map(x=>({subject:x.subject,predicate:x.predicate,object:x.object,valid_from:x.valid_from,valid_to:x.valid_to})),candidates:window.map(c=>({id:c.id,scope:c.scope,subject:c.subject,predicate:c.predicate,object:c.object,kind:c.kind,valid_from:c.valid_from,valid_to:c.valid_to,changes:c.changes,
          subject_entity_id:c.subject_entity_id,object_entity:c.object_entity,object_entity_id:c.object_entity_id,subject_types:c.subject_types,object_types:c.object_types,relationship_topics:c.relationship_topics,
          sources:c.supports.slice(0,2).map((s:any)=>{const key=`${s.client_id}:${s.event_id}@${s.revision}`;sources.set(key,{key,event_id:s.event_id,role:s.role,author_id:s.author_id,occurred_at:s.occurred_at,excerpt:s.excerpt?.slice(0,600)});return key;})})),sources:[...sources.values()]};
      const trimSources=()=>{const ids=new Set(input.candidates.map((c:any)=>c.id));const keys=new Set(input.candidates.flatMap((c:any)=>c.sources));input.sources=input.sources.filter((s:any)=>keys.has(s.key));if(input.candidate_identities)input.candidate_identities=input.candidate_identities.filter((b:any)=>ids.has(b.id));};
      const identityInput=()=>({...input,task_schema:'atlas-identity-v1',phase:'identity',system_prompt:IDENTITY_PROMPT,response_contract:identityResponseContract(d)});
      // Pack the actual larger phase, not an assumption about prompt lengths.
      const phaseTokens=async()=>Math.max(await budgetTokens(JSON.stringify(input)),this.inference.resolveEntities?await budgetTokens(JSON.stringify(identityInput())):0);
      while (input.candidates.length && await phaseTokens()>budget) {input.candidates.pop();trimSources();}
      while(input.recent_events.length && await phaseTokens()>budget)input.recent_events=input.recent_events.slice(1);
      // Very dense fragments still reconcile one atomic relation at a time.
      // Without the complete siblings, no compound refinement is permitted.
      let completeRelations=true;
      if(await phaseTokens()>budget){input.source_relations=[{subject:d.subject,predicate:d.predicate,object:d.object,valid_from:d.valid_from,valid_to:d.valid_to}];completeRelations=false;}
      if(await phaseTokens()>budget)fail(503,'curation_budget_too_small','Reconciliation framing exceeds input window',false);
      let included=unique.filter(c=>input.candidates.some((s:any)=>s.id===c.id));
      if(!live())fail(409,'curation_context_changed','Source changed',true);
      this.reconciliationCurrent(included);
      if(this.inference.resolveEntities){
        const identity=await this.inference.resolveEntities(identityInput());
        if(!live())fail(409,'curation_context_changed','Source changed',true);
        this.reconciliationCurrent(included);
        d=resolvedIdentity(identity,d,included,{event,recent,sources:input.sources});ds[index]=d;
        input.incoming=[d];input.identity_aliases=d.entity_aliases;
        input.candidate_identities=candidateIdentities(identity,d,included,{event,recent,sources:input.sources});
        input.candidates=input.candidates.map((c:any)=>{
          const binding=input.candidate_identities.find((b:any)=>b.id===c.id);
          return binding ? {...c,original_subject:c.subject,original_object:c.object,subject:binding.subject??c.subject,object:binding.object??c.object} : c;
        });
        for(const c of included)snapshots.set(c.id,c);
        while(input.candidates.length&&await budgetTokens(JSON.stringify(input))>budget){input.candidates.pop();trimSources();}
        if(await budgetTokens(JSON.stringify(input))>budget)fail(503,'curation_budget_too_small','Resolved relation exceeds input window',false);
        included=unique.filter(c=>input.candidates.some((s:any)=>s.id===c.id));
      }
      const result=normalizeReconciliation(validateReconciliations({items:await this.inference.reconcile!(input)},1)[0],d,input.candidates);
      if(!live())fail(409,'curation_context_changed','Source changed',true);
      this.reconciliationCurrent(included);
      const allowed=new Map(included.map(c=>[c.id,c]));
      for(const target of [...(result.unaffected_ids??[]),...result.duplicate_ids,...(result.superseded_ids??[]),...(result.change?.target_ids??[]),...(result.unknown_start_ids??[]),...(result.changes??[]).flatMap(c=>c.target_ids),...(result.later_replacements??[]).map(c=>c.id),...(result.superseded_by?[result.superseded_by.id]:[])])
        if(!allowed.has(target))fail(503,'curator_target_violation','Reconciliation target must be supplied same-scope evidence',true);
      for(const target of result.unknown_start_ids??[])
        if(e.role!=='user'&&!allowed.get(target)!.supports.some((s:any)=>s.event_id===e.event_id&&s.client_id===e.client_id))fail(503,'curator_target_violation','Historical precision needs original source authority',true);
      for(const target of result.superseded_ids??[])
        if(!completeRelations||!allowed.get(target)!.supports.some((s:any)=>s.event_id===e.event_id&&s.client_id===e.client_id))fail(503,'curator_target_violation','Representation refinement needs complete original source coverage',true);
      for(const change of [...(result.change?[result.change]:[]),...(result.changes??[])])this.validate([{...d,change}],e,[d.scope!],included);
      for(const replacement of [...(result.superseded_by?[result.superseded_by]:[]),...(result.later_replacements??[])]){
        const t=allowed.get(replacement.id)!;
        // Later source authority cannot be manufactured from an assistant recap.
        if(t.derived || !t.supports.some((s:any)=>s.occurred_at>e.occurred_at))
          fail(503,'curator_time_violation','Later replacement needs supported later original evidence',true);
      }
      for(const c of included)snapshots.set(c.id,c);
      if(window.length&&!included.length)fail(503,'curation_budget_too_small','One retained candidate must fit reconciliation',false);
      batches.push({...result,index,identity_aliases:d.entity_aliases,candidate_identities:input.candidate_identities});
      for(const c of included)remaining.splice(remaining.findIndex(x=>x.id===c.id),1);
      } while(remaining.length);
      const sameScope=[...snapshots.values()].filter(c=>c.scope===d.scope);
      const merged=consistentReconciliation(mergeReconciliations(batches,index),ids=>this.claimGroupTargets(ids,sameScope));
      for(const change of merged.changes??[]){
        // Equivalence expands only supplied, source-fenced IDs. Original strict
        // correction/time/lineage validation still applies to every group member.
        this.validate([{...d,change}],e,[d.scope!],sameScope);
      }
      items.push(merged);
    }
    return {items,candidates:[...snapshots.values()]};
  }
  applyReconciliation(j:any,e:any,memoryId:string,r:Reconciliation,candidates:any[]) {
    const add=(event_pk:string,target:string,replacement:string|null,type:string,effective:string)=>{
      if(target===replacement)return;
      this.memory.invalidateChildren(target,'parent_changed');
      if(type==='restored'||!this.store.one('SELECT 1 FROM memory_changes WHERE event_pk=? AND target_id=? AND replacement_id IS ? AND type=? AND effective_at=?',event_pk,target,replacement,type,effective))
        this.store.run('INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)',id('change'),event_pk,target,replacement,type,effective,now());
    };
    const incoming=this.store.one('SELECT * FROM memories WHERE id=?',memoryId);
    for(const binding of r.candidate_identities??[]){
      const c=this.store.one('SELECT * FROM memories WHERE id=?',binding.id);
      const pairs:[string|undefined,string|undefined][]=[[c.subject_id,binding.subject],[this.store.one('SELECT entity_id FROM memory_entity_targets WHERE memory_id=?',c.id)?.entity_id,binding.object]];
      for(const [from,label] of pairs){
        if(!from||!label)continue;
        const to=this.memory.entity(e.workspace_id,label,[],[incoming.scope],e.id).id;
        if(from!==to&&this.memory.canonicalEntity(e.workspace_id,incoming.scope,to)!==from)
          this.store.run('INSERT OR IGNORE INTO memory_entity_equivalences VALUES (?,?,?,?,?,?)',e.workspace_id,incoming.scope,from,to,e.id,now());
      }
    }
    for(const duplicate of r.duplicate_ids){
      if(duplicate===memoryId)continue;
      // Equivalent representation, not a declaration that the old truth was
      // false. Preserve original supports/roots and all prior invalidations.
      this.store.run('INSERT OR IGNORE INTO memory_supports SELECT ?,event_pk,roots_json,excerpt FROM memory_supports WHERE memory_id=?',memoryId,duplicate);
      for(const c of activeChanges(this.store,duplicate).filter(c=>!['superseded','restored'].includes(c.type)))
        add(c.event_pk,memoryId,c.replacement_id,c.type,c.effective_at);
      add(e.id,duplicate,memoryId,'superseded',e.occurred_at);
    }
    for(const target of r.superseded_ids??[])add(e.id,target,memoryId,'superseded',e.occurred_at);
    for(const target of r.unknown_start_ids??[])add(e.id,target,null,'start_unknown',e.occurred_at);
    for(const replacement of r.later_replacements??(r.superseded_by?[r.superseded_by]:[])){
      const later=candidates.find(c=>c.id===replacement.id);
      const source=this.store.one(`SELECT e.id FROM memory_supports s JOIN memory_events e ON e.id=s.event_pk WHERE s.memory_id=? AND e.occurred_at>? ORDER BY e.occurred_at LIMIT 1`,later.id,e.occurred_at);
      // A later truth disposition applies to every model-selected equivalent
      // old representation, not only the freshly normalized fingerprint.
      for(const target of new Set([memoryId,...r.duplicate_ids]))
        add(source.id,target,later.id,replacement.type,replacement.effective_at);
    }
    // Re-selecting an exact fingerprint chooses this representation again.
    // Format supersession must not form cycles that hide every true prior state.
    // Restoring representation never overrides a correction/retraction/closure.
    const representation=this.store.one("SELECT type FROM memory_changes WHERE target_id=? AND type IN ('superseded','restored') ORDER BY recorded_at DESC,rowid DESC LIMIT 1",memoryId);
    if(representation?.type==='superseded')add(e.id,memoryId,null,'restored',e.occurred_at);
    this.store.run('INSERT INTO memory_reconciliations VALUES (?,?,?,?,?)',j.id,e.id,memoryId,JSON.stringify({...r,prompt_sha256:memoryPromptHash()}),now());
  }
  cancel(j: any) {
    this.finish(j, "cancelled");
    return true;
  }
  finish(j: any, status: string) {
    releaseProviderProbe(this.store, 'luna', j.lease_token);
    this.store.run(
      "UPDATE memory_jobs SET status=?,completed_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status='running'",
      status,
      now(),
      j.id,
      j.lease_token,
    );
  }
  validate(ds: Decision[], e: any, scopes: string[], candidates: any[]) {
    const byId = new Map(candidates.map((c) => [c.id, c]));
    let derived = 0;
    for (const d of ds) {
      if (!scopes.includes(d.scope!))
        fail(
          503,
          "curator_scope_violation",
          "Curator requested an unauthorized graph",
          true,
        );
      if (
        d.evidence_event_ids?.length !== 1 ||
        d.evidence_event_ids[0] !== e.event_id
      )
        fail(
          503,
          "curator_lineage_violation",
          "Curator must cite current event exactly once",
          true,
        );
      if (
        e.role !== "user" &&
        d.kind === "assertion" &&
        d.scope === "user:alex"
      )
        fail(
          503,
          "curator_attribution_violation",
          "Agent/tool claims cannot become Alex preference assertions",
          true,
        );
      if (e.role !== "user" && d.kind === "hypothesis" && d.scope !== own(e.agent_id))
        fail(
          503,
          "curator_attribution_violation",
          "Agent hypotheses stay in the originating agent graph; genuine owner uncertainty may use authorized owner scopes",
          true,
        );
      if ((d.derived_from?.length ?? 0) > 0) {
        if (d.change)
          fail(
            503,
            "curator_lineage_violation",
            "Derived decisions cannot mutate parents",
            true,
          );
        for (const parent of d.derived_from!) {
          const p = byId.get(parent);
          if (!p || p.scope !== d.scope)
            fail(
              503,
              "curator_lineage_violation",
              "Consolidation must cite visible same-scope parents",
              true,
            );
        }
      }
      for (const target of d.change?.target_ids ?? []) {
        const t = byId.get(target);
        if (!t || t.scope !== d.scope)
          fail(
            503,
            "curator_target_violation",
            "Update target must be visible same-scope memory",
            true,
          );
        const sameClaim = normalize(d.subject!) === normalize(t.subject) && normalize(d.predicate!) === normalize(t.predicate) && normalize(d.object!) === normalize(t.object);
        if (d.change!.aspect === "interval" && (!sameClaim || (d.valid_from === t.valid_from && d.valid_to === t.valid_to)))
          fail(503, "curator_interval_correction_invalid", "Interval correction must preserve claim and change its bounds", true);
        if (["correction", "retraction"].includes(d.change!.type) && d.change!.aspect !== "interval" &&
          normalize(d.subject!) === normalize(t.subject) && normalize(d.predicate!) === normalize(t.predicate) && normalize(d.object!) === normalize(t.object))
          fail(503, "curator_correction_repeats_target", "Correction must express corrected or withdrawn truth, not reassert the invalidated claim", true);
        if (d.change!.type === "state_change" && d.valid_from! <= t.valid_from && !t.supports?.some((s:any)=>s.occurred_at<e.occurred_at))
          fail(
            503,
            "curator_time_violation",
            "State reversal must follow target start; use conflict/correction for overlapping evidence",
            true,
          );
      }
    }
  }
  apply(
    e: any,
    d: Decision,
    vector: number[] | undefined,
    model: string,
    readable: string[],
  ) {
    d = canonicalOwnerDecision(d, e);
    const entity = this.memory.entity(
      e.workspace_id,
      d.subject!,
      d.entity_aliases,
      [d.scope!],
      e.id,
    );
    const target = d.object_entity ? this.memory.entity(e.workspace_id,d.object!,d.entity_aliases,[d.scope!],e.id) : null;
    const fp = hash(
      canonical({
        subject: entity.id,
        predicate: normalize(d.predicate!),
        object: normalize(target?.label ?? d.object!),
        ...(d.object_entity!==undefined ? {object_entity:d.object_entity} : {}),
        kind: d.kind === "update" ? "assertion" : d.kind,
        valid_from: d.valid_from,
        valid_to: d.valid_to,
        derived_from: (d.derived_from ?? []).sort(),
      }),
    );
    let m = this.store.one(
      "SELECT * FROM memories WHERE workspace_id=? AND scope=? AND fingerprint=?",
      e.workspace_id,
      d.scope,
      fp,
    );
    if (!m) {
      const memory_id = id("memory"),
        at = now(),
        derived = d.derived_from?.length ? 1 : 0;
      this.store.run(
        "INSERT INTO memories (id,workspace_id,scope,kind,subject_id,subject,predicate,object,valid_from,valid_to,recorded_from,importance,confidence,fingerprint,embedding_json,embedding_model,derived) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        memory_id,
        e.workspace_id,
        d.scope,
        d.kind === "update" ? "assertion" : d.kind,
        entity.id,
        entity.label,
        d.predicate,
        target?.label ?? d.object,
        d.valid_from,
        d.valid_to,
        at,
        d.importance,
        d.confidence,
        fp,
        vector ? JSON.stringify(vector) : null,
        vector ? model : null,
        derived,
      );
      const parents = (d.derived_from ?? []).map(
        (parent) =>
          this.store.one("SELECT version FROM memories WHERE id=?", parent)
            .version,
      );
      const version = parents.length ? Math.max(...parents) + 1 : 1;
      this.store.run(
        "UPDATE memories SET version=? WHERE id=?",
        version,
        memory_id,
      );
      m = this.store.one("SELECT * FROM memories WHERE id=?", memory_id);
      this.store.run(
        "INSERT INTO memory_versions VALUES (?,?,?,?,?,?)",
        memory_id,
        version,
        d.scope,
        at,
        derived ? "consolidation" : "created",
        JSON.stringify({
          kind: m.kind,
          subject: m.subject,
          predicate: m.predicate,
          object: m.object,
          valid_from: m.valid_from,
          valid_to: m.valid_to,
        }),
      );
      for (const parent_id of d.derived_from ?? []) {
        const parent = this.store.one(
          "SELECT version FROM memories WHERE id=?",
          parent_id,
        );
        this.store.run(
          "INSERT INTO memory_lineage VALUES (?,?,?)",
          memory_id,
          parent_id,
          parent.version,
        );
      }
    }
    if (d.object_entity!==undefined) this.store.run('INSERT OR REPLACE INTO memory_entity_targets VALUES (?,?)',m.id,target?.id ?? null);
    let roots = parse(e.roots_json);
    // Resolve declared causal roots to their original support roots where they are in this workspace.
    for (const source of [...roots]) {
      const ref = this.store.one(
        "SELECT e.roots_json FROM memory_events e JOIN memory_heads h ON h.event_pk=e.id WHERE e.workspace_id=? AND (e.event_id=? OR e.client_id||':'||e.event_id=?)",
        e.workspace_id,
        source,
        source,
      );
      if (ref)
        roots = [
          ...new Set([
            ...roots.filter((r: string) => r !== source),
            ...parse(ref.roots_json),
          ]),
        ];
    }
    // A consolidation inherits support, never manufactures independent roots from its synthesis event.
    if (d.derived_from?.length)
      roots = [
        ...new Set(
          d.derived_from.flatMap((parent) =>
            this.memory
              .support({ id: parent })
              .flatMap((s) => s.evidence_root_ids),
          ),
        ),
      ];
    this.store.run(
      "INSERT OR IGNORE INTO memory_supports VALUES (?,?,?,?)",
      m.id,
      e.id,
      JSON.stringify(roots),
      d.scope === own(e.agent_id)
        ? (e.content?.slice(0, 2000) ?? null)
        : e.content?.includes(d.object)
          ? d.object
          : null,
    );
    for (const target_id of d.change?.target_ids ?? []) {
      if (target_id === m.id) continue;
      if (d.change!.type === "state_change") {
        const ancestors = this.store.all(
          "WITH RECURSIVE ancestors(id) AS (SELECT target_id FROM memory_changes c WHERE replacement_id=? AND type='state_change' AND NOT EXISTS (SELECT 1 FROM memory_change_invalidations i WHERE i.change_id=c.id) UNION SELECT c.target_id FROM memory_changes c JOIN ancestors a ON c.replacement_id=a.id WHERE c.type='state_change' AND NOT EXISTS (SELECT 1 FROM memory_change_invalidations i WHERE i.change_id=c.id)) SELECT DISTINCT id FROM ancestors",
          target_id,
        );
        for (const ancestor of ancestors)
          if (ancestor.id !== m.id)
            this.store.run(
              "INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)",
              id("change"),
              e.id,
              ancestor.id,
              m.id,
              "state_change",
              d.valid_from,
              now(),
            );
      }
      this.memory.invalidateChildren(target_id, "parent_changed");
      this.store.run(
        "INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)",
        id("change"),
        e.id,
        target_id,
        m.id,
        d.change!.type,
        d.valid_from,
        now(),
      );
      if (d.change!.type === "conflict")
        this.store.run(
          "INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)",
          id("change"),
          e.id,
          m.id,
          target_id,
          "conflict",
          d.valid_from,
          now(),
        );
    }
    // Delayed state evidence cannot reopen a known later state of the same relationship.
    if (d.change?.type === "state_change")
      for (const target_id of d.change.target_ids) {
        const next = activeChanges(this.store,target_id).filter(c=>c.type==='state_change'&&c.effective_at>d.valid_from!).sort((a,b)=>a.effective_at.localeCompare(b.effective_at))[0];
        if (next && next.replacement_id !== m.id)
          this.store.run(
            "INSERT INTO memory_changes VALUES (?,?,?,?,?,?,?)",
            id("change"),
            next.event_pk,
            m.id,
            next.replacement_id,
            "state_change",
            next.effective_at,
            now(),
          );
      }
    return m.id as string;
  }
}
