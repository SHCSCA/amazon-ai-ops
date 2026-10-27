import {
  randomUUID,
} from 'node:crypto';
import {
  DEFAULT_HISTORY_RETENTION_LIMIT,
  DEFAULT_POLL_INTERVAL_MS,
} from "./collection-orchestrator-constants";
import {
  type StoreCollectionOrchestratorDependencies,
  type StoreCollectionOrchestratorCycleResult,
  type StoreCollectionOrchestratorCycleMode,
  type CapabilityIdentityRecord,
  type VisibleRuntimeIntentRecord,
} from "./collection-orchestrator-contracts";
import {
  start,
  stop,
  stopAndDrain,
  isTransitionLocked,
  assertUserOperationAllowed,
  readProtectedSemanticAttempt,
  runCycle,
  recoverExistingTransitionsOnly,
  runStoreNow,
  startCycle,
  assertCanStart,
  throwIfStopping,
  markSafetyUnknown,
  safetyError,
  reportError,
} from "./collection-orchestrator-lifecycle";
import {
  executeCycle,
} from "./collection-orchestrator-cycle-execution";
import {
  runStore,
} from "./collection-orchestrator-store-execution";
import {
  restoreOperatorStore,
  closeAndConfirm,
} from "./collection-orchestrator-restore";
import {
  visibleRuntimeIntent,
  registerCapabilityIdentity,
  hasRegisteredCapabilityIdentity,
  assertCapabilityIdentity,
  setCapabilityLifecycle,
  deriveTransitionAuthority,
  assertFreshAutomationLease,
  releaseMalformedAutomationLease,
  releaseAutomationLease,
  acquirePolicySuppression,
  assertPolicySuppressed,
  releasePolicySuppression,
} from "./collection-orchestrator-capability-lifecycle";
import {
  readAuthority,
  readTransitionAuthority,
  assertAuthorityWithinTransitionScope,
  validateTransitionReceipt,
  validateConfirmation,
  assertAuthority,
  assertAuthorityExact,
  assertCapabilityBound,
  assertTransitionCapabilityBound,
} from "./collection-orchestrator-authority-checks";
import {
  validateSchedulerAccepted,
  validateSchedulerRecovery,
  validateSchedulerProjectionBinding,
  registerProtectedSchedulerRecoveryAdmission,
  recoverPendingTransitions,
  finalizeRecoveredSchedulerTransition,
  commonRecoveryOrigin,
} from "./collection-orchestrator-scheduler-recovery";
import {
  assertAuthorityAgainstActiveStoreSnapshot,
  stableActiveStoreSnapshot,
  exactActiveManualStore,
  assertManualContextCurrent,
  stableManualStoreSnapshot,
  stableDueStoreSnapshot,
} from "./collection-orchestrator-store-snapshots";
import {
  newTransition,
  appendTransition,
  updateTransition,
  completeCollectionTransition,
  readPendingTransitions,
  readProtectedHistorySnapshot,
  attemptedCollectionSemanticKeys,
  interruptTransitions,
  mutateHistory,
  readHistoryFromEnvelope,
  writeHistory,
  compactHistory,
  assertPersistenceProtectionAvailable,
} from "./collection-orchestrator-history-runtime";

