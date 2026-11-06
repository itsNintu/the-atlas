import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, totalmem, release } from "node:os";
import { Store } from "../src/store.ts";
import { server, request, waitJob, report, repo } from "./runtime.ts";
import assert from "node:assert/strict";
function summary(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const p = (n: number) =>
    +s[Math.min(s.length - 1, Math.floor((s.length - 1) * n))].toFixed(3);
  return {
    count: s.length,
    p50_ms: p(0.5),
    p95_ms: p(0.95),
    p99_ms: p(0.99),
    max_ms: p(1),
  };
}
async function parallel<T>(
  items: T[],
  concurrency: number,
  fn: (v: T, i: number) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}
const scenarios = [
  {
    name: "small",
    sources: 120,
    spaces: 3,
    sizes: [512],
    concurrency: 4,
    reads: 100,
  },
  {
    name: "varied_multi_space",
    sources: 600,
    spaces: 12,
    sizes: [512, 4096, 32768],
    concurrency: 24,
    reads: 240,
  },
  {
    name: "larger_hot_space",
    sources: 1200,
    spaces: 4,
    sizes: [1024, 8192],
    concurrency: 32,
    reads: 240,
  },
];
const output: any[] = [];
for (const scenario of scenarios) {
  const dir = mkdtempSync(join(repo, ".private-bench-")),
    db = join(dir, "bench.sqlite"),
    store = new Store(db),
    boot = store.bootstrap("Generated benchmark");
  store.close();
  const live = await server(db);
  let peak_rss_kib = 0;
  const sample = setInterval(() => {
    try {
      const s = readFileSync(`/proc/${live.proc.pid}/status`, "utf8");
      peak_rss_kib = Math.max(
        peak_rss_kib,
        Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0),
      );
    } catch {}
  }, 10);
  try {
    const project = (
      await request(live.url, boot.token, "POST", "/v1/projects", {
        name: "Generated",
      })
    ).body;
    const spaces: string[] = [];
    for (let i = 0; i < scenario.spaces; i++)
      spaces.push(
        (
          await request(live.url, boot.token, "POST", "/v1/spaces", {
            project_id: project.id,
            name: `Generated ${i}`,
          })
        ).body.id,
      );
    const times: number[] = [],
      jobs: string[] = [],
      started = performance.now();
    let total_payload_bytes = 0;
    await parallel(
      Array.from({ length: scenario.sources }, (_, i) => i),
      scenario.concurrency,
      async (i) => {
        const size = scenario.sizes[i % scenario.sizes.length],
          factCount = 1 + (i % 4);
        const payload = `Generated fixture ${i}. `.padEnd(size, "x");
        total_payload_bytes += Buffer.byteLength(payload);
        const b = {
          space_id: spaces[i % spaces.length],
          external_id: `generated-${i}`,
          format: "text",
          mode: "assertions",
          source_timestamp: "2026-01-01T00:00:00Z",
          payload,
          assertions: Array.from({ length: factCount }, (_, j) => ({
            subject: `Synthetic person ${i}`,
            predicate: `attribute_${j}`,
            object: `Generated city ${i % 37}`,
          })),
        };
        const t = performance.now(),
          r = await request(live.url, boot.token, "POST", "/v1/sources", b);
        times.push(performance.now() - t);
        assert.equal(r.status, 200);
        jobs.push(r.body.job_id);
      },
    );
    const ingest_ms = performance.now() - started;
    await parallel(jobs, scenario.concurrency, async (job) => {
      assert.equal(
        (await waitJob(live.url, boot.token, job)).status,
        "succeeded",
      );
    });
    const durable_jobs_ms = performance.now() - started;
    const reads: number[] = [];
    await parallel(
      Array.from({ length: scenario.reads }, (_, i) => i),
      scenario.concurrency,
      async (i) => {
        const t = performance.now(),
          r = await request(live.url, boot.token, "POST", "/v1/context", {
            space_ids: [spaces[i % spaces.length]],
            query: `Synthetic person ${i % scenario.sources}`,
            budget_chars: 1600,
          });
        reads.push(performance.now() - t);
        assert.equal(r.status, 200);
        assert(r.body.used_chars <= 1600);
      },
    );
    const inspect = new Store(db);
    const counts = {
      sources: inspect.one("SELECT COUNT(*) n FROM sources").n,
      facts: inspect.one("SELECT COUNT(*) n FROM facts").n,
      supports: inspect.one("SELECT COUNT(*) n FROM supports").n,
      jobs_succeeded: inspect.one(
        "SELECT COUNT(*) n FROM jobs WHERE status='succeeded'",
      ).n,
    };
    inspect.close();
    let disk_bytes = 0;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        disk_bytes += statSync(db + suffix).size;
      } catch {}
    }
    output.push({
      ...scenario,
      total_payload_bytes,
      counts,
      ingest_ms: +ingest_ms.toFixed(3),
      ingest_sources_per_s: +(scenario.sources / (ingest_ms / 1000)).toFixed(2),
      durable_jobs_ms: +durable_jobs_ms.toFixed(3),
      jobs_per_s: +(scenario.sources / (durable_jobs_ms / 1000)).toFixed(2),
      ingest_receipt_latency: summary(times),
      retrieval_latency: summary(reads),
      peak_server_rss_kib: peak_rss_kib,
      database_plus_wal_bytes: disk_bytes,
    });
  } finally {
    clearInterval(sample);
    live.proc.kill("SIGTERM");
    await live.proc.exited;
    rmSync(dir, { recursive: true, force: true });
  }
}
const result = {
  run_at: new Date().toISOString(),
  runtime: {
    bun: Bun.version,
    platform: process.platform,
    os_release: release(),
    logical_cpus: cpus().length,
    cpu_model: cpus()[0]?.model,
    total_memory_bytes: totalmem(),
  },
  method:
    "Generated deterministic assertions, real HTTP + on-disk SQLite WAL synchronous FULL, one server + one serial worker. Payload bodies contain padding; 1-4 explicit facts/source. Each query searches one authorized space. RSS sampled /proc at 10ms. Warm retrieval follows complete ingestion. No model, vector or quality/cost/parity claim. These are local measurements, not load guarantees.",
  scenarios: output,
};
await report("benchmark.json", result);
console.log(JSON.stringify(result, null, 2));
