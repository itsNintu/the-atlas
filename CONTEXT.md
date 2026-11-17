# Current project context

## 2026-11-17 Creator Platform browser login — deployed and accepted

Task `t_ecb5f288`: https://atlas.creator.gg/brain now offers **Sign in with Creator Labs**.
Actual Platform identity at platform.creator.gg is brokered through existing verified native SSO
at agents.creator.gg, not the separate free-email profile system. State/PKCE + one-use form POST,
Secure HttpOnly Atlas cookies, per-request live membership checks and explicit server-side
account/agent authorization replace manual bearer entry in the normal human flow.

Atlas source `000dcb99e1e98d96aaf3f58a93e8f99e2bbec5a9`, Worker
`cd5ebd07-835d-478e-881b-4025a9a07a50`; protected restart receipt200 at
2026-11-17T02:41:38.176915Z, exact live HTML/JS/CSS hashes match. Creator broker source
`6fc5f58a857c7d4047189d1bca3978cb4eba020b`, additive production Convex deployment,
app `KLoXWhZLg3Wstfmwy9sCu` / Worker `dc6e47f0-130c-42fe-85b9-19d1cba29cf3`.
Exact-source CI44004652467 (Atlas) and44004667700 (Creator) both green. Atlas237tests /
2647assertions + frozen install/check/build/public/helper/E2E/UI/human-auth/origin/graph suites;
Creator required root check/build2115reportedtests (cache included), OpenNext/audit/source guards,
Wrangler4.163dryrun/release and Convex1.50 additive/no-index-deletion checks pass.

Default-owned helper `t_6946d5ef` verified actual primary + independent existing test28 native
user/company/location/Creator-workspace tuples via real SSO/current membership, retained separate
parent-bound browsers, and kept credentials/mailbox sessions in their owning context. Exact primary
binding now reaches the CURRENT legacy brain and12authorized agent graphs without moving existing
machine principals/grants/data. Test28's first Atlas entry creates an independent nonadmin empty
workspace with0agents; no legacy Alex scopes are inherited. Live graph default200/69nodes60edges,
8identifier/bearer/write probes denied (400/401/403, no data), parent portal logout→Atlas401,
native Platform popup→automatic Atlas return, owner mobile reload/signout/refresh/relogin pass.
Machine graph/zero-budget recall200, wrong-agent403, all12legacy bindings/grants exactly unchanged.

Private owner evidence `D:/Projects/TheAtlas/evidence/platform-login-tecb/`; protected binding and
activation receipts in release worktree `.private/browser-auth/`. No credentials/tickets/provider
proofs in URLs or evidence. Chromium390x844 is viewport emulation, not physical-phone acceptance;
new accounts start empty, not automatic agent import. Existing active connected Platform admin
membership contract is reused. Accepted graph physics/labels/gestures and recall evidence are
unchanged/reused; no hosted physics re-audit or native fleet reload. Human graph is read-only;
`/` and collapsed Developer/API connection retain machine bearer auth. A real browser probe fixed
no-referrer→Origin:null on native cross-origin form POST using strict-origin on the broker success
form (origin only, no credential/path/query). No SSO key/provider/Marketplace grant rotation.

Release worktree `/home/alex/work/projects/the-atlas-login-tecb`; older dirty canonical operational-
memory work and retired local writer stay untouched. Do not deploy the older canonical checkout.

## 2026-11-17 Creator Labs graph design and gestures — deployed

Task `t_64ca3cc1` deploys source `66d9dae62a8ff8b464d7bf3ce5c8291656055eae`, Worker
`5d7de338-5c34-4ab6-b7c3-a3820a9860c8`. Exact-head CI `43997790793` passes226tests /
2333assertions, frozen install/check/build/public/helper/E2E/UI and both graph browser suites.

The graph now has a coherent monochrome Creator Labs shell, official mark and existing licensed
self-hosted Space Grotesk/IBM Plex Mono; arrowless subtle connections; zoom/degree/density-aware
collision-managed captions; hover/keyboard/selection neighborhood emphasis and full inspector/list
labels. Direction remains in inspection. Desktop Space-drag pans even over a node; Ctrl-wheel
zooms around the pointer without page/browser zoom. Typing-space and blur/key-release guards,
mobile canvas pan/node coupled drag/pinch/cancellation and drag-to-pinch transitions are retained.

Hosted Chromium140:85nodes/60edges,13/13neighbors move while held on both mouse/touch, changing
pairwise distances and continuous curves; release idle~3.3s. Overview2node/0edge labels; zoom
reveals previously hidden names without tested label collisions. Selection/provenance, pan/zoom,
Fit/refresh stability and bounded mobile sheet pass;8graph200responses,0page errors.390x844touch
is browser emulation, NOT physical-phone/owner acceptance or universal60fps. Prior unchanged
paging/backend/privacy evidence is reused; no memory/data/grant/model/budget redesign.

