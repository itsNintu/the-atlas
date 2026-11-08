import { test, expect } from 'bun:test';
import { Store, now } from '../src/store.ts';
import { App } from '../src/app.ts';
import { Memory, MemoryWorker } from '../src/memory.ts';
import { ApiError } from '../src/errors.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const at = '2026-01-01T00:00:00.000Z';
const answer = { choice: 'durable_candidate', confidence: .9, probabilities: { durable_candidate: .9, other: .1 }, model: 'jev-double', elapsed_ms: 1, usage: { input_tokens: 1, output_tokens: 1 } };
function double(jev = false) {
  const inputs: any[] = [], audits: any[] = [];
  const inference: any = {
    async curate(input: any) { inputs.push(structuredClone(input)); return { decisions: [{ kind: 'nothing' }] }; },
    async embed(texts: string[]) { return { vectors: texts.map(() => [1, 0]), model: 'availability-double' }; },
  };
  if (jev) inference.audit = async (input: any) => { audits.push(structuredClone(input)); return structuredClone(answer); };
  return { inference, inputs, audits };
}
function fixture(path = ':memory:', jev = false) {
  const store = new Store(path), bootstrap = store.bootstrap('Synthetic provider availability'), actor = store.authenticate(bootstrap.token);
  const d = double(jev), memory = new Memory(store, d.inference), worker = new MemoryWorker(store, d.inference, 10_000);
  memory.bind(actor, actor.id, 'default');
  const event = (event_id: string, thread_id = event_id) => memory.event(actor, {
    client_id: 'availability', event_id, revision: 1, operation: 'upsert', agent_id: 'default', thread_id,
    role: 'user', author_id: 'alex', occurred_at: at, observed_at: now(), content: `Fictional evidence for ${event_id}`, metadata: {},
  });
  return { store, bootstrap, actor, memory, worker, event, ...d };
}
function diskFixture(jev = false) {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-provider-availability-')), path = join(directory, 'test.sqlite');
  const first = fixture(path, jev), secondStore = new Store(path), d = double(jev);
  const secondMemory = new Memory(secondStore, d.inference), secondWorker = new MemoryWorker(secondStore, d.inference, 10_000);
  return { first, second: { store: secondStore, memory: secondMemory, worker: secondWorker, ...d }, cleanup() { first.store.close(); secondStore.close(); rmSync(directory, { recursive: true, force: true }); } };
}
async function waitFor(predicate: () => boolean) {
  for (let n = 0; n < 200; n++) { if (predicate()) return; await Bun.sleep(2); }
  throw new Error('Timed out waiting for synthetic provider call');
}

