import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  LEGACY_HISTORY_SCHEMA_VERSION,
  HISTORY_SCHEMA_VERSION,
  STORE_COLLECTION_MAX_DAILY_SEMANTIC_ATTEMPTS_PER_STORE_PROFILE,
  DIGEST,
  TRANSITION_PHASE_FIELD_MATRIX,
} from "./collection-orchestrator-constants";
import {
  type StoreCollectionOrchestratorHistory,
  type LegacyStoreCollectionOrchestratorHistory,
  type StoreCollectionOrchestratorTransition,
  type StoreCollectionSemanticAttempt,
  type StoreCollectionAuthorityReadback,
  type StoreCollectionSchedulerExecutionIdentity,
  type TransitionFieldShape,
  type StoreCollectionOrchestratorOutcome,
} from "./collection-orchestrator-contracts";
import {
  storeCollectionSemanticAttemptId,
  storeCollectionSemanticAttemptIntegrityDigest,
  storeCollectionOrchestratorTransitionIntegrityDigest,
  deriveStoreCollectionSchedulerExecutionIdentity,
  storeCollectionOrchestratorOutcomeIntegrityDigest,
} from "./collection-orchestrator-integrity";
import {
  semanticAttemptFromTransition,
  compactSemanticAttemptsToLatestBusinessDate,
  isSchedulerNotCreatedSemanticAttempt,
  latestSemanticAttemptBusinessDate,
} from "./collection-orchestrator-semantic-values";
import {
  collectionAttemptSemanticKey,
  freezeTransitionScope,
  transitionScopeFromTransition,
} from "./collection-orchestrator-authority-values";
import {
  corruptHistory,
  isTerminalPhase,
  safeId,
  validFingerprint,
  validIsoDate,
  validTimestamp,
  isFailureCode,
} from "./collection-orchestrator-failure-values";

export function normalizeStoredHistory(value: unknown): StoreCollectionOrchestratorHistory {
  if (value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as { schemaVersion?: unknown }).schemaVersion === LEGACY_HISTORY_SCHEMA_VERSION) {
    const legacy = value as LegacyStoreCollectionOrchestratorHistory;
    assertExactKeys(legacy, ['schemaVersion', 'transitions', 'outcomes']);
    if (!Array.isArray(legacy.transitions) || !Array.isArray(legacy.outcomes)) {
      throw corruptHistory();
    }
    assertHistoryGraph(legacy);
    const semanticAttempts = legacy.transitions
      .filter((transition) => transition.purpose === 'collection'
        && transition.schedulerAttemptId !== undefined)
      .map((transition) => semanticAttemptFromTransition(transition));
    const upgraded: StoreCollectionOrchestratorHistory = {
      schemaVersion: HISTORY_SCHEMA_VERSION,
      transitions: legacy.transitions,
      outcomes: legacy.outcomes,
      semanticAttempts,
    };
    assertHistory(upgraded);
    const compacted = {
      ...upgraded,
      semanticAttempts: compactSemanticAttemptsToLatestBusinessDate(
        upgraded.semanticAttempts,
      ),
    };
    assertHistory(compacted);
    return compacted;
  }
  const history = value as StoreCollectionOrchestratorHistory;
  assertHistory(history);
  const compacted = {
    ...history,
    semanticAttempts: compactSemanticAttemptsToLatestBusinessDate(
      history.semanticAttempts,
    ),
  };
  assertHistory(compacted);
  return compacted;
}

