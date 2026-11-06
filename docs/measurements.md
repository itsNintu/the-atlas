# Local bootstrap measurements

Measured 2026-11-06T21:40:10.560Z on Bun 1.2.21, Linux/WSL2, 16 logical CPUs (AMD Ryzen 7 3700X 8-Core Processor).

Generated deterministic assertions, real HTTP + on-disk SQLite WAL synchronous FULL, one server + one serial worker. Payload bodies contain padding; 1-4 explicit facts/source. Each query searches one authorized space. RSS sampled /proc at 10ms. Warm retrieval follows complete ingestion. No model, vector or quality/cost/parity claim. These are local measurements, not load guarantees.

| Workload           | Sources / spaces / facts | Payload bytes | Concurrency | Receipts/s | Completed jobs/s | Retrieval p50 / p95 ms | Peak server RSS MiB |
| ------------------ | -----------------------: | ------------: | ----------: | ---------: | ---------------: | ---------------------: | ------------------: |
| small              |            120 / 3 / 300 |        61,440 |           4 |      81.63 |            75.07 |        19.447 / 42.864 |              118.66 |
| varied_multi_space |          600 / 12 / 1500 |     7,475,200 |          24 |     101.19 |            77.32 |      145.873 / 211.787 |              123.52 |
| larger_hot_space   |          1200 / 4 / 3000 |     5,529,600 |          32 |     120.67 |            80.97 |     916.441 / 1031.786 |              187.11 |

These are one-run warm, generated HTTP workloads on one development host, not published capacity guarantees. Request latency includes queueing under the stated concurrency; single-request service time was not separately measured. Timing includes source receipts and eventual job completion as separate phases. Job rate covers the whole ingest-to-completion interval, not just the worker kernel. Payload padding varies storage/request size; facts are caller-supplied, not extracted from the padding.

## What the evidence supports

- All requested sources and jobs reconcile with actual on-disk counts. Temporal, authorization and deletion correctness are established by the separate tests, not by throughput alone.
- SQLite WAL is practical for this small dependency-light, local bootstrap. No corruption or lost queued work was observed in the tested restart path; this does not prove immunity to disk/host failure.
- The serial worker completed roughly the measured local rates above. High-concurrency retrieval scans are already a bottleneck in the larger case, exceeding one second at p95. Do not position this implementation as an enterprise or low-latency high-concurrency data plane.
- The next justified performance experiment is indexed candidate selection and batched provenance reads, plus single-request versus concurrent profiling. Neither a Rust rewrite nor a PostgreSQL/cloud migration is established as necessary or sufficient by these results.

## Reproduce / limits

`bun run bench` creates real HTTP servers and temporary SQLite files, uses synchronous=FULL, ingests 1–4 explicit facts per source across selected spaces, waits for every job, checks counts and budgets, samples server RSS through /proc, writes reports/benchmark.json, and removes private fixtures. Linux RSS measurement is not portable to other OSes. The benchmark has no quality, model-cost, vector-index, cold-cache, large-graph, multi-node, sustained-write/read mixed-load, retention or backup-load coverage. It is not Zep/Graphiti/enterprise parity evidence.

Full machine-readable raw results: [reports/benchmark.json](../reports/benchmark.json). Other evidence: reports/e2e.json, reports/provider.json, reports/ui.json and synthetic-only UI screenshots. Re-run them on a target deployment rather than treating these host measurements as portable guarantees.