test('Luna capacity preserves attempts and terminal rows, blocks all memory claims, and admits one recovery probe', async () => {
  const f = diskFixture(), { first, second } = f;
  const oldNative = process.env.THE_ATLAS_NATIVE_WORKER, oldJev = process.env.THE_ATLAS_JEV_API_KEY;
  process.env.THE_ATLAS_NATIVE_WORKER = 'true'; process.env.THE_ATLAS_JEV_API_KEY = 'fixture-not-a-real-key';
  try {
    const terminal = first.event('already-terminal');
    first.store.run("UPDATE memory_jobs SET status='failed',attempts=5,error_code='ordinary_failure',completed_at=? WHERE id=?", now(), terminal.job_id);
    const terminalBefore = first.store.one('SELECT * FROM memory_jobs WHERE id=?', terminal.job_id);
    const capacity = first.event('capacity', 'native-shared'), waiting = first.event('waiting', 'native-shared');
    first.worker.inference.curate = async () => { throw new ApiError(503, 'native_quota', 'Synthetic capacity fault', true, { upstream_status: 429, upstream_category: 'provider_capacity', retry_after_ms: 60_000 }); };
    const before = Date.now();
    expect(await first.worker.runOnce()).toBe(true);
    expect(first.store.one('SELECT status,attempts,error_code FROM memory_jobs WHERE id=?', capacity.job_id)).toEqual({ status: 'retry', attempts: 0, error_code: 'native_quota' });
    expect(await second.worker.runOnce()).toBe(false);
    expect(second.store.one('SELECT status,attempts FROM memory_jobs WHERE id=?', waiting.job_id)).toEqual({ status: 'queued', attempts: 0 });
    expect(second.inputs).toHaveLength(0);
    expect(first.store.one('SELECT * FROM memory_jobs WHERE id=?', terminal.job_id)).toEqual(terminalBefore);

    const captured = first.event('capture-during-hold', 'native-capture');
    expect(captured.durable).toBe(true);
    expect((await first.memory.recall(first.actor, { agent_id: 'default', thread_id: 'native-a', query: 'unrelated' })).pending_events).toEqual([]);
    const app = new App(first.store); app.memory = first.memory;
    const statusResponse = await app.fetch(new Request('http://localhost/v1/status', { headers: { Authorization: `Bearer ${first.bootstrap.token}` } }));
    const status: any = await statusResponse.json();
    const hold = first.store.one("SELECT * FROM memory_provider_holds WHERE provider='luna'");
    expect(hold.hold_until).toBeGreaterThanOrEqual(before + 59_000);
    expect(hold.hold_until).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(status.memory_inference.availability.luna).toMatchObject({ configured: true, state: 'held', reason: 'native_quota', upstream_status: 429, upstream_category: 'provider_capacity', next_probe_at: new Date(hold.hold_until).toISOString() });
    expect(JSON.stringify(status)).not.toContain('fixture-not-a-real-key');

    first.store.run("UPDATE memory_provider_holds SET hold_until=0,probe_until=NULL WHERE provider='luna'");
    first.store.run('UPDATE memory_jobs SET available_at=0 WHERE id=?', capacity.job_id);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    first.worker.inference.curate = async (input: any) => { first.inputs.push(structuredClone(input)); await gate; return { decisions: [{ kind: 'nothing' }] }; };
    first.inputs.length = 0;
    const probing = first.worker.runOnce();
    await waitFor(() => first.inputs.length === 1);
    expect(await second.worker.runOnce()).toBe(false);
    expect(second.store.one('SELECT status,attempts FROM memory_jobs WHERE id=?', waiting.job_id)).toEqual({ status: 'queued', attempts: 0 });
    expect(first.store.one("SELECT probe_token IS NOT NULL AS probing FROM memory_provider_holds WHERE provider='luna'").probing).toBe(1);
    release(); await probing;
    expect(first.store.one('SELECT status,attempts FROM memory_jobs WHERE id=?', capacity.job_id)).toEqual({ status: 'succeeded', attempts: 1 });
    expect(first.store.one("SELECT 1 FROM memory_provider_holds WHERE provider='luna'")).toBeNull();
    const availableResponse = await app.fetch(new Request('http://localhost/v1/status', { headers: { Authorization: `Bearer ${first.bootstrap.token}` } }));
    const available: any = await availableResponse.json();
    expect(available.memory_inference.availability.luna).toMatchObject({ configured: true, state: 'available', reason: null, next_probe_at: null });
    expect(await second.worker.runOnce()).toBe(true);
    expect(first.store.one('SELECT * FROM memory_jobs WHERE id=?', terminal.job_id)).toEqual(terminalBefore);
  } finally {
    if (oldNative === undefined) delete process.env.THE_ATLAS_NATIVE_WORKER; else process.env.THE_ATLAS_NATIVE_WORKER = oldNative;
    if (oldJev === undefined) delete process.env.THE_ATLAS_JEV_API_KEY; else process.env.THE_ATLAS_JEV_API_KEY = oldJev;
    f.cleanup();
  }
});