export function assertHistory(value: StoreCollectionOrchestratorHistory): void {
  assertExactKeys(value, ['schemaVersion', 'transitions', 'outcomes', 'semanticAttempts']);
  if (value.schemaVersion !== HISTORY_SCHEMA_VERSION
    || !Array.isArray(value.transitions)
    || !Array.isArray(value.outcomes)
    || !Array.isArray(value.semanticAttempts)) {
    throw corruptHistory();
  }
  const transitions = assertHistoryGraph(value);
  const semanticKeys = new Set<string>();
  const semanticAttemptIds = new Set<string>();
  const semanticTransitionIds = new Set<string>();
  const schedulerAttemptIds = new Set<string>();
  const schedulerRequestIds = new Set<string>();
  const dailySemanticAttemptCounts = new Map<string, number>();
  for (const semanticAttempt of value.semanticAttempts) {
    assertSemanticAttempt(semanticAttempt);
    const semanticKey = collectionAttemptSemanticKey(semanticAttempt);
    const schedulerNotCreated = isSchedulerNotCreatedSemanticAttempt(value, semanticAttempt);
    const dailyKey = JSON.stringify([
      semanticAttempt.storeId,
      semanticAttempt.browserProfileId,
      semanticAttempt.businessDate,
    ]);
    const dailyCount = (dailySemanticAttemptCounts.get(dailyKey) ?? 0) + 1;
    if ((!schedulerNotCreated && semanticKeys.has(semanticKey))
      || semanticAttemptIds.has(semanticAttempt.semanticAttemptId)
      || semanticTransitionIds.has(semanticAttempt.transitionId)
      || schedulerAttemptIds.has(semanticAttempt.schedulerAttemptId)
      || schedulerRequestIds.has(semanticAttempt.schedulerRequestId)
      || dailyCount > STORE_COLLECTION_MAX_DAILY_SEMANTIC_ATTEMPTS_PER_STORE_PROFILE) {
      throw corruptHistory();
    }
    const transition = transitions.get(semanticAttempt.transitionId);
    if (transition && (
      transition.purpose !== 'collection'
      || transition.cycleId !== semanticAttempt.cycleId
      || transition.toStoreId !== semanticAttempt.storeId
      || transition.browserProfileId !== semanticAttempt.browserProfileId
      || transition.expectedFingerprint !== semanticAttempt.expectedFingerprint
      || transition.businessDate !== semanticAttempt.businessDate
      || transition.sessionGeneration !== semanticAttempt.sessionGeneration
      || transition.schedulerAttemptId !== semanticAttempt.schedulerAttemptId
      || transition.schedulerRequestId !== semanticAttempt.schedulerRequestId
      || transition.startedAt !== semanticAttempt.attemptedAt
    )) {
      throw corruptHistory();
    }
    if (!schedulerNotCreated) semanticKeys.add(semanticKey);
    semanticAttemptIds.add(semanticAttempt.semanticAttemptId);
    semanticTransitionIds.add(semanticAttempt.transitionId);
    schedulerAttemptIds.add(semanticAttempt.schedulerAttemptId);
    schedulerRequestIds.add(semanticAttempt.schedulerRequestId);
    dailySemanticAttemptCounts.set(dailyKey, dailyCount);
  }
  for (const transition of value.transitions) {
    if (transition.purpose === 'collection'
      && transition.schedulerAttemptId !== undefined
      && !semanticTransitionIds.has(transition.transitionId)) {
      const latestProtectedBusinessDate = latestSemanticAttemptBusinessDate(
        value.semanticAttempts,
        transition.toStoreId!,
        transition.browserProfileId!,
      );
      if (latestProtectedBusinessDate === undefined
        || transition.businessDate === undefined
        || transition.businessDate >= latestProtectedBusinessDate) {
        throw corruptHistory();
      }
    }
  }
}