Both upload forms repeatedly hit10021. A narrow prerequisite lazily constructs the unchanged BPE
tokenizer on first use (`c037540`), with import-time and exact-count equivalence tests for both
encodings; successful final Worker startup11ms. Protected DO restart succeeded; a subsequent
generic-UA health403 interrupted receipt saving. Restart was not repeated; supported-UA health200
and exact served HTML/JS/CSS hashes verify settled activation. Exact restart reply/time not retained.

Private owner evidence: `D:/Projects/TheAtlas/evidence/graph-design-t64/` (before/after desktop/mobile,
11.40sdesktop/12.24stouch gesture MP4s, interactions/activation/media receipts and RELEASE.md).
Real graph media stays out of public Git. Recording markers/captions are test-only aids. Long canvas
captions remain truncated; full labels/direction/evidence are inspectable. Isolated release worktree
`/home/alex/work/projects/the-atlas-design-t64`; unrelated dirty canonical operational-memory work
and reports preserved, not deployed; retired WSL writer remains untouched. `src/memory.ts` is a
collision hotspot: carry only the published lazy-initialization delta when reconciling older dirt.

## 2026-11-17 live force-responsive graph correction — deployed

Task `t_2f415a77` corrects the owner's rejected static-drag feel using Alex's private Zep video.
Implementation `615c49417882e40adbe8b0f08ff6a4c2c761657a`, Worker
`731f51ce-0c07-4a23-9aca-e3634538bd3a`, protected DO activation
`2026-11-17T00:40:30.764466+00:00`; exact-head CI `43989074163` passed all existing gates
(224 tests / 2,319 assertions, check/build/public/helper/E2E/UI and both graph browser suites).

A live fixed-step spring/charge/collision integrator now runs during mouse/touch node dragging:
the held node follows input directly, connected and nearby nodes respond continuously, edges/labels
track geometry, and damping/cooling settles after release. SVG accessibility and bounded 200-node
scope are retained; no renderer/framework dependency or backend/ingestion/recall change.
Selection does not re-layout; Fit/unchanged refresh retain the settled arrangement, not a frozen
coordinate for just the dragged node. Touch cancellation and drag-to-pinch release the pin.

Hosted Chromium140:87nodes/60edges; all11non-dragged hub neighbors moved while held on desktop
and touch, with max neighbor-pair distance changes306.68/250.29world units,24/23distinct incident
curve samples, unchanged camera and no accidental selection. Release to verified idle ~3.3s.
Observed animation-frame intervals median16.7ms, p95 22.9ms desktop/19.2ms touch; event-to-next-rAF
p95 1.9/4.0ms. These are headless-browser samples with recording enabled, not end-to-end hardware
latency, source-video FPS, a universal60fps guarantee or physical-phone acceptance. Existing
selection/adjacency/provenance, pan/wheel/pinch, mobile sheet/controls and paging checks pass;
12graph200responses,0page errors. Updated acceptance now requires coupled neighbor motion.

Private owner evidence: `D:/Projects/TheAtlas/evidence/graph-physics-t2f/` (interaction receipt,
release/activation identity and ~13s desktop/~14s touch-emulated MP4s). Closeup demos show87/86
loaded nodes respectively as live data advanced; touch marker/status is test-only, event-driven.
Real graph footage and Alex's reference stay out of public Git. Normal upload hit10021; documented
minified alternative deployed successfully. Live brain.js hash matches released source. Older dirty
canonical work and retired WSL writer remain untouched; release worktree
`/home/alex/work/projects/the-atlas-physics-t2f`. This supersedes static-drag acceptance below;
it does not claim complete Zep parity or resolve unrelated operational-memory content.


## 2026-11-17 interactive graph — deployed and verified

Task `t_92bf384b` ships https://atlas.creator.gg/brain from implementation source
`afc059f49f8564a6e5c53b659fb2d89aff9b4fd0`, Worker `27bfa9fd-ed4b-4492-befc-a89e75e71a01`;
protected DO activation `2026-11-17T00:09:45.020204Z`. Exact-head CI `43985196844` passed:
224 tests / 2,319 assertions, typecheck/build/public/helper/E2E/UI and both graph browser suites.

The scoped persisted graph now has draggable nodes with attached-edge movement, click/tap and
keyboard selection, adjacency highlighting, stable dragged coordinates, background pan,
cursor-wheel/two-finger-pinch zoom, fit/full view and readable mobile dismiss/reopen details.
Disconnected components pack in 2D rather than an unreadable strip. Source/history/search and
valid/known snapshots remain; node size means loaded degree, geometry is not semantic meaning.
Exact-label/scope server neighborhood navigation and snapshot-pinned eligible-edge paging reach
beyond loaded results, still capped at100 edges/200 incident nodes and2,000 matching candidates.
No People/accounts/alias-merging system or complete export was added; agent binding and person
focus are distinct. Current grant/forget fences remain. Backend/native recall and ingestion unchanged.