test('JEV 402 opens only a bounded JEV circuit, fails open to Luna, and recovers after one real success', async () => {
  const f = diskFixture(true), { first, second } = f;
  try {
    first.worker.inference.audit = async () => { throw new ApiError(503, 'jev_http_error', 'JEV HTTP 402', false, { upstream_status: 402, upstream_category: 'payment_required' }); };
    const before = Date.now(), initial = first.event('jev-payment');
    await first.worker.runOnce();
    const hold = first.store.one("SELECT * FROM memory_provider_holds WHERE provider='jev'");
    expect(hold.upstream_status).toBe(402); expect(hold.upstream_category).toBe('payment_required');
    expect(hold.hold_until).toBeGreaterThanOrEqual(before + 299_000);
    expect(hold.hold_until).toBeLessThanOrEqual(Date.now() + 300_000);
    expect(first.store.one('SELECT status FROM memory_jobs WHERE id=?', initial.job_id).status).toBe('succeeded');
    expect(first.store.one('SELECT decision,model FROM memory_event_admissions WHERE job_id=?', initial.job_id)).toEqual({ decision: 'unavailable', model: 'jev_http_error' });
    expect(first.inputs).toHaveLength(1);
    expect(first.store.one("SELECT 1 FROM memory_provider_holds WHERE provider='luna'")).toBeNull();

    const during = first.event('jev-during-hold');
    await second.worker.runOnce();
    expect(second.audits).toHaveLength(0); expect(second.inputs).toHaveLength(1);
    expect(second.store.one('SELECT status FROM memory_jobs WHERE id=?', during.job_id).status).toBe('succeeded');
    expect(second.store.one('SELECT decision,model FROM memory_event_admissions WHERE job_id=?', during.job_id)).toEqual({ decision: 'unavailable', model: 'jev_circuit_open' });
    expect(second.store.one("SELECT 1 FROM memory_provider_holds WHERE provider='jev'")).toBeTruthy();

    first.event('jev-probe', 'probe-a'); first.event('jev-no-stampede', 'probe-b');
    first.store.run("UPDATE memory_events SET role='inter_agent',author_id='agent:other' WHERE event_id='jev-no-stampede'");
    first.store.run("UPDATE memory_provider_holds SET hold_until=0,probe_until=NULL WHERE provider='jev'");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    first.worker.inference.audit = async (input: any) => { first.audits.push(structuredClone(input)); await gate; return structuredClone(answer); };
    const probing = first.worker.runOnce();
    await waitFor(() => first.audits.length === 1);
    await second.worker.runOnce();
    expect(second.audits).toHaveLength(0); expect(second.inputs).toHaveLength(2);
    expect(second.store.one("SELECT 1 FROM memory_provider_holds WHERE provider='jev'")).toBeTruthy();
    release(); await probing;
    expect(first.store.one("SELECT 1 FROM memory_provider_holds WHERE provider='jev'")).toBeNull();
    expect(first.store.one("SELECT j.status FROM memory_jobs j JOIN memory_events e ON e.id=j.event_pk WHERE e.event_id='jev-probe'").status).toBe('succeeded');
    expect(second.store.one("SELECT decision FROM memory_event_admissions a JOIN memory_jobs j ON j.id=a.job_id JOIN memory_events e ON e.id=j.event_pk WHERE e.event_id='jev-no-stampede'").decision).toBe('unavailable');

    first.event('jev-after-recovery');
    await second.worker.runOnce();
    expect(second.audits).toHaveLength(1);
    expect(first.audits.length + second.audits.length + 1).toBe(3); // initial 402, recovery probe, post-recovery request
    expect(first.inputs.length + second.inputs.length).toBe(5);
  } finally { f.cleanup(); }
});

test('ordinary retryable and schema errors retain bounded per-job attempts without opening a provider hold', async () => {
  const f = fixture();
  try {
    f.worker.inference.curate = async () => { throw new ApiError(503, 'native_invalid_response', 'Synthetic schema fault', true); };
    const retry = f.event('ordinary-retry');
    for (let attempt = 1; attempt <= 5; attempt++) {
      f.store.run('UPDATE memory_jobs SET available_at=0 WHERE id=?', retry.job_id);
      await f.worker.runOnce();
      expect(f.store.one('SELECT status,attempts FROM memory_jobs WHERE id=?', retry.job_id)).toEqual({ status: attempt < 5 ? 'retry' : 'failed', attempts: attempt });
    }
    f.worker.inference.curate = async () => { throw new ApiError(503, 'curation_budget_too_small', 'Synthetic nonretryable fault', false); };
    const failed = f.event('ordinary-failed');
    await f.worker.runOnce();
    expect(f.store.one('SELECT status,attempts FROM memory_jobs WHERE id=?', failed.job_id)).toEqual({ status: 'failed', attempts: 1 });
    expect(f.store.one('SELECT COUNT(*) AS n FROM memory_provider_holds').n).toBe(0);
  } finally { f.store.close(); }
});
