# Capability map

## Offline derived-brain clean slate

A local OS operator can physically reset the complete derived brain with
`bun run cli reset-derived-brain --db EXISTING_FILE --confirm RESET_DERIVED_BRAIN`.
The command refuses a missing/default database path and requires the exact confirmation. It is an
**offline stopped-custody operation**: stop Atlas and capture producers, take a fresh full database
and configuration backup, then run it once. It is not an HTTP endpoint, per-source forget, demotion,
or replay operation.

The transaction removes both legacy facts/supports and every native memory scope, including demoted
memories, entities/aliases, relations, changes/versions/lineage, admission/review/reconciliation
artifacts, embeddings, FTS/LSH indexes, curation cursors, recall/feedback projections and scheduler
focus state. Original sources/revisions and native `memory_events`, heads/roots, credentials,
workspaces/grants/bindings, idempotency/audit, terminal jobs, non-content processing metrics and
reprocess/reconsider receipts remain. Existing terminal jobs are not retried. Current-generation
queued/running/retry jobs become `cancelled` with `derived_brain_reset`; provider capacity/payment
holds and backoff timestamps remain, while stale single-flight probe leases clear.

Additive reset generations fence old jobs and raw events from both schedulers, manual
retry/reprocess/review/repair, auditor/recent provider context, recall freshness and graph processing
counts. New source revisions and new native events receive the new generation and work normally;
exact old idempotent/event replays remain historical receipts rather than new work. A non-content
`derived_brain_reset_receipts` row records exact table counts. Unknown future tables fail closed and
deletion/verification runs in one immediate transaction with foreign-key and quick checks.

Atlas cannot reach producer-local outboxes. Pause and explicitly fence each adapter's pre-reset
journal/outbox/platform/feedback queues and in-memory recall cache while preserving its native
transcript, credentials and configuration; otherwise a producer could redeliver old content with a
fresh queue state. Restore the normal worker-enabled service after that coordinated reset. Backups
are retained historical custody, not active-brain rows; SQL deletion is not a claim of backup,
provider-log, SSD or consumer-copy forensic erasure.

## Sustained selective dreaming with native Luna and JEV (source; activation separate)

Atlas owns direct OAuth-backed Luna and direct regular OpenAI Responses native transports. With
`THE_ATLAS_NATIVE_WORKER=true`, a configured `THE_ATLAS_PROVIDER_API_KEY`/`OPENAI_API_KEY` selects
`https://api.openai.com/v1/responses`; `THE_ATLAS_OPENAI_PROJECT_ID` supplies the dedicated project
header. Without an API credential, the existing OAuth HTTP/SSE route remains available. API errors
do not silently switch providers. Neither route uses a Codex CLI, app-server, agent runtime or Hermes
PluginLlm/per-call bridge. The owner handoff separately verifies the dedicated API credential,
project, credit and HTTP200; production provisioning/activation is not implied by this source change.
OAuth tokens remain in the Atlas-private mode0600 `auth.json`; rotating refresh is
single-flight with PID/CAS stale-lock recovery and account preservation. Luna 429 responses
propagate only sanitized status/category plus whitelisted Retry-After/primary-reset guidance.
A persisted shared hold stops new memory-job claims without consuming capacity-failure attempts;
one lease-fenced real request probes expiry. Capture, recall and the unrelated action worker
remain available, and terminal jobs are never bulk-retried. An ambiguous refresh is never blindly
replayed: a still-valid access token may continue, while expiry after an unresolved rotation
requires supported reconnection rather than guessing its outcome.

JEV is the asynchronous first auditor/router, never the graph writer and never on foreground
recall. Each HTTP request has exactly one typed question and exactly one validated answer;
admission, graph-area and each candidate relationship are separate calls under bounded
concurrency (default4). The latest event plus up to five prior events is bounded to head/tail
excerpts, not a whole transcript. `durable_candidate`, `session_episode` and `uncertain`
reach Luna; complete `session_context`/`noise` stays captured with a skipped job; any
truncated negative also reaches Luna so omitted text cannot become an eligibility fence.
Useful session episodes remain eligible for Luna's durable/session/history/correction/noise
decision. JEV graph-area only prioritizes supplied areas. Per-candidate calls remove only
`irrelevant` relations; uncertain/unexamined and relevant session-local history remain.
Unavailable admission/routing calls are audited as `unavailable` and continue as uncertain rather
than making JEV a hidden eligibility gate; missing JEV configuration remains a deployment error.
JEV402 opens a bounded JEV-only hold (five minutes without upstream guidance, at most31days with
it), so subsequent jobs fail open to Luna without one new paid JEV attempt per job. A single
DB-fenced valid request probes expiry; only a real success declares recovery. Sanitized hold state,
reason and next-probe time are exposed through `/v1/status` without credentials or response bodies.

