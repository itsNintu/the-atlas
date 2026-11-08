import { test, expect } from 'bun:test';
import { JevClient, admissionQuestion, graphAreaQuestion, relationshipQuestion } from '../src/jev.ts';

function withEnv(url: string, fn: () => Promise<void>) {
  const old = { key: process.env.THE_ATLAS_JEV_API_KEY, url: process.env.THE_ATLAS_JEV_URL };
  process.env.THE_ATLAS_JEV_API_KEY = 'fixture-key'; process.env.THE_ATLAS_JEV_URL = url;
  return fn().finally(() => {
    for (const [name, value] of Object.entries(old)) {
      const key = name === 'key' ? 'THE_ATLAS_JEV_API_KEY' : 'THE_ATLAS_JEV_URL';
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test('every JEV request carries exactly one typed question and one validated answer', async () => {
  const bodies: any[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json(); bodies.push(body);
    const question = Object.values(body.questions)[0] as any;
    const probabilities = Object.fromEntries(Object.keys(question.criteria).map((key, index) => [key, index === 0 ? .9 : .1 / Math.max(1, Object.keys(question.criteria).length - 1)]));
    const choice = Object.keys(question.criteria)[0];
    return Response.json({ model: 'jev-fixture', answers: { decision: { type: 'choice', choice, confidence: .9, probabilities } }, usage: { input_tokens: 10, output_tokens: 2 } });
  } });
  try {
    await withEnv(new URL('/v1/systemone', server.url).href, async () => {
      const client = new JevClient();
      const results = await Promise.all([
        client.auditAdmission({ latest: { content: 'fictional session instruction' }, previous: [] }),
        client.routeGraphArea({ latest: { content: 'fictional evidence' } }, [{ id: 'area_0', label: 'agent:default: Fictional entity' }]),
        client.auditRelationship({ latest: { content: 'fictional evidence' }, candidate: { id: 'memory_fixture' } }),
      ]);
      expect(results.map(x => x.choice)).toEqual(['durable_candidate', 'area_0', 'relevant']);
      expect(bodies).toHaveLength(3);
      for (const body of bodies) {
        expect(Object.keys(body.questions)).toEqual(['decision']);
        expect(Object.keys(body.questions.decision.criteria).length).toBeGreaterThan(0);
        expect(body.state).not.toHaveProperty('questions');
      }
      expect(bodies[0].questions.decision.instructions).not.toBe(bodies[1].questions.decision.instructions);
      expect(bodies[1].questions.decision.instructions).not.toBe(bodies[2].questions.decision.instructions);
    });
  } finally { await server.stop(true); }
});

test('a multi-answer response is rejected instead of being relabelled as a single decision', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch() {
    return Response.json({ model: 'jev-fixture', answers: { decision: { type: 'choice', choice: 'durable_candidate', confidence: 1, probabilities: { durable_candidate: 1, session_episode: 0, session_context: 0, noise: 0, uncertain: 0 } }, extra: { type: 'choice', choice: 'noise', confidence: 1, probabilities: { durable_candidate: 0, session_episode: 0, session_context: 0, noise: 1, uncertain: 0 } } }, usage: { input_tokens: 1, output_tokens: 1 } });
  } });
  try {
    await withEnv(new URL('/v1/systemone', server.url).href, async () => {
      await expect(new JevClient().decide({}, admissionQuestion())).rejects.toMatchObject({ code: 'jev_invalid_response' });
    });
  } finally { await server.stop(true); }
});

test('JEV 402 is a sanitized nonretryable payment outcome with Retry-After guidance', async () => {
  const sensitive = 'upstream response prompt and token must not persist';
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    return new Response(sensitive, { status: 402, headers: { 'Retry-After': '120' } });
  } });
  try {
    await withEnv(new URL('/v1/systemone', server.url).href, async () => {
      try {
        await new JevClient().decide({}, admissionQuestion());
        throw new Error('Expected JEV 402');
      } catch (error: any) {
        expect(error).toMatchObject({ code: 'jev_http_error', retryable: false, details: {
          upstream_status: 402, upstream_category: 'payment_required', retry_after_ms: 120_000,
        } });
        expect(error.message).not.toContain(sensitive);
        expect(JSON.stringify(error.details)).not.toContain(sensitive);
      }
    });
  } finally { await server.stop(true); }
});

test('question builders never combine admission, graph area and relationship judgments', () => {
  expect(admissionQuestion().instructions).not.toContain('graph area');
  expect(graphAreaQuestion([{ id: 'area_0', label: 'fictional' }]).instructions).not.toContain('standing preference');
  expect(relationshipQuestion().instructions).toContain('only this candidate');
});
