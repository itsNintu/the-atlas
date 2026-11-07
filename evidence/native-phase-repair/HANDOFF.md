# Atlas actual native Luna phase repair — source handoff

**Implemented/source-verified, not activated. Overall settlement remains root t_5f7f3afb.**

- Task t_6200b4e1; existing runtime owner t_b3950651 (Overwatch).
- Product/source commit **ccc8c67608327b8bba0b85da6cc3860db6997fff**, based on integrated5170187c7712fe07883907b3fa45648085e5c64f.
- Canonical `/home/alex/work/projects/the-atlas`. Exact source SHA256 manifest: SOURCE-VERIFICATION.json. Evidence-only commit follows; its source content is the same.

## Actual seam and corrections

The production receipt retained safe error codes and provider usage, NOT raw failed model outputs. Consequently the exact earlier invalid_reconciliation/curator_time_violation/invalid_identity response bytes cannot be reconstructed. No claim is made that a later reproduction is those same attempts.

Read-only production SQLite backup into a PRIVATE isolated fixture preserved exact original sources, credentials, grants, candidate identities and current source support. Only on that COPY, jobs were isolated for bounded worker execution. The actual configured bridge `preparation/atlas_launch_luna.py` → `atlas_inference_luna.py` called real openai-codex/gpt-6-luna. No bridge/config/model changes or Sol fallback.

Concrete retained outputs:
- FEN9 literal qualification identity returned candidate.object paraphrases under the generic candidate example. `candidateIdentities` correctly rejected `invalid_identity`. A per-call contract now specifies the exact incoming literal, permits only id/subject candidate fields for literal input, and tells the model to omit unchanged/irrelevant bindings. The literal validator is NOT weakened.
- An intermediate native response used `change.type:"superseded"`; validator correctly rejected `invalid_reconciliation`. Prompt now names the exact truth enum and separate `superseded_ids` field, optional nonempty changes and the single local item index0.
- One baseline older Nola result treated observation-time/default bounds as a new state change against a positively historical prior-owner record. Corrected guidance explicitly distinguishes reprocessing/default timestamps from a real later different-owner handover. The corrected actual result used the supported Leda replacement via superseded_by at **2026-11-07T00:00:00.000Z**, not a new Nola start at observation time. Original production time-violation response remains unknown; existing time guards remain unchanged and focused tests confirm rejection of unsupported same-source reversal.
- Packing now measures BOTH actual phase payloads before selection, rather than assuming identity is shorter than reconciliation. Exact product4096, native rough4800 and output2400 remain distinct unchanged boundaries.

No validator bypass, fallback, source replay, manual replacement facts, production DB/queue write, reprocess request, retry request, restart, native chat session, grant/credential/config/tunnel/model edit or schema migration was performed here. Product diff is phase contracts/prompt guidance/packing only; graph/history and helper recall code are unchanged.

## Finite verification

- Frozen install, typecheck, diff check pass. Full suite: **128 tests /1083 assertions /20 files, zero failures**. After adding one final negative time regression and an enum assertion, affected final tests: **17 tests /109 assertions, zero failures**; final typecheck pass. No product behavior changed after the full suite.
- Required real on-disk HTTP/CLI E2E passes, including WAL/crash/lease recovery, correction/history, forget, backup/restore and credential behavior. It uses explicit assertions, not NL quality.
- **64 actual Luna phase calls** across retained baseline/intermediate/corrected attempts; observed product max **4094 tokens**. Failures retained in LUNA-ATTEMPTS.json, not discarded or called semantic success.
- Corrected actual copied-source runs completed the first LDN7 source, all three later originals and FEN9. The later three were queued together on the copy and processed by the normal scheduler, not submitted behind success gates.
- Final-source deterministic integration reused recorded real outputs on the exact real first-state COPY, with real resident MiniLM embeddings, **24 replay phases /max4094 /no new Luna calls**. All five affected copy jobs succeeded; exact original custody retained. Original-supported projection has current typed Leda→Lantern, reporting/reviewer links, no current known stale target IDs, and a **positive typed historical Nola→Lantern** ending exactly2026-11-07T00:00:00.000Z. LDN7 positive typed current/history counts3/4; FEN9 current/history3/3. Counts are representation edges, not independent facts or production outcomes.
- First replay-harness attempt failed target validation because newly generated IDs differed from the recorded prestate. It is preserved as FAILED-INTEGRATION.json/integration.log; the corrected harness starts from the actual saved first-state copy, does not silently substitute IDs or alter model outputs. A baseline embedding-model mismatch was a fixture setting error, not a product failure; corrected fixture uses the existing resident model.
- Raw copy databases/full traces remain private under `.private/native-phase-repair/`. Exported attempt input views contain only original fictional sources/candidates, explicitly disclose omitted unrelated candidates, and retain hashes of private raw traces. No copied DB or credential file is a deliverable.

