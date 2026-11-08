# Contract: REST v1 / SQLite schema 2 (source/fact schema-1 semantics retained)

This alpha intentionally exposes a small, explicit contract. IDs are opaque strings. Public JSON uses
snake_case, UTC RFC3339 timestamps, and a generated `request_id` (except static assets). Successful
responses carry `api_version:"v1"`; validation/access failures have:

```json
{
  "api_version": "v1",
  "request_id": "opaque",
  "error": {
    "code": "invalid_request",
    "message": "Actionable description",
    "retryable": false,
    "details": {}
  }
}
```

Job scheduler `available_at` and `lease_until` are epoch **milliseconds** in this bootstrap API, unlike
source/business timestamps. They are diagnostics, not event times. This exception is explicit and
must be versioned before changing. Read-only health is `/healthz`. All `/v1` endpoints require a
bearer credential. Bodies require `Content-Type: application/json`; writes require `Idempotency-Key`.
`POST /v1/context` and `/v1/graph` are read-only queries and do not need idempotency keys.

## Authorization

A credential is hashed at rest and binds a principal to exactly one workspace. Client-supplied
`workspace_id` or `user_id` never authorizes anything; these fields are rejected. Projects contain
spaces. Knowledge operations require explicit space grants (`read`, `write`, `delete`) even for
administrators. Scope/credential administration requires a workspace administrator. Principals are
human, agent or service; remotely created principals are non-admin. No credential API returns tokens;
local CLI key issuance writes only a private file. Local DB/filesystem access is privileged.

Denied cross-scope resources return generic 404. Granted resources may still conflict or be gone.
Mixed authorized/unauthorized context selection fails as a whole. Filtering precedes ranking,
traversal, counts and provenance; only the caller's query is sent for hybrid query embedding.
Post-await credential/grant checks and fresh fact reads prevent revocation/forget races.

## Endpoints

