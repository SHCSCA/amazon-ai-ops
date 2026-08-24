import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  StoreCollectionPolicySuppressionController,
  type PolicyDispatchSuppressionReadPort,
  type PolicyDispatchSuppressionSnapshot,
} from './store-collection-policy-suppression';
import {
  StoreMutationLane,
  StoreMutationLaneError,
  VisibleBrowserRuntimeRegistry,
  VisibleBrowserRuntimeRegistryError,
  type StoreMutationLaneClaim,
  type StoreMutationLaneKind,
  type StoreMutationLaneSnapshot,
} from './visible-browser-runtime-registry';
import { isUserVisibleBrowserTransitionPreMutationError } from './user-visible-browser-transition';

export interface StoreCollectionMainCycleResult {
  state: 'completed' | 'stopped';
  readonly [key: string]: unknown;
}

declare const manualCycleAdmissionBrand: unique symbol;
export type StoreCollectionManualCycleAdmission = Readonly<{
  capability: Readonly<object>;
  context: StoreContextEnvelope;
  readonly [manualCycleAdmissionBrand]: 'StoreCollectionManualCycleAdmission';
}>;

export type StoreCollectionManualCyclePreMutationReason =
  | 'STALE_CONTEXT'
  | 'STORE_NOT_ACTIVE'
  | 'SESSION_GENERATION_MISMATCH'
  | 'MANUAL_COLLECTION_NOT_ADMITTED';

export interface StoreCollectionManualCyclePreMutationRejection {
  state: 'rejected';
  mutationStarted: false;
  reason: StoreCollectionManualCyclePreMutationReason;
  admission: StoreCollectionManualCycleAdmission;
}

export type StoreCollectionManualCycleResult =
  | StoreCollectionMainCycleResult
  | StoreCollectionManualCyclePreMutationRejection;

/**
 * Exact compare-and-swap identity for resuming one durable failed full-eight
 * collection job in place. Main owns the current execution context while the
 * remaining fields bind the already-persisted job and authority proof.
 */
export interface StoreCollectionExistingResumeRequest {
  context: StoreContextEnvelope;
  jobId: string;
  requestId: string;
  dateStart: string;
  dateEnd: string;
  expectedJobUpdatedAt: string;
  expectedAuthorityProofSha256: string;
  deferReconciledCreateFailures?: boolean;
}

/**
 * Deliberately narrower than either the legacy scheduler or the concrete
 * orchestrator. `manualCycle` must be wired to a real orchestrator manual-run
 * entry point; a due-scan cycle is not an acceptable substitute.
 */
export interface StoreCollectionMainOrchestratorPort {
  recoverExistingTransitionsOnly(): Promise<StoreCollectionMainCycleResult>;
  runScheduledCycle(): Promise<StoreCollectionMainCycleResult>;
  manualCycle(
    context: StoreContextEnvelope,
    admission: StoreCollectionManualCycleAdmission,
  ): Promise<StoreCollectionManualCycleResult>;
  resumeExisting(
    input: StoreCollectionExistingResumeRequest,
  ): Promise<StoreCollectionMainCycleResult>;
  stopAndDrain(timeoutMs?: number): Promise<void>;
  assertUserOperationAllowed(): void;
  isTransitionLocked(): boolean;
}

export interface StoreCollectionMainRuntimeOwnedPorts {
  registry: VisibleBrowserRuntimeRegistry;
  mutationLane: StoreMutationLane;
  policySuppression: StoreCollectionPolicySuppressionController;
}

export type StoreCollectionMainRuntimeLifecycle =
  | 'startup_unknown'
  | 'recovering'
  | 'ready'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'sticky_unknown';

export interface StoreCollectionMainRuntimeStatus {
  lifecycle: StoreCollectionMainRuntimeLifecycle;
  packageUiReadOnly: boolean;
  startupRecoveryConfirmed: boolean;
  automationStarted: boolean;
  drainProven: boolean;
  registryClosed: boolean;
  orchestratorTransitionLocked: boolean;
  effectivePolicyDispatchSuppressed: boolean;
  policySuppression: PolicyDispatchSuppressionSnapshot;
  mutationLane: StoreMutationLaneSnapshot;
  visibleRuntime: Readonly<{
    runtimeId: string;
    epoch: number;
    purpose: 'operator_full' | 'collection_only';
    context: StoreContextEnvelope;
    providerIdentityStatus: Readonly<{
      lingxing: 'pending' | 'verified';
      amazonAds: 'not_present' | 'unknown' | 'pending' | 'verified' | 'blocked';
    }>;
  }> | null;
}

export type StoreCollectionMainRuntimeErrorCode =
  | 'PACKAGE_UI_READ_ONLY'
  | 'STARTUP_RECOVERY_REQUIRED'
  | 'STARTUP_RECOVERY_REPLAYED'
  | 'STARTUP_RECOVERY_FAILED'
  | 'SAFETY_STATE_UNKNOWN'
  | 'RUNTIME_STOPPING'
  | 'INVALID_RUNTIME_OPTIONS'
  | 'INVALID_USER_MUTATION_SCOPE'
  | 'INVALID_MANUAL_CONTEXT'
  | 'INVALID_RESUME_REQUEST'
  | 'INVALID_CANCELLATION_REQUEST'
  | 'COLLECTION_CANCELLATION_BLOCKED'
  | 'CANCELLATION_SETTLEMENT_UNPROVEN'
  | 'MANUAL_CYCLE_PREMUTATION_REJECTED'
  | 'USER_OPERATION_BLOCKED'
  | 'DRAIN_REQUIRED'
  | 'DRAIN_TIMEOUT'
  | 'REGISTRY_CLOSE_FAILED';

export class StoreCollectionMainRuntimeError extends Error {
  constructor(
    readonly code: StoreCollectionMainRuntimeErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'StoreCollectionMainRuntimeError';
  }
}