Final hosted Chromium140 checks used actual persisted data:87nodes/60edges initially, real
mouse movement85px/-55px and touch45px/-45px with incident curves updated and no selection/pan,
then selection/attributed-source inspection, pan, wheel/pinch, fit, unchanged-refresh stability,
mobile sheet <=52dvh with visible close/reopen, no horizontal overflow and distinct60→59
next-page edges for scope-qualified Alex navigation.12graph HTTP200 responses,0page errors.
Desktop1440×1000 and touch-enabled390×844 are browser emulation, NOT an actual phone check.
Live HTML/JS/CSS hashes match released files. No ingestion/replay/provider/credential/native
activation change; local writer remains inactive/disabled. Failed Cloudflare10021 startup validations
were resolved by the existing normal/minified deployment alternative, not a runtime/code workaround.

Release worktree `/home/alex/work/projects/the-atlas-graph-t92`; older dirty canonical operational-
memory work preserved, not deployed. Never deploy that older checkout over published main.
Owner evidence is `D:/Projects/TheAtlas/evidence/graph-t92/` (screenshots + interactions.json +
activation/release receipts). Real-data screenshots stay local/task/thread attachments, not public Git;
reproducible scripts and synthetic interaction receipt are published. No broad memory re-benchmark
or universal phone/browser/performance claim was made.


## Hosted recall reliability repair — 2026-11-15

Task `t_3dbe7837` localized current timeouts and HTTP503 to the shared Durable Object:
read-only tail captured recall cancellations near25s and the explicit platform exception
“Durable Object is overloaded. Requests queued for too long.” Health200 was not recall proof.
Support hydration repeatedly scanned all retained `memory_jobs` via `event_pk`, and canonical
identity repeatedly scanned `memory_heads` via `event_pk`. EXPLAIN plus isolated copied-production
profiling established the missing reverse indexes, not embedding/network speculation.

The repair adds NON-unique `memory_jobs(event_pk,id)` and `memory_heads(event_pk)` indexes on
both fresh and already-initialized hosted Store opens. It does not rerun serving-index or roots
backfills, alter recall eligibility/packet content, prune custody or extend timeouts. The copied
stopped production snapshot startup fell1910.609→88.442ms (7memories), focused lexical spouse
1021.712→62.077ms (1memory); offline figures are not hosted latency promises. Query-plan,
existing-database and initialized-hosted-path regressions cover installation without credential
or runtime-marker changes. Native prerequisite `t_3e1798c3` separately activated adapter1.2.10:
failed recalls consume the turn's one attempt; new turns recover; safe diagnostics retain HTTP
status/turn/elapsed without raw bodies/content. Historical generic HTTPError totals cannot all
be assigned this newly observed overload cause. Windows project-home evidence records exact
activation/live before-after identities; preserve unrelated canonical operational-memory dirt.

## Hosted operational-memory cleanup — 2026-11-10

Task t_bbadabad was narrowed by Alex to operational-memory bloat only; cold latency and graph
pagination were not changed. `src/memory-operational.ts` now filters routine assistant/inter-agent
routing, progress, implementation, test, audit and task narration before storage. Operational wrappers
are not protected merely by a `requirement` predicate or an object quoting an owner directive. Direct
owner messages, owner-attributed task requirements, and substantive requirement/design knowledge stay
eligible; status-only fields in owner-attributed cards are filtered without dropping card directives.

The hosted cleanup used the existing authenticated/idempotent `operational_status_owner_exclusion`
review with exact current-job provenance, revision, direct-support, owner-attribution and grant fences.
It demoted 213 operational memories across five agent-private scopes. Raw events/jobs/memories/supports
were not deleted. Admission reviews and demotion proofs each increased from 66 to 279 (+213). Two
Kanban directive memories—publication/no-republish and explicit operational constraints—remain active
under the server fence. The current graph source provenance resolves `memory_jobs.event_pk` so those
exact reviews work beyond the 100-row diagnostics window.

Final source is `c255cc79a6b6b8125d33d89ffaa4fb18675e7cfe`: 196 tests/2,018 assertions across
35 files, typecheck, public checks and Cloudflare dry-run pass. Production Worker version
`f63dbb39-3a85-4fe1-ae2f-45a14596173e` is live at https://atlas.creator.gg with the existing Atlas-only
Worker/SQLite Durable Object architecture. Two fresh operational-narration jobs succeeded with zero
active memories; a genuine owner correction succeeded and remains active. Exact named operational
predicates are absent. Paradev/Retell, Ghosty, Lia/Nona and genuine blog-exclusion graph/recall checks
pass with no malformed owner nodes. See `evidence/operational-memory-bloat/verification-summary.json`;
private content, credentials and full claim snapshots are not committed.