Only user/assistant/inter_agent communication can create new memory jobs. Tool upserts fail before
source/job insertion; legacy tool rows remain unchanged but are ineligible for claims, retry or
reprocess. Auditor/recent-event queries include communication roles only, and provider candidates
require at least one communication support with tool-only supports removed. This does not delete or
bulk-demote historical brain content. `execution_content_owner_exclusion` permits a supported
owner-directed admission review for affected agent-private or shared memories with current grants;
original jobs/events/history remain intact and no provider request occurs.

Automatic Kanban/status wakes, delivery receipts, internal notifications and background-process
completion notices are metadata/events, not durable communication, even when an adapter labels them
`user` or `inter_agent`. Explicit native producer/attribution metadata and start-anchored machine
forms (including the Discord `[Alex] [kanban] Task …` variant) are rejected before source/job
insertion. There is no broad task/result/completion substring ban: genuine Alex task requirements
and agent-to-agent reasoning, including delegated results, remain eligible. Already-captured notice
jobs finish as capture-only `skipped` with an `automatic_status_boundary` audit when no earlier
admission exists, without JEV/Luna; notices are also removed from prior/recent provider context and
candidate supports, and cannot be retried or reprocessed. Historical source rows are not deleted.

A 24-claim persisted conversation-focus lease provides coherent service, then rotates to the
least-served human conversation. Other threads and inherited work continue concurrently and
every fourth claim reserves oldest accepted work. This replaces the observed one-turn-per-
full-rotation starvation without a newest-thread monopoly. Capture remains immediate;
`captured` is not `processed`, and recall exposes `freshness.capture_only_count` while keeping
pending transcripts empty. Capture-filtered events support a new audited `/reprocess` route
with `memory_reconsider_requests`; original jobs/decisions remain unchanged. Legacy captured tool
content follows RAW_RETENTION_DAYS; original owner and assistant message content is
retained for reconsideration.

`POST /v1/memory/jobs/:job_id/admission-review` is the bounded owner-directed correction for
session/global admission errors, execution-derived content and automatic-notification-only memories.
It requires the exact current job and source-head revision, direct retained `memory_supports`
provenance and affected read/write grants. `session_local_owner_correction` handles completed shared
claims and keeps its succeeded+processed requirement. `execution_content_owner_exclusion` handles
affected own/shared claims and additionally accepts a failed current job with a still-pending source
event, including retained partial support. `automatic_notification_owner_exclusion` uses the same
completed/failed-current content-exclusion states and own/shared scopes, but additionally requires
the exact source to match the automatic-notification classifier and every retained direct support
to be notification-only; mixed genuine/notice memories are not eligible for this reason.
Each appends an `owner_directive` review and demotion proof; no new model vote, failed-job retry,
source replay or SQL deletion is involved. Post-review recall/graph projections exclude that derived
claim while pre-review recorded history remains inspectable. Shared restoration requires later
genuine user support; agent-private execution/notification exclusions can use later genuine
communication. Automatic notices never restore a demotion. Restoration is bounded by the requested
recorded time, so later support cannot rewrite the demoted interval.

Additive audit tables are `memory_event_admissions`, `memory_jev_routes`,
`memory_admission_reviews`, `memory_admission_demotions`, `memory_reconsider_requests` and
`memory_conversation_focus`; `memory_provider_holds` stores only sanitized availability state. Existing source/event/job/memory/support identities and terminal
job effects remain. A synthetic direct OAuth/SSE probe completed valid `{"decisions":[]}` on
`gpt-6-luna` in3.019s (88input/9output tokens), with no agent runtime or tools. Source
verification:165tests/1562assertions and typecheck pass; prior frozen-install and real on-disk
pinned-Bun HTTP/CLI E2E evidence is reused for unchanged paths. Live JEV and current-conversation activation outcomes remain Overwatch
`t_05e9321c`; no production activation, global queue-empty or universal semantic claim is made.