interface MainRuntimeTimerPort {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

interface StoreCollectionMainRuntimeBaseOptions {
  registry?: VisibleBrowserRuntimeRegistry;
  mutationLane?: StoreMutationLane;
  policySuppression?: StoreCollectionPolicySuppressionController;
  packageUiReadOnly?: boolean;
  pollIntervalMs?: number;
  timer?: MainRuntimeTimerPort;
  createAuthorityCapability?: () => Readonly<object>;
  createManualCycleAdmissionCapability?: () => Readonly<object>;
  reportError?: (error: unknown) => void;
}

export type StoreCollectionMainRuntimeOptions = StoreCollectionMainRuntimeBaseOptions & (
  | {
    orchestrator: StoreCollectionMainOrchestratorPort;
    createOrchestrator?: never;
  }
  | {
    orchestrator?: never;
    createOrchestrator(
      ports: StoreCollectionMainRuntimeOwnedPorts,
    ): StoreCollectionMainOrchestratorPort;
  }
);

export interface StoreCollectionUserMutationScope {
  operation: string;
  targetStoreId?: string;
}

const PACKAGE_UI_SETUP_MUTATIONS = new Set([
  'browser:login',
  'browser:confirm-ads-identity',
  'stores:create',
  'stores:switch',
  'stores:connections:create',
  'stores:connections:update',
]);

export type StoreCollectionCancellationPath = 'active' | 'idle';

export interface StoreCollectionCancellationCallbackInput {
  context: StoreContextEnvelope;
  storeId: string;
  jobId: string;
  requestId: string;
  path: StoreCollectionCancellationPath;
  laneOwner: string;
  laneSequence: number;
  requireNewResumeReceipt: boolean;
}

export type StoreCollectionCancellationSettlement =
  | Readonly<{
    durableCancelled: true;
    storeId: string;
    jobId: string;
    requestId: string;
    newResumeReceipt: boolean;
  }>
  | Readonly<{
    durableCancelled: false;
  }>;

export interface StoreCollectionCancellationRequest {
  context: StoreContextEnvelope;
  jobId: string;
  requestId: string;
  signalActiveCancellation(
    input: StoreCollectionCancellationCallbackInput,
  ): void;
  clearCancellationSignal(
    input: StoreCollectionCancellationCallbackInput,
  ): Promise<void> | void;
  cancelIdle(
    input: StoreCollectionCancellationCallbackInput,
  ): Promise<void> | void;
  readDurableSettlement(
    input: StoreCollectionCancellationCallbackInput,
  ): Promise<StoreCollectionCancellationSettlement> | StoreCollectionCancellationSettlement;
}

export interface StoreCollectionCancellationResult {
  cancelled: true;
  path: StoreCollectionCancellationPath;
  laneOwner: string;
  laneSequence: number;
  storeId: string;
  jobId: string;
  requestId: string;
  newResumeReceipt: boolean;
}

interface NormalizedCollectionCancellationRequest {
  context: StoreContextEnvelope;
  jobId: string;
  requestId: string;
  signalActiveCancellation: StoreCollectionCancellationRequest['signalActiveCancellation'];
  clearCancellationSignal: StoreCollectionCancellationRequest['clearCancellationSignal'];
  cancelIdle: StoreCollectionCancellationRequest['cancelIdle'];
  readDurableSettlement: StoreCollectionCancellationRequest['readDurableSettlement'];
}

interface StoreCollectionActiveLaneTarget {
  context: StoreContextEnvelope;
  jobId: string;
  requestId: string;
}

interface StoreCollectionActiveCancellationBase {
  request: NormalizedCollectionCancellationRequest;
  operation: Promise<StoreCollectionCancellationResult>;
  resolve(result: StoreCollectionCancellationResult): void;
  reject(error: unknown): void;
}

type StoreCollectionActiveCancellation =
  | (StoreCollectionActiveCancellationBase & {
    mode: 'cooperative';
    input: StoreCollectionCancellationCallbackInput;
    signalFailed: boolean;
    signalFailure?: unknown;
    cleanupOperation?: Promise<void>;
  })
  | (StoreCollectionActiveCancellationBase & {
    mode: 'after_release_idle';
  });

interface StoreCollectionActiveLaneOperation {
  claim: StoreMutationLaneClaim;
  target?: StoreCollectionActiveLaneTarget;
  cancellation: StoreCollectionActiveCancellation | null;
}

interface StoreCollectionMainDrainProof {
  readonly laneSequence: number;
  readonly laneState: 'available';
}

export class StoreCollectionMainRuntime implements PolicyDispatchSuppressionReadPort {
  private readonly registry: VisibleBrowserRuntimeRegistry;
  private readonly mutationLane: StoreMutationLane;
  private readonly policySuppression: StoreCollectionPolicySuppressionController;
  private readonly orchestrator: StoreCollectionMainOrchestratorPort;
  private readonly packageUiReadOnly: boolean;
  private readonly createAuthorityCapability: () => Readonly<object>;
  private readonly createManualCycleAdmissionCapability: () => Readonly<object>;
  private readonly pollIntervalMs: number;
  private readonly timer: MainRuntimeTimerPort;
  private readonly reportError: (error: unknown) => void;
  private timerHandle: unknown;
  private timerRegistered = false;
  private lifecycle: StoreCollectionMainRuntimeLifecycle = 'startup_unknown';
  private startupRecoveryAttempted = false;
  private startupRecoveryConfirmed = false;
  private automationStarted = false;
  private drainProven = false;
  private registryClosed = false;
  private readonly activeLaneOperations = new Set<Promise<unknown>>();
  private activeLaneOperation: StoreCollectionActiveLaneOperation | null = null;
  private shutdownOperation: Promise<void> | null = null;
  private registryCloseOperation: Promise<void> | null = null;
  private drainInProgress = false;
  private drainProof: StoreCollectionMainDrainProof | null = null;
  private shutdownLaneClaim: StoreMutationLaneClaim | null = null;
  private readonly issuedCapabilities = new WeakSet<object>();
  private readonly manualCycleAdmissions = new WeakMap<object, {
    admission: StoreCollectionManualCycleAdmission;
    consumed: boolean;
  }>();

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

  async recoverStartupThenConfirm(): Promise<void> {
    this.assertWritableMode('startup recovery');
    this.assertSafetyKnown();
    if (this.startupRecoveryAttempted) {
      this.markStickyUnknown();
      throw new StoreCollectionMainRuntimeError(
        'STARTUP_RECOVERY_REPLAYED',
        'startup recovery and policy confirmation are one-shot',
      );
    }
    this.startupRecoveryAttempted = true;
    this.lifecycle = 'recovering';
    try {
      const result = await this.withMutationLane(
        'automation',
        'startup-recovery',
        () => this.orchestrator.recoverExistingTransitionsOnly(),
      );
      if (!result || result.state !== 'completed') {
        throw new StoreCollectionMainRuntimeError(
          'STARTUP_RECOVERY_FAILED',
          'recovery-only orchestration did not prove a completed result',
        );
      }
      this.assertSafetyKnown();
      const capability = this.policySuppression
        .issueStartupRecoveryConfirmationCapability();
      const receipt = this.policySuppression.confirmStartupRecoverySafe(capability);
      if (receipt.capability !== capability || receipt.startupRecoverySafe !== true) {
        throw new StoreCollectionMainRuntimeError(
          'STARTUP_RECOVERY_FAILED',
          'startup recovery confirmation did not consume the exact capability',
        );
      }
      this.startupRecoveryConfirmed = true;
      this.lifecycle = 'ready';
    } catch (error) {
      this.markStickyUnknown();
      throw error;
    }
  }