## Automatic status-notification exclusion — 2026-11-08

Source task t_cb043bca adds a communication-only automatic-notification boundary. Explicit native
producer/attribution metadata and exact start-anchored Kanban/status, delivery, internal-notification
and background-process forms (including Discord `[Alex]` variants) are rejected before source/job
creation. Existing captured notices become capture-only skipped jobs without JEV/Luna and are removed
from provider context/candidate supports; retry/reprocess is denied. Genuine Alex task requirements
and agent-to-agent reasoning, including delegated results, remain eligible. No message history is
deleted and there is no broad task/result/completion substring rule.

`automatic_notification_owner_exclusion` extends the existing deterministic admission review with
exact current job/head, expected revision, affected grants, direct support, an automatic exact source
and notification-only retained supports. Mixed genuine/notice memories are ineligible. Append-only
owner demotion preserves base rows and pre-demotion history, needs no model call/retry/replay, and
later restoration requires genuine communication rather than another notice. The same five-notice/
one-current-fact regression proves that demotion frees a 320-token recall packet for the relevant fact.

A readonly live audit using the actual classifier found26 notification-only memories, all with a
current reviewable source; the five reported IDs are included. Source verification on pinned Bun1.4.4:
170tests/1641assertions across28files, focused notification+communication9tests/150assertions,
typecheck, public check and real on-disk HTTP/CLI E2E pass.

Live activation of product `0d20bbd8eabf4b90f7050764af7483efa2fcd0c1` (carrying receipt fix222e831)
is complete. Fresh stopped custody is `/home/alex/.local/share/the-atlas/backups/t_cb043bca_automatic_notification_activation`
(SQLite SHA256 `0973a19c386773438cf29d1760ad87bfb3449dd08c586cbd4a42be4266ed1add`, quick_check ok).
A worker-disabled review start made zero JEV/OpenAI/backlog calls;26 authenticated/idempotent reviews
returned nonempty persisted owner-directive receipts. All26 targets are absent from current graph and
recall, all26 remain in pre-demotion recorded history, and original event/job/memory/support/version
rows, provider holds and terminal native-quota rows are unchanged. The same500-token query changed
from one automatic notice/423tokens with genuine requirements crowded out to genuine requirement
`memory_0911c79b-da38-443c-a0b0-8c34e1ba751d`/422tokens, with no candidate or pending transcript.
The exact original environment was restored before the normal start. Final PID3971763 is healthy with
`atlas_native_openai_responses`+one-decision JEV and both providers available. No provider probe, job
retry, source/action replay, SQL correction or duplicate receipt task occurred. Exact receipts are in
`evidence/automatic-notification-boundary/OUTCOME.json` and `activation.json`.

## Failed-current execution owner exclusion — 2026-11-08

Source task t_0ebd3ba0 narrowly extends `execution_content_owner_exclusion`: besides the existing
succeeded+processed state, it accepts the exact current failed job with a still-pending current
source event and retained direct `memory_supports`. The job must be `memory_events.job_id` at the
current head; expected revision and affected read/write grants remain mandatory.
`session_local_owner_correction` retains its completed-only gate. Review remains deterministic
`owner_directive`: no JEV/Luna call, retry, execution replay, source/job/memory/support mutation or
replacement memory. Pre-demotion history remains, and later genuine communication restores only at
or after its accepted time rather than rewriting the demoted recorded interval. Source verification
is165tests/1562assertions, focused admission/communication/provider23tests/359assertions and
typecheck on pinned Bun1.4.4. Builder performed no production/provider/DB action. Overwatch
t_b7e29b89 retains sole activation and bounded residual demotion; receipt task t_a16c3e71 remains
separate and gated after that activation lane.

## Native API provider, communication-only admission and availability holds — 2026-11-08

Source task t_dda54603 adds a direct regular OpenAI Responses native route alongside the existing
OAuth Luna transport. `THE_ATLAS_NATIVE_WORKER=true` selects the API route when the dedicated
`THE_ATLAS_PROVIDER_API_KEY`/`OPENAI_API_KEY` is configured; `THE_ATLAS_OPENAI_PROJECT_ID` supplies
the project header. It does not silently fall back to OAuth, Hermes or Codex. The owner handoff at
`D:/Work/Operations/hermes/atlas-native/API-PROVIDER-HANDOFF.md` verifies the dedicated project,
permanent service-account credential, model catalog, actual credit and a regular Responses HTTP200
in2.463s. Builder did not read or provision the production credential and did not activate Atlas.

Only user/assistant/inter_agent communication is admitted to new memory jobs. Tool upserts are
rejected before source/job creation; historical tool rows remain stored but cannot be claimed,
retried or reprocessed, and their raw events/supports are excluded from new JEV/Luna context.
Existing derived brain content is not bulk rewritten. `execution_content_owner_exclusion` extends
the supported proof-bound admission review to affected own/shared scopes with append-only demotion;
shared restoration still requires genuine user support. Overwatch t_b7e29b89 owns actual cleanup.

