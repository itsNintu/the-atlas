# Failed-current execution owner exclusion — source handoff

Task: `t_0ebd3ba0` (Builder source) → `t_b7e29b89` (Overwatch sole production activation).
Base commit: `1c23d89f3968a872c5aa1553c752b0ee5a953656`.
The exact product commit and tree are supplied in the Kanban completion handoff.

## Narrow behavior change

- `execution_content_owner_exclusion` now accepts either the existing succeeded+processed source or a current `failed` memory job whose current source event is still `pending` and directly supports the named memory through retained `memory_supports`.
- The named job must be the current `memory_events.job_id` for the current head. Expected revision, exact event/job identity, direct provenance and affected-scope read/write grants remain mandatory. An older job for the same event is not sufficient.
- `session_local_owner_correction` retains the succeeded+processed requirement. No arbitrary caller fact editing, new reason, schema, endpoint or receipt change was added.
- Review remains deterministic `owner_directive` and appends only admission review/demotion audit. It does not call JEV/Luna, retry or alter the failed job, replay execution, mutate source/event/memory/support/version rows, or synthesize memories.
- Pre-demotion history remains inspectable. Shared restoration still requires later user support; agent-private execution exclusions accept later genuine user/assistant/inter_agent communication. Restoration evidence is also bounded by the requested recorded time, so later support cannot rewrite the intervening demoted history.

## Source verification

Pinned runtime: Bun 1.4.4.

- Focused communication boundary: **4 tests / 71 assertions, zero failures** (`failed-current-tests.log`). The two new failed-current regressions initially failed at `job_not_reviewable` before the implementation.
- Existing admission, communication, JEV and native-provider group: **23 tests / 359 assertions, zero failures** (`affected-tests.log`). Files: `communication-boundary`, `sustained-dreaming`, `provider-availability`, `native-openai`, `native-luna`, and `jev`.
- Full suite: **165 tests / 1,562 assertions, zero failures across 27 files** (`full-tests.log`).
- `bun run check`: pass (`typecheck.log`).
- `git diff --check`: pass before commit.

The regressions snapshot jobs/events/memories/supports/versions across demotion and refused retry/reprocess; verify deterministic idempotent review replay, exact provenance/grant/status fences, zero inference calls, pre-demotion and demoted-interval history, and role-specific genuine-communication restoration. Provider tests use fault-injection/deterministic doubles, not live provider calls.

## Overwatch activation boundary

Builder made no production restart, service environment/credential/database edit, live provider call, production demotion or retry. Overwatch retains sole production activation and should reconcile the exact completion commit/tree, take fresh stopped custody, activate once, then re-run its read-only residual reconciliation before demoting only memories with exact current failed+pending source/job identity, revision, direct support and current affected grants.

Use the supported authenticated/idempotent admission-review endpoint with `reason_code:"execution_content_owner_exclusion"`; do not retry failed jobs or edit base rows. Reconcile any already-demoted memory through the existing proof/idempotency behavior rather than forcing another demotion. Verify current recall/graph exclusion and retained pre-demotion history after the bounded residual operation.

Receipt-serialization task `t_a16c3e71` remains separate and gated after `t_b7e29b89`; no receipt fix is included here. Existing unrelated report/evidence dirt was preserved and not staged.