  async runNow(
    contextInput: StoreContextEnvelope,
  ): Promise<StoreCollectionMainCycleResult> {
    this.assertAutomationReady('manual collection');
    let context: StoreContextEnvelope;
    try {
      const normalized = normalizeStoreContextEnvelope(contextInput);
      assertUsContext(normalized);
      context = Object.freeze({ ...normalized });
    } catch (error) {
      throw new StoreCollectionMainRuntimeError(
        'INVALID_MANUAL_CONTEXT',
        'manual collection requires one exact US/USD/America/Los_Angeles Store context',
        { cause: error },
      );
    }
    const admission = this.issueManualCycleAdmission(context);
    const outcome = await this.withMutationLane('automation', 'manual-collection', async () => (
      this.validateManualCycleOutcome(
        await this.orchestrator.manualCycle(context, admission),
        admission,
      )
    ));
    if (outcome.kind === 'pre_mutation_rejected') {
      throw new StoreCollectionMainRuntimeError(
        'MANUAL_CYCLE_PREMUTATION_REJECTED',
        `manual collection was safely rejected before mutation: ${outcome.reason}`,
      );
    }
    return outcome.result;
  }

  /**
   * Explicit-user-only entry for an in-place failed-job resume. Startup
   * recovery and the scheduled pump have no call path to this method.
   */
  async resumeExisting(
    input: StoreCollectionExistingResumeRequest,
  ): Promise<StoreCollectionMainCycleResult> {
    this.assertAutomationReady('existing collection resume');
    const exact = normalizeExistingResumeRequest(input);
    this.assertUserOperationAllowed();
    return this.withMutationLane('automation', 'manual-collection-resume', async () => (
      this.requireCycleSettlement(
        await this.orchestrator.resumeExisting(exact),
        'existing collection resume',
      )
    ), {
      context: exact.context,
      jobId: exact.jobId,
      requestId: exact.requestId,
    });
  }

  /**
   * Main-owned cancellation admission. An active collection is interrupted
   * cooperatively, but its exact mutation-lane claim remains held until the
   * durable cancelled settlement has been read and verified.
   */
  cancelCollection(
    input: StoreCollectionCancellationRequest,
  ): Promise<StoreCollectionCancellationResult> {
    try {
      this.assertAutomationReady('collection cancellation');
      const request = normalizeCancellationRequest(input);
      const lane = this.mutationLane.inspect();
      if (!lane.held) {
        try {
          this.assertUserOperationAllowed();
        } catch (error) {
          return this.rejectCancellationAfterClear(
            request,
            cancellationCallbackInput(
              request,
              'idle',
              { owner: 'manual-collection-cancel', sequence: lane.sequence },
              false,
            ),
            error,
          );
        }
        return this.performIdleCollectionCancellation(request);
      }

      const active = this.activeLaneOperation;
      const current = lane.current;
      if (!active
        || !current
        || active.claim.kind !== current.kind
        || active.claim.owner !== current.owner
        || active.claim.sequence !== current.sequence
        || !isCancellableCollectionLane(active.claim)) {
        return this.rejectCancellationAfterClear(
          request,
          cancellationCallbackInput(
            request,
            'active',
            current ?? { owner: 'unknown', sequence: lane.sequence },
            false,
          ),
          new StoreCollectionMainRuntimeError(
            'COLLECTION_CANCELLATION_BLOCKED',
            'collection cancellation cannot cross a non-collection or externally held mutation lane',
          ),
        );
      }
      if (active.cancellation) {
        if (sameCancellationCompositeKey(active.cancellation.request, request)) {
          return active.cancellation.operation;
        }
        return this.rejectCancellationAfterClear(
          request,
          cancellationCallbackInput(
            request,
            'active',
            active.claim,
            active.claim.owner === 'manual-collection-resume',
          ),
          new StoreCollectionMainRuntimeError(
            'COLLECTION_CANCELLATION_BLOCKED',
            'the active collection lane already has a cancellation request',
          ),
        );
      }
      if (active.claim.owner === 'manual-collection-resume'
        && (!active.target
          || active.target.jobId !== request.jobId
          || active.target.requestId !== request.requestId
          || !sameStoreContext(active.target.context, request.context))) {
        return this.rejectCancellationAfterClear(
          request,
          cancellationCallbackInput(request, 'active', active.claim, true),
          new StoreCollectionMainRuntimeError(
            'COLLECTION_CANCELLATION_BLOCKED',
            'active resume cancellation must target the exact Store, job, and request',
          ),
        );
      }

      let resolveCancellation!: (result: StoreCollectionCancellationResult) => void;
      let rejectCancellation!: (error: unknown) => void;
      const operation = new Promise<StoreCollectionCancellationResult>((resolve, reject) => {
        resolveCancellation = resolve;
        rejectCancellation = reject;
      });
      if (active.claim.owner !== 'manual-collection-resume') {
        active.cancellation = {
          mode: 'after_release_idle',
          request,
          operation,
          resolve: resolveCancellation,
          reject: rejectCancellation,
        };
        return operation;
      }

      const callbackInput = cancellationCallbackInput(request, 'active', active.claim, true);
      const cancellation: StoreCollectionActiveCancellation = {
        mode: 'cooperative',
        input: callbackInput,
        request,
        operation,
        resolve: resolveCancellation,
        reject: rejectCancellation,
        signalFailed: false,
      };
      active.cancellation = cancellation;
      try {
        const signalResult = request.signalActiveCancellation(callbackInput);
        if (isPromiseLike(signalResult)) {
          throw new StoreCollectionMainRuntimeError(
            'SAFETY_STATE_UNKNOWN',
            'active collection cancellation signal must complete synchronously',
          );
        }
      } catch (error) {
        this.markStickyUnknown();
        cancellation.signalFailed = true;
        cancellation.signalFailure = error;
        const cleanupOperation = this.clearCancellationSignalSafely(
          request,
          callbackInput,
        );
        cancellation.cleanupOperation = cleanupOperation;
        void cleanupOperation.then(
          () => rejectCancellation(error),
          rejectCancellation,
        );
      }
      return operation;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  start(): void {
    this.assertAutomationReady('scheduled collection');
    if (this.automationStarted) return;
    this.automationStarted = true;
    this.lifecycle = 'running';
    try {
      this.timerHandle = this.timer.set(() => {
        this.invokeScheduledCycle();
      }, this.pollIntervalMs);
      this.timerRegistered = true;
    } catch (error) {
      this.markStickyUnknown();
      throw error;
    }
    this.invokeScheduledCycle();
  }

  assertUserOperationAllowed(): void {
    this.assertWritableMode('user Store mutation');
    this.assertSafetyKnown();
    if (!this.startupRecoveryConfirmed) {
      throw new StoreCollectionMainRuntimeError(
        'STARTUP_RECOVERY_REQUIRED',
        'startup recovery must be confirmed before Store mutation',
      );
    }
    if (this.lifecycle === 'stopping' || this.lifecycle === 'stopped') {
      throw new StoreCollectionMainRuntimeError(
        'RUNTIME_STOPPING',
        'Main collection runtime is stopping or stopped',
      );
    }
    const lane = this.mutationLane.inspect();
    if (lane.held) {
      throw new StoreCollectionMainRuntimeError(
        'USER_OPERATION_BLOCKED',
        `Store mutation lane is already held by ${lane.current?.kind ?? 'unknown'} operation`,
      );
    }
    try {
      this.orchestrator.assertUserOperationAllowed();
    } catch (error) {
      throw new StoreCollectionMainRuntimeError(
        'USER_OPERATION_BLOCKED',
        'orchestrator transition blocks the current user Store mutation',
        { cause: error },
      );
    }
  }

  async withUserStoreMutation<Result>(
    scopeInput: StoreCollectionUserMutationScope,
    work: () => Promise<Result> | Result,
  ): Promise<Result> {
    normalizeUserMutationScope(scopeInput);
    if (typeof work !== 'function') {
      throw new StoreCollectionMainRuntimeError(
        'INVALID_USER_MUTATION_SCOPE',
        'user Store mutation callback is required',
      );
    }
    this.assertUserOperationAllowed();
    return this.withMutationLane('user', 'renderer-store-ipc', work);
  }

  async withPackageUiSetupMutation<Result>(
    scopeInput: StoreCollectionUserMutationScope,
    work: () => Promise<Result> | Result,
  ): Promise<Result> {
    const scope = normalizeUserMutationScope(scopeInput);
    if (!this.packageUiReadOnly || !PACKAGE_UI_SETUP_MUTATIONS.has(scope.operation)) {
      throw new StoreCollectionMainRuntimeError(
        'PACKAGE_UI_READ_ONLY',
        `Package UI read-only mode forbids ${scope.operation}`,
      );
    }
    if (typeof work !== 'function') {
      throw new StoreCollectionMainRuntimeError(
        'INVALID_USER_MUTATION_SCOPE',
        'package UI setup mutation callback is required',
      );
    }
    this.assertSafetyKnown();
    if (this.lifecycle === 'stopping' || this.lifecycle === 'stopped') {
      throw new StoreCollectionMainRuntimeError(
        'RUNTIME_STOPPING',
        'Main collection runtime is stopping or stopped',
      );
    }
    if (this.registry.read() !== null) {
      throw new StoreCollectionMainRuntimeError(
        'USER_OPERATION_BLOCKED',
        'Package UI setup mutations are allowed only before a visible browser session exists',
      );
    }
    return this.withMutationLane('user', 'package-ui-evidence-setup', work);
  }

  stopAndDrain(timeoutMs = 5_000): Promise<void> {
    if (this.shutdownOperation) return this.shutdownOperation;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
      return Promise.reject(new StoreCollectionMainRuntimeError(
        'DRAIN_TIMEOUT',
        'Main collection runtime drain timeout must be a non-negative integer',
      ));
    }
    this.lifecycle = 'stopping';
    this.automationStarted = false;
    this.drainInProgress = true;
    this.clearAutomationTimer();

    let resolveOperation!: () => void;
    let rejectOperation!: (error: unknown) => void;
    const operation = new Promise<void>((resolve, reject) => {
      resolveOperation = resolve;
      rejectOperation = reject;
    });
    // Publish the in-flight operation before calling the orchestrator. A Main
    // port may synchronously re-enter shutdown while closing its own admission,
    // and every such caller must observe this exact attempt.
    this.shutdownOperation = operation;
    try {
      void this.performStopAndDrain(timeoutMs).then(resolveOperation, rejectOperation);
    } catch (error) {
      rejectOperation(error);
    }
    // A deadline proves only that this attempt did not finish in time. Keep
    // admission permanently closed, but allow the lifecycle recovery UI to
    // take a fresh snapshot after the underlying operations have settled.
    void operation.catch((error) => {
      if (isDrainTimeoutFailure(error) && this.shutdownOperation === operation) {
        this.shutdownOperation = null;
      }
    }).catch(() => undefined);
    return operation;
  }

  closeRegistry(timeoutMs = 5_000): Promise<void> {
    if (this.registryClosed) return Promise.resolve();
    if (this.registryCloseOperation) return this.registryCloseOperation;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new StoreCollectionMainRuntimeError(
        'DRAIN_TIMEOUT',
        'visible runtime registry close timeout must be a positive integer',
      ));
    }
    if (!this.drainProven) {
      return Promise.reject(new StoreCollectionMainRuntimeError(
        'DRAIN_REQUIRED',
        'orchestrator drain must be proven before closing the visible runtime registry',
      ));
    }
    let shutdownClaim: StoreMutationLaneClaim;
    try {
      shutdownClaim = this.claimExactShutdownLane();
    } catch (error) {
      this.markStickyUnknown();
      return Promise.reject(error instanceof StoreCollectionMainRuntimeError
        ? error
        : new StoreCollectionMainRuntimeError(
          'SAFETY_STATE_UNKNOWN',
          'the exact drained mutation-lane state could not be claimed for registry shutdown',
          { cause: error },
        ));
    }

