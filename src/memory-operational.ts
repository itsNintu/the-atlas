import type { Decision } from './inference.ts';

const predicateName = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLowerCase();

const REPORTED_OPERATION = /(?:^|_)(?:status|progress|attempt|outcome|completion|state|issue|inconsistency|failure|crash|retry|import|delivery|activation|test|regression|audit|measurement|usage|spend|cap|cooldown|session|task|repair|fix|diagnosis|collection|authored|adding|added|follow_up|early_release|planned|sequence|error)(?:_|$)/;
const OPERATIONAL_PREDICATE = /^(?:curation_failure_observed|entity_attribution_defect_observed|recall_issue_observed|has_reported_performance_observation|included_(?:unrelated_records|observation)|was_assessed_as_.+)$/;
const DURABLE_REQUIREMENT = /(?:^|_)(?:requirement|requires|requested|wants|excludes|policy|prefers|goal)(?:_|$)/;
const DURABLE_CONTENT = /\b(?:require(?:ment|ments|d|s)?|must|preserve|owner|directive|exclusion|silent|continuity|goal|no replay|do not|never)\b/i;

/**
 * A narrow attribution-aware classifier for routine agent narration. It never
 * classifies a direct user/owner event, and leaves durable requirements and
 * substantive architecture/design recommendations eligible.
 */
export function operationalStatusCategory(claim: Pick<Decision, 'subject' | 'predicate' | 'object'>, event: { role?: string | null }) {
  if (!event || !['assistant', 'inter_agent'].includes(String(event.role))) return null;
  const predicate = predicateName(claim.predicate);
  if (!predicate) return null;
  if (predicate.startsWith('assistant_sent_')) return 'task_management';
  if (predicate.startsWith('assistant_') && REPORTED_OPERATION.test(predicate) && !DURABLE_REQUIREMENT.test(predicate) && !DURABLE_CONTENT.test(String(claim.object ?? ''))) return 'assistant_status';
  if (predicate === 'activation_status' && !DURABLE_CONTENT.test(String(claim.object ?? ''))) return 'assistant_status';
  if (OPERATIONAL_PREDICATE.test(predicate)) return 'task_management';
  if (['received_task', 'assigned_task'].includes(predicate) && !DURABLE_CONTENT.test(String(claim.object ?? ''))) return 'task_management';
  if (predicate.startsWith('reported_') && REPORTED_OPERATION.test(predicate) && !DURABLE_REQUIREMENT.test(predicate) && !DURABLE_CONTENT.test(String(claim.object ?? ''))) {
    return 'operational_report';
  }
  if (['reported', 'observed', 'assessed'].includes(predicate)) {
    const object = String(claim.object ?? '').toLowerCase();
    if (/\b(?:task|commit|worker|activation|regression|test|audit|query returned|usage|spend|claimed|checking|crash|failure|delivery|retry|repair|implementation)\b/.test(object)) {
      return 'operational_observation';
    }
  }
  return null;
}

export function isOperationalStatusDecision(decision: Decision, event: { role?: string | null }) {
  return operationalStatusCategory(decision, event) !== null;
}
