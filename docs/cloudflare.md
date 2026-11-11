# Cloudflare production and recovery

## Service identity

- Public HTTPS endpoint: `https://atlas.creator.gg`
- Cloudflare Worker: `the-atlas`
- Durable Object binding/class: `ATLAS_DURABLE_OBJECT` / `AtlasDurableObject`
- Durable Object name: `atlas-production-v1`
- Storage: one SQLite-backed Durable Object; no Convex project and no Creators database
- Scheduling: Cloudflare cron every minute plus Durable Object alarms for pending work
- Account: the existing Atlas-authorized Cloudflare account (`wrangler whoami` identifies it)

The Worker preserves the existing Atlas API and bundled graph/dashboard. The Durable Object is
the single writer. Do not run the WSL writer against the production brain after cutover.

## Release

Run from the repository in WSL with a Node runtime supported by Wrangler:

```sh
bun install
bun run check
bun run build:cloudflare
bun x wrangler deploy --keep-vars
```

`wrangler.jsonc` owns nonsecret model, worker and route configuration. Provider and migration
credentials are Cloudflare secrets, never vars or Git-tracked files. The required provider secret
names are `THE_ATLAS_PROVIDER_API_KEY`, `THE_ATLAS_JEV_API_KEY`, and
`THE_ATLAS_OPENAI_PROJECT_ID`. Set them with `wrangler secret put NAME`, using the established
credential-owner flow; do not copy them into shell history or evidence.

Cloudflare rejects `redirect: "error"`. Provider fetches use `redirect: "manual"` together with
the existing response-status validation, so HTTP redirects are still not followed.

A new Worker version does not necessarily evict a live Durable Object. After changing its class,
use the protected operations restart below or an equivalent supported Durable Object reset.
`DurableObjectState.abort()` discards in-memory state while retaining SQLite storage.

## Provision an additional hosted agent

Use the ordinary workspace administrator credential, not a migration/operations token or a
stopped local SQLite database. `scripts/hosted-provision-agent.py` uses Python 3's standard library:

```sh
python3 scripts/hosted-provision-agent.py --url https://atlas.creator.gg \
  --admin-credential /protected/admin.credentials.json \
  --agent example-company --name 'Example company' \
  --credential-file /protected/example-company/credential.json
```

The helper exclusively reserves a mode-0600 file (private current-user ACL on Windows) before
generating the token. Only its SHA-256 digest crosses `POST /v1/memory/agents`; stdout is a
nonsecret receipt. Keep the reserved file after an error and retry the **identical command**:
the same token and idempotency key recover a lost response without creating another principal.
Do not delete the file or issue another key on an uncertain result. Install that exact path in
the new profile's native adapter configuration and reload only that adapter if already loaded.
Verify authenticated neutral recall, wrong-agent denial and existing pending outbox delivery.
The helper never changes adapter configuration or copies another agent's memory/space grants.
It does not need a migration fence, provider secrets, a local writer, or a database migration.

## One-time stopped-snapshot migration

1. Stop `the-atlas.service` and verify it is inactive. Keep the original database and environment
   as the rollback copy. Create a clean snapshot with SQLite's online backup API only after the
   writer has stopped, then run `PRAGMA integrity_check` on the snapshot.
2. Set a high-entropy `THE_ATLAS_MIGRATION_TOKEN` as a Worker secret. While this secret exists,
   source and memory workers and alarms are fenced; API reads and migration routes still work.
3. Run the import against the absolute stopped snapshot:

   ```sh
   read -r THE_ATLAS_MIGRATION_TOKEN < /protected/path/migration.token
   export THE_ATLAS_MIGRATION_TOKEN
   export THE_ATLAS_HOSTED_URL=https://atlas.creator.gg
   bun scripts/hosted-migrate.ts /protected/path/atlas.sqlite \
     evidence/hosted-migration/migration-receipt.json
   ```

   Batch identities and SHA-256 digests make retries idempotent. The script imports raw row tables,
   rebuilds FTS and vector projections, re-embeds memories to the configured model, and compares
   every row count and key digest. It separately verifies reset state, current nonterminal work,
   and the affected session. Public receipts contain counts/digests, never credentials or message
   bodies.
