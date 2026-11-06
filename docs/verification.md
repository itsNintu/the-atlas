# Executed verification

Initial alpha verification on 2026-11-06 UTC, Bun 1.4.4 / SQLite 3.53.4 / Linux (WSL2). These commands ran, rather than
being proposed commands. The repository's CI repeats the portable checks on ubuntu-24.04.

| Command | Actual result |
|---|---|
| bun install --frozen-lockfile | Installed/checked the real pinned dependencies |
| bun run check | Passed TypeScript checking |
| bun test tests | 24 passed, 0 failed, 134 assertions across 4 files |
| bun run test:e2e | Passed real HTTP server, JSON CLI, on-disk WAL, SIGKILL + restart, expired/queued recovery, source history, isolation, forgetting/support repair and integrity_check |
| e2e stopped backup/restore + demo | Passed copied stopped DB into new path, reused saved credential, complete executable agent loop against restored server |
| bun run test:ui | Passed Chromium 140 desktop/mobile with actual scopes, ingestion/jobs/context, source inspection, correction/forget, no page errors, no browser-stored token and no horizontal overflow |
| bun run provider:probe | Actual production adapter returned failed/provider_unavailable, one attempt, zero facts; no supported key present |
| bun run bench | Completed all 120/600/1200-source generated HTTP cases; raw counts/latency/RSS/storage and limitations recorded |
| bun audit | No vulnerabilities found in the installed lockfile at execution time |

Async regression coverage includes streamed-body credential revocation, credential/grant revocation
during query embedding, source forget during embedding (no stale cached fact response), and forget
during extraction (no newly initiated embedding call after observed cancellation). Synthetic provider
doubles are labeled fault-injection tests, not real model evidence. Live provider quality is unverified.

No finite test suite establishes forensic erasure, arbitrary concurrency/scale, correctness of source
claims, semantic quality, complete security or Zep parity. See docs/measurements.md and operations.
Reports are nonsecret and generated from deliberately synthetic fixtures. The public preflight checks
known token shapes/private paths, plus manual source/history inspection; it is not a universal secret
scanner. Published exact-commit CI is verified separately through GitHub Actions before release.