    let resolveOperation!: () => void;
    let rejectOperation!: (error: unknown) => void;
    const operation = new Promise<void>((resolve, reject) => {
      resolveOperation = resolve;
      rejectOperation = reject;
    });
    // Publish before controller.close() can synchronously re-enter cleanup.
    this.registryCloseOperation = operation;
    try {
      void this.performRegistryClose(timeoutMs, shutdownClaim)
        .then(resolveOperation, rejectOperation);
    } catch (error) {
      rejectOperation(error);
    }
    void operation.catch((error) => {
      if (isRetryableRegistryCloseFailure(error)
        && this.registryCloseOperation === operation) {
        this.registryCloseOperation = null;
      }
    }).catch(() => undefined);
    return operation;
  }

  isPolicyDispatchSuppressed(): boolean {
    const lane = this.mutationLane.inspect();
    return this.packageUiReadOnly
      || this.lifecycle === 'sticky_unknown'
      || this.lifecycle === 'stopping'
      || this.lifecycle === 'stopped'
      || lane.held
      || lane.stickyUnknown
      || this.policySuppression.isPolicyDispatchSuppressed();
  }

  readStatus(): StoreCollectionMainRuntimeStatus {
    const runtime = this.registry.read();
    const policySuppression = Object.freeze({
      ...this.policySuppression.inspectPolicyDispatchSuppression(),
    });
    const visibleRuntime = runtime
      ? Object.freeze({
        runtimeId: runtime.runtimeId,
        epoch: runtime.epoch,
        purpose: runtime.purpose,
        context: Object.freeze({ ...runtime.context }),
        providerIdentityStatus: Object.freeze({ ...runtime.providerIdentityStatus }),
      })
      : null;
    return Object.freeze({
      lifecycle: this.lifecycle,
      packageUiReadOnly: this.packageUiReadOnly,
      startupRecoveryConfirmed: this.startupRecoveryConfirmed,
      automationStarted: this.automationStarted,
      drainProven: this.drainProven,
      registryClosed: this.registryClosed,
      orchestratorTransitionLocked: this.safeTransitionLocked(),
      effectivePolicyDispatchSuppressed: this.isPolicyDispatchSuppressed(),
      policySuppression,
      mutationLane: this.mutationLane.inspect(),
      visibleRuntime,
    });
  }