export function assertHistoryGraph(
  value: Pick<StoreCollectionOrchestratorHistory, 'transitions' | 'outcomes'>,
): Map<string, StoreCollectionOrchestratorTransition> {
  const transitions = new Map<string, StoreCollectionOrchestratorTransition>();
  const capabilityIds = new Set<string>();
  for (const transition of value.transitions) {
    assertTransition(transition);
    if (transitions.has(transition.transitionId) || capabilityIds.has(transition.capabilityId)) {
      throw corruptHistory();
    }
    transitions.set(transition.transitionId, transition);
    capabilityIds.add(transition.capabilityId);
  }
  const outcomeIds = new Set<string>();
  const outcomeTransitionIds = new Set<string>();
  const attemptIds = new Set<string>();
  const requestIds = new Set<string>();
  for (const outcome of value.outcomes) {
    assertOutcome(outcome);
    const transition = transitions.get(outcome.transitionId);
    if (!transition
      || outcomeIds.has(outcome.outcomeId)
      || outcomeTransitionIds.has(outcome.transitionId)
      || transition.purpose !== 'collection'
      || outcome.cycleId !== transition.cycleId
      || outcome.owner !== transition.owner
      || outcome.storeId !== transition.toStoreId
      || outcome.browserProfileId !== transition.browserProfileId
      || outcome.fingerprint !== transition.expectedFingerprint
      || outcome.attemptId !== transition.schedulerAttemptId
      || outcome.requestId !== transition.schedulerRequestId
      || outcome.businessDate !== transition.businessDate
      || outcome.sessionGeneration !== transition.sessionGeneration
      || outcome.startedAt !== transition.startedAt
      || outcome.completedAt !== transition.completedAt
      || outcome.failureCode !== transition.failureCode
      || (outcome.state === 'succeeded' && transition.phase !== 'completed')
      || (outcome.state === 'blocked' && transition.phase !== 'blocked')
      || (outcome.state === 'failed' && transition.phase !== 'failed' && transition.phase !== 'interrupted')) {
      throw corruptHistory();
    }
    if ((outcome.attemptId && attemptIds.has(outcome.attemptId))
      || (outcome.requestId && requestIds.has(outcome.requestId))) {
      throw corruptHistory();
    }
    if (outcome.attemptId) attemptIds.add(outcome.attemptId);
    if (outcome.requestId) requestIds.add(outcome.requestId);
    outcomeIds.add(outcome.outcomeId);
    outcomeTransitionIds.add(outcome.transitionId);
  }
  for (const transition of value.transitions) {
    if (!isTerminalPhase(transition.phase)) continue;
    const hasOutcome = outcomeTransitionIds.has(transition.transitionId);
    if ((transition.purpose === 'collection' && !hasOutcome)
      || (transition.purpose === 'restore' && hasOutcome)) {
      throw corruptHistory();
    }
  }
  return transitions;
}

export function assertSemanticAttempt(value: StoreCollectionSemanticAttempt): void {
  assertExactKeys(value, [
    'semanticAttemptId', 'cycleId', 'transitionId', 'storeId', 'browserProfileId',
    'expectedFingerprint', 'businessDate', 'sessionGeneration', 'schedulerAttemptId',
    'schedulerRequestId', 'attemptedAt', 'integrityDigest',
  ]);
  if (!safeId(value.semanticAttemptId)
    || !safeId(value.cycleId)
    || !safeId(value.transitionId)
    || !safeId(value.storeId)
    || !safeId(value.browserProfileId)
    || !validFingerprint(value.expectedFingerprint)
    || !validIsoDate(value.businessDate)
    || !Number.isInteger(value.sessionGeneration)
    || value.sessionGeneration < 0
    || !safeId(value.schedulerAttemptId)
    || !safeId(value.schedulerRequestId)
    || !validTimestamp(value.attemptedAt)
    || value.semanticAttemptId !== storeCollectionSemanticAttemptId(value)
    || !DIGEST.test(value.integrityDigest)
    || value.integrityDigest !== storeCollectionSemanticAttemptIntegrityDigest(value)) {
    throw corruptHistory();
  }
}

export function assertAuthoritySnapshot(value: StoreCollectionAuthorityReadback): void {
  assertExactKeys(value, ['activeStoreId', 'context']);
  if (value.activeStoreId === null) {
    if (value.context !== null) throw corruptHistory();
    return;
  }
  if (!safeId(value.activeStoreId) || !value.context) throw corruptHistory();
  assertExactKeys(value.context, [
    'storeId', 'browserProfileId', 'marketplace', 'currency', 'businessTimezone',
    'businessDate', 'sessionGeneration',
  ]);
  let context: StoreContextEnvelope;
  try {
    context = normalizeStoreContextEnvelope(value.context);
  } catch {
    throw corruptHistory();
  }
  if (context.storeId !== value.activeStoreId
    || context.marketplace !== 'US'
    || context.currency !== 'USD'
    || context.businessTimezone !== 'America/Los_Angeles') {
    throw corruptHistory();
  }
}

