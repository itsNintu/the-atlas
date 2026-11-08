import { test, expect } from 'bun:test';
import { NativeOpenAIWorker } from '../src/native-openai.ts';
import { Inference, inferenceStatus } from '../src/inference.ts';
import { isLunaCapacity } from '../src/provider-availability.ts';

const completed = (model = 'gpt-6-luna') => Response.json({
  status: 'completed', model,
  output: [{ content: [{ type: 'output_text', text: '{"decisions":[]}' }] }],
  usage: { input_tokens: 26, output_tokens: 9 },
});

test('native API credential selects direct regular OpenAI Responses with the dedicated project and no OAuth runtime', async () => {
  const names = ['THE_ATLAS_NATIVE_WORKER', 'THE_ATLAS_PROVIDER_API_KEY', 'THE_ATLAS_OPENAI_BASE_URL', 'THE_ATLAS_OPENAI_PROJECT_ID', 'THE_ATLAS_EXTRACTION_MODEL', 'THE_ATLAS_CODEX_HOME'] as const;
  const old = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const calls: any[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    calls.push({ url: request.url, headers: request.headers, body: await request.json() });
    return completed();
  } });
  try {
    process.env.THE_ATLAS_NATIVE_WORKER = 'true';
    process.env.THE_ATLAS_PROVIDER_API_KEY = 'fixture-service-account-key';
    process.env.THE_ATLAS_OPENAI_BASE_URL = new URL('/v1', server.url).href;
    process.env.THE_ATLAS_OPENAI_PROJECT_ID = 'proj_fixture_atlas';
    process.env.THE_ATLAS_EXTRACTION_MODEL = 'gpt-6-luna';
    delete process.env.THE_ATLAS_CODEX_HOME;
    expect(inferenceStatus().curate).toBe('atlas_native_openai_responses');
    const result = await new Inference().curate({ event: { content: 'Fictional Alex/agent communication' } });
    expect(result).toEqual({ decisions: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(new URL('/v1/responses', server.url).href);
    expect(calls[0].headers.get('authorization')).toBe('Bearer fixture-service-account-key');
    expect(calls[0].headers.get('openai-project')).toBe('proj_fixture_atlas');
    expect(calls[0].headers.get('chatgpt-account-id')).toBeNull();
    expect(calls[0].body).toMatchObject({ model: 'gpt-6-luna', store: false, stream: false, tools: [], reasoning: { effort: 'low' } });
    expect(calls[0].body.instructions).toContain('Do not call tools');
    expect(calls[0].body.input[0].content[0].text).toContain('Fictional Alex/agent communication');
  } finally {
    await server.stop(true);
    for (const name of names) {
      if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name];
    }
  }
});

test('direct OpenAI payment/capacity responses share native hold classification without persisting response bodies', async () => {
  for (const status of [402, 429]) {
    const sensitive = `sensitive API response ${status}`;
    const worker = new NativeOpenAIWorker({
      apiKey: 'fixture-key', projectId: 'proj_fixture', now: () => Date.parse('2026-11-08T00:00:00Z'),
      fetch: (async () => new Response(sensitive, { status, headers: { 'Retry-After': '120' } })) as any,
    });
    try {
      await worker.structured({}, 'Curate communication');
      throw new Error(`Expected ${status}`);
    } catch (error: any) {
      expect(error).toMatchObject({ code: 'native_quota', retryable: true, details: {
        upstream_status: status,
        upstream_category: status === 402 ? 'payment_required' : 'provider_capacity',
        retry_after_ms: 120_000,
      } });
      expect(isLunaCapacity(error)).toBe(true);
      expect(error.message).not.toContain(sensitive);
      expect(JSON.stringify(error.details)).not.toContain(sensitive);
    }
  }
});
