# Atlas sustained selective dreaming — source and activation handoff

Task: `t_bdec7ab0` (Builder source) → `t_05e9321c` (Overwatch OAuth/activation).

## Implemented behavior

- Immediate durable capture remains unchanged. Asynchronous JEV audits the latest event plus up to five visible prior events, with bounded excerpts and one typed question per HTTP request. Admission, graph-area and each candidate relationship are separate calls (bounded concurrency4).
- Complete `session_context`/`noise` stays captured with a `skipped` job. `durable_candidate`, `session_episode`, `uncertain`, and every truncated negative continue to Luna. JEV transport failures are audited `unavailable` and fail open to Luna; missing JEV configuration is a deployment error.
- JEV only prioritizes graph areas and filters individually `irrelevant` candidates. It never writes graph truth and never runs on foreground recall. Luna still decides durable/session/history/correction/noise under existing provenance, temporal, support and grant fences.
- A persisted 24-claim conversation-focus lease provides coherent service, rotates to the least-served human thread, and retains every-fourth-claim oldest-work service. It avoids the observed 64-head/25-minute-per-turn starvation without a newest-thread monopoly.
- `POST /v1/memory/jobs/:job_id/reprocess` now also accepts a current `skipped` + `captured` source and writes `memory_reconsider_requests`; original jobs, decisions and source custody remain.
- `POST /v1/memory/jobs/:job_id/admission-review` provides the owner-directed bounded demotion. It requires current revision and affected shared read/write grants, appends `owner_directive` review/demotion proof, and does not call a model, replay an action, delete source/memory rows or synthesize a replacement. Pre-demotion recorded history remains. Later genuine user support can restore the same fingerprint.
- Recall remains compact and pending-free. `freshness.capture_only_count` distinguishes filtered capture from actual digestion. Excluded tool content follows the configured retention; original user/assistant content remains available for reconsideration.

## Native transport, not an agent runtime

`src/native-luna.ts` adapts `/home/alex/work/projects/creators/packages/backend/src/growth-model.ts` and `scripts/connect-growth.ts`: direct OAuth-backed HTTP/SSE Responses, pinned client/account identity, bounded stream and local JSON validation. No Codex CLI, app-server, `@openai/codex` dependency, Hermes PluginLlm/per-call bridge, or public API-key fallback exists.

OAuth was completed by Overwatch through the existing protected owner flow in `/home/alex/.local/share/the-atlas/codex-home`; the native catalog includes `gpt-6-luna`. Builder's real synthetic direct request returned:

```json
{"output":{"decisions":[]},"usage":{"provider":"atlas_native_oauth_http_sse","model":"gpt-6-luna","inputTokens":88,"outputTokens":9,"elapsed_ms":3019}}
```

Rotating refresh preserves account identity, is single-flight, persists atomically and recovers stale PID locks with compare-before-unlink. Temporary throttling is retryable. An ambiguous refresh is not blindly replayed; a valid access token can continue, while unresolved expiry needs the supported reconnect.

## Verification completed by Builder

- `bun run check`: pass.
- `bun test tests`: **155 tests / 1422 assertions, zero failures**.
- Focused native/JEV/sustained tests: **13 tests / 218 assertions**, included above (not additive).
- `bun install --frozen-lockfile`: pass.
- Real on-disk HTTP/CLI E2E on pinned Bun 1.4.4: pass. The first invocation used ambient Bun 1.2.21 and failed before the scenario; rerun with the required pinned toolchain passed. This is retained as a toolchain mismatch, not hidden as a product failure.
- `git diff --check`: pass.
- Real direct OAuth/SSE structured probe: pass, exact output above.

These are source and synthetic-provider-transport checks, not live JEV, production activation or current-thread semantic acceptance.

## Exact production configuration

Preserve existing DB, credentials, grants, primary chat models, all-six capture/recall, embedding URL/model, preview and adapter. Start from the measured four-worker baseline; do not add raw workers as a substitute for the repair, though evidence-based adjustment remains allowed if phase costs show it is needed. Remove the old Hermes `THE_ATLAS_INFERENCE_COMMAND`; do not replace it with any CLI. Set only the affected Atlas values through the existing protected owner path:

