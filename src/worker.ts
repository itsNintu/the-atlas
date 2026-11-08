import { Store, id, now, hash, canonical, type Assertion } from "./store.ts";
import { ApiError } from "./errors.ts";
import {
  OpenAICompatible,
  factText,
  type ExtractionProvider,
} from "./provider.ts";

export class Worker {
  constructor(
    public store: Store,
    public provider: ExtractionProvider = new OpenAICompatible(),
    public lease_ms = 60_000,
  ) {}
  claim() {
    return this.store.transaction(() => {
      const t = Date.now();
      // A crash on the final attempt must not strand a running job forever.
      this.store.run(
        "UPDATE jobs SET status='failed',error_code='lease_exhausted',lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<=? AND attempts>=max_attempts",
        t,
      );
      const job = this.store.one(
        "SELECT * FROM jobs WHERE reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1) AND ((status IN ('queued','retry') AND available_at<=?) OR (status='running' AND lease_until<=?)) AND attempts<max_attempts ORDER BY created_at,id LIMIT 1",
        t,
        t,
      );
      if (!job) return null;
      const lease_token = id("lease");
      this.store.run(
        "UPDATE jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,error_code=NULL WHERE id=?",
        lease_token,
        t + this.lease_ms,
        job.id,
      );
      return { ...job, lease_token, attempts: job.attempts + 1 };
    });
  }
  async runOnce(): Promise<boolean> {
    const job = this.claim();
    if (!job) return false;
    const heartbeat = setInterval(
      () =>
        this.store.run(
          "UPDATE jobs SET lease_until=? WHERE id=? AND lease_token=? AND status='running'",
          Date.now() + this.lease_ms,
          job.id,
          job.lease_token,
        ),
      Math.max(10, Math.floor(this.lease_ms / 3)),
    );
    try {
      const revision = this.store.one(
        "SELECT r.*,s.current_revision_id,s.space_id,s.deleted_at AS source_deleted FROM revisions r JOIN sources s ON s.id=r.source_id WHERE r.id=?",
        job.revision_id,
      );
      if (
        !revision ||
        revision.deleted_at ||
        revision.source_deleted ||
        revision.current_revision_id !== revision.id
      ) {
        this.finish(job, "cancelled");
        return true;
      }
      const extracted: Assertion[] =
        revision.mode === "assertions"
          ? JSON.parse(revision.assertions_json)
          : await this.provider.extract(
              JSON.parse(revision.payload_json),
              revision.source_timestamp,
            );
      // Do not initiate another provider call after an observed cancellation/supersession.
      if (!this.live(job)) return true;
      const vectors =
        revision.mode === "natural_language"
          ? await this.provider.embed(extracted.map(factText))
          : [];
      this.store.transaction(() => {
        // Fencing covers concurrent workers, correction/forget while the provider is in flight.
        const live = this.live(job);
        if (!live) return;
        extracted.forEach((a, i) => {
          const fingerprint = hash(canonical(a));
          const existing = this.store.one(
            "SELECT id FROM facts WHERE space_id=? AND fingerprint=?",
            revision.space_id,
            fingerprint,
          );
          const fact_id = existing?.id ?? id("fact");
          if (!existing)
            this.store.run(
              "INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?)",
              fact_id,
              revision.space_id,
              fingerprint,
              a.subject,
              a.predicate,
              a.object,
              a.valid_from,
              a.valid_to,
              vectors[i] ? JSON.stringify(vectors[i]) : null,
              vectors[i] ? this.provider.embedding_model : null,
            );
          else if (vectors[i])
            this.store.run(
              "UPDATE facts SET embedding_json=?,embedding_model=? WHERE id=?",
              JSON.stringify(vectors[i]),
              this.provider.embedding_model,
              fact_id,
            );
          this.store.run(
            "INSERT OR IGNORE INTO supports VALUES (?,?,?,NULL)",
            fact_id,
            revision.id,
            revision.recorded_at,
          );
        });
        this.finish(job, "succeeded");
      });
    } catch (error) {
      const retryable = error instanceof ApiError && error.retryable;
      const status =
        retryable && job.attempts < job.max_attempts ? "retry" : "failed";
      const error_code =
        error instanceof ApiError ? error.code : "processing_error";
      this.store.run(
        "UPDATE jobs SET status=?,error_code=?,available_at=?,lease_until=NULL,lease_token=NULL,completed_at=? WHERE id=? AND lease_token=? AND status='running'",
        status,
        error_code,
        Date.now() + Math.min(30_000, 250 * 2 ** job.attempts),
        status === "failed" ? now() : null,
        job.id,
        job.lease_token,
      );
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
  live(job: any) {
    return this.store.one(
      "SELECT j.id FROM jobs j JOIN revisions r ON r.id=j.revision_id JOIN sources s ON s.id=r.source_id WHERE j.id=? AND j.lease_token=? AND j.status='running' AND j.reset_epoch=(SELECT epoch FROM derived_brain_reset_state WHERE singleton=1) AND s.deleted_at IS NULL AND r.deleted_at IS NULL AND s.current_revision_id=r.id",
      job.id,
      job.lease_token,
    );
  }
  finish(job: any, status: string) {
    this.store.run(
      "UPDATE jobs SET status=?,completed_at=?,lease_token=NULL,lease_until=NULL,error_code=NULL WHERE id=? AND lease_token=? AND status='running'",
      status,
      now(),
      job.id,
      job.lease_token,
    );
  }
}