Additive `memory_provider_holds` stops new memory claims for native402/429 capacity outcomes without
consuming attempts or changing terminal rows. JEV402 has a separate bounded fail-open circuit; a
DB-fenced real success is required after expiry. Sanitized reset guidance and hold state are visible
through `/v1/status`. No backlog retry, live probe, service restart or availability-restoration claim
belongs to this source phase. Source verification is 163 tests/1,517 assertions, typecheck and diff
check on pinned Bun1.4.4; the communication-boundary change required the full suite. Prior frozen-
install and on-disk E2E evidence is reused for unchanged paths. Activation and bounded communication-
only outcome verification remain Overwatch t_b7e29b89.

## Sustained selective dreaming, Atlas-native OAuth and JEV — 2026-11-08

Source task t_bdec7ab0 addresses the observed sustained-conversation failure, not another Atlas
acceptance graph. Read `docs/capabilities.md` and `docs/contract.md` first. Live inspection found
64 eligible thread heads and the current owner thread served only about every25minutes; its next
jobs were queued without errors. Tool volume dominated the inherited queue and85/90 recent tool
chunks produced no decisions. The repair therefore covers scheduling, admission and transport,
not raw worker count or a model-name swap.

Atlas's earlier accepted source used direct OAuth HTTP/SSE Responses inference adapted from Creators
growth-model, with no Codex CLI/app-server or Hermes per-call bridge. The direct OpenAI Responses
route and owner-verified API setup are described in the current section above. Overwatch
completed the owner's official OAuth sign-in through the existing protected account flow in the
Atlas-private CODEX_HOME and verified the native catalog contains gpt-6-luna. The later owner
correction removed the app-server draft/dependency; only the direct transport remains. A real
synthetic direct structured probe returned valid `{"decisions":[]}` on gpt-6-luna in3.019s
(88input/9output tokens), with no agent runtime or tools.

Asynchronous JEV uses one typed decision per request for admission, graph-area and each candidate
relationship under bounded concurrency. Complete context/noise stays captured; durable, useful
session episodes, uncertain and truncated negatives still reach Luna. A persisted24-claim
conversation-focus lease rotates fairly and every fourth claim reserves inherited work. Capture-
filtered sources have audited reconsideration. A source/proof-bound owner-directed admission
review demotes the wrongly globalized session instruction without model approval, source replay
or history deletion; later genuine user support can restore it. Existing truth/correction/
provenance/retrieval fences and compact pending-free recall remain.

Source verification:155tests/1422assertions and typecheck pass, frozen install passes, and real
on-disk HTTP/CLI E2E passes on pinned Bun1.4.4 (initial ambient Bun1.2.21 invocation retained as
a toolchain mismatch, not a product failure). Live JEV single-decision probes, production
activation, the exact wrong-memory demotion and current-thread10–15minute selective digestion
belong to Overwatch t_05e9321c. No production restart/queue mutation/native capture replay or
current-thread semantic outcome is claimed by this source phase. Exact evidence/handoff is in
`evidence/sustained-dreaming/`.

## Claim-safe truth repair and concise correction recall — 2026-11-07

Source task t_c3cd6ab0 repairs the concrete live regression from t_4fe812c6, not its
failed/partial history. Equivalent raw/typed claim groups can no longer overwrite an
explicit incompatible unaffected disposition: the whole inconsistent change group is
withheld and retained as blocked_dispositions audit, while independent transitions apply.
This is conservative processing consistency, not a deterministic natural-language truth oracle;
no fixture predicates/names, endpoint-overlap prerequisite or predicate-rename prohibition.

Supported authenticated proof-CAS reconciliation repair appends memory_change_invalidations
without deleting old changes, editing facts/dates, replaying source actions or creating jobs.
Recorded-time projections distinguish invalidated processing from a genuine later state change.
On exact readonly current snapshot18:40:31Z (SHA2563ee23cb0f63390460101e2b5a61f75f45f56d0ee1c66cf0661ae5cddcedce24d),
copied-only repair invalidates exactly the two contradicted reporting closures; original typed
Mira is current, typed Nola remains historical ending2026-11-07T00:00:00.000Z/unknown start,
current Leda/reviewer and corrected original cobalt remain. Old event/job/change values and
pre-repair recorded history are retained. No new native Luna/model-curation sessions were used:
this deterministic integration consumes the real compiled dispositions, not invented raw bytes.