4. `--resume-singletons` retries only initialization singletons before embedding/finalization;
   `--finalize-only` retries embedding/finalization without resending ordinary row batches.
5. Only after reconciliation passes, remove the migration token with
   `wrangler secret delete THE_ATLAS_MIGRATION_TOKEN`, restart the Durable Object through the
   last authenticated restart call before deletion if needed, and verify pending work advances.
   Removing the token disables all `/internal/migration/v1/*` routes and releases the worker fence.
6. Switch native adapter endpoints, reload plugins through Hermes's supported control socket,
   drain eligible communication, then disable the local systemd unit. Do not enable permanent
   dual writers.

An explicitly confirmed `/reset` operation exists only for an incomplete hosted migration. It
calls `storage.deleteAll()`; never use it after production cutover. It does not touch the stopped
source snapshot.

## Health and recovery

```sh
curl https://atlas.creator.gg/healthz
curl -o /dev/null -w '%{http_code}\n' https://atlas.creator.gg/brain
bun x wrangler deployments list
```

The graph/dashboard and API require the same migrated per-agent credentials as before. There is
no temporary `trycloudflare` URL, public unauthenticated brain, or Windows/WSL forwarding path.
The existing zone Bot Fight Mode remains enabled; the supported native 1.2.6 client identifies
itself as `Hermes-Atlas/1.2.6` instead of generic Python urllib. Do not weaken zone security for
unrelated callers.

A separate `THE_ATLAS_OPERATIONS_TOKEN` protects post-cutover manifest and Durable Object restart
routes. Keep it in the protected owner flow and read it from the protected local file, never from
Git-tracked evidence:

```sh
read -r OPERATIONS < .private/hosted-migration/operations.token
curl -sS https://atlas.creator.gg/internal/operations/v1/manifest \
  -H "Authorization: Bearer $OPERATIONS"
curl -sS -X POST https://atlas.creator.gg/internal/operations/v1/restart \
  -H "Authorization: Bearer $OPERATIONS" -H 'content-type: application/json' --data '{}'
```

The migration token is not the operations token. Production migration routes must remain absent;
setting a migration token would fence normal background work and re-enable migration endpoints.

If the normal unminified upload hits Cloudflare startup-validation error 10021, the verified narrow
fallback is `bun node_modules/wrangler/bin/wrangler.js deploy --keep-vars --minify`. Invoke the local
entrypoint directly with Bun (not `bunx`, which exited before the API response during the 2026-11-10
activation). Use the supported operations restart above when an existing Durable Object must activate
the newly deployed classifier; this is code activation, not a latency warm-up probe.

For rollback before new hosted writes, stop/disable the hosted Worker, restore the protected
stopped-state database and environment, and start the local unit only if explicitly choosing to
abandon the hosted cutover. After hosted writes, rollback requires a new forward migration of
those hosted deltas; never overwrite them silently with the old snapshot. Keep the original local
unit disabled during normal production operation.

## 2026-11-10 verified cutover

The final stopped snapshot imported in 1,469 idempotent batches. All 50 migrated table manifests
matched: 20,242 raw events, 539 active memories, reset epoch 3, the current nonterminal job set,
and six events for affected session `20261110_114330_3ae9e980`. The hosted database passed
`quick_check` with zero foreign-key violations. See `evidence/hosted-migration/` for nonsecret
receipts; raw message content and credentials are excluded.

The affected session's exhausted user-curation job was retried through the supported jobs API.
Alex's explicit cutover clarification then supplied the company link that the isolated message did
not contain, creating source-linked Paradev interview/offer/work-trial relations without SQL edits.
Company-focused recall now distinguishes company relationships from generic role context.

After cutover, all six native profiles had zero pending outbox events and successful recalls of
1.132–1.473s. A fresh Paradev session made one silent recall at 1.065s; a fresh `Hey` made one at
0.800s with no memory metadata in the visible answer. The local unit is inactive and disabled.
Durable Object restart/recovery passed. An explicit cold Durable Object start may still take 2–3s;
this is distinct from the normal warm recalls measured against the approximately 1.5s budget.
