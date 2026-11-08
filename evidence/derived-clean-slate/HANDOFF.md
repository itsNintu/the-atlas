# Atlas derived-brain clean slate — final outcome

**PASS for the final clean-slate state and normal-service restoration.** Product commit
`e58d47a51577c3001848612868ff4ed21c0c5530` introduced the supported offline reset and generation
fences. The final physical reset completed at **2026-11-08T23:06:13.701Z (reset epoch 3)**. Atlas is
running normally as PID **4138123**, `NRestarts=0`, with ordinary workers and
`atlas_native_openai_responses` + `jev_single_decision_pipeline` active. All six adapter runtimes
report **1.2.3**, their original configuration is restored, and the temporary drain locks are released.

## Physical purge versus historical custody

The initial preflight contained **4,680 memories**, including **3,725 demotions**, across every
agent-private and shared Alex scope, plus **447,461** derived rows excluding the FTS shadow (4,680 FTS
rows). There were **1,392** queued/retry memory jobs. Every derived table was physically emptied;
no demotion-only or hidden historical graph projection was retained in the active brain.

| Derived table | Initial | After final reset |
| --- | ---: | ---: |
| memories (all scopes) | 4,680 | 0 |
| memory_admission_demotions / reviews | 3,725 / 3,725 | 0 / 0 |
| memory_entities | 2,086 | 0 |
| memory_supports | 4,757 | 0 |
| memory_changes / versions / lineage | 278 / 4,685 / 264 | 0 / 0 / 0 |
| memory_reconciliations | 1,109 | 0 |
| memory_event_admissions | 10,264 | 0 |
| memory_jev_routes | 290,122 | 0 |
| memory_vector_buckets | 112,320 | 0 |
| memory_search | 4,680 | 0 |
| memory_scoped_aliases / aliases / alias_sources | 2,239 / 1,663 / 4,274 | 0 / 0 / 0 |
| memory_entity_targets / equivalences | 588 / 63 | 0 / 0 |
| memory_change_invalidations | 2 | 0 |
| memory_chunk_progress | 87 | 0 |
| memory_recalls / feedback | 525 / 5 | 0 / 0 |
| legacy facts / supports | 0 / 0 | 0 / 0 |
| pre-reset nonterminal jobs | 1,392 | **0 eligible** |

Initial memory scopes were `agent:builder` 2,010, `agent:default` 475,
`agent:orchestrator` 274, `agent:overwatch` 1,106, `agent:reaver` 459, `agent:wordsmith` 1,
`business:alex` 301 and `user:alex` 54. All are zero at the reset snapshot. No synthetic memory was
seeded for verification.

The reset preserved original native/raw history and configuration rather than deleting it. At the
final stopped backup these retained counts were: **17,614 memory_events**, 11,382 roots, 17,536 heads,
21,416 idempotency and 21,416 audit receipts, 7,593 non-content curation metrics, 14 reprocess
requests, six bindings, 54 memory grants, seven principals/credentials, and one workspace. Original
legacy sources/revisions were already zero. Terminal, failed, skipped and historical cancelled jobs
remain historical records; old nonterminal rows cannot be claimed, retried, reprocessed, reviewed or
repaired. Provider holds/backoff survived while stale probe leases were cleared.

Fresh stopped full-database/configuration custody is protected at:

- Initial: `/home/alex/.local/share/the-atlas/backups/t_210103dc_derived_clean_slate/atlas`,
  SQLite SHA256 `a9476f4cc4570a405efa7fb7c72c88cdc78003e891f87ef912768d865db6e9eb`.
- Final: `/home/alex/.local/share/the-atlas/backups/t_210103dc_derived_clean_slate/atlas-release`,
  SQLite SHA256 `010ade2032d339ccda0ca04d32697ffe37d43d6f68081ff356c2422cf88b6fef`.
- Adapter full state: `.../adapter-state`; final queue custody: `.../adapter-state-release`.

Those backups intentionally retain old derived data **outside** the active brain. This is a physical
purge of active rows, not a claim to erase backups, provider logs, SSD remnants or consumer copies.

## Verification and current activity

- All six profiles have **0 nodes / 0 relationships / 0 changes** at the exact reset snapshot. The real
  Chromium brain UI independently displays **“0 nodes / 0 relationships”** and the empty state;
  see `graph-reset-snapshot.png`, `graph-reset-snapshot.json` and `ui-reset-snapshot.json`.
- Twelve known-old recall checks (two prior queries × six profiles) returned **zero old memories**;
  all returned context was empty in that check. Old recall/feedback projections were purged.
- Final read-only checks found zero pre-reset memory IDs, zero pre-reset nonterminal jobs, zero old
  adapter outbox/journal/platform/feedback items, integrity `ok`, and no foreign-key violations.
  Current memories/supports/admissions/routes are all generation 3 with times at/after the reset.
- Communication-only and automatic-notification boundaries remain in the activated source. No tool
  jobs exist in generation 3. Configuration, credentials and provider topology are intact.

Normal new conversations began after activation. At the final `OUTCOME.json` timestamp there were
**76 new events and 7 new memories** (5 succeeded, 70 skipped, 1 running new-generation job), all
recorded after reset. These are genuine post-reset activity, not residual old content and not a
reason to keep the service quiesced. New recall receipts were empty at that snapshot.

## Intermediate release deviations — corrected, not hidden

Two early adapter-release verifications allowed stale maintenance rows through before a final cutoff.
Before the last reset those attempts had produced 39 current derived memories, 74 admission rows and
90 JEV-route rows; 11 then-nonterminal jobs were cancelled by the final reset. Their derived outputs
were physically purged. Those intermediate calls are process deviations, not retained state or a
claim that the first attempts were clean. The final release used a second cutoff fence after adapter
verification and before normal start, closing that race. **No pre-reset content was admitted to
JEV/OpenAI after the final cutoff; post-reset provider work is solely for new generation-3 events.**

`OUTCOME.json` carries the reconciled machine counts. `activation.json`, `live-verification.json`,
`adapter-release-fence.json`, `adapter-verify.json` and the custody scripts retain exact checks and
identities. Source verification is **173 tests / 1,800 assertions**, typecheck and real on-disk E2E,
all passing.