```text
THE_ATLAS_NATIVE_WORKER=true
THE_ATLAS_CODEX_HOME=/home/alex/.local/share/the-atlas/codex-home
THE_ATLAS_EXTRACTION_MODEL=gpt-6-luna
THE_ATLAS_CODEX_REASONING_EFFORT=low
THE_ATLAS_JEV_API_KEY=<resolve existing authorized TypeSafe credential privately>
THE_ATLAS_JEV_MODEL=jev-1.14.0
THE_ATLAS_JEV_CONCURRENCY=4
```

Do not print/persist the JEV key in cards, shell history, receipts or screenshots. Keep `auth.json` mode0600 and its parent mode0700. There must be no `THE_ATLAS_PROVIDER_API_KEY` fallback. No new public API key is authorized or needed.

## Activation order

1. Reconcile the exact committed source identity in `SOURCE-VERIFICATION.json`. Stop Atlas normally and take a fresh stopped full-DB custody backup. Preserve every old table/row, source/job/change/support, grant and credential. Startup additively creates only the documented audit/focus tables.
2. Before starting the changed service, run three **separate** real JEV requests using synthetic data: one admission, one graph-area, one relationship. Each request must contain exactly one `questions.decision`; each response must contain exactly one validated `answers.decision`. Record nonsecret choice/model/confidence/probabilities/usage/latency. Do not use the old batched relevance probe as proof of this contract.
3. Run the real direct structured Luna probe against the exact source and Atlas OAuth home, requiring valid JSON, requested model and no tools. Then start the service once and verify health/status shows `atlas_native_oauth_http_sse` and `jev_single_decision_pipeline`.
4. Apply the known owner demotion once through the supported API, using the existing default/admin credential privately (never inline it):

```http
POST /v1/memory/jobs/mjob_0002f7b1-7e70-4ada-9ada-13fe29bf786f/admission-review
Idempotency-Key: t_05e9321c-session-local-memory-d76817d0
Content-Type: application/json

{"agent_id":"default","memory_id":"memory_d76817d0-477b-4099-ab96-dc1d13bccef3","expected_revision":1,"reason_code":"session_local_owner_correction"}
```

Expected: `demoted:true`, `model:"owner_directive"`. Reconcile first if a prior demotion already exists; the same proof is idempotent, a different demotion is a conflict. Verify current recall/graph no longer serves that memory ID, while original event `event_befab48d-fd58-4f83-8792-f207f9199485`, source job, memory/support rows and pre-demotion recorded history remain. Do not SQL-delete or manually correct it and do not replay the original message.

5. Start with the new scheduler. If live evidence shows inherited nonterminal memory work still prevents the roughly 10–15 minute objective, Overwatch may make targeted scheduling/priority adjustments to `queued`/`retry` memory jobs. Preserve event/job identity, source data, original message/tool actions and every terminal job effect; do not mark work processed/succeeded without actual digestion, replay original messages/tools or manufacture memories. Record the exact job IDs, before/after scheduling state, reason and observed result. Observe thread `20261108_050646_37bcf2ab`, separating:
   - durable capture accepted times;
   - `memory_event_admissions` / `memory_jev_routes` decisions and elapsed costs;
   - `captured` + `skipped` versus actually `processed` + `succeeded` events;
   - new original-supported memories/entities/relationships and correction/history behavior;
   - compact automatic recall with zero pending transcript and existing fast retrieval.

   Require useful coherent selective digestion, not every message becoming a fact. If provider/model semantics or throughput prevents the target, report the concrete remaining failure rather than inventing another approval gate or flooding Luna with all tool events.
6. Verify the changed route does not invoke Hermes/CLI/app-server for inference and preserves all-six existing capture/recall and the preview. Reuse accepted truth/relevance/latency evidence; only affected live checks are needed. No global queue-empty, perfect semantic accuracy or repeated whole Atlas acceptance campaign.

## Remaining boundaries

- JEV and Luna remain probabilistic; routing `unavailable` is not a fabricated decision and must not be presented as a successful JEV response.
- Long sources can exceed the target even with focus; no universal latency SLA or global queue-empty guarantee.
- An ambiguous rotating refresh can require supported OAuth reconnection after access expiry; never silently replay it.
- Production current-thread usefulness, live JEV evidence, actual demotion and all-six serving behavior are not claimed until Overwatch observes them.