export class StoreCollectionOrchestratorRuntime {
  readonly now: () => Date;
  readonly createCycleId: () => string;
  readonly historyRetentionLimit: number;
  readonly pollIntervalMs: number;
  readonly createInterval: NonNullable<StoreCollectionOrchestratorDependencies['setInterval']>;
  readonly cancelInterval: NonNullable<StoreCollectionOrchestratorDependencies['clearInterval']>;
  timer: ReturnType<typeof setInterval> | null = null;
  cycle: Promise<StoreCollectionOrchestratorCycleResult> | null = null;
  cycleMode: StoreCollectionOrchestratorCycleMode | null = null;
  cycleManualKey: string | null = null;
  transitionLocked = false;
  stopRequested = false;
  drainRequested = false;
  safetyStateUnknown = false;
  readonly capabilityIdentityRegistry = new WeakMap<object, CapabilityIdentityRecord>();
  readonly issuedTransitionCapabilityIds = new Set<string>();
  readonly visibleRuntimeIntents = new WeakMap<object, VisibleRuntimeIntentRecord>();
  start = start;
  stop = stop;
  stopAndDrain = stopAndDrain;
  isTransitionLocked = isTransitionLocked;
  assertUserOperationAllowed = assertUserOperationAllowed;
  readProtectedSemanticAttempt = readProtectedSemanticAttempt;
  runCycle = runCycle;
  recoverExistingTransitionsOnly = recoverExistingTransitionsOnly;
  runStoreNow = runStoreNow;
  startCycle = startCycle;
  assertCanStart = assertCanStart;
  executeCycle = executeCycle;
  runStore = runStore;
  restoreOperatorStore = restoreOperatorStore;
  closeAndConfirm = closeAndConfirm;
  visibleRuntimeIntent = visibleRuntimeIntent;
  readAuthority = readAuthority;
  readTransitionAuthority = readTransitionAuthority;
  assertAuthorityWithinTransitionScope = assertAuthorityWithinTransitionScope;
  validateTransitionReceipt = validateTransitionReceipt;
  validateConfirmation = validateConfirmation;
  validateSchedulerAccepted = validateSchedulerAccepted;
  validateSchedulerRecovery = validateSchedulerRecovery;
  validateSchedulerProjectionBinding = validateSchedulerProjectionBinding;
  assertAuthority = assertAuthority;
  assertAuthorityExact = assertAuthorityExact;
  assertCapabilityBound = assertCapabilityBound;
  assertTransitionCapabilityBound = assertTransitionCapabilityBound;
  registerCapabilityIdentity = registerCapabilityIdentity;
  hasRegisteredCapabilityIdentity = hasRegisteredCapabilityIdentity;
  assertCapabilityIdentity = assertCapabilityIdentity;
  setCapabilityLifecycle = setCapabilityLifecycle;
  registerProtectedSchedulerRecoveryAdmission = registerProtectedSchedulerRecoveryAdmission;
  deriveTransitionAuthority = deriveTransitionAuthority;
  assertFreshAutomationLease = assertFreshAutomationLease;
  releaseMalformedAutomationLease = releaseMalformedAutomationLease;
  releaseAutomationLease = releaseAutomationLease;
  acquirePolicySuppression = acquirePolicySuppression;
  assertPolicySuppressed = assertPolicySuppressed;
  releasePolicySuppression = releasePolicySuppression;
  throwIfStopping = throwIfStopping;
  assertAuthorityAgainstActiveStoreSnapshot = assertAuthorityAgainstActiveStoreSnapshot;
  stableActiveStoreSnapshot = stableActiveStoreSnapshot;
  exactActiveManualStore = exactActiveManualStore;
  assertManualContextCurrent = assertManualContextCurrent;
  stableManualStoreSnapshot = stableManualStoreSnapshot;
  stableDueStoreSnapshot = stableDueStoreSnapshot;
  newTransition = newTransition;
  appendTransition = appendTransition;
  updateTransition = updateTransition;
  completeCollectionTransition = completeCollectionTransition;
  readPendingTransitions = readPendingTransitions;
  readProtectedHistorySnapshot = readProtectedHistorySnapshot;
  attemptedCollectionSemanticKeys = attemptedCollectionSemanticKeys;
  recoverPendingTransitions = recoverPendingTransitions;
  finalizeRecoveredSchedulerTransition = finalizeRecoveredSchedulerTransition;
  commonRecoveryOrigin = commonRecoveryOrigin;
  interruptTransitions = interruptTransitions;
  mutateHistory = mutateHistory;
  readHistoryFromEnvelope = readHistoryFromEnvelope;
  writeHistory = writeHistory;
  compactHistory = compactHistory;
  assertPersistenceProtectionAvailable = assertPersistenceProtectionAvailable;
  markSafetyUnknown = markSafetyUnknown;
  safetyError = safetyError;
  reportError = reportError;

  constructor(readonly dependencies: StoreCollectionOrchestratorDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.createCycleId = dependencies.createCycleId ?? (() => randomUUID());
    this.historyRetentionLimit = dependencies.historyRetentionLimit ?? DEFAULT_HISTORY_RETENTION_LIMIT;
    this.pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.createInterval = dependencies.setInterval ?? ((callback, milliseconds) => setInterval(callback, milliseconds));
    this.cancelInterval = dependencies.clearInterval ?? ((timer) => clearInterval(timer));
    if (!Number.isInteger(this.historyRetentionLimit) || this.historyRetentionLimit < 1) {
      throw new RangeError('store collection orchestrator history retention limit must be at least 1');
    }
    if (!Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 1_000) {
      throw new RangeError('store collection orchestrator poll interval must be at least 1000ms');
    }
  }
}
