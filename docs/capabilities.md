# Capability map

## Automatic event-memory path — schema 2

Additive `/v1/events`, `/v1/recall`, `/v1/feedback`, `/v1/memory/bind` and memory job diagnostics/retry
now implement durable revisioned intake, server-bound own/shared graphs, bounded contextual
natural-language curation, temporal reversal/correction/conflict, visible entity aliases,
semantic/lexical/entity-and-lineage association recall, token packing, pending freshness, salience
fading, explicit outcome-linked utility, derived consolidation lineage, source-root dedupe and
correction/forget repair. Capture acceptance is not extraction success. Role/source attribution is
retained; retrieval and retelling do not manufacture independent support.

The actual synthetic product exercise completed seven natural-language/tool events and eight recall
checkpoints with `openai-codex/gpt-6.1-sol` curation through an authorized command bridge and real
`sentence-transformers/all-MiniLM-L6-v2` CPU embeddings. It distinguished a contextual preference,
one-turn override, later reversal/current/history, cross-agent pending correction, delayed business
responsibility, and failed versus later dated verified tool outcomes. Native capture/pre-answer
injection is a separate adapter/activation workstream: these explicit product calls are not proof
of all-profile native behavior. Small-case evidence is not general accuracy, cognition or parity.
Observed command-adapter curation plus embedding was roughly 5–15 seconds/event and recall about
one second, including process startup. Provider dollar cost was unavailable. Busy capture may
outpace processing; freshness reports disclose pending/included/omitted counts.

`src/inference.ts` exports the curate types, validator and prompt. Configure OpenAI-compatible HTTP
or `THE_ATLAS_INFERENCE_COMMAND` JSON executable/argument vector (no shell); an independent
`THE_ATLAS_EMBED_COMMAND` and `THE_ATLAS_EMBEDDING_MODEL` may supply actual vectors. Commands have
bounded timeout/output. Explicit embedding disablement degrades honestly, not to fake vectors.
`THE_ATLAS_MEMORY_WORKERS` configures concurrency; related concurrent belief changes retry with fresh
context rather than imposing a workspace-wide in-flight cap. The legacy worker has its own loop.

Other configurable choices: `THE_ATLAS_CURATION_CANDIDATE_LIMIT` (96),
`THE_ATLAS_CURATION_INPUT_TOKENS` (64000), `THE_ATLAS_CONSOLIDATE_EVERY` (16),
`THE_ATLAS_SALIENCE_HALF_LIFE_DAYS` (30), `THE_ATLAS_WEIGHT_<RELEVANCE|SEMANTIC|ASSOCIATION|RECENCY|IMPORTANCE|USEFULNESS>`,
`THE_ATLAS_TOKEN_ENCODING` (o200k_base or cl100k_base), `THE_ATLAS_RAW_RETENTION_DAYS` (30; nonpositive
disables expiry). These are deployment defaults, not owner-imposed constants. Token counts include
injected context framing; the native caller reserves outer message framing. Curation bounds its
candidate/recent context; an oversize current event fails visibly and stays durable/unprocessed,
requiring appropriate model-window configuration or client chunking, never silent partial success.

Fading does not delete truth. Pending/failed events do not silently expire. Selected provenance is
separate from raw retention. Forgetting is source-event deletion with root/dependent-retell,
derivative, vector, version-content and pending repair; independent support remains. Already-sent
provider requests, backups and previously delivered consumer copies cannot be recalled. Credential
redaction recognizes common patterns, not perfect DLP. SQLite remains single-node and recall scans
its permitted graphs; no scale/SLA/distributed architecture or general-quality claim is made.

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
