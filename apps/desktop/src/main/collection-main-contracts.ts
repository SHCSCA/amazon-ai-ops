import {
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  StoreCollectionPolicySuppressionController,
  type PolicyDispatchSuppressionSnapshot,
} from './store-collection-policy-suppression';
import {
  StoreMutationLane,
  VisibleBrowserRuntimeRegistry,
  type StoreMutationLaneClaim,
  type StoreMutationLaneSnapshot,
} from './visible-browser-runtime-registry';

export interface StoreCollectionMainCycleResult {
  state: 'completed' | 'stopped';
  readonly [key: string]: unknown;
}

export declare const manualCycleAdmissionBrand: unique symbol;

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

export interface MainRuntimeTimerPort {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface StoreCollectionMainRuntimeBaseOptions {
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

export interface NormalizedCollectionCancellationRequest {
  context: StoreContextEnvelope;
  jobId: string;
  requestId: string;
  signalActiveCancellation: StoreCollectionCancellationRequest['signalActiveCancellation'];
  clearCancellationSignal: StoreCollectionCancellationRequest['clearCancellationSignal'];
  cancelIdle: StoreCollectionCancellationRequest['cancelIdle'];
  readDurableSettlement: StoreCollectionCancellationRequest['readDurableSettlement'];
}

export interface StoreCollectionActiveLaneTarget {
  context: StoreContextEnvelope;
  jobId: string;
  requestId: string;
}

export interface StoreCollectionActiveCancellationBase {
  request: NormalizedCollectionCancellationRequest;
  operation: Promise<StoreCollectionCancellationResult>;
  resolve(result: StoreCollectionCancellationResult): void;
  reject(error: unknown): void;
}

export type StoreCollectionActiveCancellation =
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

export interface StoreCollectionActiveLaneOperation {
  claim: StoreMutationLaneClaim;
  target?: StoreCollectionActiveLaneTarget;
  cancellation: StoreCollectionActiveCancellation | null;
}

export interface StoreCollectionMainDrainProof {
  readonly laneSequence: number;
  readonly laneState: 'available';
}
