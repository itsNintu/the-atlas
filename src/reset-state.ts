import type { Store } from "./store.ts";
import { fail } from "./errors.ts";

/** Current clean-slate generation. Raw history remains, but only this generation
 * may schedule work or supply conversational context to a provider. */
export function currentResetEpoch(store: Store): number {
  return store.one(
    "SELECT epoch FROM derived_brain_reset_state WHERE singleton=1",
  ).epoch as number;
}

export function assertCurrentJobEpoch(store: Store, ...epochs: number[]) {
  const epoch = currentResetEpoch(store);
  if (epochs.some((value) => value !== epoch)) {
    fail(
      409,
      "job_reset_fenced",
      "Pre-reset evidence is retained as history and cannot be retried, reprocessed, reviewed or repaired",
    );
  }
}
