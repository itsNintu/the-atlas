# What this alpha does — and does not

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