export function assertTransition(value: StoreCollectionOrchestratorTransition): void {
  const optionalKeys = [
    'expectedFingerprint', 'businessDate', 'sessionGeneration', 'schedulerAttemptId', 'schedulerRequestId',
    'completedAt', 'failureCode',
  ];
  assertExactKeys(value, [
    'transitionId', 'capabilityId', 'cycleId', 'owner', 'fromStoreId', 'toStoreId',
    'browserProfileId', 'purpose', 'fromAuthority', 'originAuthority', 'phase', 'startedAt',
    'integrityDigest', ...optionalKeys,
  ], optionalKeys);
  assertAuthoritySnapshot(value.fromAuthority);
  assertAuthoritySnapshot(value.originAuthority);
  if (!safeId(value.transitionId)
    || !safeId(value.capabilityId)
    || !safeId(value.cycleId)
    || !safeId(value.owner)
    || (value.fromStoreId !== null && !safeId(value.fromStoreId))
    || value.fromStoreId !== value.fromAuthority.activeStoreId
    || (value.toStoreId !== null && !safeId(value.toStoreId))
    || (value.browserProfileId !== null && !safeId(value.browserProfileId))
    || (value.purpose !== 'collection' && value.purpose !== 'restore')
    || (value.purpose === 'collection' && (value.toStoreId === null || value.browserProfileId === null))
    || ((value.toStoreId === null) !== (value.browserProfileId === null))
    || (value.purpose === 'collection' && !validFingerprint(value.expectedFingerprint))
    || (value.purpose === 'restore' && value.expectedFingerprint !== undefined)
    || !['claimed', 'authority_touch_pending', 'previous_closed', 'activated', 'runtime_started', 'identity_verified',
      'scheduler_request_bound', 'scheduler_accepted', 'scheduler_reconciled',
      'cleanup_pending', 'completed', 'blocked', 'failed', 'interrupted'].includes(value.phase)
    || !validTimestamp(value.startedAt)
    || (value.completedAt !== undefined && !validTimestamp(value.completedAt))
    || (value.completedAt !== undefined && Date.parse(value.completedAt) < Date.parse(value.startedAt))
    || (value.sessionGeneration !== undefined
      && (!Number.isInteger(value.sessionGeneration) || value.sessionGeneration < 0))
    || (value.businessDate !== undefined && !validIsoDate(value.businessDate))
    || ((value.businessDate === undefined) !== (value.sessionGeneration === undefined))
    || ((value.schedulerAttemptId === undefined) !== (value.schedulerRequestId === undefined))
    || (value.schedulerAttemptId !== undefined && !safeId(value.schedulerAttemptId))
    || (value.schedulerRequestId !== undefined && !safeId(value.schedulerRequestId))
    || (value.failureCode !== undefined && !isFailureCode(value.failureCode))
    || !DIGEST.test(value.integrityDigest)
    || value.integrityDigest !== storeCollectionOrchestratorTransitionIntegrityDigest(value)
    || (isTerminalPhase(value.phase) !== (value.completedAt !== undefined))
    || (value.phase === 'completed' && value.failureCode !== undefined)
    || (isTerminalPhase(value.phase) && value.phase !== 'completed' && value.failureCode === undefined)
    || (!isTerminalPhase(value.phase) && value.failureCode !== undefined)
    || !storeCollectionTransitionPhaseFieldsValid(value)) {
    throw corruptHistory();
  }
  if (value.schedulerAttemptId && value.schedulerRequestId) {
    if (!value.businessDate
      || value.sessionGeneration === undefined
      || !value.expectedFingerprint
      || !value.toStoreId
      || !value.browserProfileId) {
      throw corruptHistory();
    }
    let identity: StoreCollectionSchedulerExecutionIdentity;
    try {
      identity = deriveStoreCollectionSchedulerExecutionIdentity({
        cycleId: value.cycleId,
        transitionId: value.transitionId,
        fingerprint: value.expectedFingerprint,
        transitionScope: freezeTransitionScope(
          transitionScopeFromTransition(value, 'transition_execution'),
        ),
        context: normalizeStoreContextEnvelope({
          storeId: value.toStoreId,
          browserProfileId: value.browserProfileId,
          marketplace: 'US',
          currency: 'USD',
          businessTimezone: 'America/Los_Angeles',
          businessDate: value.businessDate,
          sessionGeneration: value.sessionGeneration,
        }),
      });
    } catch {
      throw corruptHistory();
    }
    if (identity.attemptId !== value.schedulerAttemptId
      || identity.requestId !== value.schedulerRequestId) {
      throw corruptHistory();
    }
  }
}