  private withMutationLane<Result>(
    kind: StoreMutationLaneKind,
    owner: string,
    work: () => Promise<Result> | Result,
    target?: StoreCollectionActiveLaneTarget,
  ): Promise<Result> {
    const operation = this.performMutationLaneWork(kind, owner, work, target);
    this.activeLaneOperations.add(operation);
    void operation.finally(() => {
      this.activeLaneOperations.delete(operation);
    }).catch(() => undefined);
    return operation;
  }

  private async performMutationLaneWork<Result>(
    kind: StoreMutationLaneKind,
    owner: string,
    work: () => Promise<Result> | Result,
    target?: StoreCollectionActiveLaneTarget,
  ): Promise<Result> {
    let capability: Readonly<object>;
    try {
      capability = this.createAuthorityCapability();
      this.registerRuntimeCapability(capability);
      this.mutationLane.registerAuthority({ kind, owner, capability });
    } catch (error) {
      this.markStickyUnknown();
      throw error;
    }
    let claim;
    try {
      claim = this.mutationLane.claim({ kind, owner, capability });
    } catch (error) {
      if (!(error instanceof StoreMutationLaneError && error.code === 'LANE_HELD')) {
        this.markStickyUnknown();
      }
      throw error;
    }
    const active: StoreCollectionActiveLaneOperation = {
      claim,
      target,
      cancellation: null,
    };
    if (this.activeLaneOperation) {
      this.markStickyUnknown();
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'Main collection runtime has overlapping mutation-lane operation records',
      );
    }
    this.activeLaneOperation = active;
    let workResult: Promise<Result> | Result | undefined;
    let result: Result | undefined;
    let safePreMutationRejection: unknown;
    try {
      workResult = work();
    } catch (error) {
      if (isUserVisibleBrowserTransitionPreMutationError(error)) {
        safePreMutationRejection = error;
      } else {
        this.markStickyUnknown();
        throw await this.failActiveCancellation(active, error);
      }
    }
    if (!safePreMutationRejection) {
      try {
        result = await workResult;
      } catch (error) {
        this.markStickyUnknown();
        throw await this.failActiveCancellation(active, error);
      }
    }
    let cancellationResult: StoreCollectionCancellationResult | null | undefined;
    const cancellation = active.cancellation;
    if (cancellation?.mode === 'cooperative') {
      if (cancellation.signalFailed) {
        let failure = cancellation.signalFailure;
        try {
          await (cancellation.cleanupOperation
            ?? this.clearCancellationSignalSafely(cancellation.request, cancellation.input));
        } catch (cleanupError) {
          failure = cleanupError;
        }
        cancellation.reject(failure);
        throw failure;
      }
      try {
        const settlement = await cancellation.request
          .readDurableSettlement(cancellation.input);
        cancellationResult = verifyCancellationSettlement(
          settlement,
          cancellation.input,
        );
      } catch (error) {
        let failure = error;
        try {
          await this.clearCancellationSignalSafely(
            cancellation.request,
            cancellation.input,
          );
        } catch (cleanupError) {
          failure = cleanupError;
        }
        this.markStickyUnknown();
        cancellation.reject(failure);
        throw failure;
      }
      try {
        await this.clearCancellationSignalSafely(
          cancellation.request,
          cancellation.input,
        );
      } catch (error) {
        cancellation.reject(error);
        throw error;
      }
    }
    try {
      const receipt = this.mutationLane.release(claim);
      if (receipt.released !== true
        || receipt.claimCapability !== claim.claimCapability
        || receipt.sequence !== claim.sequence) {
        throw new StoreCollectionMainRuntimeError(
          'SAFETY_STATE_UNKNOWN',
          'mutation lane release did not bind the exact claim',
        );
      }
    } catch (error) {
      this.markStickyUnknown();
      throw await this.failActiveCancellation(active, error);
    }
    if (this.activeLaneOperation !== active) {
      const error = new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'Main collection runtime lost the exact mutation-lane operation record',
      );
      this.markStickyUnknown();
      throw await this.failActiveCancellation(active, error);
    }
    this.activeLaneOperation = null;
    if (cancellation?.mode === 'cooperative') {
      if (cancellationResult) {
        cancellation.resolve(cancellationResult);
      } else {
        cancellation.reject(new StoreCollectionMainRuntimeError(
          'CANCELLATION_SETTLEMENT_UNPROVEN',
          'collection cancellation did not prove an exact durable cancelled settlement',
        ));
      }
    } else if (cancellation?.mode === 'after_release_idle') {
      try {
        cancellation.resolve(
          await this.performIdleCollectionCancellation(cancellation.request),
        );
      } catch (error) {
        cancellation.reject(error);
      }
    }
    if (safePreMutationRejection) throw safePreMutationRejection;
    return result as Result;
  }

  private async performIdleCollectionCancellation(
    request: NormalizedCollectionCancellationRequest,
  ): Promise<StoreCollectionCancellationResult> {
    let callbackInput: StoreCollectionCancellationCallbackInput | undefined;
    let clearAttempted = false;
    try {
      const result = await this.withMutationLane(
        'user',
        'manual-collection-cancel',
        async () => {
          const active = this.activeLaneOperation;
          if (!active || active.claim.owner !== 'manual-collection-cancel') {
            throw new StoreCollectionMainRuntimeError(
              'SAFETY_STATE_UNKNOWN',
              'idle collection cancellation lost its exact mutation-lane claim',
            );
          }
          callbackInput = cancellationCallbackInput(
            request,
            'idle',
            active.claim,
            false,
          );
          let settlement: StoreCollectionCancellationSettlement;
          try {
            await request.cancelIdle(callbackInput);
            settlement = await request.readDurableSettlement(callbackInput);
          } catch (error) {
            clearAttempted = true;
            await this.clearCancellationSignalSafely(request, callbackInput);
            throw error;
          }
          const verified = verifyCancellationSettlement(settlement, callbackInput);
          clearAttempted = true;
          await this.clearCancellationSignalSafely(request, callbackInput);
          return verified;
        },
      );
      if (result) return result;
      throw new StoreCollectionMainRuntimeError(
        'CANCELLATION_SETTLEMENT_UNPROVEN',
        'idle collection cancellation did not prove an exact durable cancelled settlement',
      );
    } catch (error) {
      if (!clearAttempted) {
        const lane = this.mutationLane.inspect();
        await this.clearCancellationSignalSafely(
          request,
          callbackInput ?? cancellationCallbackInput(
            request,
            'idle',
            lane.current ?? { owner: 'manual-collection-cancel', sequence: lane.sequence },
            false,
          ),
        );
      }
      throw error;
    }
  }

  private async failActiveCancellation(
    active: StoreCollectionActiveLaneOperation,
    error: unknown,
  ): Promise<unknown> {
    const cancellation = active.cancellation;
    if (!cancellation) return error;
    const input = cancellation.mode === 'cooperative'
      ? cancellation.input
      : cancellationCallbackInput(
        cancellation.request,
        'active',
        active.claim,
        false,
      );
    try {
      await (cancellation.mode === 'cooperative' && cancellation.cleanupOperation
        ? cancellation.cleanupOperation
        : this.clearCancellationSignalSafely(cancellation.request, input));
    } catch (cleanupError) {
      cancellation.reject(cleanupError);
      return cleanupError;
    }
    cancellation.reject(error);
    return error;
  }

  private async rejectCancellationAfterClear(
    request: NormalizedCollectionCancellationRequest,
    input: StoreCollectionCancellationCallbackInput,
    error: unknown,
  ): Promise<never> {
    await this.clearCancellationSignalSafely(request, input);
    throw error;
  }

  private async clearCancellationSignalSafely(
    request: NormalizedCollectionCancellationRequest,
    input: StoreCollectionCancellationCallbackInput,
  ): Promise<void> {
    try {
      await request.clearCancellationSignal(input);
    } catch (error) {
      this.markStickyUnknown();
      throw error;
    }
  }

  private issueManualCycleAdmission(
    context: StoreContextEnvelope,
  ): StoreCollectionManualCycleAdmission {
    try {
      const capability = this.createManualCycleAdmissionCapability();
      this.registerRuntimeCapability(capability);
      const admission = Object.freeze({
        capability,
        context,
      }) as StoreCollectionManualCycleAdmission;
      this.manualCycleAdmissions.set(capability, { admission, consumed: false });
      return admission;
    } catch (error) {
      this.markStickyUnknown();
      throw error;
    }
  }

  private validateManualCycleOutcome(
    outcome: StoreCollectionManualCycleResult,
    admission: StoreCollectionManualCycleAdmission,
  ): Readonly<
    | { kind: 'completed'; result: StoreCollectionMainCycleResult }
    | { kind: 'pre_mutation_rejected'; reason: StoreCollectionManualCyclePreMutationReason }
  > {
    const record = this.manualCycleAdmissions.get(admission.capability);
    if (!record || record.admission !== admission || record.consumed) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'manual collection admission is forged, stale, or replayed',
      );
    }
    if (outcome && (
      outcome.state === 'completed'
      || (outcome.state === 'stopped' && this.acceptsGracefulShutdownStop())
    )) {
      record.consumed = true;
      return Object.freeze({ kind: 'completed', result: outcome });
    }
    let mutationStarted: unknown;
    let reason: unknown;
    let returnedAdmission: unknown;
    try {
      if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)
        || !Object.isFrozen(outcome)
        || Reflect.get(outcome, 'state') !== 'rejected') {
        throw new TypeError('manual rejection receipt must be one frozen object');
      }
      mutationStarted = Reflect.get(outcome, 'mutationStarted');
      reason = Reflect.get(outcome, 'reason');
      returnedAdmission = Reflect.get(outcome, 'admission');
    } catch (error) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'manual collection result did not prove a pre-mutation rejection',
        { cause: error },
      );
    }
    if (mutationStarted !== false
      || returnedAdmission !== admission
      || !isManualPreMutationReason(reason)) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'manual collection rejection was not bound to the exact one-shot admission',
      );
    }
    record.consumed = true;
    return Object.freeze({
      kind: 'pre_mutation_rejected',
      reason,
    });
  }

  private registerRuntimeCapability(capability: Readonly<object>): void {
    if (!runtimeObject(capability) || this.issuedCapabilities.has(capability)) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'Main runtime capability must be a fresh one-shot object identity',
      );
    }
    this.issuedCapabilities.add(capability);
  }

  private async performStopAndDrain(timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    try {
      const orchestratorTimeout = remainingTimeout(timeoutMs, startedAt);
      await waitForOperation(
        this.orchestrator.stopAndDrain(orchestratorTimeout),
        orchestratorTimeout,
        'collection orchestrator did not stop before the Main shutdown deadline',
      );
      await waitForSettledOperations(
        [...this.activeLaneOperations],
        remainingTimeout(timeoutMs, startedAt),
      );
      const lane = this.mutationLane.inspect();
      if (lane.stickyUnknown || this.lifecycle === 'sticky_unknown') {
        throw new StoreCollectionMainRuntimeError(
          'SAFETY_STATE_UNKNOWN',
          'shared Store mutation lane became sticky unknown during orchestrator drain',
        );
      }
      if (lane.held) {
        throw new StoreCollectionMainRuntimeError(
          'DRAIN_TIMEOUT',
          'shared Store mutation lane did not prove exact empty after orchestrator drain',
        );
      }
      if (lane.state !== 'available' || !Number.isSafeInteger(lane.sequence)) {
        throw new StoreCollectionMainRuntimeError(
          'SAFETY_STATE_UNKNOWN',
          'shared Store mutation lane did not expose an exact available drain sequence',
        );
      }
      this.drainProof = Object.freeze({
        laneSequence: lane.sequence,
        laneState: 'available',
      });
      this.drainProven = true;
      this.lifecycle = 'stopped';
    } catch (error) {
      const lane = this.mutationLane.inspect();
      if (isDrainTimeoutFailure(error)
        && this.lifecycle !== 'sticky_unknown'
        && !lane.stickyUnknown) {
        this.lifecycle = 'stopping';
        this.drainProof = null;
        this.drainProven = false;
        throw error instanceof StoreCollectionMainRuntimeError
          ? error
          : new StoreCollectionMainRuntimeError(
            'DRAIN_TIMEOUT',
            'Main collection runtime did not prove an exact drain before the deadline',
            { cause: error },
          );
      }
      this.markStickyUnknown();
      throw error;
    } finally {
      this.drainInProgress = false;
    }
  }

  private acceptsGracefulShutdownStop(): boolean {
    return this.drainInProgress && this.lifecycle === 'stopping';
  }

  private async performRegistryClose(
    timeoutMs: number,
    shutdownClaim: StoreMutationLaneClaim,
  ): Promise<void> {
    try {
      const proof = await waitForOperation(
        this.registry.closeAllAndSeal(),
        timeoutMs,
        'visible runtime registry did not close before the shutdown deadline',
      );
      this.registry.consumeEmptyProof(proof);
      this.assertExactShutdownLaneHeld(shutdownClaim);
      this.registryClosed = true;
    } catch (error) {
      if (isRetryableRegistryCloseFailure(error)) {
        // The exact terminal lane claim remains held and registry publication
        // remains sealed. A later strict-quit attempt may retry closure/proof.
        try {
          this.assertExactShutdownLaneHeld(shutdownClaim);
        } catch (integrityError) {
          this.markStickyUnknown();
          throw integrityError;
        }
        this.lifecycle = 'stopped';
        throw error instanceof StoreCollectionMainRuntimeError
          ? error
          : new StoreCollectionMainRuntimeError(
            'REGISTRY_CLOSE_FAILED',
            'visible runtime registry did not close and consume its exact empty proof',
            { cause: error },
          );
      }
      this.markStickyUnknown();
      if (error instanceof StoreCollectionMainRuntimeError
        && error.code === 'SAFETY_STATE_UNKNOWN') {
        throw error;
      }
      throw new StoreCollectionMainRuntimeError(
        'REGISTRY_CLOSE_FAILED',
        'visible runtime registry did not close and consume its exact empty proof',
        { cause: error },
      );
    }
  }

  private claimExactShutdownLane(): StoreMutationLaneClaim {
    if (this.shutdownLaneClaim) {
      this.assertExactShutdownLaneHeld(this.shutdownLaneClaim);
      return this.shutdownLaneClaim;
    }
    const proof = this.drainProof;
    const before = this.mutationLane.inspect();
    if (!proof
      || proof.laneState !== 'available'
      || before.state !== 'available'
      || before.held
      || before.stickyUnknown
      || before.sequence !== proof.laneSequence) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'mutation-lane state changed after the exact drain proof was issued',
      );
    }
    const capability = this.createAuthorityCapability();
    this.registerRuntimeCapability(capability);
    this.mutationLane.registerAuthority({
      kind: 'automation',
      owner: 'shutdown-registry-close',
      capability,
    });
    const claim = this.mutationLane.claim({
      kind: 'automation',
      owner: 'shutdown-registry-close',
      capability,
    });
    const after = this.mutationLane.inspect();
    if (claim.sequence !== proof.laneSequence + 1
      || after.state !== 'held'
      || !after.held
      || after.stickyUnknown
      || after.sequence !== claim.sequence
      || after.current?.kind !== claim.kind
      || after.current.owner !== claim.owner
      || after.current.sequence !== claim.sequence) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'shutdown mutation-lane claim did not bind the exact fresh drain sequence',
      );
    }
    this.shutdownLaneClaim = claim;
    return claim;
  }

  private assertExactShutdownLaneHeld(claim: StoreMutationLaneClaim): void {
    if (this.shutdownLaneClaim !== claim) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'shutdown mutation-lane claim identity changed during registry close',
      );
    }
    const held = this.mutationLane.inspect();
    if (held.state !== 'held'
      || !held.held
      || held.stickyUnknown
      || held.sequence !== claim.sequence
      || held.current?.kind !== claim.kind
      || held.current.owner !== claim.owner
      || held.current.sequence !== claim.sequence) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'shutdown mutation-lane claim was not held through registry empty proof',
      );
    }
    // Shutdown is terminal. Retaining this exact opaque claim prevents every
    // later direct lane claimant, including code outside MainRuntime, from
    // mutating Store authority after the visible-runtime registry is sealed.
  }

  private requireCycleSettlement(
    result: StoreCollectionMainCycleResult,
    operation: string,
  ): StoreCollectionMainCycleResult {
    if (result?.state === 'completed'
      || (result?.state === 'stopped' && this.acceptsGracefulShutdownStop())) {
      return result;
    }
    throw new StoreCollectionMainRuntimeError(
      'SAFETY_STATE_UNKNOWN',
      `${operation} did not prove a completed cycle or an exact shutdown stop`,
    );
  }

  private invokeScheduledCycle(): void {
    if (!this.automationStarted || this.lifecycle !== 'running') return;
    void this.withMutationLane('automation', 'scheduled-collection', async () => {
      const result = await this.orchestrator.runScheduledCycle();
      return this.requireCycleSettlement(result, 'scheduled collection');
    }).catch((error) => {
      if (!(error instanceof StoreMutationLaneError && error.code === 'LANE_HELD')) {
        this.markStickyUnknown();
      }
      try {
        this.reportError(error);
      } catch {
        this.markStickyUnknown();
      }
    });
  }

  private assertWritableMode(operation: string): void {
    if (this.packageUiReadOnly) {
      throw new StoreCollectionMainRuntimeError(
        'PACKAGE_UI_READ_ONLY',
        `Package UI read-only mode forbids ${operation}`,
      );
    }
  }

  private assertAutomationReady(operation: string): void {
    this.assertWritableMode(operation);
    this.assertSafetyKnown();
    if (!this.startupRecoveryConfirmed) {
      throw new StoreCollectionMainRuntimeError(
        'STARTUP_RECOVERY_REQUIRED',
        `startup recovery must be confirmed before ${operation}`,
      );
    }
    if (this.lifecycle === 'stopping' || this.lifecycle === 'stopped') {
      throw new StoreCollectionMainRuntimeError(
        'RUNTIME_STOPPING',
        `Main collection runtime cannot begin ${operation} while stopping`,
      );
    }
  }

  private assertSafetyKnown(): void {
    if (this.lifecycle === 'sticky_unknown'
      || this.mutationLane.inspect().stickyUnknown) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'Main collection runtime safety state is unknown',
      );
    }
  }

  private markStickyUnknown(): void {
    this.lifecycle = 'sticky_unknown';
    this.automationStarted = false;
    this.clearAutomationTimer();
    this.mutationLane.markSafetyStateUnknown();
  }

  private clearAutomationTimer(): void {
    if (!this.timerRegistered) return;
    const handle = this.timerHandle;
    this.timerRegistered = false;
    this.timerHandle = undefined;
    try {
      this.timer.clear(handle);
    } catch {
      this.lifecycle = 'sticky_unknown';
      this.mutationLane.markSafetyStateUnknown();
    }
  }

  private safeTransitionLocked(): boolean {
    try {
      return this.orchestrator.isTransitionLocked();
    } catch {
      this.markStickyUnknown();
      return true;
    }
  }
}