Concise recall attaches source-backed never-true/interval correction metadata and bounded complete
scope excerpts to relevant positive atoms, through correction/representation links, never through
state-change links. Rejected-claim matches can locate their current correction without injecting
false positive history. Excerpts use existing scope-safe support, not private source.content;
retention of raw content is unnecessary. Actual resident MiniLM and lexical-only current-copy
original query both1118/1200tokens with current direct reporting, always amber/never cobalt and
all requested typed facets; irrelevant query0, pending/context messages0. No assistant-recap
substitution for those facets. Focused shared-source privacy, interval, retention, forgotten-source,
negative-value-only lookup, grant/revision/idempotency/custody regressions are included.

Final142tests/1203assertions, typecheck and actual copied HTTP/Chromium changed-view checks pass;
frozen install and isolated on-disk HTTP/CLI E2E pass (the latter before the scope-safe-excerpt-only
fix; unchanged E2E paths reused). Source/copy evidence is not production activation/native answer
acceptance or full callback timing. Overwatch t_d281231f owns sole activation/minimal supported
repair; original jobs need NO blind reprocess/retry. Root t_5f7f3afb settles the original outcome.
Exact committed source, manifest, retained intermediate failures and repair procedure live in
`evidence/claim-safe-repair/HANDOFF.md` and SOURCE-VERIFICATION.json. Other report/sibling dirt is
not part of this change. Reuse unchanged FEN9/helper/all-six/brand/preview evidence.

## Retained original-claim reconciliation and direct-facet repair — 2026-11-07

Source task t_eeafcd2f committed product26958d0c24de567eb1bd5fc4e0a3d88989e03175.
The bounded indexed candidate pool now drains through at-most4-candidate identity/reconciliation
windows instead of silently packing away retained originals. Native reconciliation-v2 requires
one directional assessment per supplied ID; separate per-target truth types compile without
forcing correction and formerly-true closure into one type. Live recorded semantic-duplicate
proof propagates truth across supplied raw/typed claim groups; generic format supersession is
not equivalence. Existing target/time/scope/support and no-fallback fences remain. Source-backed
start_unknown audit qualifies legacy unsupported precision without rewriting raw IDs/dates.
Multifacet lexical admission and complete-predicate packing restore direct reporting evidence;
ordinary full-query lexical/moderate semantic/lexical-only fallback remain available.

Exact current private prestate SHA25615c267c189f58276868d8eed2d2aec4066b722b0bb52c3b53f762b4458b6eae1
at16:46:50Z reconciled correction succeeded2 but original cobalt/typed Nola still current.
Real unchanged native-Luna outputs and final-source recorded-output integration on that prestate
show corrected ORIGINAL cobalt, positive typed historical Nola ending2026-11-07T00:00:00.000Z,
current Leda/reporting/review support, and unknown rather than endorsed legacy January precision.
Intermediate model and replay-harness failures are retained. Final integration structurally
projects independent recorded candidate outputs across final token windows with exact fingerprint
identity mapping; it is not another model run or production acceptance. Full137tests/1156assertions,
affected35/213, typecheck/frozen install and isolated on-disk E2E pass. Exact original native query
copy recall includes typed Mira with normal and original-user-only evidence, MiniLM or lexical-only.

No production writes/retry/reprocess/restart/session/config/grant/model/tunnel changes by Builder.
Prior runtime t_b3950651 stays complete with failed/partial semantics. Root t_5f7f3afb assigned
necessary activation/live outcome to Overwatch t_4fe812c6; source completion releases that lane,
not same-card review. Reuse unchanged FEN9/helper/all-six/brand/preview/timing evidence. Increased
candidate-window inference cost is not a freshness/latency guarantee. Read
`evidence/original-truth-repair/HANDOFF.md` and SOURCE-VERIFICATION.json for hashes, actual outputs,
finite evidence, limitations and minimal supported original-only remediation.


## Actual native Luna phase contract repair — 2026-11-07

Source continuation t_6200b4e1 reproduces the affected native call seam on an exact private
SQLite copy through the unchanged host Luna bridge. Literal qualification candidate rewrites
failed invalid_identity; an intermediate result also emitted invalid change.type superseded.
Per-call response contracts now specify exact literals, allowed candidate fields, local item0,
valid truth enums and separate representation disposition. Temporal guidance distinguishes a
same-source/event-time default from a genuine handover. Both actual phase payload sizes are
packed, instead of assuming identity is shorter. Validators and no-fallback behavior remain.
Real copied-original Luna runs plus final-source recorded-output integration retain source
custody and a positively historical typed prior owner ending2026-11-07T00:00:00.000Z, current
Leda, reporting/reviewer links and FEN9 relations. This is not native runtime activation.
At readonly production16:16:26Z the first original failed5 invalid_identity, the other four
original jobs had naturally succeeded, but both known stale LDN7 targets still had no changes.
Do not repeat reprocess submissions. Existing runtime owner t_b3950651 can activate changed
source then use supported failed-job retry only if still needed, with graph/history evidence.
Read evidence/native-phase-repair/HANDOFF.md; root t_5f7f3afb owns overall settlement. Historical
raw production attempts were not retained, so isolated reproductions are not exact reconstructions
of their outputs. Helper recall/native timing/brand/preview evidence stays applicable unchanged.

