import  {
  PolicyGrantDispatchStatus,
  PolicyGrantDispatchTrigger,
  PolicyGrantDispatchCode,
  PolicyGrantDispatchEventRow,
  PolicyGrantDispatchPayload,
} from './contracts';
import  {
  policyGrantDispatchEventType,
  isCanonicalTimestamp,
  stateConflict,
  revisionConflict,
  terminalState,
} from './values';
export const POLICY_GRANT_DISPATCH_ENTITY_TYPE = 'policy_grant_dispatch_v1';
export const POLICY_GRANT_DISPATCH_SOURCE = 'policy-grant-dispatch-v1';
export const POLICY_GRANT_DISPATCH_STATUSES: readonly PolicyGrantDispatchStatus[] = [
    'pending',
    'attempting',
    'queued_for_execution',
    'waiting_runtime',
    'completed',
    'attention_required',
];
export const POLICY_GRANT_DISPATCH_TRIGGERS: readonly PolicyGrantDispatchTrigger[] = [
    'grant_issued',
    'startup_recovery',
    'store_activated',
    'session_ready',
    'timer_retry',
];
export const POLICY_GRANT_DISPATCH_CODES: readonly PolicyGrantDispatchCode[] = [
    'DISPATCH_PENDING',
    'DISPATCH_ATTEMPT_STARTED',
    'BATCH_QUEUED_FOR_EXECUTION',
    'EXECUTION_START_ACQUIRED',
    'EXECUTION_RETRY_SCHEDULED',
    'EXECUTION_TERMINAL',
    'EXECUTION_STATE_REQUIRES_RECONCILIATION',
    'RUNTIME_UNAVAILABLE',
    'STARTUP_ATTEMPT_INTERRUPTED',
    'BATCH_CREATED',
    'EXISTING_BATCH_RECOVERED',
    'SESSION_REAUTHORIZATION_REQUIRED',
    'GRANT_EXPIRED',
    'GRANT_TERMINAL',
    'MISSION_REVISION_CHANGED',
    'POLICY_AUTHORITY_CHANGED',
    'ADS_IDENTITY_AUTHORITY_CHANGED',
    'UNSAFE_DISPATCH_FAILURE',
];
export function assertPolicyGrantDispatchTransition(previous: PolicyGrantDispatchPayload | undefined, next: PolicyGrantDispatchPayload): void {
    if (!previous) {
        if (next.attempt !== 0
            || !['pending', 'queued_for_execution', 'completed', 'attention_required'].includes(next.status)) {
            throw stateConflict('The first policy dispatch event must use attempt 0 and a recoverable initial state.');
        }
        return;
    }
    if (previous.status === 'completed' || previous.status === 'attention_required') {
        throw terminalState(`Policy dispatch ${previous.status} is terminal and cannot transition.`);
    }
    if (next.status === 'attempting') {
        if (!['pending', 'waiting_runtime', 'queued_for_execution'].includes(previous.status)
            || next.attempt !== previous.attempt + 1) {
            throw revisionConflict('Policy dispatch attempts must increase by exactly one from a resumable state.');
        }
        return;
    }
    if (next.attempt !== previous.attempt) {
        throw revisionConflict('Policy dispatch attempt cannot move backward, jump, or change outside attempt start.');
    }
    const allowed: Record<Exclude<PolicyGrantDispatchStatus, 'completed' | 'attention_required'>, readonly PolicyGrantDispatchStatus[]> = {
        pending: ['queued_for_execution', 'completed', 'attention_required'],
        attempting: ['queued_for_execution', 'waiting_runtime', 'completed', 'attention_required'],
        queued_for_execution: ['queued_for_execution', 'waiting_runtime', 'completed', 'attention_required'],
        waiting_runtime: ['queued_for_execution', 'completed', 'attention_required'],
    };
    if (!allowed[previous.status].includes(next.status)) {
        throw stateConflict(`Policy dispatch cannot transition from ${previous.status} to ${next.status}.`);
    }
}
export function parsePolicyGrantDispatchPayload(row: PolicyGrantDispatchEventRow): PolicyGrantDispatchPayload | undefined {
    if (!row.signal)
        return undefined;
    let value: unknown;
    try {
        value = JSON.parse(row.signal);
    }
    catch {
        return undefined;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const payload = value as Partial<PolicyGrantDispatchPayload>;
    if (payload.schemaVersion !== 1
        || !POLICY_GRANT_DISPATCH_TRIGGERS.includes(payload.trigger as PolicyGrantDispatchTrigger)
        || !POLICY_GRANT_DISPATCH_STATUSES.includes(payload.status as PolicyGrantDispatchStatus)
        || !POLICY_GRANT_DISPATCH_CODES.includes(payload.code as PolicyGrantDispatchCode)
        || !Number.isSafeInteger(payload.attempt)
        || Number(payload.attempt) < 0
        || typeof payload.detail !== 'string'
        || payload.detail !== redactPolicyGrantDispatchDetail(payload.detail)
        || (payload.batchId !== undefined && typeof payload.batchId !== 'string')
        || (payload.nextRetryAt !== undefined && !isCanonicalTimestamp(payload.nextRetryAt))
        || (payload.status !== 'waiting_runtime' && payload.nextRetryAt !== undefined)
        || row.event_type !== policyGrantDispatchEventType(payload.status as PolicyGrantDispatchStatus)
        || row.status !== payload.status) {
        return undefined;
    }
    return payload as PolicyGrantDispatchPayload;
}
export function redactPolicyGrantDispatchDetail(value: unknown): string {
    const normalized = String(value ?? '')
        .replace(/\b[A-Za-z]:[\\/][^\s"'<>]*/g, '[local-path]')
        .replace(/\\\\[^\\/\s"'<>]+[\\/][^\s"'<>]*/g, '[local-path]')
        .replace(/\bfile:(?:\/{2,}|\\{2,})[^\s"'<>]*/gi, '[local-path]')
        .replace(/\bhttps?:\/\/[^\s"'<>]*/gi, '[url-redacted]')
        .replace(/\b(cookie|authorization|password|passwd|token|secret)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim();
    return (normalized || 'Policy grant dispatch stopped safely.').slice(0, 500);
}
