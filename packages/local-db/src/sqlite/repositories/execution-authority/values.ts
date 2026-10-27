import { normalizeDomainTimestamp } from '@amazon-ai-ops/shared-types';
import { createHash } from 'crypto';
import { normalizeStoreContextEnvelope, type AdExecutionBatchProjection, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { assertMissionAuthorityGates, MissionAuthorityGateError, type MissionAuthorityGateCheck } from '../mission-domain/authority-gates';
import { PolicyGrantDispatchStatus, PolicyGrantDispatchCode } from './contracts';
import { ExecutionAuthorityRepositoryError, ExecutionAuthorityGateError } from './errors';
export function isPolicyExecutionBatchSafelyRestartable(projection: AdExecutionBatchProjection): boolean {
    if (projection.jobs.length === 0
        || (projection.batch.status !== 'queued' && projection.batch.status !== 'preflight')) {
        return false;
    }
    let unfinishedCount = 0;
    let sawUnfinished = false;
    for (const job of projection.jobs) {
        if (job.status === 'succeeded') {
            if (sawUnfinished)
                return false;
            const evidenceSlots = new Set(job.evidence.map((item) => item.slot));
            if (!job.submitIntentId
                || !job.intentWrittenAt
                || !job.submittedAt
                || !evidenceSlots.has('before')
                || !evidenceSlots.has('after')
                || !evidenceSlots.has('reload')) {
                return false;
            }
            continue;
        }
        unfinishedCount += 1;
        sawUnfinished = true;
        if ((job.status !== 'queued' && job.status !== 'preflight')
            || job.submitIntentId
            || job.intentWrittenAt
            || job.submittedAt) {
            return false;
        }
    }
    return unfinishedCount > 0;
}
export function policyGrantDispatchEventType(status: PolicyGrantDispatchStatus): string {
    if (status === 'pending')
        return 'policy_grant_dispatch_pending_v1';
    if (status === 'attempting')
        return 'policy_grant_dispatch_attempt_started_v1';
    if (status === 'queued_for_execution')
        return 'policy_grant_dispatch_queued_for_execution_v1';
    if (status === 'waiting_runtime')
        return 'policy_grant_dispatch_waiting_runtime_v1';
    if (status === 'completed')
        return 'policy_grant_dispatch_completed_v1';
    return 'policy_grant_dispatch_attention_required_v1';
}
export function policyGrantDispatchTitle(status: PolicyGrantDispatchStatus): string {
    if (status === 'pending')
        return '策略授权派发：待处理';
    if (status === 'attempting')
        return '策略授权派发：正在建立安全执行批次';
    if (status === 'queued_for_execution')
        return '策略授权派发：等待串行执行';
    if (status === 'waiting_runtime')
        return '策略授权派发：等待浏览器与会话条件';
    if (status === 'completed')
        return '策略授权派发：已进入执行账本';
    return '策略授权派发：需要人工修复';
}
export function policyGrantDispatchCodeSupportsStatus(code: PolicyGrantDispatchCode, status: PolicyGrantDispatchStatus): boolean {
    const expected: Record<PolicyGrantDispatchCode, readonly PolicyGrantDispatchStatus[]> = {
        DISPATCH_PENDING: ['pending'],
        DISPATCH_ATTEMPT_STARTED: ['attempting'],
        BATCH_QUEUED_FOR_EXECUTION: ['queued_for_execution'],
        EXECUTION_START_ACQUIRED: ['queued_for_execution'],
        EXECUTION_RETRY_SCHEDULED: ['waiting_runtime'],
        EXECUTION_TERMINAL: ['completed'],
        EXECUTION_STATE_REQUIRES_RECONCILIATION: ['completed'],
        RUNTIME_UNAVAILABLE: ['waiting_runtime'],
        STARTUP_ATTEMPT_INTERRUPTED: ['waiting_runtime'],
        BATCH_CREATED: ['queued_for_execution'],
        EXISTING_BATCH_RECOVERED: ['completed'],
        SESSION_REAUTHORIZATION_REQUIRED: ['attention_required'],
        GRANT_EXPIRED: ['attention_required'],
        GRANT_TERMINAL: ['attention_required'],
        MISSION_REVISION_CHANGED: ['attention_required'],
        POLICY_AUTHORITY_CHANGED: ['attention_required'],
        ADS_IDENTITY_AUTHORITY_CHANGED: ['attention_required'],
        UNSAFE_DISPATCH_FAILURE: ['attention_required'],
    };
    return expected[code].includes(status);
}
export function policyGrantDispatchDetail(code: PolicyGrantDispatchCode): string {
    const details: Record<PolicyGrantDispatchCode, string> = {
        DISPATCH_PENDING: 'A policy grant is durably pending in the store execution lane.',
        DISPATCH_ATTEMPT_STARTED: 'The store execution lane started a durable dispatch attempt.',
        BATCH_QUEUED_FOR_EXECUTION: 'A durable batch is queued for safe serial execution.',
        EXECUTION_START_ACQUIRED: 'The store execution lane acquired the batch for a safe start attempt.',
        EXECUTION_RETRY_SCHEDULED: 'A pre-intent execution retry is scheduled under the store lane.',
        EXECUTION_TERMINAL: 'The execution batch reached a durable terminal state.',
        EXECUTION_STATE_REQUIRES_RECONCILIATION: 'The execution ledger state is not safe for automatic restart.',
        RUNTIME_UNAVAILABLE: 'Required runtime authority is temporarily unavailable.',
        STARTUP_ATTEMPT_INTERRUPTED: 'Startup recovered an interrupted pre-batch dispatch attempt.',
        BATCH_CREATED: 'A durable batch is queued for safe serial execution.',
        EXISTING_BATCH_RECOVERED: 'An existing batch remains governed by the execution ledger.',
        SESSION_REAUTHORIZATION_REQUIRED: 'The grant requires fresh authorization for the current store session.',
        GRANT_EXPIRED: 'The policy grant expired before safe execution.',
        GRANT_TERMINAL: 'The policy grant is terminal and cannot execute again.',
        MISSION_REVISION_CHANGED: 'The Mission authority changed and requires fresh analysis.',
        POLICY_AUTHORITY_CHANGED: 'The policy authority changed and requires fresh evaluation.',
        ADS_IDENTITY_AUTHORITY_CHANGED: 'The Ads object identity authority changed and requires repair.',
        UNSAFE_DISPATCH_FAILURE: 'Dispatch stopped at a fail-closed authority boundary.',
    };
    return details[code];
}
export function isCanonicalTimestamp(value: unknown): value is string {
    if (typeof value !== 'string')
        return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
export function normalizeContext(input: StoreContextEnvelope): StoreContextEnvelope {
    try {
        return normalizeStoreContextEnvelope(input);
    }
    catch (error) {
        throw new ExecutionAuthorityRepositoryError('INVALID_CONTEXT', error instanceof Error ? error.message : 'StoreContextEnvelope is invalid.');
    }
}
export function idOf(value: unknown, field: string): string {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized.length > 512 || /[\u0000-\u001f]/.test(normalized)) {
        throw invalid(`${field} must be a non-empty identifier.`);
    }
    return normalized;
}
export function optionalText(value: unknown): string | null {
    if (value === undefined || value === null)
        return null;
    const normalized = String(value).trim();
    return normalized ? normalized.slice(0, 2000) : null;
}
export function safeProjectionText(value: unknown, field: string): string {
    const normalized = idOf(value, field);
    if (/[\\/<>?&=]/.test(normalized)
        || /(?:https?|file):/i.test(normalized)
        || /(?:document\.)?cookie/i.test(normalized)) {
        throw invalid(`${field} must not contain paths, URLs, query data, cookies, or HTML.`);
    }
    return normalized;
}
export function positiveInt(value: unknown, field: string): number {
    const normalized = Number(value);
    if (!Number.isSafeInteger(normalized) || normalized <= 0)
        throw invalid(`${field} must be a positive integer.`);
    return normalized;
}
export function finite(value: unknown, field: string): number {
    const normalized = Number(value);
    if (!Number.isFinite(normalized))
        throw invalid(`${field} must be finite.`);
    return normalized;
}
export function sha256Of(value: unknown, field: string): string {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized))
        throw invalid(`${field} must be a SHA-256 hex digest.`);
    return normalized;
}
export function timestampOf(value: unknown, field: string): string {
  try { return normalizeDomainTimestamp(value, field); }
  catch (error) { throw invalid(error instanceof Error ? error.message : field + ' must be a valid ISO timestamp.'); }
}

