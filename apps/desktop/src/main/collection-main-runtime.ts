import {
  StoreCollectionPolicySuppressionController,
} from './store-collection-policy-suppression';
import {
  StoreMutationLane,
  VisibleBrowserRuntimeRegistry,
  type StoreMutationLaneClaim,
} from './visible-browser-runtime-registry';
import {
  type StoreCollectionMainOrchestratorPort,
  type MainRuntimeTimerPort,
  type StoreCollectionMainRuntimeLifecycle,
  type StoreCollectionActiveLaneOperation,
  type StoreCollectionMainDrainProof,
  type StoreCollectionManualCycleAdmission,
  type StoreCollectionMainRuntimeOptions,
  StoreCollectionMainRuntimeError,
} from "./collection-main-contracts";
import {
  assertOrchestratorPort,
} from "./collection-main-request-values";
import {
  recoverStartupThenConfirm,
  start,
  isPolicyDispatchSuppressed,
  readStatus,
  invokeScheduledCycle,
  assertWritableMode,
  assertAutomationReady,
  assertSafetyKnown,
  markStickyUnknown,
  clearAutomationTimer,
  safeTransitionLocked,
} from "./collection-main-lifecycle";
import {
  runNow,
  resumeExisting,
  assertUserOperationAllowed,
  withUserStoreMutation,
  withPackageUiSetupMutation,
  issueManualCycleAdmission,
  validateManualCycleOutcome,
  registerRuntimeCapability,
} from "./collection-main-user-admission";
import {
  cancelCollection,
  performIdleCollectionCancellation,
  failActiveCancellation,
  rejectCancellationAfterClear,
  clearCancellationSignalSafely,
} from "./collection-main-cancellation";
import {
  stopAndDrain,
  closeRegistry,
  performStopAndDrain,
  acceptsGracefulShutdownStop,
  performRegistryClose,
  claimExactShutdownLane,
  assertExactShutdownLaneHeld,
  requireCycleSettlement,
} from "./collection-main-shutdown";
import {
  withMutationLane,
  performMutationLaneWork,
} from "./collection-main-mutation-lane";

export class CollectionMainRuntimeContext {
  readonly registry: VisibleBrowserRuntimeRegistry;
  readonly mutationLane: StoreMutationLane;
  readonly policySuppression: StoreCollectionPolicySuppressionController;
  readonly orchestrator: StoreCollectionMainOrchestratorPort;
  readonly packageUiReadOnly: boolean;
  readonly createAuthorityCapability: () => Readonly<object>;
  readonly createManualCycleAdmissionCapability: () => Readonly<object>;
  readonly pollIntervalMs: number;
  readonly timer: MainRuntimeTimerPort;
  readonly reportError: (error: unknown) => void;
  timerHandle: unknown;
  timerRegistered = false;
  lifecycle: StoreCollectionMainRuntimeLifecycle = 'startup_unknown';
  startupRecoveryAttempted = false;
  startupRecoveryConfirmed = false;
  automationStarted = false;
  drainProven = false;
  registryClosed = false;
  readonly activeLaneOperations = new Set<Promise<unknown>>();
  activeLaneOperation: StoreCollectionActiveLaneOperation | null = null;
  shutdownOperation: Promise<void> | null = null;
  registryCloseOperation: Promise<void> | null = null;
  drainInProgress = false;
  drainProof: StoreCollectionMainDrainProof | null = null;
  shutdownLaneClaim: StoreMutationLaneClaim | null = null;
  readonly issuedCapabilities = new WeakSet<object>();
  readonly manualCycleAdmissions = new WeakMap<object, {
    admission: StoreCollectionManualCycleAdmission;
    consumed: boolean;
  }>();
  recoverStartupThenConfirm = recoverStartupThenConfirm;
  runNow = runNow;
  resumeExisting = resumeExisting;
  cancelCollection = cancelCollection;
  start = start;
  assertUserOperationAllowed = assertUserOperationAllowed;
  withUserStoreMutation = withUserStoreMutation;
  withPackageUiSetupMutation = withPackageUiSetupMutation;
  stopAndDrain = stopAndDrain;
  closeRegistry = closeRegistry;
  isPolicyDispatchSuppressed = isPolicyDispatchSuppressed;
  readStatus = readStatus;
  withMutationLane = withMutationLane;
  performMutationLaneWork = performMutationLaneWork;
  performIdleCollectionCancellation = performIdleCollectionCancellation;
  failActiveCancellation = failActiveCancellation;
  rejectCancellationAfterClear = rejectCancellationAfterClear;
  clearCancellationSignalSafely = clearCancellationSignalSafely;
  issueManualCycleAdmission = issueManualCycleAdmission;
  validateManualCycleOutcome = validateManualCycleOutcome;
  registerRuntimeCapability = registerRuntimeCapability;
  performStopAndDrain = performStopAndDrain;
  acceptsGracefulShutdownStop = acceptsGracefulShutdownStop;
  performRegistryClose = performRegistryClose;
  claimExactShutdownLane = claimExactShutdownLane;
  assertExactShutdownLaneHeld = assertExactShutdownLaneHeld;
  requireCycleSettlement = requireCycleSettlement;
  invokeScheduledCycle = invokeScheduledCycle;
  assertWritableMode = assertWritableMode;
  assertAutomationReady = assertAutomationReady;
  assertSafetyKnown = assertSafetyKnown;
  markStickyUnknown = markStickyUnknown;
  clearAutomationTimer = clearAutomationTimer;
  safeTransitionLocked = safeTransitionLocked;

  constructor(options: StoreCollectionMainRuntimeOptions) {
    if (!options || (!options.orchestrator && !options.createOrchestrator)) {
      throw new StoreCollectionMainRuntimeError(
        'INVALID_RUNTIME_OPTIONS',
        'an exact Main collection orchestrator port or factory is required',
      );
    }
    this.registry = options.registry ?? new VisibleBrowserRuntimeRegistry();
    this.mutationLane = options.mutationLane ?? new StoreMutationLane();
    this.policySuppression = options.policySuppression
      ?? new StoreCollectionPolicySuppressionController();
    const ports = Object.freeze({
      registry: this.registry,
      mutationLane: this.mutationLane,
      policySuppression: this.policySuppression,
    });
    this.orchestrator = options.orchestrator ?? options.createOrchestrator!(ports);
    assertOrchestratorPort(this.orchestrator);
    this.packageUiReadOnly = options.packageUiReadOnly === true;
    this.createAuthorityCapability = options.createAuthorityCapability
      ?? (() => Object.freeze({}));
    this.createManualCycleAdmissionCapability = options.createManualCycleAdmissionCapability
      ?? (() => Object.freeze({}));
    this.pollIntervalMs = options.pollIntervalMs ?? 5 * 60 * 1_000;
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 1_000) {
      throw new StoreCollectionMainRuntimeError(
        'INVALID_RUNTIME_OPTIONS',
        'Main collection poll interval must be an integer of at least 1000ms',
      );
    }
    this.timer = options.timer ?? {
      set: (callback, delayMs) => setInterval(callback, delayMs),
      clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    };
    this.reportError = options.reportError ?? (() => undefined);
  }
}
