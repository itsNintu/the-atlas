# Current project context

Updated 2026-11-06 UTC (2026-11-07 UTC+07).

ThreadAtlas 0.1.0-alpha.0 is a standalone Bun/TypeScript source-linked graph/context-memory bootstrap.
The chosen scope is a useful, complete ingestion → durable job → authorized temporal context/graph →
correction/history → forget/support-repair loop, with a JSON CLI and minimal real inspection UI.
SQLite WAL (synchronous FULL) is a provisional single-node backend, not a scale/parity assertion.

Verified locally on Bun 1.4.4 / SQLite 3.53.4 / Linux: typecheck; 24 tests / 134 assertions; real server+CLI+on-disk
SIGKILL/restart/lease recovery; idempotency; cross-workspace and personal/shared isolation; async
revocation/deletion races; offline backup/restore into a fresh directory; executable agent demo;
Chromium desktop/mobile UI against actual APIs. Dependency audit reported no vulnerabilities.
Generated workload evidence and interpretation are in reports/ and docs/measurements.md.

No supported real provider key was configured on the verification host. The production adapter probe
returned provider_unavailable with no facts, as intended. Natural-language/embedding quality and live
provider success are NOT verified. Explicit assertions are caller-supplied structured evidence, not a
model extraction demonstration. See docs/quickstart.md for the actionable configured probe.

Read README.md, docs/contract.md, docs/capabilities.md and docs/operations.md for actual scope and
limitations. Reuse/fork/port/new code remain valid engineering choices. No full-platform checklist,
full-Zep parity or specific hosting/toolchain requirement should be inferred. Useful next experiments
are live provider evaluation and indexed retrieval/provenance profiling if concurrency demands it.
The working CLI is not an SDK/MCP/connector or automatic agent-capture claim.

Publication verification belongs to the actual GitHub repository/release and exact-head Actions run;
use fresh remote readbacks, not this local context file, to establish current remote state.