| Endpoint                          | Behavior                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /v1/me`, `GET /v1/status`    | Caller identity, storage/provider diagnostic, authorized-space queue counts                     |
| `GET/POST /v1/projects`           | List visible projects / admin creates project                                                   |
| `GET/POST /v1/principals`         | Admin list/create human/agent/service principals                                                |
| `GET/POST /v1/spaces`             | List explicitly granted spaces / admin creates owner-only personal or shared space              |
| `GET/POST /v1/grants`             | Admin inspect/replace principal space-action grants                                             |
| `POST /v1/sources`                | Authorize write, atomically insert source revision + queued job; receipt is not completion      |
| `GET /v1/sources[?space_id=ID]`   | Paginated authorized source metadata, including forgotten tombstones                            |
| `GET /v1/sources/ID`              | Source metadata and all non-erased revisions/payloads                                           |
| `POST /v1/sources/ID/revisions`   | CAS correction with expected_revision_number + complete replacement input                       |
| `DELETE /v1/sources/ID`           | Erase every revision payload/assertions, remove supports, delete orphan facts, retain tombstone |
| `GET /v1/jobs`, `GET /v1/jobs/ID` | Granted job diagnostics (never lease fencing token or source payload)                           |
| `POST /v1/jobs/ID/retry`          | Write grant; failed/retry current revisions only; resets bounded attempt budget                 |
| `POST /v1/context`                | Explicit space_ids, query, optional strategy, budget_chars, limit, valid_at, recorded_at        |
| `POST /v1/graph`                  | Explicit space_ids, seed_entities, max_hops 1–3, same budget/time controls                      |
| `GET /v1/facts/ID`                | Granted fact and revision/source support history                                                |
| `POST /v1/credentials/ID/revoke`  | Own credential or workspace admin; revocation is immediate                                      |
| `GET /v1/audit`                   | Admin, non-content write events and request correlation                                         |

List responses are `{data,next_cursor}` with limit 1–100 (default 25). Cursors bind to caller/route/space
filter and represent an opaque untrusted keyset position, not authorization or snapshot isolation.
Concurrent inserts/deletes can alter later pages. Follow cursors to exhaust a collection.

## Evidence and time

A source's external identity is unique **within its space**. Revisions are immutable except deletion
redaction and supersession timestamp. Assertions explicitly contain subject/predicate/object and
optional valid_from/valid_to (default start is source_timestamp). Same canonical assertion+interval
within one space shares a fact ID and accumulates supports. No cross-space deduplication or inference
occurs. There is no automatic contradiction resolution between unrelated sources: conflicting live
facts remain independently supported and visible. Correct the appropriate source or assert explicit
valid-time intervals.

Valid intervals are `[valid_from,valid_to)`, recorded intervals are `[recorded_from,recorded_to)`.
A null end is unbounded. Support recorded_from is the revision acceptance timestamp, not provider
completion time: historical results converge when processing finishes. A correction closes old
support immediately and queues new evidence. Historical access always uses **current** grants.
Forget removes both present and historical supports. Stored source payloads are untrusted input,
not instructions; assertions/provenance are not proof of real-world truth. Retrieved context belongs in an untrusted-data channel in your agent harness, not in a privileged developer/system instruction channel.

## Retrieval / graph / budgeting

Lexical ranking is normalized query-term substring coverage, not BM25. Hybrid adds nonnegative cosine
similarity only for compatible stored embedding models; extraction/embedding quality has not been
validated without a real provider. Ranking is stable by fact ID for equal scores. Empty query returns
all eligible facts. The engine fails actionably above 5,000 authorized time-filtered candidates.
Graph expansion is exact case-sensitive label matching, undirected subject/object expansion up to
three hops, using only selected, authorized temporal edges. Entity labels are not canonical IDs.
No fuzzy resolution, graph query language, PageRank or automatic multi-hop reasoning is claimed.

The packed context string contains complete `subject | predicate | object [fact_id]` lines, within a
Unicode-code-point budget 0–100,000 (default 2,000). Response metadata is outside this character
budget. This is not a tokenizer/token-window guarantee. Typed facts correspond to selected lines;
`matched_facts`/`omitted_facts` disclose eligible results not packed. Result limit is 1–100, default 20.

## Jobs / idempotency

The source/revision/job insert is transactional. A worker claims via an IMMEDIATE SQLite transaction,
leases for 60 seconds, heartbeats, fences results with a per-claim token, and reclaims expired leases
after restart. It checks cancellation/supersession before starting a later provider call and again
before commit. A request already sent to a provider cannot be unsent. Persisted errors contain safe
codes, never provider responses that might echo payloads/secrets. Automatic attempts cap at five;
transient backoff starts at 500 ms and caps at 30 seconds. A shared native Luna capacity outage is
the bounded exception: its failed claim does not consume a job attempt, and the same nonterminal job
waits for the provider hold instead of becoming terminal. An expired final-attempt lease becomes
failed, not stranded. Manual retry of current evidence starts a new bounded attempt family.

Writes use a principal-scoped key and canonical operation/path/body hash. Same request replays stored
non-content receipt, changed request conflicts. Current authorization is always rechecked on replay.
Keys are retained without TTL in this alpha. A replayed historical receipt describes the original
operation; inspect current source/job state rather than assuming it remains current after deletion.

## Versioning boundary

Schema user_version rejects newer data. Schema 1 upgrades additively to schema 2 with original source/fact/credential identities retained; the dreaming serving-index extension is additive within schema 2. Offline pre-upgrade backup is the rollback boundary. Restoring old source over a newly indexed DB is not a safe writer rollback: new triggers invoke the registered index function. Restore the stopped full DB backup instead. Future migrations need fixture backups and rollback tests. REST contract changes must be explicit.
There is no claimed SDK, MCP, connector or experience-learning compatibility simply because these
entities could later be represented. Server transport-level oversized requests may be rejected by
Bun before the structured API envelope; ordinary API validation uses the envelope above.

## Automatic event memory: durable intake, selective graph and indexed recall

### Native Luna transport and bounded JEV admission/routing

With `THE_ATLAS_NATIVE_WORKER=true`, extraction, identity and reconciliation use Atlas-owned direct
providers, never a Codex CLI/app-server, agent runtime or Hermes inference bridge. A configured
`THE_ATLAS_PROVIDER_API_KEY`/`OPENAI_API_KEY` selects regular OpenAI Responses at
`https://api.openai.com/v1/responses`; `THE_ATLAS_OPENAI_PROJECT_ID` supplies the dedicated project
header. This route uses `store:false`, `stream:false`, `tools:[]`, bounded1MB JSON and exact-model
completion. Without an API credential, `THE_ATLAS_CODEX_HOME` selects the existing OAuth HTTP/SSE
transport at `https://chatgpt.com/backend-api/codex/responses` with `stream:true`. Both parse JSON
before the existing decision/phase validators and never expose source/tool actions for execution.
`THE_ATLAS_EXTRACTION_MODEL=gpt-6-luna` remains exact. Provider errors do not silently switch routes.