function isDrainTimeoutFailure(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'DRAIN_TIMEOUT';
}

function isRetryableRegistryCloseFailure(error: unknown): boolean {
  return isDrainTimeoutFailure(error)
    || (error instanceof VisibleBrowserRuntimeRegistryError
      && (error.code === 'RUNTIME_CLOSE_FAILED' || error.code === 'RUNTIME_RESIDUE'))
    || (error instanceof StoreCollectionMainRuntimeError
      && error.code === 'REGISTRY_CLOSE_FAILED'
      && isRetryableRegistryCloseFailure(error.cause));
}

function normalizeUserMutationScope(
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

function normalizeCancellationRequest(
  input: StoreCollectionCancellationRequest,
): NormalizedCollectionCancellationRequest {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('collection cancellation request is required');
    }
    const context = normalizeStoreContextEnvelope(input.context);
    assertUsContext(context);
    if (typeof input.signalActiveCancellation !== 'function'
      || typeof input.clearCancellationSignal !== 'function'
      || typeof input.cancelIdle !== 'function'
      || typeof input.readDurableSettlement !== 'function') {
      throw new TypeError('collection cancellation callbacks are required');
    }
    return Object.freeze({
      context: Object.freeze({ ...context }),
      jobId: exactResumeIdentity(input.jobId, 'jobId'),
      requestId: exactResumeIdentity(input.requestId, 'requestId'),
      signalActiveCancellation: input.signalActiveCancellation,
      clearCancellationSignal: input.clearCancellationSignal,
      cancelIdle: input.cancelIdle,
      readDurableSettlement: input.readDurableSettlement,
    });
  } catch (error) {
    if (error instanceof StoreCollectionMainRuntimeError
      && error.code === 'INVALID_CANCELLATION_REQUEST') {
      throw error;
    }
    throw new StoreCollectionMainRuntimeError(
      'INVALID_CANCELLATION_REQUEST',
      'collection cancellation requires one exact Store, job, request, and callback set',
      { cause: error },
    );
  }
}