## Claim-consistency repair and correction-preserving recall (source only)

Equivalent claim-group propagation is conservative when a supplied member is explicitly
unaffected: conflicting group transitions are withheld and audited as `blocked_dispositions`,
not silently applied and not presented as domain truth conflicts. Independent changes still
apply; predicate/entity renames are not forbidden. This detects contradictory processing
outputs, not every possible semantic model error.

A bound caller with current affected-scope read/write grants can inspect and invalidate the
exact persisted processing changes proven inconsistent by the same source/job reconciliation.
`repair-preview` returns a CAS proof and exact IDs; authenticated/idempotent `repair` appends
invalidation audit. No caller facts, date edits, job resets, extraction or tools execute. Original
changes remain inspectable; older recorded snapshots retain the old interpretation. The scope is
compiled unaffected/changed conflicts, not arbitrary operator rewriting. Independently ended
states remain ended; invalidated derived descendants are not automatically regenerated.

Relevant recall preserves never-true versus formerly-true meaning after atomic normalization:
compact correction metadata, original-source citation and at most360-character complete scope
sentences from scope-safe support. Raw event retention is not required. Bounded traversal (8
representations, up to4 distinct correction claims) never follows state changes; identical quoted
correction clauses share one injected citation, not a blanket one-correction-per-source rule.
Rejected-value lexical/semantic matches can retrieve the positive correction, never the false
claim as a positive past state. Existing relevance/grant/time/support fences and lexical/moderate
semantic paths remain. If the bounded correction cannot fit, that indivisible memory record may
be omitted; a whole pending/source transcript is never substituted.

Exact already-damaged current-copy repair, real resident MiniLM/lexical original query1118/1200
(with direct current reporting and always amber/never cobalt), irrelevant0, and real copied
HTTP/Chromium audit/history projection pass. Final142tests/1203assertions and typecheck pass;
frozen install/on-disk E2E evidence is reused where unchanged. This is source/copy evidence, not
production/native acceptance. See `evidence/claim-safe-repair/HANDOFF.md`; activation and minimal
supported repair belong solely to Overwatch t_d281231f, with root t_5f7f3afb settling delivery.

## Focused relational identity/state repair (source, activation separate)

The default Luna path now separates atomic extraction, scoped sourced entity co-reference and
truth reconciliation into bounded phase calls, each with the exact4096 product-input cap.
Reconciliation retains the predicate-focused indexed pool (two lookups returning at most24 each,
plus at most12 extraction candidates, deduplicated within scope). It drains that bounded pool in
windows of at most4 candidates, each packed against4096 tokens; packing defers rather than drops
retained candidates. The native directional assessment schema covers every supplied ID exactly
once. Duplicate correct replacements cannot silently omit other retained contradictory claims.
Live recorded semantic-duplicate proofs propagate a selected truth disposition across the supplied
claim group; generic compound/representation supersession is not equivalence proof.
Original source attribution/roots remain attached; scenario qualification is separate from plain
entity relationships. Explicit typed objects can be supported entities without ever being subjects;
literal properties stay literal. Scoped source-backed aliases/equivalences do not pool graphs.

Current/history serving distinguishes never-true correction, genuine handover, and superseded
representations. Multi-target changes, duplicate normalization, additions/co-owners, date-only
corrections, derived lineage and late-original replay protection are covered by focused regressions.
Unknown prior start remains unknown when a handover predates an observation-time default; the real
handover boundary is retained rather than fabricating a start or leaving stale truth current.
An original-source model assessment can also qualify unsupported legacy start precision through
additive `start_unknown` audit, without changing raw dates/IDs. Current graph/recall mark that
precision unknown. Multi-question lexical facets retain independently grounded atomic relations;
requested complete predicates pack before broad report/recap predicates. The original full-query
lexical path, moderate semantic threshold and lexical-only fallback remain available.
See contract.md for additive tables and versioned identity/reconciliation task shapes. Existing
native adapter/embedding/preview evidence is reused where unchanged. Additional focused model calls
increase digestion cost/latency; this is not an unchanged24.640s freshness promise or universal
semantic accuracy claim. The isolated source evidence and remaining native activation boundary
belong to the current source handoff, not a new observation/approval lane.