`auth.json` remains private mode0600. Access/refresh identity is JWT/account checked. Refresh is
single-flight, preserves account identity, persists updates atomically and recovers stale locks by
PID plus compare-before-unlink. Refresh and ordinary transient failures use bounded retry; native
Luna429 uses the shared hold below. A rotating refresh with an unknown outcome is not replayed.
A valid access token can continue during that ambiguity, but expired credentials require the
supported reconnect path. `INFERENCE_COMMAND` and OpenAI-compatible HTTP remain available for
explicit custom configurations; neither native route silently falls back to them. Native provider
credentials and project configuration stay in protected service configuration, never Git/evidence.

Native provider402/429 errors carry only sanitized upstream status/category and whitelisted
Retry-After or `x-codex-primary-reset-at`/`x-codex-primary-reset-after` guidance in `ApiError.details`; response
bodies and credentials are not persisted. A shared additive `memory_provider_holds` row stops NEW
memory-job claims across workers until the bounded reset/hold. Capacity failures restore the current
claim's attempt and retain the same nonterminal job; already-terminal rows are untouched. Expiry
admits one lease-fenced real request rather than a worker stampede. Capture, recall and the unrelated
action worker remain available, and recovery never automatically retries terminal jobs. Upstream
holds are capped at31days; absent usable guidance uses a bounded five-minute hold.

Only `user`, `assistant` and `inter_agent` upserts are admitted to memory ingestion. A tool-role
upsert fails `invalid_event` before source/job insertion; a tool-role delete remains available for
existing source cleanup and never creates a job. Existing nonterminal tool rows retain their stored
status/attempts but are excluded from scheduler heads and `live` fences, so they cannot reach JEV or
Luna. Manual retry/reprocess of those rows is not supported. Auditor previous-event and recent-event
queries include communication roles only. Curation candidates require communication support and
remove tool-only supports before identity/reconciliation; existing graph/recall rows are not bulk
rewritten by this admission boundary. No tool action, task event or execution feed is an allowed
new source of memory evidence.

JEV is used only in asynchronous digestion. `THE_ATLAS_JEV_API_KEY`, `JEV_MODEL` (default
`jev-1.14.0`), `JEV_URL` (default TypeSafe System One) and `JEV_CONCURRENCY` (default4, maximum16)
control it. Every request has exactly one named `decision` question and exactly one validated
choice/probability/usage response. Admission, graph-area and each relationship are independent
calls; no multi-question battery or bundled candidate evaluation is accepted. JEV never runs on
foreground recall and never writes a memory or relationship.

The latest event plus up to five visible preceding same-thread events forms the auditor view.
The latest content is bounded to the first/last2,000 characters (600 each for context), with
`content_truncated` disclosed. Admission choices are:
- `durable_candidate`, `session_episode`, `uncertain`: continue through bounded Luna curation;
- `session_context`, `noise`: preserve captured source with a terminal `skipped` job, but only
  when the complete source was audited;
- any negative on a truncated source: continue to Luna rather than excluding unseen evidence.

Luna still decides durable/session-only/history/correction/noise; session-local instructions
must not be globalized as standing shared preferences. JEV graph-area selects/prioritizes one
supplied area or none/uncertain, without deleting unexamined areas. Up to6 candidate
relationships are audited separately; only `irrelevant` removes that evaluated candidate.
Relevant, uncertain, unexamined and session-local-but-relevant relationships remain available.
Unavailable admission/routing is persisted as `unavailable` and fails open to Luna; missing JEV
configuration remains an explicit deployment error rather than silently disabling the pipeline.
JEV402 Payment Required opens a bounded JEV-only circuit with sanitized status/category and any
standard Retry-After guidance. During the hold, admission/routing is honestly `unavailable` without
another paid request and Luna remains eligible. Expiry permits one DB-fenced request; only its real
validated success closes the circuit. No-reset holds are five minutes, upstream holds are capped at
31days, and this circuit never blocks Luna by itself.
`GET /v1/status` exposes `memory_inference.availability` for Luna and JEV: configured/not_configured,
available, held with reason and next-probe time, or probing. It contains no credentials, prompts or
provider response bodies.
`memory_event_admissions` and `memory_jev_routes` persist non-content decisions, model,
confidence, proof and elapsed time for these calls. Admission is reused across chunk retries;
new jobs/reconsiderations receive fresh review.