export function storeCollectionTransitionPhaseFieldsValid(
  value: StoreCollectionOrchestratorTransition,
): boolean {
  const hasContext = value.businessDate !== undefined && value.sessionGeneration !== undefined;
  const hasScheduler = value.schedulerAttemptId !== undefined && value.schedulerRequestId !== undefined;
  if (hasScheduler && !hasContext) return false;
  if (value.purpose === 'restore' && value.toStoreId === null && hasContext) return false;
  const shape: TransitionFieldShape = hasScheduler
    ? 'scheduler'
    : hasContext
      ? 'context'
      : 'none';
  if (value.purpose === 'restore'
    && (value.phase === 'activated'
      || value.phase === 'cleanup_pending'
      || value.phase === 'completed')) {
    return shape === (value.toStoreId === null ? 'none' : 'context');
  }
  return TRANSITION_PHASE_FIELD_MATRIX[value.purpose][value.phase].includes(shape);
}

export function assertOutcome(value: StoreCollectionOrchestratorOutcome): void {
  const optionalKeys = ['businessDate', 'sessionGeneration', 'attemptId', 'requestId', 'failureCode'];
  assertExactKeys(value, [
    'outcomeId', 'cycleId', 'transitionId', 'owner', 'storeId', 'browserProfileId',
    'fingerprint', 'schedulerSucceeded', 'cleanupStatus', 'state', 'startedAt', 'completedAt',
    'integrityDigest', ...optionalKeys,
  ], optionalKeys);
  const hasExecutionIdentity = safeId(value.attemptId)
    && safeId(value.requestId)
    && validIsoDate(value.businessDate)
    && Number.isInteger(value.sessionGeneration)
    && (value.sessionGeneration ?? -1) >= 0;
  if (!safeId(value.outcomeId)
    || !safeId(value.cycleId)
    || !safeId(value.transitionId)
    || !safeId(value.owner)
    || !safeId(value.storeId)
    || !safeId(value.browserProfileId)
    || !validFingerprint(value.fingerprint)
    || typeof value.schedulerSucceeded !== 'boolean'
    || (value.cleanupStatus !== 'confirmed' && value.cleanupStatus !== 'unknown')
    || !['succeeded', 'blocked', 'failed'].includes(value.state)
    || (value.businessDate !== undefined && !validIsoDate(value.businessDate))
    || (value.sessionGeneration !== undefined
      && (!Number.isInteger(value.sessionGeneration) || value.sessionGeneration < 0))
    || !validTimestamp(value.startedAt)
    || !validTimestamp(value.completedAt)
    || Date.parse(value.completedAt) < Date.parse(value.startedAt)
    || (value.failureCode !== undefined && !isFailureCode(value.failureCode))
    || !DIGEST.test(value.integrityDigest)
    || value.integrityDigest !== storeCollectionOrchestratorOutcomeIntegrityDigest(value)
    || ((value.attemptId === undefined) !== (value.requestId === undefined))
    || (value.schedulerSucceeded && !hasExecutionIdentity)
    || (value.attemptId !== undefined && !hasExecutionIdentity)
    || (value.state === 'succeeded'
      && (!value.schedulerSucceeded || value.cleanupStatus !== 'confirmed' || value.failureCode !== undefined))
    || (value.state !== 'succeeded' && value.failureCode === undefined)
    || (value.state === 'blocked' && (value.schedulerSucceeded || value.attemptId !== undefined))
    || (value.cleanupStatus === 'unknown' && !isCleanupProofFailureCode(value.failureCode))) {
    throw corruptHistory();
  }
}

export function isCleanupProofFailureCode(value: unknown): boolean {
  return value === 'SAFETY_STATE_UNKNOWN'
    || value === 'RUNTIME_CLOSE_FAILED'
    || value === 'COLLECTION_LEASE_ACTIVE'
    || value === 'OPERATOR_STORE_RESTORE_FAILED';
}

export function assertExactKeys(
  value: unknown,
  allowed: readonly string[],
  optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw corruptHistory();
  const keys = Object.keys(value);
  const allowedSet = new Set(allowed);
  if (keys.some((key) => !allowedSet.has(key))) throw corruptHistory();
  const optionalSet = new Set(optional);
  if (allowed.some((key) => !optionalSet.has(key) && !Object.prototype.hasOwnProperty.call(value, key))) {
    throw corruptHistory();
  }
}
