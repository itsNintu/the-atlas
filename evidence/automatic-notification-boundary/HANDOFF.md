# Automatic status-notification exclusion — source and activation handoff

Task: `t_cb043bca` (Builder, including the explicitly authorized bounded live activation and cleanup).
Base: `222e831ff61205e60666bb57506bac0026b9aa9a` (includes the admission-review HTTP receipt fix).

## Implemented boundary

- `automaticStatusNotification` uses explicit native notification producer/author metadata and exact start-anchored machine forms for Kanban wakes/statuses, completion receipts, internal notifications and background-process completion. Optional Discord `[Alex]` display attribution is covered. It does not search for broad task/result/completion words.
- New notice upserts fail `automatic_status_notification` before source/job insertion. Existing captured notices finish as capture-only `skipped` jobs without JEV/Luna, receive an `automatic_status_boundary` admission only if no earlier admission exists, cannot be retried/reprocessed, and are excluded from previous/recent provider context and candidate supports. Source rows remain intact.
- Genuine Alex task outcomes/durable requirements and genuine agent-to-agent reasoning remain eligible. The regressions include an Alex `[kanban] Please remember …` request and an inter-agent `delegated_result` with substantive reasoning.
- `automatic_notification_owner_exclusion` extends the synchronous supported admission-review route. It enforces the exact current job/source head, expected revision, affected read/write grants, direct retained support, an exact automatic source and notification-only retained supports. Mixed genuine/notice memories are rejected. Completed and failed-current/pending content-exclusion states use the existing fences.
- Review appends only `owner_directive` review/demotion audit. It does not call a model, retry a job, replay a source/action, mutate event/job/memory/support/version rows or delete history. Current graph/recall excludes demoted claims; pre-demotion recorded history remains. Later restoration requires genuine communication, never another automatic notice.

## Source verification (pinned Bun 1.4.4)

- New focused tests initially failed: notices were admitted, a legacy notice job succeeded through the worker, and the new review reason was unsupported.
- Notification + existing communication boundary: **9 tests passed** (`focused-tests.log`), including exact Kanban/Discord/wake/background forms, genuine discussion eligibility, zero-provider legacy capture, exact demotion fences, base-row preservation and a five-notice/one-current-fact 320-token crowd-out regression.
- Full suite: **170 tests / 1,641 assertions passed across 28 files** (`full-tests.log`).
- `bun run check`: pass (`typecheck.log`).
- Real isolated on-disk HTTP/CLI/WAL E2E: pass (`e2e.log`), with no natural-language/provider claim.
- Provider tests remain deterministic doubles/fault injection. No live provider result is inferred from source tests.

## Readonly live audit and bounded activation procedure

`audit-readonly.ts` applies the actual product classifier to retained direct supports through a readonly/query-only SQLite connection. The pre-activation audit found **26 notification-only memories**, all with a current reviewable source; the five reported IDs are included. Manual inspection of the candidate prefixes found only Kanban/background machine notices, not genuine delegated reasoning. No mixed-support memory is in the candidate set.

The live 500-token probe (`recall-probe-500.json`) uses the exact owner communication-requirement query. It returned old automatic notification `memory_e17592d2-05a7-41e2-bf2b-a92f7b7f9503` plus an old agent progress report, while genuine Atlas requirement records `memory_0911c79b-da38-443c-a0b0-8c34e1ba751d` and `memory_213a6666-082d-4815-b1ca-a829407058a1` were omitted. Reuse the same query after demotion; do not treat an empty packet as success.

Activation must:

1. Reconcile the exact product commit/tree and unchanged serving/protected files; refresh the readonly candidate audit.
2. Drain/stop the existing service, take a fresh stopped full-SQLite backup plus protected configuration custody, and verify quick_check and target/base-row digests.
3. Start once in a quiesced `THE_ATLAS_WORKER=false` activation so no JEV/OpenAI/backlog call can occur during review. Do not run provider probes or retry jobs. Verify the loaded direct OpenAI/JEV configuration and existing holds without changing credentials/provider configuration.
4. Capture pre-demotion graph/recall evidence, then make one authenticated/idempotent `automatic_notification_owner_exclusion` review per refreshed candidate. The HTTP receipt must be nonempty and match the persisted review, carrying commit222e831 into activation. Reconcile an already-demoted item by exact proof rather than repeating an uncertain write.
5. Verify all candidates disappear from current graph/recall, pre-demotion history and all original event/job/memory/support/version rows remain, the same 500-token query now returns at least one genuine Atlas requirement and no candidate, and no review model call/retry/replay occurred.
6. Stop, restore the exact original service environment, and start the normal native service once. Verify health, exact serving source, direct OpenAI/JEV route, preserved provider holds/config/credentials and no bulk terminal-backlog retry. Natural later scheduler behavior is separate from the deterministic cleanup.

No duplicate receipt task, source/action replay, SQL demotion, synthetic replacement memory or blanket inter-agent ban is part of this procedure.
