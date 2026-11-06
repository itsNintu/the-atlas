# Contract: REST v1 / SQLite schema 1

This alpha intentionally exposes a small, explicit contract. IDs are opaque strings. Public JSON uses
snake_case, UTC RFC3339 timestamps, and a generated `request_id` (except static assets). Successful
responses carry `api_version:"v1"`; validation/access failures have:

```json
{
  "api_version": "v1",
  "request_id": "opaque",
  "error": {
    "code": "invalid_request",
    "message": "Actionable description",
    "retryable": false,
    "details": {}
  }
}
```

Job scheduler `available_at` and `lease_until` are epoch **milliseconds** in this bootstrap API, unlike
source/business timestamps. They are diagnostics, not event times. This exception is explicit and
must be versioned before changing. Read-only health is `/healthz`. All `/v1` endpoints require a
bearer credential. Bodies require `Content-Type: application/json`; writes require `Idempotency-Key`.
`POST /v1/context` and `/v1/graph` are read-only queries and do not need idempotency keys.

## Authorization

A credential is hashed at rest and binds a principal to exactly one workspace. Client-supplied
`workspace_id` or `user_id` never authorizes anything; these fields are rejected. Projects contain
spaces. Knowledge operations require explicit space grants (`read`, `write`, `delete`) even for
administrators. Scope/credential administration requires a workspace administrator. Principals are
human, agent or service; remotely created principals are non-admin. No credential API returns tokens;
local CLI key issuance writes only a private file. Local DB/filesystem access is privileged.

Denied cross-scope resources return generic 404. Granted resources may still conflict or be gone.
Mixed authorized/unauthorized context selection fails as a whole. Filtering precedes ranking,
traversal, counts and provenance; only the caller's query is sent for hybrid query embedding.
Post-await credential/grant checks and fresh fact reads prevent revocation/forget races.

## Endpoints

| Endpoint                          | Behavior                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /v1/me`, `GET /v1/status`    | Caller identity, storage/provider diagnostic, authorized-space queue counts                     |
| `GET/POST /v1/projects`           | List visible projects / admin creates project                                                   |
| `GET/POST /v1/principals`         | Admin list/create human/agent/service principals                                                |
| `GET/POST /v1/spaces`             | List explicitly granted spaces / admin creates owner-only personal or shared space              |
| `GET/POST /v1/grants`             | Admin inspect/replace principal space-action grants                                             |
| `POST /v1/sources`                | Authorize write, atomically insert source revision + queued job; receipt is not completion      |
| `GET /v1/sources[?space_id=ID]`   | Paginated authorized source metadata, including forgotten tombstones                            |
| `GET /v1/sources/ID`              | Source metadata and all non-erased revisions/payloads                                           |
| `POST /v1/sources/ID/revisions`   | CAS correction with expected_revision_number + complete replacement input                       |
| `DELETE /v1/sources/ID`           | Erase every revision payload/assertions, remove supports, delete orphan facts, retain tombstone |
| `GET /v1/jobs`, `GET /v1/jobs/ID` | Granted job diagnostics (never lease fencing token or source payload)                           |
| `POST /v1/jobs/ID/retry`          | Write grant; failed/retry current revisions only; resets bounded attempt budget                 |
| `POST /v1/context`                | Explicit space_ids, query, optional strategy, budget_chars, limit, valid_at, recorded_at        |
| `POST /v1/graph`                  | Explicit space_ids, seed_entities, max_hops 1–3, same budget/time controls                      |
| `GET /v1/facts/ID`                | Granted fact and revision/source support history                                                |
| `POST /v1/credentials/ID/revoke`  | Own credential or workspace admin; revocation is immediate                                      |
| `GET /v1/audit`                   | Admin, non-content write events and request correlation                                         |

List responses are `{data,next_cursor}` with limit 1–100 (default 25). Cursors bind to caller/route/space
filter and represent an opaque untrusted keyset position, not authorization or snapshot isolation.
Concurrent inserts/deletes can alter later pages. Follow cursors to exhaust a collection.

## Evidence and time

A source's external identity is unique **within its space**. Revisions are immutable except deletion
redaction and supersession timestamp. Assertions explicitly contain subject/predicate/object and
optional valid_from/valid_to (default start is source_timestamp). Same canonical assertion+interval
within one space shares a fact ID and accumulates supports. No cross-space deduplication or inference
occurs. There is no automatic contradiction resolution between unrelated sources: conflicting live
facts remain independently supported and visible. Correct the appropriate source or assert explicit
valid-time intervals.

Valid intervals are `[valid_from,valid_to)`, recorded intervals are `[recorded_from,recorded_to)`.
A null end is unbounded. Support recorded_from is the revision acceptance timestamp, not provider
completion time: historical results converge when processing finishes. A correction closes old
support immediately and queues new evidence. Historical access always uses **current** grants.
Forget removes both present and historical supports. Stored source payloads are untrusted input,
not instructions; assertions/provenance are not proof of real-world truth. Retrieved context belongs in an untrusted-data channel in your agent harness, not in a privileged developer/system instruction channel.

## Retrieval / graph / budgeting

Lexical ranking is normalized query-term substring coverage, not BM25. Hybrid adds nonnegative cosine
similarity only for compatible stored embedding models; extraction/embedding quality has not been
validated without a real provider. Ranking is stable by fact ID for equal scores. Empty query returns
all eligible facts. The engine fails actionably above 5,000 authorized time-filtered candidates.
Graph expansion is exact case-sensitive label matching, undirected subject/object expansion up to
three hops, using only selected, authorized temporal edges. Entity labels are not canonical IDs.
No fuzzy resolution, graph query language, PageRank or automatic multi-hop reasoning is claimed.

The packed context string contains complete `subject | predicate | object [fact_id]` lines, within a
Unicode-code-point budget 0–100,000 (default 2,000). Response metadata is outside this character
budget. This is not a tokenizer/token-window guarantee. Typed facts correspond to selected lines;
`matched_facts`/`omitted_facts` disclose eligible results not packed. Result limit is 1–100, default 20.

## Jobs / idempotency

The source/revision/job insert is transactional. A worker claims via an IMMEDIATE SQLite transaction,
leases for 60 seconds, heartbeats, fences results with a per-claim token, and reclaims expired leases
after restart. It checks cancellation/supersession before starting a later provider call and again
before commit. A request already sent to a provider cannot be unsent. Persisted errors contain safe
codes, never provider responses that might echo payloads/secrets. Automatic attempts cap at five;
transient backoff starts at 500 ms and caps at 30 seconds. An expired final-attempt lease becomes
failed, not stranded. Manual retry of current evidence starts a new bounded attempt family.

Writes use a principal-scoped key and canonical operation/path/body hash. Same request replays stored
non-content receipt, changed request conflicts. Current authorization is always rechecked on replay.
Keys are retained without TTL in this alpha. A replayed historical receipt describes the original
operation; inspect current source/job state rather than assuming it remains current after deletion.

## Versioning boundary

Schema user_version rejects newer data. No schema-1 upgrade path is needed for the first release;
future migrations need fixture backups and rollback tests. REST contract changes must be explicit.
There is no claimed SDK, MCP, connector or experience-learning compatibility simply because these
entities could later be represented. Server transport-level oversized requests may be rejected by
Bun before the structured API envelope; ordinary API validation uses the envelope above.
