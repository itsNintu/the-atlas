# Durable brain view

Open **`/brain` on your existing private Atlas origin** (also linked from the evidence inspector at `/`). Connect using an existing profile-bound bearer credential and its bound agent ID (`default`, `builder`, etc.). Admin credentials need the same binding and explicit memory grants; the page cannot impersonate another profile. The service activation owner confirms the live origin/port. This source phase did not restart or activate production.

The credential is used only in Authorization headers and tab memory. Never put it in a URL, screenshot, shared report or browser storage. Reload/disconnect drops the credential. Serve the private app over trusted loopback or HTTPS, not an exposed plain-HTTP host.

## Explore

- Select authorized agent/shared scopes. Each scope has distinct node identities, even when labels match.
- Search a literal phrase in subject, predicate or object; results are persisted knowledge, not the incoming transcript. Blank search shows the newest retained eligible assertions.
- Select a node for full label and incident relationships; **Focus this neighborhood** filters to its incident edges within the current result set. **All results** restores the bounded result. The accessible relationship list exposes the same full labels without relying on the drawing.
- Drag background to pan, wheel or use `+`/`−` to zoom, and **Fit** to recover the result. Nodes support keyboard Enter/Space selection. The narrow layout stacks map, details and accessible list.
- Select a relationship for meaning, type, scope, valid interval, recorded time, status, attributed event/client/revision/role/author/agent, supported excerpt when retained, roots, real versions and change types.
- **Time & history** accepts UTC RFC3339 timestamps. Blank means now. Valid time asks when a claim applied; known time asks what had been recorded then. Include history shows retained superseded/corrected/retracted assertions with explicit statuses; a correction is not mislabeled as an ordinary later state. Current grants and forgetting always apply, even to past snapshots.
- Refresh manually or enable the 15-second poll. No knowledge is created by inspection. Processing counts cover only caller-agent intake, not another agent's private backlog. Pending intake never becomes a node just because it was captured. Shared digestion may lag. Failed/denied reads clear the prior picture and detail rather than displaying stale authorized-looking results.

## Read-only API

`POST /v1/memory/graph` requires `Content-Type: application/json` and `Authorization: Bearer <private credential>`; **no Idempotency-Key** is needed. Example request body:

```json
{
  "agent_id": "builder",
  "scopes": ["agent:builder", "user:alex", "business:alex"],
  "query": "Lantern",
  "include_history": true,
  "limit": 60
}
```

Optional `valid_at` and `recorded_at` use the existing strict timestamp validator. Omit `scopes` for all currently authorized bound-agent/user:alex/business:alex scopes. An unauthorized member rejects the entire explicit selection **before data/counts/layout**. There is no admin bypass. `query` is a case-insensitive literal substring, not wildcard syntax or semantic retrieval. `limit` is 1–100 (default 60).

Success is the existing REST envelope `{api_version:"v1",request_id,data}`. `data` includes:

- `nodes: [{id,label,kind,scope}]`, kind `entity` or `literal`. IDs are stable hashes of workspace/scope/persisted identity (literal text for literal endpoints). Subject identity is persisted; an object resolves only to an exact recorded supported subject in the same scope. A private/other-scope entity cannot change its kind. Free text is not fabricated into a semantic entity or hidden relation. Retained historical entity assertions still establish an identity.
- `edges: [{id,source,target,predicate,scope,kind,valid_from,valid_to,recorded_from,status,sources,...}]`. Memory IDs are the edge IDs. Sources retain event/client/revision/role/author identity and only stored supported excerpts, with existing secret redaction applied. No raw event transcript or embeddings are included. Current truth uses `Memory.effective`, provenance uses `Memory.support`, authorization uses `Memory.authorize`.
- `changes`: real `memory_changes` with correction/state_change/retraction/conflict distinctions and source attribution. Replacement IDs outside selected edges are null; this does not imply absence of a replacement elsewhere in an authorized graph. `versions` on each edge are persisted non-erased version/reason/recorded-time metadata, not an invented event stream.
- `snapshot: {valid_at,recorded_at}`, `truncated`, `scopes`, `available_scopes`, caller-only `processing`, and explicit `limits`.

## Practical limits and evidence

This is a dependency-light SVG inspector, not a graph database rewrite or complete graph export. Output is bounded to 100 edges / at most 200 incident nodes; eligibility inspects at most 2,000 newest matching authorized rows. Candidate/edge/change exhaustion sets `truncated`; narrow the query/scope when shown. Source and version detail are bounded to 20 entries per edge with separate `sources_truncated` / `versions_truncated` flags. Change detail is bounded to 20 per edge and 200 overall. Entity resolution checks up to 100 same-scope subject assertions and discloses exhaustion. Search has no model/network call. This synchronous local inspection path is not the native recall latency claim. Dense large results can still need focus, zoom or the full-label relationship list. Disconnected components are placed separately without invented edges; geometric distance is not a confidence, similarity or causal measure.

Reproduce the graph checks in the canonical checkout:

```sh
bun run check
bun test tests/memory-graph.test.ts
bun scripts/brain-ui-test.ts
```

The browser script starts a real loopback HTTP App with on-disk SQLite, generated temporary credentials and explicit **fictional persisted fixtures**; it does not mock fetch or claim model extraction. It checks scope isolation, pending diagnostics, search/empty state, node/relationship/source selection, focus/reset, pan/zoom/fit, valid/recorded snapshots, history, new persisted knowledge, source forgetting, polling, revocation/stale-data clearing and no credential browser storage, at 1500×1100 and 390×844. Receipts and screenshots are under `evidence/brain-view/`. Live Luna-backed native digestion/activation is the separate downstream operation, not claimed by these fixtures.