## Automatic event-memory path — schema 2, dreaming revision

`/v1/events`, `/v1/recall`, `/v1/feedback`, `/v1/memory/bind` and job diagnostics/retry
implement immediate durable revisioned intake followed by asynchronous **selected** knowledge.
A receipt is not extraction success; chatter may yield no graph memory. Own `agent:<profile>` plus
`user:alex`/`business:alex` scopes, current grants, attribution, roots, correction versus state
change, valid/recorded history, fading, utility, aliases, consolidation lineage and forget fences
remain. See [contract](contract.md) and the graph lane's [memory graph](brain-view.md).

### Bounded digestion, not a model-name swap

The worker checkpoints coherent fragments of at most 6,000 UTF-16 code units, shrinking them further
to an exact **4,096-token maximum** (`o200k_base` by default), including the serialized system prompt.
It sends at most two earlier same-thread events (800 characters each), 500 preceding fragment
characters, a bounded metadata excerpt, and targeted existing beliefs: indexed lexical matches
(default 8, configurable up to 12) plus bounded source/thread continuity, at most 12 combined.
Unused context is removed before shortening a fragment. Each successful fragment atomically commits
selected memories and a durable cursor, then requeues the same job for its next fragment. Oversized
accepted sources are neither silently truncated nor stranded pending for a larger model. Final
success/processed time follows the last fragment. Crashes/retries resume the committed cursor;
revisions/deletion invalidate source evidence and progress. Pending/failed custody never expires.

`THE_ATLAS_CURATION_INPUT_TOKENS` can lower the 4,096 maximum; a window unable to fit protocol/prompt
framing fails visibly as `curation_budget_too_small`, retaining custody. Other controls:
`CURATION_CANDIDATE_LIMIT` (8), `CONSOLIDATE_EVERY` (16), `MEMORY_WORKERS`,
`SALIENCE_HALF_LIFE_DAYS` (30), `WEIGHT_<RELEVANCE|SEMANTIC|ASSOCIATION|RECENCY|IMPORTANCE|USEFULNESS>`,
`TOKEN_ENCODING` (`o200k_base` or `cl100k_base`) and `RAW_RETENTION_DAYS` (30, nonpositive disables).
All names accept `THE_ATLAS_` and compatible legacy `THREADATLAS_` prefixes.

The current digestion route is Atlas-native direct OAuth HTTP/SSE to `gpt-6-luna`; no Sol fallback,
Codex CLI/app-server, Hermes per-call bridge or primary-chat change. Product source remains
inference-provider independent for retained custom paths: `INFERENCE_COMMAND` is a JSON argv,
never a shell; OpenAI-compatible HTTP also remains available for those non-native configurations.
Native account/model routing and JEV admission/routing are Atlas-owned.
The actual fictional Luna exercise selected connected responsibilities/reporting, discarded noise,
reconciled a handover with January history, retained a useful final fact from an 11,082-character
source in two calls, and corrected a never-true delivery-owner claim. The real run exposed a model
reasserting the invalidated positive claim; an explicit prompt rule plus target-repeat validation
fixed it in one focused source revision. Invalid model results retry safely, not relabelled truth.
Exact product input counts were 989–3,236 tokens in that run (provider counts differ by framing).
This small exercise is semantic evidence, not general extraction-accuracy or throughput certification.

### Indexed, relevant query serving

Recall uses SQLite FTS5 (Porter/Unicode) plus a persisted random-hyperplane LSH index: 24 eight-bit
bands with one-bit multi-probes. Each index admits at most 96 authorized candidate IDs; at most 192
base memories are materialized and cosine/relevance-ranked. Model and dimensions are fenced before
semantic lookup. This is **approximate** candidate search, not exact nearest-neighbour recall or a
scale/SLA guarantee. It does not load/rank all authorized memory rows or scan/pack pending content.
Non-content freshness still reports accepted/processed times and pending counts under current grants.

