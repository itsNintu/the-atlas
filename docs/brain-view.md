# Durable brain view

Open **`/brain` on your existing private Atlas origin** (also linked from the evidence inspector at `/`). Connect using an existing profile-bound bearer credential and its bound agent ID (`default`, `builder`, etc.). Admin credentials need the same binding and explicit memory grants; the page cannot impersonate another profile. The hosted production view is https://atlas.creator.gg/brain. Agent perspective comes from the credential binding; node/person focus is separate and cannot impersonate another agent.

The credential is used only in Authorization headers and tab memory. Never put it in a URL, screenshot, shared report or browser storage. Reload/disconnect drops the credential. Serve the private app over trusted loopback or HTTPS, not an exposed plain-HTTP host.

## Explore

Explicit entity objects are linked even when they have never been a subject; explicit literals
remain literals. Supported same-scope identity equivalences project canonical nodes without
rewriting the original memory/entity IDs or pooling private/shared identities. History also shows
`superseded` representations (not false claims). A prior state with a known handover end but no
honest start is marked `historical_start_unknown`; its initial observation timestamp is not shown
as an invented valid start. Source evidence and original versions remain inspectable.

- Select authorized agent/shared scopes. Each scope has distinct node identities, even when labels match.
- Search a literal phrase in subject, predicate or object; results are persisted knowledge, not the incoming transcript. Blank search shows the newest retained eligible assertions.
- Select a node to highlight its actual loaded connections and dim unrelated nodes, with full label and incident relationships; **Focus this neighborhood** filters to its incident edges within the current result set. **All results** restores the bounded result. **Explore all matching connections** performs a new server read for that exact endpoint label in its selected scope, including connections outside the loaded page. This is exact-label navigation, not alias merging or a new People directory. **Next connections** / **Previous** page through matching eligible edges; loaded counts are not corpus totals. Page navigation pins the current valid/known snapshot; Refresh starts a current snapshot again. The accessible relationship list exposes the same full labels without relying on the drawing.
- Drag a node to arrange it; its actual incident curves follow. A movement threshold separates a drag from a selection tap. Drag background to pan, pinch with two fingers, wheel at the cursor or use `+`/`−` to zoom, and **Fit** to recover the result without losing dragged positions. Nodes support keyboard Enter/Space selection. **Full view** dedicates the screen to the graph. On narrow/touch layouts, selection opens a scrollable bottom details sheet with sticky **Close** and a **Details** reopen control. Touch gestures are contained to the graph; the rest of the page still scrolls. Escape closes the sheet/full view. Loaded connectivity controls node size, not importance; geometry is not semantic similarity. Overview labels prioritize hubs and selection; zoom reveals the rest. Labels retain readable screen size.
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

Optional `valid_at` and `recorded_at` use the existing strict timestamp validator. Omit `scopes` for all currently authorized bound-agent/user:alex/business:alex scopes. An unauthorized member rejects the entire explicit selection **before data/counts/layout**. There is no admin bypass. `query` is a case-insensitive literal substring, not wildcard syntax or semantic retrieval. `limit` is 1–100 (default 60). Optional `offset` is 0–1900 (default 0). Optional `focus:{scope,label}` requires a selected, currently authorized scope and matches literal subject/object labels case-insensitively, without SQL wildcards. It filters before the 2,000-row candidate bound. It does not merge aliases; scope-qualified equal-label literals/entities can both match. All existing support, temporal and grant fences still apply. Use returned `snapshot` as `valid_at` / `recorded_at` when paging an unchanged snapshot. Grants/forgetting are always current, so pages are not a retained export or immutable cursor.

Success is the existing REST envelope `{api_version:"v1",request_id,data}`. `data` includes:

- `nodes: [{id,label,kind,scope}]`, kind `entity` or `literal`. IDs are stable hashes of workspace/scope/persisted identity (literal text for literal endpoints). Subject identity is persisted; an object resolves only to an exact recorded supported subject in the same scope. A private/other-scope entity cannot change its kind. Free text is not fabricated into a semantic entity or hidden relation. Retained historical entity assertions still establish an identity.
- `edges: [{id,source,target,predicate,scope,kind,valid_from,valid_to,recorded_from,status,sources,...}]`. Memory IDs are the edge IDs. Sources retain event/current-job/client/revision/role/author identity and only stored supported excerpts, with existing secret redaction applied. The source `job_id` supports the exact-job admission-review contract. No raw event transcript or embeddings are included. Current truth uses `Memory.effective`, provenance uses `Memory.support`, authorization uses `Memory.authorize`.
- `changes`: real `memory_changes` with correction/state_change/retraction/conflict distinctions and source attribution. Replacement IDs outside selected edges are null; this does not imply absence of a replacement elsewhere in an authorized graph. `versions` on each edge are persisted non-erased version/reason/recorded-time metadata, not an invented event stream.
- `page:{offset,returned,next_offset,candidate_scan_truncated}`, echoed `focus` (or null), `snapshot: {valid_at,recorded_at}`, `truncated`, `scopes`, `available_scopes`, caller-only `processing`, and explicit `limits`.

## Practical limits and evidence

This is a dependency-light SVG inspector, not a graph database rewrite or complete graph export. Output is bounded to 100 edges / at most 200 incident nodes; eligibility inspects at most 2,000 newest matching authorized rows. Candidate/edge/change exhaustion sets `truncated`; page matching edges, explore an exact-label neighborhood or narrow the query/scope when shown. Paging never exceeds the 2,000 matching candidate window, and change/version bounds remain separate from whether a next edge page exists. Source and version detail are bounded to 20 entries per edge with separate `sources_truncated` / `versions_truncated` flags. Change detail is bounded to 20 per edge and 200 overall. Entity resolution checks up to 100 same-scope subject assertions and discloses exhaustion. Search has no model/network call. This synchronous local inspection path is not the native recall latency claim. Dense large results can still need focus, zoom or the full-label relationship list. Disconnected components are placed separately without invented edges; geometric distance is not a confidence, similarity or causal measure.

Reproduce the graph checks in the canonical checkout:

```sh
bun run check
bun test tests/memory-graph.test.ts
bun scripts/brain-ui-test.ts
bun scripts/graph-interaction-test.ts
```

The browser script starts a real loopback HTTP App with on-disk SQLite, generated temporary credentials and explicit **fictional persisted fixtures**; it does not mock fetch or claim model extraction. It checks scope isolation, pending diagnostics, search/empty state, node/relationship/source selection, focus/reset, pan/zoom/fit, valid/recorded snapshots, history, new persisted knowledge, source forgetting, polling, revocation/stale-data clearing and no credential browser storage, at 1500×1100 and 390×844. Receipts and screenshots are under `evidence/brain-view/`. Live Luna-backed native digestion/activation is the separate downstream operation, not claimed by these fixtures.

## Draggable graph release verification

`graph-interaction-test.ts` additionally checks actual mouse and CDP-dispatched touch node movement against node transforms AND incident edge geometry, non-selection during dragging, adjacency highlights, source inspection, pan, cursor-wheel zoom, two-finger pinch, fit/position stability, mobile dismiss/reopen, full view, no overflow and HTTP off-page navigation. Its dense fixture contains more than one page. CI runs both brain scripts.

For an authorized hosted read-only check, set `ATLAS_GRAPH_URL=https://atlas.creator.gg/brain`, `ATLAS_GRAPH_CREDENTIAL` to the existing private JSON credential path, and `ATLAS_GRAPH_AGENT` to its bound agent. The script keeps real-data screenshots/receipts under ignored `.private/graph-t92/live`; never commit them or credentials. The browser checks use Chromium touch emulation, not an actual phone. No ingestion, recall, provider call or native-memory activation is performed by this UI check.