function cancellationCallbackInput(
  request: NormalizedCollectionCancellationRequest,
  path: StoreCollectionCancellationPath,
  lane: Readonly<{ owner: string; sequence: number }>,
  requireNewResumeReceipt: boolean,
): StoreCollectionCancellationCallbackInput {
  return Object.freeze({
    context: request.context,
    storeId: request.context.storeId,
    jobId: request.jobId,
    requestId: request.requestId,
    path,
    laneOwner: lane.owner,
    laneSequence: lane.sequence,
    requireNewResumeReceipt,
  });
}

function verifyCancellationSettlement(
  settlement: StoreCollectionCancellationSettlement,
  input: StoreCollectionCancellationCallbackInput,
): StoreCollectionCancellationResult | null {
  if (!settlement
    || typeof settlement !== 'object'
    || Array.isArray(settlement)
    || settlement.durableCancelled !== true
    || settlement.storeId !== input.storeId
    || settlement.jobId !== input.jobId
    || settlement.requestId !== input.requestId
    || typeof settlement.newResumeReceipt !== 'boolean'
    || (input.requireNewResumeReceipt && settlement.newResumeReceipt !== true)) {
    return null;
  }
  return Object.freeze({
    cancelled: true,
    path: input.path,
    laneOwner: input.laneOwner,
    laneSequence: input.laneSequence,
    storeId: input.storeId,
    jobId: input.jobId,
    requestId: input.requestId,
    newResumeReceipt: settlement.newResumeReceipt,
  });
}