Default recall budget is 1,200 exact tokenizer tokens; explicitly requested larger budgets remain
supported (0–100,000). Relevance, not spare allocation, determines output. Admission requires lexical
coverage >=0.34 or compatible cosine >=0.42 (`RECALL_SEMANTIC_MIN_MILLI`, default420). Lexical coverage
remains independent of memory length, embedding availability and word order. An explicit
"In the fictional X archive," query-location preamble is focused to "X:"; the exact scenario token
and substantive question remain, but generic fictional/archive overlap cannot dominate. This never
requires literal name/code repetition by memories or aliases. An 80%-of-strongest relevance gate follows;
strong lexical matches >=0.6, already-admitted requested predicates and relationships on leading
same-scope entities survive so one facet cannot erase another. Salience/utility rank only
eligible evidence; they cannot admit unrelated truth. Up to three direct seeds may add bounded
same-scope entity-object-to-subject relationships, plus bounded same-entity siblings whose predicate
is requested (e.g. maintains AND reports_to). Source citations are compact; full support/root
metadata remains typed. Empty/unrelated queries can return an empty context and no memory.

Named coded topics (after fictional/project/exercise/task/ticket/fixture) are ranking hints only,
not an additional admission prerequisite. Matching a claim or visible support excerpt adds0.12;
moderate semantic aliases/paraphrases and lexical-only recall retain the same admission thresholds
whether or not the query names a code. Incidental model/version codes and ISO timestamp fragments
are not topic hints. These relevance thresholds are engineering heuristics, not general relevance
certification: moderate-similarity unrelated receipts can still be admitted. An exact
query/predicate two-word phrase adds0.10 to already-admitted ranking. Explicit ISO date/time in a query
adds source-time proximity weight `0.15/(1+distance_ms/300000)` using supporting event occurred_at,
not last-use, ingestion or processing time. Bare ISO query times are interpreted as UTC for this ranking
hint. This neither changes valid_at/recorded_at eligibility nor imposes a global newest-first rule.
`retrieval.specificity` discloses those hints and weights. Explicit before/previous/history/ever queries
may include supported closed states, labelled HISTORICAL with their valid interval; corrections and
retractions still cannot reappear as former true states. Ordinary current queries remain current-only.

Recall removes only recognized standalone answer-control boilerplate before embedding/lexical
scoring, not substantive conditional or technical questions. Duplicate current-query snippets are
not explanatory context. Assistant-only notes consisting solely of a lack-of-supplied-context
answer are not domain facts for direct factual questions; historical/process queries can still
retrieve those observations. Mixed useful facts, user/tool evidence and domain negatives are not
classified as abstentions. These are bounded English heuristics, not a general intent classifier.
No conversational model or hosted reranker is used on recall. Ambiguous pronoun followups may use
only two caller-supplied user/assistant snippets, 600 characters each, for query resolution, not
independent evidence. No pending transcript is returned (`pending_events:[]`); graph lag is explicit.
Optional `THE_ATLAS_EMBED_URL` supports a resident embedding service using the existing exact-ID
`atlas-inference-v1` envelope, bounded to 3s/4MB. HTTPS or loopback only. `EMBED_COMMAND` remains
compatible; embedding failure degrades honestly to indexed lexical recall. There is no recalled
content cache surviving forget/revocation. FTS/bucket triggers synchronously track writes/deletion;
initial indexed backfill is transactional and retains source/credential/table identities.

Actual local HTTP/query/embedding measurements and sample outputs are in
`reports/dreaming-source.json`. They separate first-request serving, warm samples, embedding and
service time. Native adapter/full-path activation and observation are **separate downstream work**;
this source implementation is not a claim that the running production process has loaded it.

SQLite is still single-node. Forget cannot unsend provider requests, erase backups or already
returned consumer copies; credential redaction is not perfect DLP. Approximate semantic retrieval,
model errors, unbounded queue growth when input exceeds processing throughput, and large explicitly
requested recall windows remain practical limitations, not a promise of cognition or Zep parity.

## Fair event scheduling and specific historical recall — 2026-11-07 follow-up