Reuse t_d7c1e270126/1072/19 and helper evidence for unchanged behavior: exact original FEN9 pre-capture732→0, live current530tokens/all3facts, callbacks76.190/92.043ms, six adapters1.2.0, Luna/MiniLM, preview/brand/date/private. Helper SHA256 remains dedcc79fcc57d79c20c95f0cabf2dc951fcbb12c9a7bbae41960b4ad78916ede. No new callback or freshness guarantee is claimed.

## Current production effects reconciled READ-ONLY

READONLY-LATEST.json cutoff **2026-11-07T16:16:26.808775Z**, compared with exact original repair receipts. All original source fields and job pointers remain unchanged:

| Original | Exact job | Natural current outcome |
|---|---|---|
| LDN7 first | mjob_3d9c6e05-803f-402b-82fc-074d15383406 | FAILED5 invalid_identity,15:57:37.115Z |
| LDN7 pronoun | mjob_15bf34a4-2421-4a19-ab79-dcaca5cafa70 | succeeded1,16:02:01.336Z |
| LDN7 handover | mjob_65a38b83-70e3-41fa-9bd8-0f48903d5ae3 | succeeded1,16:05:12.203Z |
| LDN7 correction | mjob_4d41cd33-131d-443f-afc0-bca2e12ac9d3 | succeeded2,16:13:10.785Z |
| FEN9 | mjob_af931955-1de5-40b2-92e8-4e85687e4925 | succeeded4,15:54:43.154Z |

Both known stale production targets memory_36a62b9d-b757-48ed-8f92-7a65303eabbd and memory_a826fdb2-4310-40e3-8b39-387d212bbc63 still have **no memory_changes** at that cutoff. Succeeded jobs do not establish reconciled domain truth. The stopped custody backup SHA256 is unchanged5adb6b50257db8d993e163c31f77bc39d75ef4c898b9492401ac28cd55ec3356; it was read only, not used as a current restart backup.

## Exact activation handoff — existing runtime owner only

1. Use the source commit above/integrated evidence HEAD with manifest hashes. Existing running service is NOT certified as having loaded these edits. Follow the established safe drain/fresh stopped full backup/start lifecycle on the SAME service. No model/config/grant/adapter/preview change is needed; no new schema migration. Historical PID2453708/invocatione3a3aafde6a8499c8d9b189a49ad98c5 is from the prior activation receipt, not freshly rechecked here.
2. Read the current five exact job/source pointers and original-supported graph/history first; state can progress. **Do not repeat the five already submitted reprocess effects.**
3. If first LDN7 remains the same failed/current source after changed source is loaded, the existing authenticated supported endpoint is `POST /v1/memory/jobs/mjob_3d9c6e05-803f-402b-82fc-074d15383406/retry`, ordinary existing credential + Content-Type application/json + unique Idempotency-Key, body `{"agent_id":"reaver"}`. This is supported retry of the SAME failed job, preserving prior evidence, not another reprocess/ACK/action replay. Do not raw-edit attempts/queue. No retry is requested for the four natural successes merely to obtain clean statuses; any further original-only supported action must be justified by remaining graph semantics and current state.
4. Verify the already specified affected original-supported graph/current/history/native answer. Preserve old change_900e67f4-9042-49e8-85cd-bad6e1172a72, original sources/old jobs/history and the never-true versus formerly-true distinction. Do not manually patch claims or count an assistant narrative as original truth. Reuse unchanged helper/timing/preview evidence; no broad new fleet campaign, queue-empty wait or approval lane.

Remaining uncertainty: inference remains probabilistic. Contracts prevent the demonstrated prompt ambiguities and the finite changed-copy checks pass; they do not guarantee every future model response or all historical date precision. Exact prior production failure bytes are unavailable. Activation/production remediation and native changed outcomes remain Overwatch; root settles overall completion.
