# Local operation and recovery

## Runtime

Bun 1.4.4 is the verified, recommended baseline on Linux/macOS (Linux is the tested release environment). Windows Bun is not yet a
verified serving target. The runtime has no npm production dependencies. `bun install --production
--frozen-lockfile` and `bun start` run source directly. Development tools/tests need a normal install.
Default listener is loopback `127.0.0.1:8787`. Keep it there unless you configure a trusted TLS reverse
proxy. No CORS is enabled. The static UI has a restrictive self-only CSP and uses textContent for
untrusted content. Browser tokens stay in tab memory; XSS and compromised OS access remain threats.

Variables: THE_ATLAS_DB, THE_ATLAS_HOST, THE_ATLAS_PORT, THE_ATLAS_WORKER (false disables job
processing), THE_ATLAS_LOG_REQUESTS=true (safe request ID/method/status/duration, no body/headers).
Provider variables are in .env.example. CLI adds THE_ATLAS_URL and THE_ATLAS_CREDENTIAL_FILE.
Legacy `THREADATLAS_` variables and existing data/credentials remain usable; see [rename notes](rename.md).
Never share a real .env, database, credential file, or source export in an issue.

### Atlas-native Luna and JEV

Set `THE_ATLAS_NATIVE_WORKER=true`. For the verified direct OpenAI Responses route, provision the
selected permanent credential privately as `THE_ATLAS_PROVIDER_API_KEY` (or `OPENAI_API_KEY`) and set
`THE_ATLAS_OPENAI_PROJECT_ID` to the dedicated project. Optional `THE_ATLAS_OPENAI_BASE_URL` defaults
to `https://api.openai.com/v1`. Without that credential, `THE_ATLAS_CODEX_HOME` selects the existing
OAuth route; API failure never silently switches providers. Keep `THE_ATLAS_EXTRACTION_MODEL=gpt-6-luna`
and protected `THE_ATLAS_JEV_API_KEY` in the owning credential channel. Remove the old Hermes
`INFERENCE_COMMAND`; do not configure a Codex CLI/app-server. Report API authentication, credit,
billing and rate limits separately. New capture adapters must send only user/assistant/inter_agent
communication, never tool results, task events or execution feeds. `CODEX_REASONING_EFFORT=low`,
`JEV_MODEL=jev-1.14.0` and `JEV_CONCURRENCY=4` are the current defaults. Keep the resident
`EMBED_URL` separate from Luna and JEV. `auth.json` must remain mode0600 and its parent mode0700.
Capture adapters must also suppress automatic Kanban wakes/statuses, delivery receipts, internal
notifications and background-process completion notices rather than relabelling them as user or
inter-agent conversation. Atlas independently rejects their exact native provenance/structural
forms before source/job creation and capture-skips pre-existing notice jobs without provider calls.
Genuine task requirements and agent reasoning are not filtered by broad content substrings.
Notification-only owner demotion uses the documented authenticated/idempotent admission-review
procedure, with reason `automatic_notification_owner_exclusion`; no migration or provider probe is
needed for that deterministic review.
Stop Atlas before replacing OAuth/config state; preserve existing account identity and do not copy
another profile's auth cache. Refresh locks are self-recovering after stale PIDs. An ambiguous
refresh may require the supported OAuth reconnection after access expiry; never replay it blindly.

`JEV_URL` defaults to the supported TypeSafe System One endpoint and may be loopback only for
tests. Each request is one typed decision. Before activation, run one real admission, one graph-
area and one independent relationship request, checking exact response names/types and bounded
latency, then run one direct structured Luna request. JEV and Luna credentials never appear in
logs, receipts, task cards or screenshots. See contract.md for admission/demotion/reconsideration
semantics and required current-conversation checks.

Use a private local directory, local filesystem (not network-shared SQLite), and a dedicated OS user
for deployment. Workspace administrators are trusted to create shared grants but are not granted
knowledge access automatically. Local OS/database access bypasses application permissions by design.
Tokens are random high-entropy values hashed with SHA-256, not user passwords needing a password KDF.

## SQLite engine and checkpoint behavior

The release was reverified with Bun 1.4.4 and its SQLite 3.53.4. SQLite documents a rare WAL-reset
corruption race in 3.7.0 through 3.51.2, fixed in 3.51.3+ and backports 3.50.7/3.44.6:
https://sqlite.org/wal.html#walreset . Persistent WAL storage reports the actual engine version and
an actionable upgrade recommendation for a version predating the published fix; this is diagnostic,
not an added startup admission gate. In-memory fixtures do not need a persistent-WAL warning. Use the supported current Bun runtime;
there is no need to replace another project's runtime or introduce an extra database service.

Long-lived external SQLite readers can retain old MVCC snapshots and prevent WAL truncation. API
forget repairs/redacts logical state immediately and attempts a nonblocking checkpoint; the writer's
normal 5000 ms busy timeout is restored afterward. An existing reader may retain the old snapshot
until it closes, just as an earlier API consumer may have retained a copy. The storage test exercises
this on a real file and checks integrity afterward. Do not promise immediate forensic erasure.

