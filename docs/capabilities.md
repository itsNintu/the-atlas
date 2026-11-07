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
selected memories and a durable cursor, then requeues the same job at the queue tail. Oversized
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
coverage >=0.34 or compatible cosine >=0.42 (`RECALL_SEMANTIC_MIN_MILLI`, default420), followed by an
80%-of-strongest relevance gate (strong lexical matches >=0.6 remain). Salience/utility rank only
eligible evidence; they cannot admit unrelated truth. Up to three direct seeds may add bounded
same-scope entity-object-to-subject relationships. Source citations are compact; full support/root
metadata remains typed. Empty/unrelated queries can return an empty context and no memory.

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
