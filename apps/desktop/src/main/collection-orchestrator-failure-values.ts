import {
  createHash,
} from 'node:crypto';
import {
  TRANSITION_PHASE_EDGE_MATRIX,
  DIGEST,
  ISO_DATE,
  ISO_TIMESTAMP,
  SAFE_ID,
} from "./collection-orchestrator-constants";
import {
  StoreCollectionOrchestratorError,
  type StoreCollectionOrchestratorFailureCode,
  type TransitionPhase,
  type StoreCollectionOrchestratorTransitionPurpose,
  type StoreCollectionOrchestratorTransitionPhase,
} from "./collection-orchestrator-contracts";

export function isCriticalSafetyError(error: unknown): boolean {
  return error instanceof StoreCollectionOrchestratorError
    && ['RUNTIME_CLOSE_FAILED', 'COLLECTION_LEASE_ACTIVE', 'SAFETY_STATE_UNKNOWN',
      'PERSISTENCE_PROTECTION_UNAVAILABLE', 'CORRUPT_PERSISTENCE'].includes(error.code);
}

export function isIdentityFailure(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return isIdentityFailureCode(code);
}

export function normalizeIdentityFailure(error: unknown): StoreCollectionOrchestratorFailureCode {
  const code = normalizeFailureCode(error, 'IDENTITY_UNVERIFIED');
  return isIdentityFailureCode(code) ? code : 'IDENTITY_UNVERIFIED';
}

export function normalizeFailureCode(
  error: unknown,
  fallback: StoreCollectionOrchestratorFailureCode,
): StoreCollectionOrchestratorFailureCode {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return isFailureCode(code) ? code : fallback;
}

export function isIdentityFailureCode(value: unknown): value is StoreCollectionOrchestratorFailureCode {
  return typeof value === 'string'
    && ['LOGIN_REQUIRED', 'REAUTH_REQUIRED', 'MFA_REQUIRED', 'IDENTITY_UNVERIFIED'].includes(value);
}

export function isFailureCode(value: unknown): value is StoreCollectionOrchestratorFailureCode {
  return typeof value === 'string' && [
    'APP_EXIT_INTERRUPTED', 'AUTOMATION_LEASE_UNAVAILABLE', 'COLLECTION_LEASE_ACTIVE',
    'CORRUPT_PERSISTENCE', 'IDENTITY_UNVERIFIED', 'LEASE_RELEASE_FAILED', 'LOGIN_REQUIRED',
    'MFA_REQUIRED', 'OPERATOR_STORE_RESTORE_FAILED', 'PERSISTENCE_PROTECTION_UNAVAILABLE',
    'REAUTH_REQUIRED', 'RUNTIME_CLOSE_FAILED', 'RUNTIME_START_FAILED', 'SAFETY_STATE_UNKNOWN',
    'SCHEDULE_PRECHECK_FAILED', 'SCHEDULER_FAILED', 'SCHEDULER_NOT_SUCCEEDED',
    'TRANSITION_FAILED', 'UNSUPPORTED_STORE',
  ].includes(value);
}

export function isTerminalPhase(phase: TransitionPhase): boolean {
  return phase === 'completed' || phase === 'blocked' || phase === 'failed' || phase === 'interrupted';
}

export function isStoreCollectionTransitionPhaseAllowed(
  purpose: StoreCollectionOrchestratorTransitionPurpose,
  previous: StoreCollectionOrchestratorTransitionPhase,
  next: StoreCollectionOrchestratorTransitionPhase,
): boolean {
  if (isTerminalPhase(previous)) return false;
  return TRANSITION_PHASE_EDGE_MATRIX[purpose][previous].includes(next);
}

export function validFingerprint(value: unknown): value is string {
  return typeof value === 'string' && DIGEST.test(value);
}

export function validIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && ISO_TIMESTAMP.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

export function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function combineFailures(primary: unknown, secondary: unknown): unknown {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const combined = secondary instanceof StoreCollectionOrchestratorError
    ? secondary
    : new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', '编排器发生多个安全故障。');
  (combined as StoreCollectionOrchestratorError & { cause?: unknown }).cause ??= primary;
  return combined;
}

export function corruptHistory(): StoreCollectionOrchestratorError {
  return new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '切换历史结构或关联无效。');
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