A capture-filtered current event supports the same authenticated/idempotent `/reprocess`
operation as a completed event. Its new job links through `memory_reconsider_requests` with the
original accepted time; completed jobs continue using `memory_reprocess_requests` with the
original processed time. Neither operation replays source tools/actions or changes the old job,
admission history, source content, roots, revision or existing knowledge.

`POST /v1/memory/jobs/:job_id/admission-review` requires normal authentication, Idempotency-Key,
`{agent_id,memory_id,expected_revision,reason_code}` and current affected-scope read/write grants.
The accepted reasons are `session_local_owner_correction` and `execution_content_owner_exclusion`.
The completed current source revision must directly support the named memory through retained
`memory_supports`; raw source content is not required for this deterministic demotion. Session-local
correction targets `user:alex`/`business:alex`; execution exclusion additionally covers the bound
agent's private scope under current grants. The operation appends an `owner_directive` review and
demotion proof; it does not call a new model, execute the original action, alter the source/job/
memory/support rows or synthesize a replacement memory. Post-demotion graph/recall excludes that
derived claim while pre-demotion recorded history remains inspectable. Later independently supported
user evidence can restore shared claims; agent-private execution exclusions can instead be restored
by genuine user/assistant/inter_agent communication. These bounded owner-directed reasons are not
arbitrary caller-authored fact editing.

### Processing-decision consistency and supported repair

Claim-equivalence expansion must not override an explicit `unaffected_ids` member. Such a
contradictory group's proposed transitions are withheld, retained as `blocked_dispositions`
(reason `incompatible_unaffected` with targets and conflicting IDs), and excluded from writes.
Independent transitions remain. This is unresolved processing evidence, not a domain truth
conflict or an assertion that a model was universally correct. Semantic inference remains
probabilistic; no predicate vocabulary or fixed endpoint-overlap prerequisite is imposed.

Two additive endpoints repair already-persisted contradictions without reprocessing:

- `POST /v1/memory/reconciliations/:job_id/repair-preview` is read-only, no Idempotency-Key
  required. Body `{agent_id,expected_revision}`. Returns `{job_id,event_id,expected_revision,
  change_ids,proof_sha256,memory_only:true}` inside the normal data envelope.
- `POST /v1/memory/reconciliations/:job_id/repair` requires normal authentication and
  Idempotency-Key. Body `{agent_id,expected_revision,expected_proof_sha256,change_ids,reason_code}`.
  The exact ordered change_ids and proof must match a freshly computed plan. Reason is the same
  non-content1–80-character `[a-z0-9_-]` diagnostic form as reprocess. The receipt adds
  `invalidated_at` and `reason_code`; idempotent replay rechecks current read/write grants.

A completed current upsert/source head, original live supports, exact revision, same-workspace
agent binding and current read/write grants for affected scopes are required. Retained scoped
supports suffice after raw-content retention. The plan derives eligibility only from that job's
persisted expanded target group contradicting its explicit unaffected disposition. It matches
actual source/target/replacement/type/effective-time changes, never caller-supplied facts or a
newly invented historical model response. An absent current source is404, revision mismatch409
`revision_conflict`, stale proof/set409`repair_conflict`, and no proven eligible changes409
`repair_not_supported`. No automatic corpus repair, new job, inference or original action executes.

Additive schema-2 table `memory_change_invalidations(change_id,job_id,principal_id,reason_code,
proof_sha256,recorded_at)` references retained changes/jobs; deletion of an original change
cascades its annotation. Original sources/IDs/jobs/changes/versions and raw dates remain unchanged.
Effective graph/recall and subsequent curation exclude invalidated changes only at/after their
recorded invalidation time. Graph change audit adds `invalidated_at`/`invalidation_reason`; UI
labels INVALIDATED PROCESSING DECISION, not a real later domain transition. Other actual closures
still apply. Invalidated derived descendants remain conservative until separately regenerated;
repair does not fabricate derived knowledge. Restore a stopped full backup for writer rollback:
an older writer does not understand this new audit projection.