export function parseJson(value: string, field: string): unknown {
    try {
        return JSON.parse(value);
    }
    catch {
        throw stateConflict(`${field} is invalid JSON.`);
    }
}
export function objectOf(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw stateConflict('Expected an authority object.');
    return value as Record<string, unknown>;
}
export function uniqueStringArray(value: unknown): string[] {
    if (!Array.isArray(value))
        throw stateConflict('Expected an authority string array.');
    const result = value.map((item) => idOf(item, 'authority item'));
    if (new Set(result).size !== result.length)
        throw stateConflict('Authority array contains duplicates.');
    return result;
}
export function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length
        && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}
export function hashObject(value: unknown): string {
    return createHash('sha256').update(stableJson(value)).digest('hex');
}
export function stableJson(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
export function invalid(message: string): ExecutionAuthorityRepositoryError {
    return new ExecutionAuthorityRepositoryError('INVALID_INPUT', message);
}
export function notFound(message: string): ExecutionAuthorityRepositoryError {
    return new ExecutionAuthorityRepositoryError('NOT_FOUND', message);
}
export function referenceConflict(message: string): ExecutionAuthorityRepositoryError {
    return new ExecutionAuthorityRepositoryError('REFERENCE_CONFLICT', message);
}
export function stateConflict(message: string): ExecutionAuthorityRepositoryError {
    return new ExecutionAuthorityRepositoryError('STATE_CONFLICT', message);
}
export function revisionConflict(message: string): ExecutionAuthorityRepositoryError {
    return new ExecutionAuthorityRepositoryError('REVISION_CONFLICT', message);
}
export function terminalState(message: string): ExecutionAuthorityRepositoryError {
    return new ExecutionAuthorityRepositoryError('TERMINAL_STATE', message);
}
export function assertExecutionAuthorityGates(checks: readonly MissionAuthorityGateCheck[]): void {
    try {
        assertMissionAuthorityGates(checks);
    }
    catch (error) {
        if (!(error instanceof MissionAuthorityGateError))
            throw error;
        const original = error.failures[0]?.error;
        throw new ExecutionAuthorityGateError(original instanceof ExecutionAuthorityRepositoryError ? original.code : 'STATE_CONFLICT', error.message, error.authorityGate);
    }
}
