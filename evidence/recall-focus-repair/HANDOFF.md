# Atlas substantive recall focus — source handoff

Task `t_f373a2cd`; source-only implementation commit **35c24a64c78d0eec4ce24841dc0f555e922a187e**.
Root `t_5f7f3afb`; curation/integration owner `t_d7c1e270`; runtime owner `t_b3950651`.

## Implemented

Only product files `src/recall-query.ts` and new `tests/recall-focus-repair.test.ts` changed.
All four existing exports retain their signatures. New declarative intake and questions use substantive
content, not recognized response-control/scenario-location wrappers. Exact FEN9/Iona/Copper/Remy tokens
and factual negatives/temporal qualifiers survive. Removing “that same imaginary archive” also avoids
importing unrelated recent context merely because the wrapper contains “that”.

Context-only, exclusively assistant-supported availability denials are excluded for ordinary substantive
intake, not treated as domain knowledge. Explicit prior-response/failure inquiries retain those notes.
Mixed notes, domain negatives, user/tool evidence remain eligible; ambiguous mixed punctuation is
conservatively retained. These language heuristics are not universal intent or accuracy guarantees.
No changes to the configured semantic admission, lexical fallback, public request shape, inference hot
path, memory.ts, inference.ts, index, schema, production data or native configuration in this lane.

SHA256:
- `src/recall-query.ts`: `dedcc79fcc57d79c20c95f0cabf2dc951fcbb12c9a7bbae41960b4ad78916ede`
- `tests/recall-focus-repair.test.ts`: `d5aea24c4315a8a91a2fb359eef8aa319780ebb657540ae23fbb83b1cdf5399c`

## Exact failure reproduced and changed

`READONLY-COMPARISON.json`: ten paired recalls, one held readonly SQLite transaction, identical
baseline engine bytes (`65b9a6302bdfdb4daed8022f6220ee81f70aee3f`) and helper-only delta, actual resident
`sentence-transformers/all-MiniLM-L6-v2`, 384 dimensions. The existing authorized Reaver actor is read
without exposing credentials. Store construction/migrations are bypassed; all twenty receipt writes
are intercepted, any other write fails, curation calls zero, pending transcript zero, no new sessions.

For the original capture query, recorded/valid time `2026-11-07T13:41:57.500Z` reconstructs the original
pre-capture eligible corpus from the same readonly snapshot. This is **logical recorded-time replay**,
not a claim of a separately stopped pre-capture database file. Its baseline **five IDs,732 tokens and
entire context hash exactly equal the immutable original FEN9-capture receipt**:
`f33c3a61c922b119ef2afaabdc9b6bd8b3d4573d754746790a08cdbf9ac6d4ae`.
Corrected recall is **0 memories/0 tokens**, without any name/code admission prerequisite.
Original wrapper similarities to unrelated LDN7/VES8 fixture claims were .545/.506 and denials .471/.449;
substantive focus's highest old-corpus similarity was .320. No threshold was raised to manufacture emptiness.

| Readonly comparison | Before → corrected tokens | Meaning |
|---|---:|---|
| Original FEN9 pre-capture exact query |732 → **0**|Unrelated original packet removed|
| Current FEN9 intake exact query |530 →530|All three original facts plus attributed later recap retained|
| FEN9 services/signal-tower/accountable paraphrase |530 →530|Original maintenance/reporting/review facts retained; reporting cosine **.440**|
| VES8 useful exact/paraphrase |344 →344 each|Original relationship evidence plus recap retained; paraphrase original cosine **.610**|
| Original exact QZX8 query |0 →**0**|Prior native abstention remains applicable|
| LDN7 ownership/history/correction/reporting/review |1199 →1199|Required current/prior/correction/relationship evidence retained, including prior owner|
| Actual response-history inquiry |1035 →1035|Prior VES8 denial remains retrievable|
| Lexical-only nonadjacent terms |1187 →1153|Original useful lexical facts retained; denial removed, no embeddings|

The current DB has additional attributed assistant recaps; these are not counted as independently
supported original facts. Existing stale LDN7 graph conflicts remain curation sibling scope, not fixed
or accepted here. Previous native LDN7/VES8/FEN9-use/QZX8 evidence is reused, not rerun organically.

## Narrow integration finding — explicitly not concealed

**FEN9 current-use** changes530→776 tokens with this helper-only engine comparison: its three useful
original facts/recap remain, but two unrelated LDN7 review notes newly qualify lexically after generic
wrapper removal. IDs `memory_05b08881-05cc-48b4-a211-8ac0d9f22527` and
`memory_875228bc-41be-4023-856b-5f0b4352a550`; lexical .375, semantic .264/.255, strongest direct .875.
Existing memory.ts relative pruning unconditionally rescues any requested predicate, so “reviews”
alone overrides the relative relevance check. This is not a semantic .42 false-positive.

Sent exact finding to root and owning sibling. Narrow recommendation: rescue the weaker requested
predicate only when independently semantically admitted; retain same-entity rescue, lexical>=.6
and normal lexical-only fallback. The sibling owns that integration and its affected verification.
No collision edit or claim that the current-use packet is fully clean is made here.

## Verification and reuse

- Regression-first run: 4 expected failures,5 passes, then affected helper/intent checks pass.
- Frozen install and typecheck pass.
- Full shared-tree suite: **118 tests,1024 assertions,19 files,0 failures**. Includes in-progress
  sibling curation changes; this is applicable helper evidence, not a frozen final sibling commit.
- Existing disk/HTTP/CLI E2E checks pass: actual SQLite WAL, SIGKILL/lease recovery, correction/history,
  forget, offline restore and credential handling. A scoped copy changes only import/report/temp paths
  so sibling's shared generated reports are untouched.
- Deterministic moderate semantic-only .42/.50/.619 cases with no literal overlap, lexical-only
  nonadjacent terms, ordinary followups, mixed notes and history inquiries pass. Numbers are measured
  compatibility cases, not immutable policy or a universal quality claim.
- `SOURCE-VERIFICATION.json` programmatically reconciles ten pairs/twenty intercepted receipts and
  immutable original packet equality; raw private source/context/credentials are not exported.

Reproduce helper-only comparison in canonical WSL repo:

```sh
python3 evidence/recall-focus-repair/prepare-compare.py
THE_ATLAS_EMBED_URL=http://127.0.0.1:8788/v1/embed \
THE_ATLAS_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2 \
.private/toolchain/bun-linux-x64/bun evidence/recall-focus-repair/readonly-compare.ts
```

This source lane is implemented and verified within its owned files. **Not activated**, not overall
owner acceptance and not clean durable graph reconciliation. Runtime changes remain solely Overwatch's.
