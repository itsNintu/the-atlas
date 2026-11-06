# Local bootstrap measurements

Measured 2026-11-06T22:02:53.176Z on Bun 1.4.4, SQLite 3.53.4, Linux/WSL2, 16 logical CPUs (AMD Ryzen 7 3700X 8-Core Processor).

Generated deterministic assertions, real HTTP + on-disk SQLite WAL synchronous FULL, one server + one serial worker. Payload bodies contain padding; 1-4 explicit facts/source. Each query searches one authorized space. RSS sampled /proc at 10ms. Warm retrieval follows complete ingestion. No model, vector or quality/cost/parity claim. These are local measurements, not load guarantees.

| Workload | Sources / spaces / facts | Payload bytes | Concurrency | Receipts/s | Completed jobs/s | Retrieval p50 / p95 ms | Peak server RSS MiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| small | 120 / 3 / 300 | 61,440 | 4 | 92.19 | 88.04 | 9.492 / 18.983 | 60.18 |
| varied_multi_space | 600 / 12 / 1500 | 7,475,200 | 24 | 128.99 | 98.26 | 85.714 / 97.189 | 75.38 |
| larger_hot_space | 1200 / 4 / 3000 | 5,529,600 | 32 | 134.84 | 93.51 | 657.243 / 836.969 | 89.09 |

These are one-run warm, generated HTTP workloads on one development host, not published capacity guarantees. Request latency includes queueing under the stated concurrency; single-request service time was not separately measured. Job rate covers the whole ingest-to-completion interval, not just the worker kernel. Payload padding varies request/storage sizes; facts are supplied, not extracted from that padding.

## What the evidence supports

- Actual counts reconcile across all requested sources, facts/supports and completed jobs. Separate tests establish authorization/time/deletion behavior; throughput alone does not.
- SQLite WAL is useful for the small, dependency-light local bootstrap, but scan-based concurrent retrieval is already a bottleneck. The largest case has a p95 of 836.969 ms and a p99 of 1167.15 ms. No enterprise/low-latency/high-concurrency data-plane claim is warranted.
- The next justified experiment is indexed candidate selection and batched provenance reads, with single-request/concurrent profiling. These measurements do not prove a Rust rewrite or a PostgreSQL/cloud migration necessary or sufficient.

## Engine and long-reader evidence

The inherited Bun 1.2.21 engine was actually SQLite 3.50.4. SQLite documents a rare WAL-reset corruption race in that range (https://sqlite.org/wal.html#walreset). Before release, a project-local Bun 1.4.4 official binary was checksum-verified and read back as SQLite 3.53.4; other projects and the host runtime were not changed. This table is the rerun on that patched engine, not the superseded earlier baseline. Restart tests do not prove an engine free of known corruption bugs.

reports/storage.json contains actual engine/PRAGMA and long-reader measurements: WAL, synchronous=2/FULL, secure_delete=1, busy_timeout=5000. With another read transaction open, API forget completed logical repair in 5.157 ms and a nonblocking checkpoint reported busy; after the reader closed it truncated successfully and integrity_check returned ok. Previously opened snapshots, provider copies and backups are not remotely erased. This is logical erasure, not forensic deletion.

## Reproduce / limits

`bun run bench` uses real HTTP and temporary on-disk SQLite files, 1–4 explicit facts per source, selected authorized spaces, source/job count checks, budget checks and /proc RSS sampling. It deletes private fixtures and writes reports/benchmark.json. `bun scripts/storage-probe.ts` exercises engine settings and long-reader checkpoint behavior. Linux RSS sampling is not portable to other OSes. No quality, model-cost, vector-index, cold-cache, large-graph, multi-node, sustained mixed read/write, retention or backup-load coverage is implied. These are not Zep/Graphiti parity measurements.

Raw results: [benchmark](../reports/benchmark.json), [storage](../reports/storage.json), [disk E2E](../reports/e2e.json), [provider](../reports/provider.json), [UI](../reports/ui.json). Screenshots contain only disclosed synthetic test data. Re-run on a target deployment rather than treating host measurements as portable guarantees.
