import { setting } from "../src/config.ts";
import { readFileSync, statSync } from "node:fs";
import assert from "node:assert/strict";
const credential_file =
  setting("CREDENTIAL_FILE") ?? "./data/admin.credentials.json";
if (process.platform !== "win32" && statSync(credential_file).mode & 0o077)
  throw Error("Credential file must be mode 0600");
const { token } = JSON.parse(readFileSync(credential_file, "utf8"));
const base = setting("URL") ?? "http://127.0.0.1:8787",
  url = new URL(base);
if (
  url.protocol !== "https:" &&
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
)
  throw Error("Use HTTPS beyond loopback");
async function call(
  method: string,
  path: string,
  body?: unknown,
  key: string = crypto.randomUUID(),
): Promise<any> {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30000),
  });
  const result = (await response.json()) as any;
  if (!response.ok)
    throw Error(`${result.error?.code}: ${result.error?.message}`);
  return result;
}
async function wait(job: string) {
  for (let i = 0; i < 600; i++) {
    const r = await call("GET", "/v1/jobs/" + job);
    if (r.status === "succeeded") return;
    if (["failed", "cancelled"].includes(r.status))
      throw Error(`Job ${r.status}: ${r.error_code}`);
    await Bun.sleep(100);
  }
  throw Error("Job wait timeout; job remains durable");
}
const project = await call("POST", "/v1/projects", {
    name: "Synthetic demo " + new Date().toISOString(),
  }),
  space = await call("POST", "/v1/spaces", {
    name: "Demo evidence",
    project_id: project.id,
  });
const body = {
  space_id: space.id,
  external_id: "sample",
  format: "text",
  mode: "assertions",
  source_timestamp: "2026-01-01T00:00:00Z",
  payload: "Mira works for Cedar Labs. Cedar Labs is in Lisbon.",
  assertions: [
    { subject: "Mira", predicate: "works_for", object: "Cedar Labs" },
    { subject: "Cedar Labs", predicate: "based_in", object: "Lisbon" },
  ],
};
const source = await call("POST", "/v1/sources", body, "demo-" + space.id);
try {
  await wait(source.job_id);
  const context = await call("POST", "/v1/context", {
    space_ids: [space.id],
    query: "Mira",
    budget_chars: 1000,
  });
  assert(context.context.includes("Mira"));
  const graph = await call("POST", "/v1/graph", {
    space_ids: [space.id],
    seed_entities: ["Mira"],
    max_hops: 2,
    budget_chars: 1500,
  });
  assert.equal(graph.facts.length, 2);
  const revision = await call(
    "POST",
    `/v1/sources/${source.source_id}/revisions`,
    {
      expected_revision_number: 1,
      format: "text",
      mode: "assertions",
      source_timestamp: "2026-02-01T00:00:00Z",
      payload: "Mira works for Maple Labs.",
      assertions: [
        { subject: "Mira", predicate: "works_for", object: "Maple Labs" },
      ],
    },
  );
  await wait(revision.job_id);
  const corrected = await call("POST", "/v1/context", {
    space_ids: [space.id],
    query: "Mira",
    budget_chars: 1000,
  });
  assert(corrected.context.includes("Maple Labs"));
  assert(!corrected.context.includes("Cedar"));
  await call("DELETE", "/v1/sources/" + source.source_id);
  const forgotten = await call("POST", "/v1/context", {
    space_ids: [space.id],
    query: "Mira",
    budget_chars: 1000,
  });
  assert.equal(forgotten.context, "");
  console.log(
    JSON.stringify(
      {
        result: "pass",
        mode: "explicit_assertions_not_model_extraction",
        project_id: project.id,
        space_id: space.id,
        source_id: source.source_id,
        initial_context: context.context,
        two_hop_edges: graph.facts.length,
        corrected_context: corrected.context,
        forgotten_context: forgotten.context,
        note: "Synthetic source payloads erased; empty demo project/space and tombstone remain inspectable. No credential was printed.",
      },
      null,
      2,
    ),
  );
} finally {
  await call("DELETE", "/v1/sources/" + source.source_id);
}