Event-memory claims use a persisted three conversation-service turns to one oldest-work turn.
The current sustained-use revision gives a selected human conversation a bounded24-claim focus
lease, then rotates focus to the least-recently-claimed eligible human conversation; unseen ties
favor latest accepted intake. Independent workers serve other heads while that conversation is
running. There is no age cutoff that can strand an already-overdue conversation outside the fair lane.
Oldest turns use original event accepted_at/rowid, not chunk requeue time. Each conversation's oldest
unfinished event is its sole head: running leases, retries/backoff and incomplete fragments block
later events in that same conversation, while independent conversations can run concurrently. A
persisted claim clock, focus lease and per-thread service cursor survive reopen/multiple workers.
No sources are dropped, marked processed en masse, replayed or moved into recall. This is a service
allocation policy, NOT a universal latency bound; a long source or retry can still delay its own
conversation, and sustained input above provider throughput still grows backlog.

The additive non-content tables are `memory_schedule_clock(singleton,sequence)` and
`memory_thread_schedule(workspace_id,agent_id,thread_id,last_claim)`. Existing jobs, source revisions,
cursors, credentials and graph identities are preserved. The initial live FIFO observation remains a
failure: original LDN7 was0/8processed behind2651older jobs at6minutes. The initial coded-topic0.62
admission prerequisite and its empty-LDN7 success claim in7082fe2 were withdrawn. With that restriction
removed (no substitute coded-query gate), a fresh same-readonly-snapshot baseline/corrected comparison
still admits the unrelated329token LDN7 receipt while all8original events remain pending. This is an
unresolved relevance failure, not abstention success. Correct dated comment2030 still ranks first in
1144tokens rather than being displaced by2017/generic receipts; the Neptune query returns0tokens.
These are source diagnostics, not native answer-use or processing proof. Targeted Overwatch
activation/outcome is separate. Exact corrected source/test/readonly evidence is in the follow-up handoff.

## Fact-selection source repair, not production acceptance

The curation prompt now explicitly retains useful user-supplied fictional working relationships as
scenario-qualified **agent-private episodes**, not Alex preferences or business truth, without
mechanically retaining every message. Routine ACKs and lack-of-evidence answers normally yield no
knowledge. A real isolated gpt-6-luna source fixture selected three relational/qualification notes,
resolved a contextual reviewer, and discarded both ACK and denial (four calls, exact inputs
1,330–1,941 tokens). Its initial recall omitted a stored reporting relation; the requested-predicate
same-entity expansion repaired that serving defect without repeating model extraction. Four persisted
edges are connected through actual same-scope entities, and the unrelated packet is empty. This is
source fixture evidence, NOT a new native session, freshness guarantee or overall acceptance.

`POST /v1/memory/jobs/:current_job_id/reprocess` is an explicit authenticated, idempotent memory-only
remediation operation. It requires agent write access, expected_revision and a non-content reason_code;
only a current completed upsert with retained content qualifies. A new memory job and immutable
`memory_reprocess_requests` audit link retain the previous completed job, original processed time,
prompt hash, original event/revision/content/roots/accepted time and all existing knowledge/history.
It cannot execute original tools/actions. It does not erase earlier decisions or guarantee model
reconciliation; existing model change/support/lineage fences still apply. Active same-conversation
curation returns a bounded conflict rather than overlapping chronology. No corpus replay is automatic.

A same-readonly-snapshot baseline/corrected comparison now selects both originally omitted LDN7
memories plus the naturally progressed handover/color notes (658 tokens), excludes prior denial,
returns zero for QZX8, and preserves the dated comment2030 packet exactly. At that snapshot original
LDN7 had naturally reached8/8processed; this does NOT repair its earlier6minute/10minute freshness
failure. Original VES8 still had0supportedfacts and, before any supported memory reprocess, its query
now correctly receives an empty packet rather than a prior denial or unrelated note. The repair does not invent missing source
facts: targeted audited memory remediation and changed native behavior belong to activation owner
t_fc720392. No production lifecycle, config, grants, queues or native sessions changed in this source
phase. Exact local evidence is in D:/Projects/TheAtlas/evidence/selection-repair/.

## Original alpha source/fact path (unchanged; historical verification)