## Diagnose / recover

`bun run cli doctor` reports the configured provider, authorized queue counts and storage mode.
`jobs` and `GET /v1/jobs/ID` distinguish queued/running/retry/succeeded/failed/cancelled and safe errors.
An ingestion receipt means data+job were committed, not that extraction completed. Stop with SIGTERM
for graceful shutdown; a SIGKILL leaves durable leases for recovery within the 60-second lease window.
Do not run multiple schedulers on a network filesystem. Multiple local processes share SQLite's
single-writer limit; distributed scheduling/HA is not a claim.

Provider unavailable: set a compatible authorized provider key, restart, run the synthetic probe, and
retry the failed job through the API. Auth/network/invalid-output errors are distinct. Do not replace
model output with fabricated facts to make a job green. Superseded/forgotten revisions cannot be retried.

## Backup / restore (tested offline workflow)

1. Stop every The Atlas process using the database. This is important: copying only the live .sqlite
   file while WAL is active is not a safe backup.
2. Keep a protected copy of the database **and** its -wal/-shm siblings if present, or checkpoint using
   SQLite while no server is running. Treat all of them as sensitive, as well as credential files.
3. Copy the complete stopped data directory to a protected destination. Start the service again.
4. Restore to a **new private directory** while the server is stopped. Set THE_ATLAS_DB and the CLI
   credential path to the restored location. Start, run doctor and verify a known source-linked query.
5. For integrity inspection, use Bun's sqlite API or SQLite `PRAGMA integrity_check` on the stopped copy.

Backup restores can resurrect data forgotten since that backup. Operators must expire/erase backups
according to their own policy and propagate a deletion ledger if they later build retained backups.
This release does not pretend to erase provider logs, SSD remanence, remote snapshots or old copies.
API forget immediately redacts application payload/assertion columns, deletes support/orphan fact
rows, uses SQLite secure_delete and attempts a truncating WAL checkpoint. It is logical lifecycle
erasure, not a certification of forensic deletion. Metadata/tombstones/audit/idempotency receipts
(without source contents) remain. Other independently supported sources remain deliberately intact.

## Derived-brain clean-slate reset

For an explicit owner-authorized full reset, use stopped custody and the local privileged command:

```sh
bun run cli reset-derived-brain \
  --db /absolute/existing/the-atlas.sqlite \
  --confirm RESET_DERIVED_BRAIN
```

1. Stop every Atlas process and quiesce capture producers. Take the complete stopped SQLite and
   configuration/credential backup described above before opening the reset command.
2. Fence producer-local pre-reset journals, unacknowledged outbox rows, platform/feedback queues and
   in-memory recall caches without deleting native transcripts or producer configuration. Atlas's
   database command cannot perform that external producer step.
3. Run the command against the explicit existing path. It never creates a missing database. Its
   immediate transaction physically removes all legacy facts/supports and all native derived memory
   scopes, including demotions, graph entities/relations/history, embeddings, FTS/LSH, cursors,
   recall/feedback projections and scheduler focus state. It resets the FTS external-content index
   through SQLite's supported rebuild command.
4. Original `sources`/`revisions`/`memory_events`, heads/roots, account/configuration/grant/binding
   state, idempotency/audit, terminal jobs, non-content curation metrics and reprocess/reconsider
   receipts remain. Existing nonterminal jobs become cancelled with `derived_brain_reset`; no old
   job is retried or replayed. Provider holds remain as availability protection, but stale probe
   leases clear.
5. Inspect the returned exact before/after counts and quick check. `derived_brain_reset_receipts`
   stores the same non-content reset receipt. The operation fails closed on an unclassified table,
   rolls back on deletion/foreign-key failure, and verifies every derived table is empty.
6. Restore the exact normal service environment and start Atlas with its ordinary workers enabled.
   Do not leave a maintenance-disabled worker configuration behind.

Reset generations fence all pre-reset jobs/events from scheduler claims, retry, reprocess, admission
review, reconciliation repair, JEV/Luna prior/recent context, recall freshness and graph processing
counts. A new source revision or new native event belongs to the new generation and processes under
the normal contract; an exact old idempotent/event replay remains a historical duplicate/receipt.
This is physical deletion of active derived rows, not a demotion or a promise to erase retained
backups, provider logs, SSD remnants or already returned consumer copies.

## Upgrade / release

Schema version is PRAGMA user_version=1. Opening a newer schema fails rather than silently downgrading.
Back up before upgrading. No arbitrary compatibility promises or private service dependencies are
hidden in the initial release. Build future migrations with old-database fixtures and restore tests.
Source artifacts are produced by git archive from the release commit; SHA256SUMS verifies download
integrity, not code trust. Use the published prerelease rather than assuming an alpha is production-ready.
