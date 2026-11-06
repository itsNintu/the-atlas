# Bootstrap decisions

## Small original core rather than a framework deployment

Reuse, adaptation, forks and ports are available strategies. No prohibition is inferred from this
choice. A small original Bun/TypeScript implementation gives this milestone one install, no runtime
package dependency, and directly testable permission/revision/forget/lease behavior. It does **not**
inherit Graphiti's extraction/resolution/retrieval breadth or Zep's proprietary data plane.

Public product research supplies useful comparison questions, not compatibility requirements. This
release does not copy Graphiti implementation code, vendor prompts or proprietary APIs. Upstream
Graphiti or another engine may be a better fit if advanced entity resolution/hybrid traversal is the
next real requirement; compare integration/migration cost and current licenses then.

## Bun / TypeScript / SQLite WAL

Bun supplies an HTTP server, SQLite, tests and a straightforward JSON CLI without a build/deploy
stack. TypeScript keeps shared request and provider shapes inspectable. SQLite transactions let
source acceptance, work enqueueing, idempotency and evidence repair commit together. WAL + FULL
synchronous writes are deliberate durability defaults; the UI is plain HTML/JS backed by the API.

Tradeoffs: SQLite serializes writers. The alpha server uses synchronous SQL, in-process candidate
scans and one serial worker. It has no distributed failover, tenant sharding, vector index or cold
storage. The actual local workload report reveals high-concurrency scan latency, so do not extrapolate
from a small correctness fixture to scale. Keep this as a small/self-hosted single-node backend unless
measurements justify a change.

Potential incremental improvements are indexed lexical candidate selection, bounded vector search,
provenance batched reads and worker isolation. PostgreSQL would provide multi-process operational
headroom but also a deployment/service dependency; Rust could optimize measured CPU kernels but
would not fix product contracts by itself. Cloud services/frameworks add capabilities and operational
constraints rather than guaranteeing faster graph retrieval. No unmeasured rewrite is recommended.

## License / dependencies

Application code is Apache-2.0. Bun is an externally installed MIT-licensed runtime with bundled
components under their own notices; do not redistribute it without its notices. The source release
ships no bundled runtime or node_modules. Development dependencies are pinned in bun.lock:
TypeScript and Playwright are Apache-2.0; Bun/Node type declarations and transitive utility types are
MIT. Full dependency license files remain in each installed package. No private research or host
operational documentation is included. See LICENSE and THIRD_PARTY.md.
