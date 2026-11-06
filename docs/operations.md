# Local operation and recovery

## Runtime

Use Bun 1.4.4+ on Linux/macOS (Linux is the tested release environment). Windows Bun is not yet a
verified serving target. The runtime has no npm production dependencies. `bun install --production
--frozen-lockfile` and `bun start` run source directly. Development tools/tests need a normal install.
Default listener is loopback `127.0.0.1:8787`. Keep it there unless you configure a trusted TLS reverse
proxy. No CORS is enabled. The static UI has a restrictive self-only CSP and uses textContent for
untrusted content. Browser tokens stay in tab memory; XSS and compromised OS access remain threats.

Variables: THREADATLAS_DB, THREADATLAS_HOST, THREADATLAS_PORT, THREADATLAS_WORKER (false disables job
processing), THREADATLAS_LOG_REQUESTS=true (safe request ID/method/status/duration, no body/headers).
Provider variables are in .env.example. CLI adds THREADATLAS_URL and THREADATLAS_CREDENTIAL_FILE.
Never share a real .env, database, credential file, or source export in an issue.

Use a private local directory, local filesystem (not network-shared SQLite), and a dedicated OS user
for deployment. Workspace administrators are trusted to create shared grants but are not granted
knowledge access automatically. Local OS/database access bypasses application permissions by design.
Tokens are random high-entropy values hashed with SHA-256, not user passwords needing a password KDF.

## SQLite engine and checkpoint behavior

The release was reverified with Bun 1.4.4 and its SQLite 3.53.4. SQLite documents a rare WAL-reset
corruption race in 3.7.0 through 3.51.2, fixed in 3.51.3+ and backports 3.50.7/3.44.6:
https://sqlite.org/wal.html#walreset . Persistent WAL storage checks the actual engine version and
fails actionably on a known-unpatched engine rather than claiming the restart tests fix it. In-memory
fixtures are exempt because they do not use persistent WAL. Use the supported current Bun runtime;
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

1. Stop every ThreadAtlas process using the database. This is important: copying only the live .sqlite
   file while WAL is active is not a safe backup.
2. Keep a protected copy of the database **and** its -wal/-shm siblings if present, or checkpoint using
   SQLite while no server is running. Treat all of them as sensitive, as well as credential files.
3. Copy the complete stopped data directory to a protected destination. Start the service again.
4. Restore to a **new private directory** while the server is stopped. Set THREADATLAS_DB and the CLI
   credential path to the restored location. Start, run doctor and verify a known source-linked query.
5. For integrity inspection, use Bun's sqlite API or SQLite `PRAGMA integrity_check` on the stopped copy.

Backup restores can resurrect data forgotten since that backup. Operators must expire/erase backups
according to their own policy and propagate a deletion ledger if they later build retained backups.
This release does not pretend to erase provider logs, SSD remanence, remote snapshots or old copies.
API forget immediately redacts application payload/assertion columns, deletes support/orphan fact
rows, uses SQLite secure_delete and attempts a truncating WAL checkpoint. It is logical lifecycle
erasure, not a certification of forensic deletion. Metadata/tombstones/audit/idempotency receipts
(without source contents) remain. Other independently supported sources remain deliberately intact.

## Upgrade / release

Schema version is PRAGMA user_version=1. Opening a newer schema fails rather than silently downgrading.
Back up before upgrading. No arbitrary compatibility promises or private service dependencies are
hidden in the initial release. Build future migrations with old-database fixtures and restore tests.
Source artifacts are produced by git archive from the release commit; SHA256SUMS verifies download
integrity, not code trust. Use the published prerelease rather than assuming an alpha is production-ready.
