import type { Decision } from './inference.ts';
import { ownerAttributedEvent } from './memory-attribution.ts';

const predicateName = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[\s-]+/g, '_');

const REPORTED_OPERATION = /(?:^|_)(?:status|progress|attempt|outcome|completion|state|issue|inconsistency|failure|crash|retry|import|delivery|activation|test|regression|audit|measurement|usage|spend|cap|cooldown|session|task|repair|fix|diagnosis|collection|authored|adding|added|follow_up|early_release|planned|sequence|error|route|routing|deployment|implementation|check|checking|run|running|update|validation|verification|build|release|cutover|migration|result|limit|limitation|checks|testing|planning|applying|attempting|restoring|review|reviews|reconciliation|latency|commit|effort|finalization|change|correction|mismatch|discrepancy|stale|blocked|readback|hanging|diagnostic|residual|unavailable|changing|intent|instruction|paused|timing|start|changes|failures|failed|measurements|fixed|pushed|incorrect|incompatibility|gap|blocker|effects|prompt|cost|baseline|reads|excluded|completed|modified|produce|plan|stop|handoff|create|amendment|interrupted|retried|maintenance)(?:_|$)/;
const OPERATIONAL_REPORT_PREFIX = /^(?:(?:assistant|agent|operator|builder)_)?(?:reported|reports|plans|planned|stated|claimed|attempted|observed|identified|encountered|performed|prepared|received|reviewed|was_reported)(?:_|$)/;
const TASK_MANAGEMENT_PREDICATE = /^(?:plans?_to_(?:route|check_and_route|deploy)|reports?_.*task(?:_|$)|reported_(?:adding|added)_requirement_to_.*task|received_.*task(?:_|$)|was_instructed_to_route|owns_next_steps_for|assigned|assigned_work|was_assigned|intends|performed|prepared|said_would_prepare)/;
const ROUTINE_STATUS_PREDICATE = /^(?:status|builder_reported|content_status|editorial_status|publication_status|has_status|has_reported_status|package_work_status_reported|needs_input_status_withdrawn|observed_run_status|stated_run_status|hosted_request_returned_http_status|snapshot_apply_rolled_back|browser_acceptance_attempt_.+|exact_recall_result|had_correct_direct_recall|had_verification_file_path_issue|injected_packet_.+|packet_contains_.+|has_observed_.+|has_current_repair_focus|has_repair_command_plan|has_identified_gaps|failed_with|diagnosed_as|produced_incorrect_leading_answer|is_checking_.+|is_correcting_.+)$/;
const DURABLE_OPERATIONAL_INTENT = /(?:^|_)(?:status|progress|task|route|routing)(?:_|$)/;
const OPERATIONAL_PREDICATE = /^(?:curation_failure_observed|entity_attribution_defect_observed|recall_issue_observed|has_reported_performance_observation|included_(?:unrelated_records|observation)|was_assessed_as_.+)$/;
const DURABLE_REQUIREMENT = /(?:^|_)(?:requirement|requires|requested|wants|excludes|policy|prefers|goal)(?:_|$)/;
const EXPLICIT_OWNER_REQUIREMENT = /\b(?:alex\s+(?:explicitly\s+)?(?:requires?|requested|wants|prefers|directed)|owner\s+(?:requirement|directive|correction|instruction)\s*[:-])/i;

/**
 * A narrow attribution-aware classifier for routine agent narration. Direct
 * owner messages and explicitly attributed owner requirements are never
 * operationalized. Task-routing reports remain operational even when their
 * predicates contain words such as "requirement" or "directive".
 */
export function operationalStatusCategory(claim: Pick<Decision, 'subject' | 'predicate' | 'object'>, event: { role?: string | null }) {
  if (!event || !['assistant', 'inter_agent'].includes(String(event.role))) return null;
  if (ownerAttributedEvent(event)) return null;
  const predicate = predicateName(claim.predicate);
  if (!predicate) return null;
  const durableIntent = DURABLE_REQUIREMENT.test(predicate) && !DURABLE_OPERATIONAL_INTENT.test(predicate);
  if (TASK_MANAGEMENT_PREDICATE.test(predicate) && !EXPLICIT_OWNER_REQUIREMENT.test(String(claim.object ?? ''))) return 'task_management';
  if (ROUTINE_STATUS_PREDICATE.test(predicate) && !EXPLICIT_OWNER_REQUIREMENT.test(String(claim.object ?? ''))) return 'assistant_status';
  if (predicate.startsWith('assistant_sent_') && !durableIntent && !EXPLICIT_OWNER_REQUIREMENT.test(String(claim.object ?? ''))) return 'task_management';
  if (OPERATIONAL_REPORT_PREFIX.test(predicate) && REPORTED_OPERATION.test(predicate) && !durableIntent && !EXPLICIT_OWNER_REQUIREMENT.test(String(claim.object ?? ''))) return 'operational_report';
  if (predicate === 'activation_status' && !EXPLICIT_OWNER_REQUIREMENT.test(String(claim.object ?? ''))) return 'assistant_status';
  if (OPERATIONAL_PREDICATE.test(predicate) && !DURABLE_REQUIREMENT.test(predicate) && !EXPLICIT_OWNER_REQUIREMENT.test(String(claim.object ?? ''))) return 'task_management';
  if (['received_task', 'assigned_task'].includes(predicate) && !EXPLICIT_OWNER_REQUIREMENT.test(String(claim.object ?? ''))) return 'task_management';
  if (['reported', 'observed', 'assessed'].includes(predicate) && !DURABLE_REQUIREMENT.test(predicate) && !EXPLICIT_OWNER_REQUIREMENT.test(String(claim.object ?? ''))) {
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
