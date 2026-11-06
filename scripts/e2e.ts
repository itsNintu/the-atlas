import {
  mkdtempSync,
  statSync,
  readFileSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { Worker } from "../src/worker.ts";
import { cli, server, request, waitJob, report, repo } from "./runtime.ts";
const dir = mkdtempSync(join(repo, ".private-e2e-")),
  db = join(dir, "memory.sqlite"),
  credentials = join(dir, "admin.credentials.json");
let live: Awaited<ReturnType<typeof server>> | undefined;
const checks: string[] = [],
  start = performance.now();
try {
  const boot = await cli([
    "bootstrap",
    "--db",
    db,
    "--credential-file",
    credentials,
    "--name",
    "Synthetic E2E",
  ]);
  assert.equal(boot.secret_printed, false);
  assert.equal(boot.token, undefined);
  assert.equal(statSync(credentials).mode & 0o777, 0o600);
  const saved = JSON.parse(readFileSync(credentials, "utf8"));
  const token = saved.token;
  checks.push(
    "CLI bootstrap writes exclusive mode-0600 generated credential without printing it",
  );
  live = await server(db, false);
  const env = {
    THREADATLAS_CREDENTIAL_FILE: credentials,
    THREADATLAS_URL: live.url,
  };
  const project = await cli(
    ["api", "POST", "/v1/projects"],
    { name: "Synthetic project" },
    env,
  );
  const space = await cli(
    ["api", "POST", "/v1/spaces"],
    { name: "Synthetic shared", project_id: project.id },
    env,
  );
  const source = {
    space_id: space.id,
    external_id: "offline-1",
    format: "text",
    mode: "assertions",
    source_timestamp: "2026-01-01T00:00:00Z",
    payload: "Mira lives in Lisbon.",
    assertions: [{ subject: "Mira", predicate: "lives_in", object: "Lisbon" }],
  };
  const first = await cli(
    ["ingest", "--idempotency-key", "e2e-ingest"],
    source,
    env,
  );
  const replay = await cli(
    ["ingest", "--idempotency-key", "e2e-ingest"],
    source,
    env,
  );
  assert.equal(first.source_id, replay.source_id);
  assert.equal(replay.idempotent_replay, true);
  const second = await cli(
    ["ingest"],
    {
      ...source,
      external_id: "offline-2",
      format: "json",
      payload: { note: "Mira lives in Lisbon." },
    },
    env,
  );
  checks.push(
    "Server + CLI + REST ingest text and JSON and replay idempotently",
  );
  const control = new Store(db);
  const claimed = new Worker(control, undefined, 250).claim();
  assert(claimed);
  control.close();
  live.proc.kill("SIGKILL");
  await live.proc.exited;
  await Bun.sleep(300);
  live = await server(db, true);
  env.THREADATLAS_URL = live.url;
  assert.equal(
    (await waitJob(live.url, token, first.job_id)).status,
    "succeeded",
  );
  assert.equal(
    (await waitJob(live.url, token, second.job_id)).status,
    "succeeded",
  );
  checks.push(
    "SIGKILL + new server recovers both queued and expired leased work from real SQLite WAL",
  );
  let c = await cli(
    ["context"],
    { space_ids: [space.id], query: "Mira", budget_chars: 2000 },
    env,
  );
  assert.equal(c.facts.length, 1);
  assert.equal(c.facts[0].supports.length, 2);
  const fact = c.facts[0].id;
  const provenance = await request(live.url, token, "GET", "/v1/facts/" + fact);
  assert.equal(provenance.body.supports.length, 2);
  const otherFile = join(dir, "other.credentials.json");
  await cli([
    "bootstrap",
    "--db",
    db,
    "--credential-file",
    otherFile,
    "--name",
    "Other synthetic workspace",
  ]);
  const other = JSON.parse(readFileSync(otherFile, "utf8")).token;
  assert.equal(
    (await request(live.url, other, "GET", "/v1/sources/" + first.source_id))
      .status,
    404,
  );
  assert.equal(
    (
      await request(live.url, other, "POST", "/v1/context", {
        space_ids: [space.id],
        query: "Lisbon",
      })
    ).status,
    404,
  );
  assert.equal(
    (await request(live.url, other, "DELETE", "/v1/sources/" + first.source_id))
      .status,
    404,
  );
  checks.push(
    "HTTP cross-workspace read/write/inference isolation and source provenance verified",
  );
  const before = new Date().toISOString();
  await Bun.sleep(5);
  const correction = await cli(
    ["correct", first.source_id],
    {
      expected_revision_number: 1,
      format: "messages",
      mode: "assertions",
      source_timestamp: "2026-02-01T00:00:00Z",
      payload: [
        {
          role: "user",
          content: "Mira moved to Porto.",
          timestamp: "2026-02-01T00:00:00Z",
        },
      ],
      assertions: [{ subject: "Mira", predicate: "lives_in", object: "Porto" }],
    },
    env,
  );
  await cli(["wait", correction.job_id], undefined, env);
  const history = await cli(
    ["context"],
    {
      space_ids: [space.id],
      query: "Mira",
      recorded_at: before,
      budget_chars: 2000,
    },
    env,
  );
  assert(history.context.includes("Lisbon"));
  assert(!history.context.includes("Porto"));
  checks.push(
    "CLI correction and historical recorded-time retrieval across durable source revisions",
  );
  await cli(["forget", first.source_id], undefined, env);
  c = await cli(
    ["context"],
    { space_ids: [space.id], query: "Mira", budget_chars: 2000 },
    env,
  );
  assert(c.context.includes("Lisbon"));
  assert(!c.context.includes("Porto"));
  assert.equal(c.facts[0].supports.length, 1);
  const tomb = await cli(["inspect", first.source_id], undefined, env);
  assert(
    tomb.revisions.every(
      (r: any) => r.payload === null && r.assertions === null,
    ),
  );
  const tiny = await cli(
    ["context"],
    { space_ids: [space.id], query: "Mira", budget_chars: 1 },
    env,
  );
  assert.equal(tiny.context, "");
  checks.push(
    "Forget erases all revision payload/assertions, removes unsupported facts, retains independent live support, honors context budget",
  );
  live.proc.kill("SIGTERM");
  await live.proc.exited;
  const restored = join(dir, "restored");
  mkdirSync(restored, { mode: 0o700 });
  const restoredDB = join(restored, "memory.sqlite");
  for (const suffix of ["", "-wal", "-shm"])
    if (existsSync(db + suffix)) copyFileSync(db + suffix, restoredDB + suffix);
  copyFileSync(credentials, join(restored, "admin.credentials.json"));
  live = await server(restoredDB, true);
  env.THREADATLAS_URL = live.url;
  const demo = await Bun.spawn([process.execPath, "examples/workflow.ts"], {
    cwd: repo,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(await demo.exited, 0, await new Response(demo.stderr).text());
  assert.equal(
    JSON.parse(await new Response(demo.stdout).text()).result,
    "pass",
  );
  checks.push(
    "Stopped-database backup restores into a new path with saved credential; runnable agent demo completes against restored server",
  );
  c = await cli(["context"], { space_ids: [space.id], query: "Mira" }, env);
  assert(c.context.includes("Lisbon"));
  const physical = new Store(restoredDB);
  assert.equal(physical.one("PRAGMA integrity_check").integrity_check, "ok");
  const payloads = physical.all(
    "SELECT payload_json,assertions_json FROM revisions WHERE source_id=?",
    first.source_id,
  );
  assert(
    payloads.every(
      (x) => x.payload_json === null && x.assertions_json === null,
    ),
  );
  physical.close();
  checks.push(
    "Second graceful restart preserves repaired context; SQLite integrity_check=ok and direct erased-column verification",
  );
  const result = {
    run_at: new Date().toISOString(),
    result: "pass",
    checks,
    duration_ms: +(performance.now() - start).toFixed(2),
    storage: "real on-disk SQLite WAL",
    provider: "explicit assertions only; no natural-language claim",
    runtime: Bun.version,
    platform: process.platform,
  };
  await report("e2e.json", result);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (live && live.proc.exitCode === null) {
    live.proc.kill("SIGTERM");
    await live.proc.exited;
  }
  rmSync(dir, { recursive: true, force: true });
}
