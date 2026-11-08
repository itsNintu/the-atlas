import { canonical, hash } from './store.ts';

export const COMMUNICATION_ROLES = ['user', 'assistant', 'inter_agent'] as const;
export const communicationRole = (role: unknown) => COMMUNICATION_ROLES.includes(role as any);

// JEV receives a bounded auditor view of communication only, never the whole
// pending transcript or execution/task payloads. Full source provenance stays durable.
export function auditorEvent(event: any, latest = false) {
  const content = String(event.content ?? '');
  const limit = latest ? 4000 : 600;
  const excerpt = content.length <= limit ? content : latest
    ? content.slice(0, 2000) + '\n[…source elided for JEV…]\n' + content.slice(-2000)
    : content.slice(0, limit);
  return {
    event_id: event.event_id,
    role: event.role,
    author_id: event.author_id,
    occurred_at: event.occurred_at,
    content: excerpt,
    content_truncated: excerpt.length !== content.length,
  };
}
export function auditorState(event: any, previous: any[]) {
  return {
    schema_version: 1,
    latest: auditorEvent(event, true),
    previous: previous.map(x => auditorEvent(x)),
    context_contract: 'The latest message is audited with up to five preceding messages. Context explains the latest message and is not independent evidence.',
  };
}
export function admissionProof(kind: string, job: any, event: any, previous: any[], result: any, target?: unknown) {
  return hash(canonical({
    version: 1, kind, job_id: job.id, event_pk: event.id, event_id: event.event_id,
    revision: event.revision, body_hash: event.body_hash,
    previous: previous.map(x => `${x.client_id}:${x.event_id}@${x.revision}:${x.body_hash}`),
    target, choice: result.choice, confidence: result.confidence,
    probabilities: result.probabilities, model: result.model,
  }));
}
export function routeRecord(kind: string, target_id: string, result: any, proof: string) {
  return { kind, target_id, decision: result.choice, model: result.model, confidence: result.confidence, proof_sha256: proof, elapsed_ms: result.elapsed_ms };
}
