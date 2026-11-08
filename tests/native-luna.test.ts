import { test, expect } from 'bun:test';
import { NativeLunaWorker, ATLAS_OAUTH_CLIENT_ID, ATLAS_RESPONSES_URL } from '../src/native-luna.ts';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const account = 'account-fixture';
function token(expiresAt: number, accountId = account) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(expiresAt / 1000), 'https://api.openai.com/auth': { chatgpt_account_id: accountId } })).toString('base64url');
  return `header.${payload}.signature`;
}
function sse(model = 'gpt-6-luna') {
  const response = { status: 'completed', model, output: [{ content: [{ type: 'output_text', text: '{"decisions":[]}' }] }], usage: { input_tokens: 12, output_tokens: 3 } };
  return new Response(`data: ${JSON.stringify({ type: 'response.completed', response })}\n\ndata: [DONE]\n\n`, { status: 200 });
}
function env(home: string) {
  const old = { home: process.env.THE_ATLAS_CODEX_HOME, model: process.env.THE_ATLAS_EXTRACTION_MODEL };
  process.env.THE_ATLAS_CODEX_HOME = home; process.env.THE_ATLAS_EXTRACTION_MODEL = 'gpt-6-luna';
  return () => { for (const [key, value] of Object.entries(old)) value === undefined ? delete process.env[key === 'home' ? 'THE_ATLAS_CODEX_HOME' : 'THE_ATLAS_EXTRACTION_MODEL'] : process.env[key === 'home' ? 'THE_ATLAS_CODEX_HOME' : 'THE_ATLAS_EXTRACTION_MODEL'] = value; };
}

test('direct OAuth HTTP/SSE uses no tools and validates the exact model and output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-native-luna-')), restore = env(dir), now = Date.parse('2026-11-08T00:00:00Z'), access = token(now + 3600_000);
  writeFileSync(join(dir, 'auth.json'), JSON.stringify({ tokens: { access_token: access, refresh_token: 'refresh-old', account_id: account } }));
  const calls: any[] = [];
  const fetcher = async (url: any, init: any) => { calls.push({ url, init }); return sse(); };
  try {
    const worker = new NativeLunaWorker({ fetch: fetcher as any, now: () => now, home: dir });
    const result = await worker.structured({ event: { content: 'fictional evidence' } }, 'Curate memory');
    expect(result.output).toEqual({ decisions: [] });
    expect(result.usage).toMatchObject({ provider: 'atlas_native_oauth_http_sse', model: 'gpt-6-luna', inputTokens: 12, outputTokens: 3 });
    expect(calls).toHaveLength(1); expect(calls[0].url).toBe(ATLAS_RESPONSES_URL);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${access}`);
    expect(calls[0].init.headers['ChatGPT-Account-ID']).toBe(account);
    const body = JSON.parse(calls[0].init.body);
    expect(body).toMatchObject({ model: 'gpt-6-luna', store: false, stream: true, tools: [] });
    expect(body.instructions).toContain('Do not call tools');
    expect(calls[0].init.body).not.toContain('app-server');
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
});

test('expired OAuth refreshes once with identity preservation and recovers an abandoned lock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-native-luna-')), restore = env(dir), now = Date.parse('2026-11-08T00:00:00Z'), oldAccess = token(now - 1000), nextAccess = token(now + 7200_000);
  writeFileSync(join(dir, 'auth.json'), JSON.stringify({ tokens: { access_token: oldAccess, refresh_token: 'refresh-old', account_id: account } }));
  writeFileSync(join(dir, 'auth.json.refresh.lock'), JSON.stringify({ owner: 'dead', pid: 99999999, created_at: '2026-11-07T00:00:00.000Z' }));
  const calls: any[] = [];
  const fetcher = async (url: any, init: any) => {
    calls.push({ url, init });
    if (url === 'https://auth.openai.com/oauth/token') return new Response(JSON.stringify({ access_token: nextAccess, refresh_token: 'refresh-next', expires_in: 7200 }), { status: 200 });
    return sse();
  };
  try {
    const worker = new NativeLunaWorker({ fetch: fetcher as any, now: () => now, home: dir });
    const result = await worker.structured({ event: { content: 'fictional evidence' } }, 'Curate memory');
    expect(result.output).toEqual({ decisions: [] }); expect(calls).toHaveLength(2);
    const refresh = JSON.parse(calls[0].init.body);
    expect(refresh).toEqual({ grant_type: 'refresh_token', client_id: ATLAS_OAUTH_CLIENT_ID, refresh_token: 'refresh-old' });
    const persisted = JSON.parse(readFileSync(join(dir, 'auth.json'), 'utf8'));
    expect(persisted.tokens.access_token).toBe(nextAccess); expect(persisted.tokens.refresh_token).toBe('refresh-next');
    expect(persisted.atlas_refresh_ambiguous_at).toBeUndefined();
    expect(() => readFileSync(join(dir, 'auth.json.refresh.lock'))).toThrow();
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
});

test('Luna throttling propagates exact bounded reset guidance and a valid token survives an ambiguous refresh marker', async () => {
  const resetAt = 1796696415, resetAfter = 2560406, now = resetAt * 1000 - resetAfter * 1000;
  const dir = mkdtempSync(join(tmpdir(), 'atlas-native-luna-')), restore = env(dir), access = token(now + 3600_000);
  writeFileSync(join(dir, 'auth.json'), JSON.stringify({ atlas_refresh_ambiguous_at: '2026-11-07T23:00:00.000Z', tokens: { access_token: access, refresh_token: 'refresh-old', account_id: account } }));
  try {
    const response = new Response('sensitive upstream body must not persist', { status: 429, headers: {
      'Retry-After': '60',
      'x-codex-primary-reset-at': String(resetAt),
      'x-codex-primary-reset-after': String(resetAfter),
    } });
    const worker = new NativeLunaWorker({ fetch: (async () => response) as any, now: () => now, home: dir });
    await expect(worker.structured({}, 'Curate memory')).rejects.toMatchObject({
      code: 'native_quota', retryable: true,
      details: {
        upstream_status: 429, upstream_category: 'provider_capacity',
        retry_after_ms: 60_000, primary_reset_after_ms: 2_560_406_000,
        reset_at_ms: 1_796_696_415_000, hold_until_ms: 1_796_696_415_000,
      },
    });
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
});