## Relational identity/truth reconciliation source repair — 2026-11-07

Source task t_d7c1e270 separates atomic extraction, focused same-scope identity resolution and
truth reconciliation; each phase enforces exact4096 product input tokens, with extraction
headroom and resumable source fragments. Meaningful entity targets can exist without becoming
subjects; explicit literal values stay literals. Original source roles/authors/roots and stored
entity/memory IDs remain. Five additive schema-2 tables retain scoped alias proof, typed targets,
recorded source-backed equivalences and reconciliation audit. No production DB/job/config/model/
grant writes, restart or native session was performed here. Runtime completion remains Overwatch
t_b3950651 under owner root t_5f7f3afb; source completion is not activated owner completion.

Real isolated Luna testing copied the reported synthetic LDN7 rows/supports, not production data.
It exposed and then repaired predicate-window starvation, duplicate-versus-change exclusivity,
and Lantern-launch/short-name co-reference. Final real current graph has Leda ownership, no stale
current Nola ownership/cobalt, actual linked reporting/review entities, and correct correction vs
historical handover ending2026-11-07T00:00:00.000Z. New FEN9 is atomic linked knowledge, including
the contextual Remy reviewer/auditor. Earlier fixture/model failures remain evidence, not erased.
Final-source integration reuses the recorded successful Luna output on an isolated copy, with no
new Luna calls, and verifies current/history, exact source custody, old jobs and4096 phase bounds.
Counting positive historical entity components exposed a duplicate-format retirement cycle; the
final store fix records representation restoration without undoing truth changes. The normalized
prior-owner edge remains positively historical and links the reporting/reviewer chain to Lantern
and Leda, instead of treating every prior representation as merely superseded.
Unknown prior start remains unknown rather than inventing a date. These are source-fixture
observations, not native callback timing, production freshness or all-history truth guarantees.

The parallel recall helper's committed seam is retained unchanged. Its exact original FEN9
732→0 readonly evidence is reused. A final-engine readonly same-snapshot integration removes
two weak unrelated LDN7 reviews from current FEN9-use while preserving all three original FEN9
facts, semantic paraphrases, LDN7/VES8 evidence, lexical fallback and response history. Relative
predicate rescue now needs independent semantic or non-predicate lexical evidence; same-entity
rescue and global admission are unchanged. See evidence/relational-reconciliation/HANDOFF.md
for exact source hashes, finite checks, failure evidence and supported original-only repair steps.

## Fact selection and recall source repair — 2026-11-07

Source-only t_031912e4 repairs response-control contamination, duplicate current-query context,
prior context-only denial dominance and multi-facet relationship omission. Useful fictional working
relations are explicitly agent-private attributed episodes, never fabricated Alex/business truth.
Moderate semantic admission remains0.42 regardless of query codes; lexical-only fallback remains.
Explicit fictional archive location preambles are focused without their generic wrapper words;
partial lexical coverage is unchanged, without length/code/name/word-order prerequisites. Requested same-entity
predicates can expand from direct seeds; existing grants/support/time/forget fences remain.
Explicit authenticated/idempotent memory-only reprocess now creates a NEW job and additive audit
link without changing original event custody, wiping knowledge, resetting prior jobs or executing
source tools. See docs/contract.md for expected_revision, reason_code and conflict/error behavior.
Real isolated Luna selected meaningful private relationships, resolved a contextual reviewer and
discarded ACK/denial. A source fixture reporting-recall omission was exposed and repaired, then
checked against the already-persisted real model output, without repeating extraction. Same-readonly
production snapshot comparison restores the original omitted LDN7 facts, QZX8 empty context and exact
dated2030packet. LDN7 naturally progressed8/8during work, not retroactive timely success; VES8 still
has0originalsupportedfacts and needs narrowly targeted supported memory reprocess after activation.
See D:/Projects/TheAtlas/evidence/selection-repair/ for exact source handoff. Runtime activation and
changed native outcome remain exclusively Overwatch t_fc720392; this is not overall native acceptance.

## Freshness/relevance source follow-up — 2026-11-07