Recall selected memories may add `corrections` (negative claim metadata, change/target IDs,
meaning, effective/recorded times, original source citation and optional complete scope excerpt).
`meaning:never_true_not_former_state` is distinct from `interval_correction`. These are attributed
processing claims, not independently verified world truth. Correction/representation traversal is
bounded and same-scope supported; never follow state-change links for never-true evidence. A
matching rejected claim can locate its positive correction using the existing lexical/semantic
admission, without ever returning the rejected claim as a positive historical memory. Complete
compact correction text participates in the actual token budget and selected-evidence fence.
Excerpts come exclusively from scope-safe retained memory support, never from an agent's raw
private event payload merely because one shared claim was published. Raw retention does not erase
these graph semantics; forgetting/removing source support does. Whole pending transcripts/source
payloads remain excluded. This extension does not invent a valid_from for an unsupported earlier
start: the compact source scope can explain always/never truth despite an observation-time default.

### Focused identity/reconciliation extension

REST endpoints/envelopes and original Decision fields remain compatible. Decisions may add
`object_entity:boolean`: true marks an exact canonical entity object, including a never-subject
target; false is an explicit literal, even if its text matches an entity name. Omitted retains the
legacy exact-subject graph lookup. Typed target metadata belongs to the new memory fingerprint,
not a retroactive change to an old recorded claim.
An optional assessment start_basis (explicit_source, event_default, unknown) can qualify legacy
historical precision without rewriting custody. Unknown records `memory_changes.type:start_unknown`
under original-source authority, not independent assistant recap authority. Graph/recall expose
historical_start_unknown and render unknown start; original stored valid_from remains inspectable.
The annotation is neither a never-true correction nor a handover or representation retirement.

The default inference path separates extraction, entity identity and truth reconciliation. Each
serialized product input (including its system prompt) is checked against the same exact maximum
4096 tokens. No whole graph or pending corpus is sent. Extraction uses coherent source fragments,
earlier explanatory context and earlier/same-time candidate support; later truth cannot rewrite
what the original source said. Identity/reconciliation use bounded indexed same-scope relation
windows and a deduplicated source registry, with original roles/authors/times/excerpts. Identity
co-reference is an explicit model decision, not string similarity or automatic cross-scope pooling.
Property values are not silently upgraded to entities. Actual source support remains authoritative.

Command transport remains `atlas-inference-v1`/`curate`, following the supplied system prompt;
the default task bodies are `atlas-identity-v1` and `atlas-reconciliation-v2`.
Their JSON responses preserve `decisions:[]` for the native bridge, plus `identity`/
`candidate_identities` or exhaustive `assessments:[{id,disposition}]` respectively. Each native
assessment selects exactly one directional disposition for each supplied ID: duplicate,
state_change, correction, retraction, conflict, superseded, later_state_change, later_correction,
later_retraction, or unaffected. Later replacements additionally require effective_at. Missing,
duplicate, invented or invalid assessment IDs/dispositions fail visibly. The compiler preserves
independent per-target truth types rather than forcing all candidates into one change type.
The earlier `atlas-reconciliation-v1` items contract and custom inference Decision seam remain
compatible; there is no invalid-v2 fallback to them. An adapter must pass structured JSON through and
honor the supplied task prompt; the existing Luna bridge does. Custom inference implementations
without the optional `resolveEntities`/`reconcile` methods retain their existing Decision seam.
There is no silent un-reconciled fallback if a configured model returns an invalid phase shape.
HTTP providers receive the same phase prompt. Each native phase also receives a per-call
`response_contract`: identity specifies an exact literal and omits all candidate-object bindings
for literal input; reconciliation requires exhaustive directional candidate assessments, separate
from the incoming index in the internal legacy Decision seam. Compiled representation retirement
is `superseded_ids`, never `change.type:"superseded"`. Older-source
reprocessing is not a handover at its observation-time default. Both actual identity and
reconciliation inputs are packed against4096. Retained candidates drain through windows of at
most4; a candidate deferred by packing is reconsidered, never silently dropped. A non-fitting
single candidate fails explicitly. Post-identity candidate bindings are trimmed with their IDs
so a removed binding cannot invite an unsupported reconciliation target. These contracts guide inference; unchanged literal/source/ID/time validators still reject
violations visibly. They are not deterministic semantic acceptance or a fallback.
These are product payload limits, not a promise that
external provider framing/billing also totals at most4096 tokens.