function isCancellableCollectionLane(claim: StoreMutationLaneClaim): boolean {
  return claim.kind === 'automation'
    && (claim.owner === 'manual-collection'
      || claim.owner === 'manual-collection-resume'
      || claim.owner === 'scheduled-collection');
}

function sameStoreContext(
  left: StoreContextEnvelope,
  right: StoreContextEnvelope,
): boolean {
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.marketplace === right.marketplace
    && left.currency === right.currency
    && left.businessTimezone === right.businessTimezone
    && left.businessDate === right.businessDate
    && left.sessionGeneration === right.sessionGeneration;
}

function sameCancellationCompositeKey(
  left: NormalizedCollectionCancellationRequest,
  right: NormalizedCollectionCancellationRequest,
): boolean {
  return left.context.storeId === right.context.storeId
    && left.jobId === right.jobId
    && left.requestId === right.requestId;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null)
    && typeof Reflect.get(value, 'then') === 'function';
}

function normalizeExistingResumeRequest(
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

function exactResumeIdentity(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw new TypeError(`${field} must use 1-160 safe identity characters`);
  }
  return value;
}

function exactIsoDate(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${field} must be one canonical ISO date`);
  }
  return value;
}

function exactUtcInstant(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new TypeError(`${field} must be one canonical UTC instant`);
  }
  return value;
}

function safeIdentity(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(value)) {
    throw new StoreCollectionMainRuntimeError(
      'INVALID_USER_MUTATION_SCOPE',
      `${field} must use 1-160 safe identity characters`,
    );
  }
  return value;
}

function assertUsContext(context: StoreContextEnvelope): void {
  if (context.marketplace !== 'US'
    || context.currency !== 'USD'
    || context.businessTimezone !== 'America/Los_Angeles') {
    throw new TypeError('only exact US/USD/America/Los_Angeles context is supported');
  }
}

function isManualPreMutationReason(
  value: unknown,
): value is StoreCollectionManualCyclePreMutationReason {
  return value === 'STALE_CONTEXT'
    || value === 'STORE_NOT_ACTIVE'
    || value === 'SESSION_GENERATION_MISMATCH'
    || value === 'MANUAL_COLLECTION_NOT_ADMITTED';
}

function runtimeObject(value: unknown): value is Readonly<object> {
  return (typeof value === 'object' && value !== null)
    || typeof value === 'function';
}

function remainingTimeout(timeoutMs: number, startedAt: number): number {
  return Math.max(0, timeoutMs - Math.max(0, Date.now() - startedAt));
}

async function waitForSettledOperations(
  operations: readonly Promise<unknown>[],
  timeoutMs: number,
): Promise<void> {
  if (operations.length === 0) return;
  if (timeoutMs === 0) {
    throw new StoreCollectionMainRuntimeError(
      'DRAIN_TIMEOUT',
      'shared Store mutation lane did not settle before the shutdown deadline',
    );
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const settled = await Promise.race([
      Promise.allSettled(operations).then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (!settled) {
      throw new StoreCollectionMainRuntimeError(
        'DRAIN_TIMEOUT',
        'shared Store mutation lane did not settle before the shutdown deadline',
      );
    }
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForOperation<Result>(
  operation: Promise<Result>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Result> {
  if (timeoutMs === 0) {
    // The operation is created by the caller before it reaches this helper.
    // Observe any later rejection even though the zero budget must fail
    // immediately, otherwise an adversarial port could surface an unhandled
    // rejection after Main has already entered sticky-unknown shutdown.
    void operation.catch(() => undefined);
    throw new StoreCollectionMainRuntimeError('DRAIN_TIMEOUT', timeoutMessage);
  }
  const timeoutResult = Object.freeze({});
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const settled = await Promise.race<Result | Readonly<object>>([
      operation,
      new Promise<Readonly<object>>((resolve) => {
        timeout = setTimeout(() => resolve(timeoutResult), timeoutMs);
      }),
    ]);
    if (settled === timeoutResult) {
      throw new StoreCollectionMainRuntimeError('DRAIN_TIMEOUT', timeoutMessage);
    }
    return settled as Result;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function assertOrchestratorPort(value: StoreCollectionMainOrchestratorPort): void {
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
