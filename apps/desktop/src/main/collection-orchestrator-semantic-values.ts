import {
  type BrowserProfileId,
  type StoreId,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionOrchestratorTransition,
  type StoreCollectionSemanticAttempt,
  type StoreCollectionOrchestratorHistory,
} from "./collection-orchestrator-contracts";
import {
  storeCollectionSemanticAttemptId,
  storeCollectionSemanticAttemptIntegrityDigest,
} from "./collection-orchestrator-integrity";
import {
  corruptHistory,
} from "./collection-orchestrator-failure-values";

export function semanticAttemptFromTransition(
  transition: StoreCollectionOrchestratorTransition,
): StoreCollectionSemanticAttempt {
  if (transition.purpose !== 'collection'
    || !transition.toStoreId
    || !transition.browserProfileId
    || !transition.expectedFingerprint
    || !transition.businessDate
    || transition.sessionGeneration === undefined
    || !transition.schedulerAttemptId
    || !transition.schedulerRequestId) {
    throw corruptHistory();
  }
  const semanticAttemptId = storeCollectionSemanticAttemptId({
    cycleId: transition.cycleId,
    transitionId: transition.transitionId,
    schedulerAttemptId: transition.schedulerAttemptId,
    schedulerRequestId: transition.schedulerRequestId,
  });
  const value = {
    semanticAttemptId,
    cycleId: transition.cycleId,
    transitionId: transition.transitionId,
    storeId: transition.toStoreId,
    browserProfileId: transition.browserProfileId,
    expectedFingerprint: transition.expectedFingerprint,
    businessDate: transition.businessDate,
    sessionGeneration: transition.sessionGeneration,
    schedulerAttemptId: transition.schedulerAttemptId,
    schedulerRequestId: transition.schedulerRequestId,
    attemptedAt: transition.startedAt,
  };
  return {
    ...value,
    integrityDigest: storeCollectionSemanticAttemptIntegrityDigest(value),
  };
}

export function isSchedulerNotCreatedSemanticAttempt(
  history: Pick<StoreCollectionOrchestratorHistory, 'transitions' | 'outcomes'>,
  semanticAttempt: StoreCollectionSemanticAttempt,
): boolean {
  const transition = history.transitions.find((candidate) => (
    candidate.transitionId === semanticAttempt.transitionId
  ));
  const outcome = history.outcomes.find((candidate) => (
    candidate.transitionId === semanticAttempt.transitionId
  ));
  return transition?.purpose === 'collection'
    && transition.phase === 'failed'
    && transition.failureCode === 'SCHEDULER_NOT_SUCCEEDED'
    && outcome?.state === 'failed'
    && outcome.failureCode === 'SCHEDULER_NOT_SUCCEEDED'
    && outcome.schedulerSucceeded === false
    && outcome.cleanupStatus === 'confirmed';
}

export function compactSemanticAttemptsToLatestBusinessDate(
  attempts: readonly StoreCollectionSemanticAttempt[],
): StoreCollectionSemanticAttempt[] {
  const latestBusinessDateByStoreProfile = new Map<string, string>();
  for (const attempt of attempts) {
    const storeProfileKey = JSON.stringify([attempt.storeId, attempt.browserProfileId]);
    const latest = latestBusinessDateByStoreProfile.get(storeProfileKey);
    if (latest === undefined || attempt.businessDate > latest) {
      latestBusinessDateByStoreProfile.set(storeProfileKey, attempt.businessDate);
    }
  }
  return attempts.filter((attempt) => (
    attempt.businessDate === latestBusinessDateByStoreProfile.get(
      JSON.stringify([attempt.storeId, attempt.browserProfileId]),
    )
  ));
}

export function latestSemanticAttemptBusinessDate(
  attempts: readonly StoreCollectionSemanticAttempt[],
  storeId: StoreId,
  browserProfileId: BrowserProfileId,
): string | undefined {
  return attempts
    .filter((attempt) => (
      attempt.storeId === storeId
      && attempt.browserProfileId === browserProfileId
    ))
    .reduce<string | undefined>((latest, attempt) => (
      latest === undefined || attempt.businessDate > latest
        ? attempt.businessDate
        : latest
    ), undefined);
}

export function isSchedulerBoundPendingTransition(
  transition: StoreCollectionOrchestratorTransition,
): boolean {
  return transition.purpose === 'collection'
    && transition.schedulerAttemptId !== undefined
    && transition.schedulerRequestId !== undefined
    && (
      transition.phase === 'scheduler_request_bound'
      || transition.phase === 'scheduler_accepted'
      || transition.phase === 'scheduler_reconciled'
      || transition.phase === 'cleanup_pending'
    );
}

export function isUnreconciledSchedulerPending(
  transition: StoreCollectionOrchestratorTransition,
): boolean {
  return transition.purpose === 'collection'
    && (transition.phase === 'scheduler_request_bound'
      || transition.phase === 'scheduler_accepted');
}

export function hasDurableSchedulerSuccess(
  transition: StoreCollectionOrchestratorTransition,
): boolean {
  return transition.purpose === 'collection'
    && transition.schedulerAttemptId !== undefined
    && transition.schedulerRequestId !== undefined
    && (transition.phase === 'scheduler_reconciled'
      || transition.phase === 'cleanup_pending');
}