Reconciliation can jointly normalize duplicate representations and close multiple explicitly
affected assertions; compatible additions/co-owners remain independent. `memory_changes.type`
adds `superseded` for redundant/decomposed representations and internal `restored` when a selected
fingerprint is re-chosen, distinct from false `correction`, withdrawn `retraction`, or formerly true
`state_change`. Format retirement is not inherited as domain truth: repeated alias normalization
cannot hide every positive prior representation. Restoring a format never overrides a genuine
closure, correction or retraction. Explicit live duplicate audit (with current supported source
proof) also connects retained equivalent representations into bounded claim groups. A selected
truth disposition reaches supplied members of that group under the same strict scope/time/target
checks; generic superseded or compound-decomposition edges do not create equivalence. A late
replacement likewise disposes of all selected old duplicates, not only a new normalized row. A compound refinement requires its actual
original support and complete supplied atomic coverage. Original source/job/version/root history
is retained. Supported later replacements can bound/retract a reprocessed older assertion using
the later original source as audit authority, rather than ingestion/retry order. Date-only
`change.aspect:"interval"`, conflicts and grounded derived consolidation remain supported.

A handover may explicitly predate the initial claim's observation-time default. The persisted
initial bound remains custody, not an invented historical start. Such history adds
`historical_start_unknown:true`, retains the actual exclusive `valid_to`, and renders "unknown
start" in recall/UI. It never remains current merely because the old default start was later.
An exact historical start is not inferred when the source did not supply one.

Additive schema-2 tables are `memory_scoped_aliases`, `memory_alias_sources`,
`memory_entity_targets`, `memory_entity_equivalences`, and `memory_reconciliations`.
Original knowledge tables/IDs/credentials are not remapped. Legacy aliases migrate only into
scopes with supported subject identity. New aliases/equivalences retain original event proof;
forget/revision removes that proof. Graph canonical projections require same-scope live proof
visible at the requested recorded time; ambiguous equivalences are not silently pooled. Entity
objects are supported by their actual incoming edge. Reconciliation audit stores job/event/memory
IDs and selected dispositions/identity bindings; reprocess prompt hashes identify all phase prompts.
Current source/grant/lease, candidate support/version/change, post-await and concurrent related
memory fences remain. An unsupported actor rewrite in a target-identity result is quarantined and
audited, not applied. Exact canonical same-claim/same-interval state output is audited as duplicate
representation rather than a fictional handover; different actors/intervals are never coalesced by
that rule. A write-only shared destination does not grant read access to its candidates.
Use the stopped full custody backup for writer rollback; do not treat source-only completion as
runtime activation or proof of owner-native outcomes.

This is distinct from the original `/v1/context` and `/v1/graph` source/fact APIs above.
`POST /v1/events` durably stores revisioned capture before asynchronous curation;
`POST /v1/recall` is read-only (no idempotency key), with the existing `{api_version,request_id,data}`
envelope. Both require authentication and an administrator-established agent binding. The six
existing profile IDs and explicit own/shared memory grants remain the authorization boundary.
Feedback, bind and memory jobs/retry retain their existing routes. Completed current memory events additionally support explicit
`POST /v1/memory/jobs/:job_id/reprocess`, with normal authentication/Idempotency-Key and body
`{agent_id,expected_revision,reason_code}`. The reason is a non-content `[a-z0-9_-]` diagnostic code,
1–80 characters. This queues a NEW memory job linked to the previous successful job; original
event identity/revision/content/roots/accepted time, previous job/metrics, previous processed timestamp
and existing memory knowledge/history are retained. Only a completed current upsert with retained
content qualifies; changed revision, active same-conversation curation or missing source fails
explicitly. Standard original credential, grant, source-head and lease fences apply to processing.
The additive `memory_reprocess_requests` table records job_id,previous_job_id,event_pk,principal_id,
reason_code,prompt_sha256,previous_processed_at,created_at. This is selective memory digestion only,
never an original tool/action executor or automatic corpus replay. It does not erase old decisions;
normal support deduplication and model reconciliation apply. A graph-inspection endpoint is
specified separately in [brain-view.md](brain-view.md); memories/entities/supports/changes/
versions retain their persisted meanings and column identities.

Recall request: `agent_id`, `thread_id`, `query` (up to16,000 characters), optional `token_budget`
(0–100,000; default1,200), `valid_at`, `recorded_at`, `recent_context` (compatible validation up to32
messages). Only ambiguous followups use recent context: at most two user/assistant messages x600
characters, as query resolution, not evidence. No conversational inference call is made by default.
Response retains `recall_id`, `context`, `memories`, `pending_events`, token accounting, times,
`freshness` and `retrieval`. `pending_events` is now always empty; no raw pending transcript is
injected. `freshness` retains authorized non-content latest intake/processed times, pending counts and
`capture_only_count` for JEV-filtered source-only events, with included0 and omitted=pending_count. Asynchronous selection can legitimately return
no memory. Empty query also returns no memory, not the whole graph. The exact tokenizer budget
covers injected framing/citations, not response JSON or native outer message framing.

