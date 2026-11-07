# Capability map

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

The proven host-owned route is `openai-codex/gpt-6-luna`; no Sol fallback or primary-chat change.
Product source remains inference-provider independent: `INFERENCE_COMMAND` is a JSON argv, never a
shell; OpenAI-compatible HTTP also remains available. Native account/model routing is host-owned.
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

Event-memory claims use a persisted three fair-thread turns to one oldest-work turn. Fair turns
choose the least-recently-claimed eligible conversation; unseen-thread ties favor latest accepted
intake. There is no age cutoff that can strand an already-overdue conversation outside the fair lane.
Oldest turns use original event accepted_at/rowid, not chunk requeue time. Each conversation's oldest
unfinished event is its sole head: running leases, retries/backoff and incomplete fragments block
later events in that same conversation, while independent conversations can run concurrently. A
persisted claim clock and per-thread service cursor survive reopen/multiple workers. No sources are
dropped, marked processed en masse, replayed or moved into recall. This is a service allocation
policy, NOT a universal latency bound; a long source or retry can still delay its own conversation,
and sustained input above provider throughput still grows backlog.

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
