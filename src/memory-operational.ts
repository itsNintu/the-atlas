import type { Decision } from './inference.ts';
import { ownerAttributedEvent } from './memory-attribution.ts';

const predicateName = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[\s-]+/g, '_');

const REPORTED_OPERATION = /(?:^|_)(?:status|progress|attempt|outcome|completion|state|issue|inconsistency|failure|crash|retry|import|delivery|activation|test|regression|audit|measurement|usage|spend|cap|cooldown|session|task|repair|fix|diagnosis|collection|authored|adding|added|follow_up|early_release|planned|sequence|error|route|routing|deployment|implementation|implemented|check|checking|run|running|update|validation|verification|build|release|cutover|migration|result|limit|limitation|checks|testing|planning|applying|attempting|restoring|review|reviews|reconciliation|latency|commit|effort|finalization|change|correction|mismatch|discrepancy|stale|blocked|readback|hanging|diagnostic|residual|unavailable|changing|intent|instruction|paused|timing|start|changes|failures|failed|measurements|fixed|pushed|incorrect|incompatibility|gap|blocker|effects|prompt|cost|baseline|reads|excluded|completed|modified|produce|plan|stop|handoff|create|amendment|interrupted|retried|maintenance)(?:_|$)/;
const OPERATIONAL_REPORT_PREFIX = /^(?:(?:assistant|agent|operator|builder)_)?(?:reported|reports|plans|planned|stated|claimed|attempted|observed|identified|encountered|performed|prepared|received|reviewed|was_reported)(?:_|$)/;
const TASK_MANAGEMENT_PREDICATE = /^(?:plans?_to_(?:route|check_and_route|deploy)|reports?_.*task(?:_|$)|reported_(?:adding|added)_requirement_to_.*task|received_.*task(?:_|$)|was_instructed_to_route|owns_next_steps_for|assigned|assigned_work|was_assigned|intends|performed|prepared|said_would_prepare)/;
const ROUTINE_STATUS_PREDICATE = /^(?:status|builder_reported|content_status|editorial_status|publication_status|has_status|has_reported_status|package_work_status_reported|needs_input_status_withdrawn|observed_run_status|stated_run_status|hosted_request_returned_http_status|snapshot_apply_rolled_back|browser_acceptance_attempt_.+|exact_recall_result|had_correct_direct_recall|had_verification_file_path_issue|injected_packet_.+|packet_contains_.+|has_observed_.+|has_current_repair_focus|has_repair_command_plan|has_identified_gaps|failed_with|diagnosed_as|produced_incorrect_leading_answer|is_checking_.+|is_correcting_.+)$/;
const DURABLE_OPERATIONAL_INTENT = /(?:^|_)(?:status|progress|task|route|routing)(?:_|$)/;
const OPERATIONAL_PREDICATE = /^(?:curation_failure_observed|entity_attribution_defect_observed|recall_issue_observed|has_reported_performance_observation|included_(?:unrelated_records|observation)|was_assessed_as_.+)$/;
const DURABLE_REQUIREMENT = /(?:^|_)(?:requirement|requires|requested|wants|excludes|policy|prefers|goal)(?:_|$)/;
const OWNER_ROUTINE_STATUS = /^(?:has_status|status|publication_status|has_reported_status|reported_builder_status|reports_builder_task_running)$/;
const OWNER_DIRECTIVE_CONTENT = /\b(?:must|do\s+not|never|preserve|requires?|required|exclude|keep|remain|only|exact)\b/i;
const EXPLICIT_OWNER_DIRECTIVE = /\bAlex\s+(?:explicitly\s+)?(?:requires?|requested|wants|prefers|directed)\s+(.+)$/is;
const OPERATIONAL_DIRECTIVE_TRAILER = /\s*(?:[.;]\s*|\s*,?\s*but\s+)(?:this|that|it)\b[\s\S]*\b(?:reported plan|status report|implementation progress|routing narration|not verified|not completed)\b[\s\S]*$/i;

function ownerRequirementDecision<T extends Pick<Decision, 'subject' | 'predicate' | 'object'>>(claim: T): (T & { kind: 'assertion'; predicate: string; object: string; object_entity: false }) | null {
  const text = String(claim.object ?? '').trim();
  const match = EXPLICIT_OWNER_DIRECTIVE.exec(text);
  if (!match || /\b(?:not|denies)\s*$/i.test(text.slice(0, match.index))) return null;
  const directive = match[1]
    .replace(OPERATIONAL_DIRECTIVE_TRAILER, '')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/[.;!?]+$/g, '')
    .trim();
  if (!directive) return null;
  return { ...claim, kind: 'assertion', predicate: 'has_owner_requirement', object: directive, object_entity: false };
}

/**
 * A narrow attribution-aware classifier for routine agent narration. Direct
 * owner messages and explicitly attributed owner requirements are never
 * operationalized. Task-routing reports remain operational even when their
 * predicates contain words such as "requirement" or "directive".
 */
function routineOperationalStatusCategory(claim: Pick<Decision, 'subject' | 'predicate' | 'object'>, event: { role?: string | null }) {
  if (!event || !['assistant', 'inter_agent'].includes(String(event.role))) return null;
  const predicate = predicateName(claim.predicate);
  if (!predicate) return null;
  if (ownerAttributedEvent(event) && !(OWNER_ROUTINE_STATUS.test(predicate) && !OWNER_DIRECTIVE_CONTENT.test(String(claim.object ?? '')))) return null;
  const durableIntent = DURABLE_REQUIREMENT.test(predicate) && !DURABLE_OPERATIONAL_INTENT.test(predicate);
  if (TASK_MANAGEMENT_PREDICATE.test(predicate)) return 'task_management';
  if (ROUTINE_STATUS_PREDICATE.test(predicate)) return 'assistant_status';
  if (predicate.startsWith('assistant_sent_') && !durableIntent) return 'task_management';
  if (OPERATIONAL_REPORT_PREFIX.test(predicate) && REPORTED_OPERATION.test(predicate) && !durableIntent) return 'operational_report';
  if (predicate === 'activation_status') return 'assistant_status';
  if (OPERATIONAL_PREDICATE.test(predicate) && !DURABLE_REQUIREMENT.test(predicate)) return 'task_management';
  if (['received_task', 'assigned_task'].includes(predicate)) return 'task_management';
  if (['reported', 'observed', 'assessed'].includes(predicate) && !DURABLE_REQUIREMENT.test(predicate)) {
    const object = String(claim.object ?? '').toLowerCase();
    if (/\b(?:task|commit|worker|activation|regression|test|audit|query returned|usage|spend|claimed|checking|crash|failure|delivery|retry|repair|implementation)\b/.test(object)) {
      return 'operational_observation';
    }
  }
  return null;
}

export function operationalStatusCategory(claim: Pick<Decision, 'subject' | 'predicate' | 'object'>, event: { role?: string | null }) {
  const category = routineOperationalStatusCategory(claim, event);
  return category && !ownerRequirementDecision(claim) ? category : null;
}

/** Remove routine narration without discarding an explicit owner requirement it carries. */
export function decisionAfterOperationalFilter(decision: Decision, event: { role?: string | null }): Decision | null {
  if (!routineOperationalStatusCategory(decision, event)) return decision;
  return ownerRequirementDecision(decision);
}

export function isOperationalStatusDecision(decision: Decision, event: { role?: string | null }) {
  return operationalStatusCategory(decision, event) !== null;
}