Recall materializes at most96 authorized lexical plus96 approximate semantic candidate IDs using
FTS5 and indexed LSH buckets, then checks live supports, current grants, lineage and both temporal
axes. Relevance gates and bounded entity relations determine output; allocation alone does not.
`retrieval` adds `index`, `candidates_examined`, `candidate_limit_per_index`, `embedding_ms`,
`service_ms`, `context_messages_used`, and `semantic_min`. Model/dimension incompatibility cannot
score as semantic similarity. Post-await/post-packing selected support checks fence deletion and
revocation; stale context fails retryably rather than returning cached text. See capabilities.md
for engineering thresholds and approximate-search limitations.

Curation sends coherent event fragments plus focused context under4,096 exact tokens. Durable
full content/roots and source revision identity are not truncated. Event claims use persisted
3conversation-service:1oldest-work turns. A selected human conversation receives a bounded24-claim
focus lease, then focus rotates to the least-recently-claimed human conversation; unseen ties favor
newest intake. Every fourth claim reserves oldest original accepted work. No age cutoff; a
conversation's running/retry/incomplete head prevents later same-conversation claims, not
independent-thread concurrency. Lease fencing and resumable atomic cursors remain. Additive
non-content schedule tables are `memory_schedule_clock(singleton,sequence)`,
`memory_thread_schedule(workspace_id,agent_id,thread_id,last_claim)` and
`memory_conversation_focus(singleton,workspace_id,agent_id,thread_id,remaining)`. Fairness is not a latency SLA.

Recall `retrieval.specificity` discloses named topic identifiers, unchanged lexical/configured semantic
admission, optional ISO source-time focus and ranking weights. Named topics affect ranking only, not
eligibility: moderate semantic aliases/paraphrases and lexical-only fallback need not repeat a code.
See capabilities.md for heuristic limits; incidental model codes and timestamp fragments are not
named-topic ranking hints. Same-scope seed-linked relationships remain eligible.
Explicit before/previous/history/ever queries can include supported closed states as
`historical:true`, labelled HISTORICAL in injected context with their closed valid interval. They
still cannot include corrected/retracted never-true beliefs. Current queries remain current-only.
The explicit query time is only a source-time ranking hint, not a changed valid_at/recorded_at.

Fragment cursor plus selected
facts commit atomically; incomplete source stays pending and same job requeues for its next
fragment. Only final completion sets processed time. Noise may create no memory. Correction or
retraction cannot positively reassert the exact invalidated subject/predicate/object under a new
date; such model output is a retryable `curator_correction_repeats_target` error. Genuine date-only
correction remains supported with `change.aspect:"interval"`: the same claim and genuinely changed
valid bounds are required. Other corrections default to `aspect:"claim"`; the optional aspect is
an inference-seam distinction, while persisted `memory_changes.type` remains `correction`. State changes keep
historical truth; corrections retract never-true belief while retaining recorded history until
source deletion. Root/support/lineage and forget semantics are unchanged.

New additive tables: `memory_search` (FTS5 external content over memories),
`memory_vector_buckets(memory_id,workspace_id,scope,model,dimensions,bucket)`,
`memory_index_meta(version)`, `memory_chunk_progress(event_pk,offset_chars)` and non-content
`memory_curation_metrics(job_id,event_pk,chunk_start,chunk_end,input_tokens,input_bytes,
candidate_count,recent_count,decision_count,elapsed_ms,created_at)`. UTF-16 offsets are internal
checkpoints, never source/evidence IDs. Insert/update/delete triggers maintain serving indexes;
existing memories are indexed transactionally on first open. The old knowledge tables are not
replaced or remapped. Credential values and durable captured payloads are unchanged by migration.

Optional resident embedding transport: POST `THE_ATLAS_EMBED_URL` with
`{protocol:"atlas-inference-v1",operation:"embed",request_id,input:{texts,model}}`; require the same
protocol/request_id and `output:{vectors,model}` in the response, optional `usage`. Timeout3s,
response max4MB, valid vector shape/nonzero/model validation. No credentials are exported by this
transport. Native/model route activation remains an operations concern, not implied by this API.
