# Automatic notification exclusion — activated outcome

**PASS.** Product commit `0d20bbd8eabf4b90f7050764af7483efa2fcd0c1` (tree `4baebfc13d142fd535c7701520d0ea8902f33d5b`) is active and includes admission-review receipt fix `222e831ff61205e60666bb57506bac0026b9aa9a`.

## Bounded cleanup

- The actual classifier found **26** current, nondemoted memories whose retained direct supports were all automatic Kanban/background notices. Every candidate had an exact current reviewable source; all five reported IDs were included. No mixed genuine/notice memory was demoted.
- A worker-disabled review start prevented all JEV/OpenAI/backlog activity. The operation made **26 authenticated/idempotent HTTP reviews**, each returning a nonempty `owner_directive`/`demoted:true` receipt that matched the persisted review. It made **0 review model calls, 0 provider probes, 0 job retries and 0 source/action replays**.
- Current graph contains **0/26** targets; pre-demotion recorded graph history retains **26/26**. The post-operation classifier audit has **0** remaining candidates. Original event/job/memory/support/version rows and provider holds are unchanged. The pre-existing terminal native-quota history is unchanged and was not bulk-retried.

## Recall outcome

The same owner-requirement query and 500-token budget was used before and after:

- Before (`recall_39c224f1-bfa8-4ee4-9022-a61d48062c9f`): 423 tokens, including automatic notification `memory_e17592d2-05a7-41e2-bf2b-a92f7b7f9503`; both designated genuine Atlas requirement records were crowded out.
- After (`recall_b5ad063d-f6de-4af0-ac24-4f7bf1d0de52`): 422 tokens, no notification candidate, and genuine requirement `memory_0911c79b-da38-443c-a0b0-8c34e1ba751d` present. Pending transcript/events remained 0/0; semantic recall was available.

## Custody and restored runtime

- Fresh stopped full-SQLite backup: `/home/alex/.local/share/the-atlas/backups/t_cb043bca_automatic_notification_activation`.
- Backup SHA256: `0973a19c386773438cf29d1760ad87bfb3449dd08c586cbd4a42be4266ed1add`; `quick_check=ok`.
- The activation used one quiesced review start and one normal start, with a stop before each. The exact original service environment was restored before the normal start.
- Final PID **3971763**, `NRestarts=0`, healthy schema2 service, `atlas_native_openai_responses` + `jev_single_decision_pipeline`; Luna/JEV both report available. Protected configuration/credential files and serving source hashes are unchanged. Target rows and terminal native-quota history remain unchanged after the normal start.

`OUTCOME.json` is the concise machine receipt. `activation.json`, `baseline.json`, the before/after classifier audits, and the two lifecycle scripts retain exact checks and identities. Source tests and the isolated E2E remain separate from this observed live result.
