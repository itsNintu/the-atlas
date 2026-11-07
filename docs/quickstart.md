# Quickstart: an agent's complete memory loop

Run these from the repository root using a supported Bun runtime. No private services are required.
The CLI prints JSON and reads JSON files or stdin. Use `--credential-file FILE`, `--url URL`, and
`--idempotency-key KEY` as needed. Never put a real bearer token in a command-line argument or URL.

## 1. Install, bootstrap, diagnose

```sh
bun install --frozen-lockfile
bun run cli bootstrap --name 'My workspace'
bun start
# In a second terminal:
bun run cli doctor
```

The default database is `data/the-atlas.sqlite`. Bootstrap creates a workspace and a human
administrator and exclusively writes `data/admin.credentials.json`. Repeating it with that filename
fails rather than overwriting a credential. An OS operator may bootstrap another workspace using a
**new** credential filename against the same database. Local filesystem access is the operator trust
boundary, not a remotely callable signup endpoint.

The web inspector at `http://127.0.0.1:8787` accepts the credential from that private file. Enter it
only in the local password field; it stays in tab memory, never localStorage, cookies, or URLs.
Refresh/disconnect removes it. Use TLS before exposing the service beyond loopback.

## 2. Create a project and a space

```sh
printf '%s' '{"name":"Research"}' | bun run cli api POST /v1/projects
```

Save its returned `id`, then create `space.json` using that ID:

```json
{
  "name": "Shared research",
  "project_id": "REPLACE_PROJECT_ID",
  "kind": "shared"
}
```

```sh
bun run cli api POST /v1/spaces --file space.json
bun run cli spaces
```

The creator/selected owner receives explicit read/write/delete grants. Even a workspace administrator
cannot read another principal's personal space. Personal spaces can only grant their owner; use a
shared space when collaboration is intended.

## 3. Ingest and wait for processing

Create `source.json` with your returned space ID:

```json
{
  "space_id": "REPLACE_SPACE_ID",
  "external_id": "meeting-001",
  "format": "text",
  "mode": "assertions",
  "source_timestamp": "2026-01-01T10:00:00Z",
  "payload": "Mira works for Cedar Labs. Cedar Labs is based in Lisbon.",
  "assertions": [
    { "subject": "Mira", "predicate": "works_for", "object": "Cedar Labs" },
    { "subject": "Cedar Labs", "predicate": "based_in", "object": "Lisbon" }
  ]
}
```

```sh
bun run cli ingest --file source.json --idempotency-key meeting-001-import
bun run cli wait REPLACE_JOB_ID
bun run cli inspect REPLACE_SOURCE_ID
```

Reusing the same idempotency key and identical body replays the receipt, without another source or job.
Changing the body under that key returns a conflict. An independent attempt with the same external ID
also conflicts: use the source revision API for corrections.

`assertions` are facts **supplied by the caller**, not inferred from the payload. Omit them to retain a
source without creating facts. JSON payloads must be objects; messages payloads are arrays of
`{role,content,timestamp}`. Every message timestamp must be UTC RFC3339.

## 4. Retrieve context and traverse the graph

`context.json`:

```json
{
  "space_ids": ["REPLACE_SPACE_ID"],
  "query": "Mira Cedar",
  "budget_chars": 1000
}
```

```sh
bun run cli context --file context.json
```

The result includes `context`, exact `used_chars`, `facts`, support/source/revision links and omitted
counts. Budget applies to the context string, not the JSON metadata envelope. Zero budget returns an
empty string. The service does not split/truncate a fact to make it fit.

Graph request JSON:

```json
{
  "space_ids": ["REPLACE_SPACE_ID"],
  "seed_entities": ["Mira"],
  "max_hops": 2,
  "budget_chars": 1500
}
```

```sh
bun run cli graph --file graph.json
```

This exact-label, undirected expansion should reach Cedar Labs and Lisbon. It is not fuzzy entity
resolution, arbitrary Cypher, or a hidden traversal of unselected spaces.

## 5. Correct, inspect history, forget

`replacement.json`:

```json
{
  "expected_revision_number": 1,
  "format": "text",
  "mode": "assertions",
  "source_timestamp": "2026-02-01T00:00:00Z",
  "payload": "Mira works for Maple Labs.",
  "assertions": [
    { "subject": "Mira", "predicate": "works_for", "object": "Maple Labs" }
  ]
}
```

```sh
bun run cli correct REPLACE_SOURCE_ID --file replacement.json
bun run cli wait REPLACE_NEW_JOB_ID
bun run cli inspect REPLACE_SOURCE_ID
bun run cli forget REPLACE_SOURCE_ID
```

`expected_revision_number` is a compare-and-swap guard. A correction immediately removes the old
revision's current support; there may be no current fact while the new job is pending. Use a past
`recorded_at` in context JSON to inspect historical knowledge (with current access grants still
required). Supply `valid_at` to query event validity. The two axes are independent.

Forget is not historical invalidation: it erases payload/assertions of **all** revisions and removes
all their support links, including historical ones. Facts with independent support remain. Metadata
IDs/tombstones and non-content audit events remain. External provider copies and operator-owned
backups are not remotely erased; see operations.

## More principals, without printing credentials

```sh
printf '%s' '{"name":"Research agent","kind":"agent"}' | bun run cli api POST /v1/principals
bun run cli issue-key --principal-id REPLACE_PRINCIPAL_ID --credential-file data/agent.credentials.json
```

The local OS operator issues the generated key into a new mode-0600 file. Use the admin API to replace
shared-space grants:

```json
{
  "space_id": "REPLACE_SPACE_ID",
  "principal_id": "REPLACE_PRINCIPAL_ID",
  "actions": ["read"]
}
```

```sh
bun run cli api POST /v1/grants --file grant.json
bun run cli spaces --credential-file data/agent.credentials.json
```

An empty actions array revokes all access to that space. Grant writes replace rather than append.
Credential revocation: `POST /v1/credentials/ID/revoke` with `{}`. The issuer receives `credential_id`
without needing to print the token.

## Optional real provider

Set variables in your process or an untracked `.env`:

```sh
# Set the key through your normal secret manager, not shell history.
# THE_ATLAS_PROVIDER_API_KEY=...
# THE_ATLAS_PROVIDER_BASE_URL=https://api.openai.com/v1
# THE_ATLAS_EXTRACTION_MODEL=gpt-4.1-mini
# THE_ATLAS_EMBEDDING_MODEL=text-embedding-3-small
bun run provider:probe
```

The probe sends only disclosed synthetic text, but may incur provider charges. Configure a provider
compatible with OpenAI's JSON chat-completions and embeddings endpoints. Restart the server after
configuration. Set source `mode` to `natural_language` and omit `assertions`; jobs perform real
extraction and embedding. Hybrid context adds a real query embedding with `strategy:"hybrid"`.
No key means an actionable failed job, not synthetic extraction or a blocked assertions lane.
Inspect `jobs` / `doctor`, configure the provider, then call `POST /v1/jobs/ID/retry` with a fresh
idempotency key. Network/rate-limit/5xx failures retry with bounded backoff; rejected credentials or
missing configuration fail until fixed. You own provider data handling and costs.
