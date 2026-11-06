import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Store, id } from "../src/store.ts";
import { Worker } from "../src/worker.ts";
import { App } from "../src/app.ts";
import { providerStatus } from "../src/provider.ts";
import { report, repo } from "./runtime.ts";
import assert from "node:assert/strict";
const dir = mkdtempSync(join(repo, ".private-provider-")),
  store = new Store(join(dir, "probe.sqlite"));
try {
  const boot = store.bootstrap("Synthetic provider probe"),
    app = new App(store);
  async function call(path: string, body: any) {
    const r = await app.fetch(
      new Request("http://localhost" + path, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${boot.token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": id("probe"),
        },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(r.status, 200);
    return (await r.json()) as any;
  }
  const project = await call("/v1/projects", { name: "Probe" });
  const space = await call("/v1/spaces", {
    name: "Probe",
    project_id: project.id,
  });
  const source = await call("/v1/sources", {
    space_id: space.id,
    external_id: "real-provider-probe",
    format: "text",
    mode: "natural_language",
    source_timestamp: "2026-01-01T00:00:00Z",
    payload: "Mira lives in Lisbon. Mira works for Cedar Labs.",
  });
  await new Worker(store).runOnce();
  const job = store.one(
    "SELECT status,error_code,attempts FROM jobs WHERE id=?",
    source.job_id,
  );
  const facts = store.all(
    "SELECT subject,predicate,object,embedding_model,embedding_json FROM facts",
  );
  const configured = providerStatus().configured;
  if (!configured) {
    assert.equal(job.error_code, "provider_unavailable");
    assert.equal(facts.length, 0);
  }
  if (configured && job.status !== "succeeded") process.exitCode = 1;
  const result = {
    run_at: new Date().toISOString(),
    configured,
    result:
      job.status === "succeeded"
        ? "real_provider_extraction_and_embedding_completed"
        : "provider_unavailable_or_failed",
    job,
    facts: facts.map(({ embedding_json, ...safe }) => ({
      ...safe,
      embedding_dimensions: JSON.parse(embedding_json ?? "[]").length,
    })),
    diagnostic: providerStatus(),
    note: "No mocked model output. Without configuration, this exercises the real production adapter failure path; deterministic workflows remain independently usable.",
  };
  if (job.status === "succeeded") {
    assert(facts.length > 0);
    assert(facts.every((f) => JSON.parse(f.embedding_json).length > 0));
  }
  await report("provider.json", result);
  console.log(JSON.stringify(result, null, 2));
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