The following map describes the original API path, not the new event-memory capabilities above.

This is a bounded, runnable context-memory product milestone. The map documents actual claims, not
an imported platform checklist or a full-Zep completion standard.

| Capability                               | State                                         | Practical boundary                                                                                          |
| ---------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Install, local setup, CLI JSON workflows | Shipped                                       | Bun + local disk; generated file-only credentials; runnable complete demo                                   |
| Source text/JSON/messages and revisions  | Shipped                                       | 250k UTF-16 payload limit; explicit timestamp/idempotent source identity                                    |
| Durable asynchronous jobs                | Shipped                                       | One process/serial worker, retry/heartbeat/fencing and restart recovery                                     |
| Temporal facts and provenance            | Shipped                                       | Explicit assertions; deterministic scope-local dedupe; half-open valid/recorded intervals                   |
| Graph navigation                         | Shipped, bounded                              | Exact-label undirected 1–3-hop expansion; no alias/entity resolution                                        |
| Context retrieval and budgeting          | Shipped                                       | Lexical scans, caller-selected spaces, Unicode character budget, 5k candidate cap                           |
| Correction/history/forget                | Shipped                                       | CAS revisions, support repair, payload redaction, orphan-fact erasure; external copies/backups separate     |
| Real natural-language provider path      | Implemented, unverified with live credentials | OpenAI-compatible extraction + embedding; initial host had no supported key; actionable error tested        |
| Semantic retrieval                       | Partial                                       | Adapter/vector storage/cosine available, no configured live run or quality claim                            |
| Isolation and credentials                | Shipped, local-first                          | Workspace credentials, personal/shared spaces, explicit grants/revocation, no enterprise auth               |
| Browser inspection/admin                 | Shipped, minimal                              | Real scopes, jobs, ingestion, source history, correction, forget and context; not a full dashboard          |
| Operations                               | Local alpha                                   | Health, safe request diagnostics, queue/errors, audit, offline backup instructions; no managed failover/SLA |
| Open source                              | See release/readback evidence                 | Apache-2.0, lockfile, CI and obtainable alpha source artifact                                               |

**Not shipped / not implied:** automatic capture from an agent harness, SDK/MCP adapter, connector sync,
learned procedures, SSO/advanced policies/retention engine, arbitrary graph query language, entity/alias
resolution, summarization/observations, rerankers, distributed architecture, compliance certification,
provider cost/quality benchmark or Zep/enterprise parity. Add these only when a concrete product need
justifies them; absence is not an invented mandatory platform obligation.

## Useful next improvements

1. Run the configured provider probe with an authorized key before making semantic/extraction claims;
   then evaluate grounded extraction/retrieval on public or deliberately synthetic labeled examples.
2. If query latency matters above the measured small-dataset envelope, implement indexed candidate
   retrieval and batch provenance reads before changing the entire storage architecture.
3. Harden public exposure: TLS termination, request/rate limits appropriate to the deployment,
   credential lifecycle management and a deliberate backup-retention policy.
4. Add a small SDK/MCP or harness adapter only against a real client workflow; the CLI is the complete
   working agent surface today, not a claim that adapters already work.

## Focused entity relationships and conversational recall (source)

Recall classifies the latest query plus the two recent compatible messages already supplied by adapter
1.2.4. Narrow entity/name questions follow typed relationships and synonyms and stop at a compact
packet. Domain questions, including a dog-to-work topic shift, drop exclusive unrelated topics and
closed or historically prefixed work predicates. A broad self-profile question still returns a varied
non-agent packet. Unknown predicates remain valid; this is not a closed ontology.

`POST /v1/memory/entities/repair` is the provenance-CAS amendment for one generic ownership claim and
its existing typed pet claim. It can record name history as an entity equivalence, invalidate an exact
mistaken retraction, and close only that retraction's overgeneralized sibling. It does not replay
sources, call a provider, or rewrite valid time. Graph reads expose predicate-sourced entity types and
the original object text, including a superseded name. The activated serving commit is
`85c7b80cd85783b2561c2949933fe749eef48bdd`. Live reconciliation used the existing correction
source, preserved history, and did not replay intake; evidence is
`evidence/entity-focused-recall/activation.json`.