Replaced global event FIFO with persisted3fair-thread:1oldest-work service: least-recently-served
conversation heads, unseen ties favor newest intake, original oldest accepted work reserved every
fourth claim. No expiry cutoff, source dropping or queue edits. Same-conversation leases/backoff/
cursors serialize chronological source processing; separate conversations remain concurrent.
Additive schedule metadata preserves all source/credential/graph identities. Named topic/support
matches are ranking hints only: lexical and configured semantic admission are unchanged, including
moderate paraphrases/aliases and lexical-only fallback. The earlier coded-topic0.62 prerequisite
and its gate-dependent empty LDN7 packet in7082fe2 are explicitly withdrawn, not accepted evidence.
Explicit query source time, topic and predicate phrase specificity rank the requested dated event;
this is not a newest-first outcome rule. Explicit history queries can include closed supported states,
not corrected false beliefs. A fresh readonly same-snapshot baseline/corrected comparison still
returns the unrelated329token receipt for unprocessedLDN7: this relevance failure remains unresolved.
Correct comment2030 is first (1144tokens); Neptune returns0tokens. No pending transcript is supplied.
Correction frozen install/check,90tests849assertions and on-disk E2E pass; after adding one final
below-threshold negative regression, typecheck plus10affected tests93assertions pass. No source
behavior changed after the full run. Runtime/native activation and finite original8LDN7 outcome
belong to existing Overwatch t_13dac1a6; no production restart or native proof in this source phase.
See docs/capabilities.md and D:/Projects/TheAtlas/evidence/freshness/ for exact source handoff.

## Current engineering handoff — 2026-11-07 dreaming revision

Implemented bounded Luna-ready event digestion and indexed specific recall in src/memory.ts,
src/memory-index.ts, src/inference.ts and Store initialization. Existing graph knowledge tables
and credential/source identities are preserved; new indexes/cursor/metrics are additive.
Default recall1200tokens, relevance-gated FTS5+approximate semantic lookup, no pending transcript;
explicit larger budgets and authorized freshness metadata remain. Curator exact input maximum4096
tokens, coherent resumable fragments, targeted prior context; real host-owned gpt-6-luna fixture
selected useful relations, discarded noise and preserved temporal/correction distinctions.
See docs/capabilities.md, docs/contract.md and reports/dreaming-source.json for actual measurements
and failures/repairs. Native activation/integrated observation belongs to downstream cards; do not
infer a production restart from this implementation handoff. Earlier accepted fb86855 automatic
capture/semantic/native lifecycle evidence remains applicable where unchanged. No publication.

## Historical release baseline (not current runtime/semantic capability claims)

Updated 2026-11-07 UTC+07: renamed to The Atlas (`the-atlas`), alpha.1.

Canonical repository: /home/alex/work/projects/the-atlas (Ubuntu WSL, alex).
Windows project home: D:/Projects/TheAtlas.
Public source: https://github.com/itsNintu/the-atlas.
Current release: https://github.com/itsNintu/the-atlas/releases/tag/v0.1.0-alpha.1.
See docs/rename.md for configuration/data compatibility and historical provenance.

Rename verification: frozen install/typecheck; 27 tests / 147 assertions; disk/HTTP/CLI recovery
and browser desktop/mobile checks with The Atlas title/heading. An exact original alpha.0 fixture
was reopened by the renamed runtime with identical supported facts/provenance and unchanged saved
credential. Legacy server/CLI environment aliases work; ambiguous local data does not gate remote
CLI commands. No new provider, quality or scale claim. Reports below retain alpha.0 provenance.

The Atlas 0.1.0-alpha.1 is a standalone Bun/TypeScript source-linked graph/context-memory bootstrap.
The chosen scope is a useful, complete ingestion → durable job → authorized temporal context/graph →
correction/history → forget/support-repair loop, with a JSON CLI and minimal real inspection UI.
SQLite WAL (synchronous FULL) is a provisional single-node backend, not a scale/parity assertion.

Original alpha.0 behavior verification (unchanged scope), locally on Bun 1.4.4 / SQLite 3.53.4 / Linux: typecheck; 24 tests / 134 assertions; real server+CLI+on-disk
SIGKILL/restart/lease recovery; idempotency; cross-workspace and personal/shared isolation; async
revocation/deletion races; offline backup/restore into a fresh directory; executable agent demo;
Chromium desktop/mobile UI against actual APIs. Dependency audit reported no vulnerabilities.
Generated workload evidence and interpretation are in reports/ and docs/measurements.md.

No supported real provider key was configured on the verification host. The production adapter probe
returned provider_unavailable with no facts, as intended. Natural-language/embedding quality and live
provider success are NOT verified. Explicit assertions are caller-supplied structured evidence, not a
model extraction demonstration. See docs/quickstart.md for the actionable configured probe.

Read README.md, docs/contract.md, docs/capabilities.md and docs/operations.md for actual scope and
limitations. Reuse/fork/port/new code remain valid engineering choices. No full-platform checklist,
full-Zep parity or specific hosting/toolchain requirement should be inferred. Useful next experiments
are live provider evaluation and indexed retrieval/provenance profiling if concurrency demands it.
The working CLI is not an SDK/MCP/connector or automatic agent-capture claim.

Publication verification belongs to the actual GitHub repository/release and exact-head Actions run;
use fresh remote readbacks, not this local context file, to establish current remote state.
