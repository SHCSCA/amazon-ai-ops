import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionUserMutationScope,
  StoreCollectionMainRuntimeError,
  type StoreCollectionExistingResumeRequest,
  type StoreCollectionManualCyclePreMutationReason,
  type StoreCollectionMainOrchestratorPort,
} from "./collection-main-contracts";

export function normalizeUserMutationScope(
  input: StoreCollectionUserMutationScope,
): StoreCollectionUserMutationScope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new StoreCollectionMainRuntimeError(
      'INVALID_USER_MUTATION_SCOPE',
      'user Store mutation scope is required',
    );
  }
  const operation = safeIdentity(input.operation, 'operation');
  const targetStoreId = input.targetStoreId === undefined
    ? undefined
    : safeIdentity(input.targetStoreId, 'targetStoreId');
  return Object.freeze({
    operation,
    ...(targetStoreId ? { targetStoreId } : {}),
  });
}

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null)
    && typeof Reflect.get(value, 'then') === 'function';
}

export function normalizeExistingResumeRequest(
  input: StoreCollectionExistingResumeRequest,
): StoreCollectionExistingResumeRequest {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('resume request is required');
    }
    const context = normalizeStoreContextEnvelope(input.context);
    assertUsContext(context);
    const jobId = exactResumeIdentity(input.jobId, 'jobId');
    const requestId = exactResumeIdentity(input.requestId, 'requestId');
    const dateStart = exactIsoDate(input.dateStart, 'dateStart');
    const dateEnd = exactIsoDate(input.dateEnd, 'dateEnd');
    if (dateStart > dateEnd) throw new TypeError('resume date window is reversed');
    const expectedJobUpdatedAt = exactUtcInstant(
      input.expectedJobUpdatedAt,
      'expectedJobUpdatedAt',
    );
    if (typeof input.expectedAuthorityProofSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(input.expectedAuthorityProofSha256)) {
      throw new TypeError('expectedAuthorityProofSha256 must be one lowercase SHA-256 digest');
    }
    return Object.freeze({
      context: Object.freeze({ ...context }),
      jobId,
      requestId,
      dateStart,
      dateEnd,
      expectedJobUpdatedAt,
      expectedAuthorityProofSha256: input.expectedAuthorityProofSha256,
    });
  } catch (error) {
    if (error instanceof StoreCollectionMainRuntimeError
      && error.code === 'INVALID_RESUME_REQUEST') {
      throw error;
    }
    throw new StoreCollectionMainRuntimeError(
      'INVALID_RESUME_REQUEST',
      'existing collection resume requires one exact Store/job/request/window authority CAS',
      { cause: error },
    );
  }
}

export function exactResumeIdentity(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw new TypeError(`${field} must use 1-160 safe identity characters`);
  }
  return value;
}

export function exactIsoDate(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${field} must be one canonical ISO date`);
  }
  return value;
}

export function exactUtcInstant(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new TypeError(`${field} must be one canonical UTC instant`);
  }
  return value;
}

export function safeIdentity(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(value)) {
    throw new StoreCollectionMainRuntimeError(
      'INVALID_USER_MUTATION_SCOPE',
      `${field} must use 1-160 safe identity characters`,
    );
  }
  return value;
}

export function assertUsContext(context: StoreContextEnvelope): void {
  if (context.marketplace !== 'US'
    || context.currency !== 'USD'
    || context.businessTimezone !== 'America/Los_Angeles') {
    throw new TypeError('only exact US/USD/America/Los_Angeles context is supported');
  }
}

export function isManualPreMutationReason(
  value: unknown,
): value is StoreCollectionManualCyclePreMutationReason {
  return value === 'STALE_CONTEXT'
    || value === 'STORE_NOT_ACTIVE'
    || value === 'SESSION_GENERATION_MISMATCH'
    || value === 'MANUAL_COLLECTION_NOT_ADMITTED';
}

export function runtimeObject(value: unknown): value is Readonly<object> {
  return (typeof value === 'object' && value !== null)
    || typeof value === 'function';
}

export function assertOrchestratorPort(value: StoreCollectionMainOrchestratorPort): void {
  if (!value
    || typeof value.recoverExistingTransitionsOnly !== 'function'
    || typeof value.runScheduledCycle !== 'function'
    || typeof value.manualCycle !== 'function'
    || typeof value.resumeExisting !== 'function'
    || typeof value.stopAndDrain !== 'function'
    || typeof value.assertUserOperationAllowed !== 'function'
    || typeof value.isTransitionLocked !== 'function') {
    throw new StoreCollectionMainRuntimeError(
      'INVALID_RUNTIME_OPTIONS',
      'Main collection orchestrator port is incomplete',
    );
  }
}
