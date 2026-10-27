import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionOrchestratorCycleResult,
  type StoreCollectionOrchestratorTransition,
  type StoreCollectionOrchestratorOutcome,
  type StoreCollectionSchedulerExecutionIdentityInput,
  type StoreCollectionSchedulerExecutionIdentity,
  StoreCollectionOrchestratorError,
  type StoreCollectionTransitionCapabilityScope,
  type StoreCollectionSemanticAttempt,
} from "./collection-orchestrator-contracts";
import {
  canonicalTransitionScope,
} from "./collection-orchestrator-authority-values";
import {
  sha256,
  safeId,
  validFingerprint,
} from "./collection-orchestrator-failure-values";

export function emptyCycleResult(cycleId: string): StoreCollectionOrchestratorCycleResult {
  return {
    cycleId,
    state: 'completed',
    outcomes: [],
    skippedStoreIds: [],
    plannedDueStoreIds: [],
    attemptedStoreIds: [],
  };
}

export function storeCollectionOrchestratorTransitionIntegrityDigest(
  value: Omit<StoreCollectionOrchestratorTransition, 'integrityDigest'> & { integrityDigest?: string },
): string {
  return sha256({
    transitionId: value.transitionId,
    capabilityId: value.capabilityId,
    cycleId: value.cycleId,
    owner: value.owner,
    fromStoreId: value.fromStoreId,
    toStoreId: value.toStoreId,
    browserProfileId: value.browserProfileId,
    purpose: value.purpose,
    fromAuthority: value.fromAuthority,
    originAuthority: value.originAuthority,
    expectedFingerprint: value.expectedFingerprint ?? null,
    phase: value.phase,
    businessDate: value.businessDate ?? null,
    sessionGeneration: value.sessionGeneration ?? null,
    schedulerAttemptId: value.schedulerAttemptId ?? null,
    schedulerRequestId: value.schedulerRequestId ?? null,
    startedAt: value.startedAt,
    completedAt: value.completedAt ?? null,
    failureCode: value.failureCode ?? null,
  });
}

export function storeCollectionOrchestratorOutcomeIntegrityDigest(
  value: Omit<StoreCollectionOrchestratorOutcome, 'integrityDigest'> & { integrityDigest?: string },
): string {
  return sha256({
    outcomeId: value.outcomeId,
    cycleId: value.cycleId,
    transitionId: value.transitionId,
    owner: value.owner,
    storeId: value.storeId,
    browserProfileId: value.browserProfileId,
    businessDate: value.businessDate ?? null,
    sessionGeneration: value.sessionGeneration ?? null,
    fingerprint: value.fingerprint,
    attemptId: value.attemptId ?? null,
    requestId: value.requestId ?? null,
    schedulerSucceeded: value.schedulerSucceeded,
    cleanupStatus: value.cleanupStatus,
    state: value.state,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    failureCode: value.failureCode ?? null,
  });
}

export function deriveStoreCollectionSchedulerExecutionIdentity(
  input: StoreCollectionSchedulerExecutionIdentityInput,
): StoreCollectionSchedulerExecutionIdentity {
  const context = normalizeStoreContextEnvelope(input.context);
  const scope = input.transitionScope;
  if (!safeId(input.cycleId)
    || !safeId(input.transitionId)
    || !validFingerprint(input.fingerprint)
    || !scope
    || scope.cycleId !== input.cycleId
    || scope.transitionId !== input.transitionId
    || scope.capabilityDomain !== 'transition_execution'
    || scope.purpose !== 'collection'
    || scope.expectedFingerprint !== input.fingerprint
    || !safeId(scope.capabilityId)
    || !scope.target
    || scope.target.storeId !== context.storeId
    || scope.target.browserProfileId !== context.browserProfileId
    || scope.target.marketplace !== 'US'
    || scope.target.currency !== 'USD'
    || scope.target.businessTimezone !== 'America/Los_Angeles') {
    throw new StoreCollectionOrchestratorError(
      'SCHEDULER_NOT_SUCCEEDED',
      '无法从当前 transition capability scope 派生 scheduler execution identity。',
    );
  }
  const executionDigest = sha256({
    schemaVersion: 1,
    cycleId: input.cycleId,
    transitionId: input.transitionId,
    fingerprint: input.fingerprint,
    transitionScope: canonicalTransitionScope(scope),
    context,
  });
  return {
    attemptId: `sca:${executionDigest}`,
    requestId: `scr:${sha256({ schemaVersion: 1, executionDigest, kind: 'request' })}`,
  };
}

export function storeCollectionSchedulerRecoveryAdmissionScopeDigest(input: {
  executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
  context: StoreContextEnvelope;
  attemptId: string;
  requestId: string;
}): string {
  const context = normalizeStoreContextEnvelope(input.context);
  const identity = deriveStoreCollectionSchedulerExecutionIdentity({
    cycleId: input.executionScope.cycleId,
    transitionId: input.executionScope.transitionId,
    fingerprint: input.executionScope.expectedFingerprint ?? '',
    transitionScope: input.executionScope,
    context,
  });
  if (identity.attemptId !== input.attemptId || identity.requestId !== input.requestId) {
    throw new StoreCollectionOrchestratorError(
      'SAFETY_STATE_UNKNOWN',
      'recovery admission attempt/request 与 execution scope 不一致。',
    );
  }
  return sha256({
    schemaVersion: 1,
    kind: 'protected_scheduler_recovery_admission',
    executionScope: canonicalTransitionScope(input.executionScope),
    context,
    attemptId: input.attemptId,
    requestId: input.requestId,
  });
}

export function storeCollectionSemanticAttemptIntegrityDigest(
  value: Omit<StoreCollectionSemanticAttempt, 'integrityDigest'> & { integrityDigest?: string },
): string {
  return sha256({
    semanticAttemptId: value.semanticAttemptId,
    cycleId: value.cycleId,
    transitionId: value.transitionId,
    storeId: value.storeId,
    browserProfileId: value.browserProfileId,
    expectedFingerprint: value.expectedFingerprint,
    businessDate: value.businessDate,
    sessionGeneration: value.sessionGeneration,
    schedulerAttemptId: value.schedulerAttemptId,
    schedulerRequestId: value.schedulerRequestId,
    attemptedAt: value.attemptedAt,
  });
}

export function storeCollectionSemanticAttemptId(value: Pick<
  StoreCollectionSemanticAttempt,
  'cycleId' | 'transitionId' | 'schedulerAttemptId' | 'schedulerRequestId'
>): string {
  return `sam:${sha256({
    cycleId: value.cycleId,
    transitionId: value.transitionId,
    schedulerAttemptId: value.schedulerAttemptId,
    schedulerRequestId: value.schedulerRequestId,
  })}`;
}

export function withTransitionIntegrity(
  value: Omit<StoreCollectionOrchestratorTransition, 'integrityDigest'> & { integrityDigest?: string },
): StoreCollectionOrchestratorTransition {
  const { integrityDigest: _ignored, ...rest } = value;
  return { ...rest, integrityDigest: storeCollectionOrchestratorTransitionIntegrityDigest(rest) };
}

export function withOutcomeIntegrity(
  value: Omit<StoreCollectionOrchestratorOutcome, 'integrityDigest'> & { integrityDigest?: string },
): StoreCollectionOrchestratorOutcome {
  const { integrityDigest: _ignored, ...rest } = value;
  return { ...rest, integrityDigest: storeCollectionOrchestratorOutcomeIntegrityDigest(rest) };
}
