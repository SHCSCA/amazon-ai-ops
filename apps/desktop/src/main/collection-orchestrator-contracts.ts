import {
  type BrowserProfileId,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  HISTORY_SCHEMA_VERSION,
  LEGACY_HISTORY_SCHEMA_VERSION,
} from "./collection-orchestrator-constants";

export declare const automationCapabilityBrand: unique symbol;

export type StoreCollectionAutomationCapability = Readonly<object> & {
  readonly [automationCapabilityBrand]: 'StoreCollectionAutomationCapability';
};

export declare const transitionCapabilityBrand: unique symbol;

export type StoreCollectionTransitionCapability = Readonly<object> & {
  readonly [transitionCapabilityBrand]: 'StoreCollectionTransitionCapability';
};

export declare const visibleRuntimeIntentBrand: unique symbol;

export type StoreCollectionVisibleRuntimeIntent = Readonly<{
  domainCapability: Readonly<object>;
  initialCapability: Readonly<object>;
  terminalCleanupCapability: Readonly<object>;
  selectedCapability: Readonly<object>;
  readonly [visibleRuntimeIntentBrand]: 'StoreCollectionVisibleRuntimeIntent';
}>;

export declare const schedulerRecoveryAdmissionBrand: unique symbol;

export type StoreCollectionSchedulerRecoveryAdmission = Readonly<object> & {
  readonly [schedulerRecoveryAdmissionBrand]: 'StoreCollectionSchedulerRecoveryAdmission';
};

export declare const policySuppressionGuardBrand: unique symbol;

export type StoreCollectionPolicySuppressionGuard = Readonly<object> & {
  readonly [policySuppressionGuardBrand]: 'StoreCollectionPolicySuppressionGuard';
};

export interface StoreCollectionAutomationAuthority {
  owner: string;
  capability: StoreCollectionAutomationCapability;
}

export type StoreCollectionTransitionCapabilityDomain =
  | 'transition_execution'
  | 'recovery_existing_request_only';

export interface StoreCollectionTransitionCapabilityScope<
  Domain extends StoreCollectionTransitionCapabilityDomain = StoreCollectionTransitionCapabilityDomain,
> {
  capabilityDomain: Domain;
  capabilityId: string;
  cycleId: string;
  transitionId: string;
  purpose: StoreCollectionOrchestratorTransitionPurpose;
  fromAuthority: StoreCollectionAuthorityReadback;
  originAuthority: StoreCollectionAuthorityReadback;
  target: StoreCollectionTransitionTarget | null;
  expectedFingerprint: string | null;
}

export interface StoreCollectionTransitionAutomationAuthority<
  Domain extends StoreCollectionTransitionCapabilityDomain = StoreCollectionTransitionCapabilityDomain,
>
  extends StoreCollectionAutomationAuthority {
  transitionCapability: StoreCollectionTransitionCapability;
  transitionScope: StoreCollectionTransitionCapabilityScope<Domain>;
}

export type StoreCollectionExecutionAutomationAuthority =
  StoreCollectionTransitionAutomationAuthority<'transition_execution'>;

export type StoreCollectionRecoveryAutomationAuthority =
  StoreCollectionTransitionAutomationAuthority<'recovery_existing_request_only'>;

export interface StoreCollectionTransitionCapabilityReceipt<
  Domain extends StoreCollectionTransitionCapabilityDomain = StoreCollectionTransitionCapabilityDomain,
> extends StoreCollectionTransitionAutomationAuthority<Domain> {
  derived: true;
  recoveryAdmission?: StoreCollectionSchedulerRecoveryAdmission;
  recoveryScopeDigest?: string;
  schedulerAttemptId?: string;
  schedulerRequestId?: string;
}

export interface StoreCollectionSchedulerRecoveryAdmissionReceipt
  extends StoreCollectionAutomationAuthority {
  recoveryAdmission: StoreCollectionSchedulerRecoveryAdmission;
  executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
  context: StoreContextEnvelope;
  attemptId: string;
  requestId: string;
  scopeDigest: string;
  registered: true;
}

export interface StoreCollectionAutomationLease extends StoreCollectionAutomationAuthority {
  release(): Promise<StoreCollectionAutomationLeaseReleaseReceipt>;
}

export interface StoreCollectionAutomationLeaseReleaseReceipt extends StoreCollectionAutomationAuthority {
  released: true;
}

export interface StoreCollectionPolicySuppressionLease extends StoreCollectionAutomationAuthority {
  guard: StoreCollectionPolicySuppressionGuard;
  release(): Promise<StoreCollectionPolicySuppressionReleaseReceipt>;
}

export interface StoreCollectionPolicySuppressionReceipt extends StoreCollectionAutomationAuthority {
  guard: StoreCollectionPolicySuppressionGuard;
  suppressed: true;
}

export interface StoreCollectionPolicySuppressionReleaseReceipt extends StoreCollectionAutomationAuthority {
  guard: StoreCollectionPolicySuppressionGuard;
  released: true;
}

export interface StoreCollectionAuthorityReadback {
  activeStoreId: StoreId | null;
  context: StoreContextEnvelope | null;
}

export interface StoreCollectionAuthorityConfirmation extends StoreCollectionAutomationAuthority {
  authority: StoreCollectionAuthorityReadback;
}

export interface StoreCollectionTransitionAuthorityConfirmation
  extends StoreCollectionExecutionAutomationAuthority {
  authority: StoreCollectionAuthorityReadback;
}

export interface StoreCollectionTransitionTarget {
  storeId: StoreId;
  browserProfileId: BrowserProfileId;
  marketplace: 'US';
  currency: 'USD';
  businessTimezone: 'America/Los_Angeles';
}

export interface StoreCollectionTransitionReceipt extends StoreCollectionExecutionAutomationAuthority {
  reason: 'collection_automation';
  mode: 'collection_only';
  previous: StoreCollectionAuthorityReadback;
  current: StoreCollectionAuthorityReadback;
  targetGenerationBefore: number | null;
  targetGenerationAfter: number | null;
}

export type StoreCollectionOrchestratorFailureCode =
  | 'APP_EXIT_INTERRUPTED'
  | 'AUTOMATION_LEASE_UNAVAILABLE'
  | 'COLLECTION_LEASE_ACTIVE'
  | 'CORRUPT_PERSISTENCE'
  | 'IDENTITY_UNVERIFIED'
  | 'LEASE_RELEASE_FAILED'
  | 'LOGIN_REQUIRED'
  | 'MFA_REQUIRED'
  | 'OPERATOR_STORE_RESTORE_FAILED'
  | 'PERSISTENCE_PROTECTION_UNAVAILABLE'
  | 'REAUTH_REQUIRED'
  | 'RUNTIME_CLOSE_FAILED'
  | 'RUNTIME_START_FAILED'
  | 'SAFETY_STATE_UNKNOWN'
  | 'SCHEDULE_PRECHECK_FAILED'
  | 'SCHEDULER_FAILED'
  | 'SCHEDULER_NOT_SUCCEEDED'
  | 'TRANSITION_FAILED'
  | 'UNSUPPORTED_STORE';

export type StoreCollectionOrchestratorTransitionPurpose = 'collection' | 'restore';

export type StoreCollectionOrchestratorTransitionPhase =
  | 'claimed'
  | 'authority_touch_pending'
  | 'previous_closed'
  | 'activated'
  | 'runtime_started'
  | 'identity_verified'
  | 'scheduler_request_bound'
  | 'scheduler_accepted'
  | 'scheduler_reconciled'
  | 'cleanup_pending'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'interrupted';

export type TransitionPhase = StoreCollectionOrchestratorTransitionPhase;

export type OutcomeState = 'succeeded' | 'blocked' | 'failed';

export interface StoreCollectionScheduleInspection {
  state: 'due' | 'not_due';
  expectedFingerprint?: string;
}

export interface StoreCollectionManualScheduleInspection {
  state: 'eligible' | 'duplicate';
  expectedFingerprint: string;
}

export type StoreCollectionOrchestratorSchedulerState =
  | 'accepted'
  | 'succeeded'
  | 'failed'
  | 'waiting'
  | 'due'
  | 'claimed'
  | 'not_found'
  | 'unknown'
  | 'not_configured'
  | 'archived';

export interface StoreCollectionOrchestratorSchedulerProjection<
  Domain extends StoreCollectionTransitionCapabilityDomain = StoreCollectionTransitionCapabilityDomain,
> extends StoreCollectionTransitionAutomationAuthority<Domain> {
  state: StoreCollectionOrchestratorSchedulerState;
  authority: StoreCollectionAuthorityReadback;
  cycleId?: string;
  transitionId?: string;
  fingerprint?: string;
  accepted?: boolean;
  duplicate?: boolean;
  attemptId?: string;
  requestId?: string;
}

export interface StoreCollectionSchedulerExecutionIdentityInput {
  cycleId: string;
  transitionId: string;
  fingerprint: string;
  transitionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
  context: StoreContextEnvelope;
}

export interface StoreCollectionSchedulerExecutionIdentity {
  attemptId: string;
  requestId: string;
}

export interface StoreCollectionOrchestratorTransition {
  transitionId: string;
  capabilityId: string;
  cycleId: string;
  owner: string;
  fromStoreId: StoreId | null;
  toStoreId: StoreId | null;
  browserProfileId: BrowserProfileId | null;
  purpose: StoreCollectionOrchestratorTransitionPurpose;
  fromAuthority: StoreCollectionAuthorityReadback;
  originAuthority: StoreCollectionAuthorityReadback;
  expectedFingerprint?: string;
  phase: TransitionPhase;
  businessDate?: string;
  sessionGeneration?: number;
  schedulerAttemptId?: string;
  schedulerRequestId?: string;
  startedAt: string;
  completedAt?: string;
  failureCode?: StoreCollectionOrchestratorFailureCode;
  integrityDigest: string;
}

export interface StoreCollectionOrchestratorOutcome {
  outcomeId: string;
  cycleId: string;
  transitionId: string;
  owner: string;
  storeId: StoreId;
  browserProfileId: BrowserProfileId;
  businessDate?: string;
  sessionGeneration?: number;
  fingerprint: string;
  attemptId?: string;
  requestId?: string;
  schedulerSucceeded: boolean;
  cleanupStatus: 'confirmed' | 'unknown';
  state: OutcomeState;
  startedAt: string;
  completedAt: string;
  failureCode?: StoreCollectionOrchestratorFailureCode;
  integrityDigest: string;
}

export interface StoreCollectionSemanticAttempt {
  semanticAttemptId: string;
  cycleId: string;
  transitionId: string;
  storeId: StoreId;
  browserProfileId: BrowserProfileId;
  expectedFingerprint: string;
  businessDate: string;
  sessionGeneration: number;
  schedulerAttemptId: string;
  schedulerRequestId: string;
  attemptedAt: string;
  integrityDigest: string;
}

export interface StoreCollectionProtectedSemanticAttemptQuery {
  storeId: StoreId;
  browserProfileId: BrowserProfileId;
  expectedFingerprint: string;
}

export interface StoreCollectionProtectedSemanticAttemptReadback {
  semanticAttempt: Readonly<StoreCollectionSemanticAttempt>;
  terminalOutcome: Readonly<StoreCollectionOrchestratorOutcome> | null;
}

export interface StoreCollectionOrchestratorHistory {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  transitions: StoreCollectionOrchestratorTransition[];
  outcomes: StoreCollectionOrchestratorOutcome[];
  semanticAttempts: StoreCollectionSemanticAttempt[];
}

export interface LegacyStoreCollectionOrchestratorHistory {
  schemaVersion: typeof LEGACY_HISTORY_SCHEMA_VERSION;
  transitions: StoreCollectionOrchestratorTransition[];
  outcomes: StoreCollectionOrchestratorOutcome[];
}

export interface StoreCollectionOrchestratorHistoryPort {
  get(): string | null | undefined;
  set(value: string): unknown;
  transaction<T>(work: () => T): T;
}

export interface StoreCollectionOrchestratorRecordCodec {
  isAvailable(): boolean;
  seal(plaintext: string): string;
  open(envelope: string): string;
}

export interface AutomationPortInput<
  Domain extends StoreCollectionTransitionCapabilityDomain = 'transition_execution',
> extends StoreCollectionTransitionAutomationAuthority<Domain> {
  context: StoreContextEnvelope;
  expectedAuthority: StoreCollectionAuthorityReadback;
}

export interface AuthorityBoundConfirmation extends StoreCollectionExecutionAutomationAuthority {
  authority: StoreCollectionAuthorityReadback;
}

export interface StoreCollectionOrchestratorDependencies {
  listActiveStores(): readonly StoreRecord[];
  inspectStoreSchedule(store: StoreRecord): StoreCollectionScheduleInspection;
  inspectManualStoreSchedule(
    store: StoreRecord,
    exactContext: StoreContextEnvelope,
  ): StoreCollectionManualScheduleInspection;
  getActiveStoreId(): StoreId | null;
  acquireAutomationLease(): Promise<StoreCollectionAutomationLease>;
  registerSchedulerRecoveryAdmission(
    input: StoreCollectionAutomationAuthority & {
      executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
      context: StoreContextEnvelope;
      attemptId: string;
      requestId: string;
    },
  ): Promise<StoreCollectionSchedulerRecoveryAdmissionReceipt>;
  deriveTransitionCapability<Domain extends StoreCollectionTransitionCapabilityDomain>(
    input: StoreCollectionAutomationAuthority & {
      scope: StoreCollectionTransitionCapabilityScope<Domain>;
      recoveryAdmission?: StoreCollectionSchedulerRecoveryAdmission;
      recoveryScopeDigest?: string;
      schedulerAttemptId?: string;
      schedulerRequestId?: string;
    },
  ): Promise<StoreCollectionTransitionCapabilityReceipt<Domain>>;
  acquirePolicyDispatchSuppression(
    input: StoreCollectionAutomationAuthority,
  ): Promise<StoreCollectionPolicySuppressionLease>;
  readPolicyDispatchSuppression(
    input: StoreCollectionAutomationAuthority & { guard: StoreCollectionPolicySuppressionGuard },
  ): Promise<StoreCollectionPolicySuppressionReceipt>;
  transitionAuthorityForCollection(input: StoreCollectionExecutionAutomationAuthority & {
    reason: 'collection_automation';
    mode: 'collection_only';
    previous: StoreCollectionAuthorityReadback;
    target: StoreCollectionTransitionTarget | null;
  }): Promise<StoreCollectionTransitionReceipt>;
  readActiveAuthority(input: StoreCollectionAutomationAuthority): Promise<StoreCollectionAuthorityConfirmation>;
  readTransitionAuthority(input: StoreCollectionExecutionAutomationAuthority & {
    expectedAuthority: StoreCollectionAuthorityReadback;
  }): Promise<StoreCollectionTransitionAuthorityConfirmation>;
  closeVisibleRuntime(
    input: StoreCollectionExecutionAutomationAuthority & {
      expectedAuthority: StoreCollectionAuthorityReadback;
      visibleRuntimeIntent: StoreCollectionVisibleRuntimeIntent;
    },
  ): Promise<AuthorityBoundConfirmation & { closed: true }>;
  assertCollectionLeaseReleased(
    input: StoreCollectionExecutionAutomationAuthority & {
      expectedAuthority: StoreCollectionAuthorityReadback;
      visibleRuntimeIntent: StoreCollectionVisibleRuntimeIntent;
    },
  ): Promise<AuthorityBoundConfirmation & { released: true }>;
  startCollectionOnlyVisibleRuntime(
    input: AutomationPortInput & {
      visibleRuntimeIntent: StoreCollectionVisibleRuntimeIntent;
    },
  ): Promise<AuthorityBoundConfirmation & { started: true }>;
  verifyVisibleLingxingIdentity(
    input: AutomationPortInput & {
      visibleRuntimeIntent: StoreCollectionVisibleRuntimeIntent;
    },
  ): Promise<AuthorityBoundConfirmation & { verified: true }>;
  scheduler: {
    execute(input: AutomationPortInput<'transition_execution'> & {
      cycleId: string;
      transitionId: string;
      expectedFingerprint: string;
      attemptId: string;
      requestId: string;
    }): Promise<StoreCollectionOrchestratorSchedulerProjection<'transition_execution'>>;
    recover(input: AutomationPortInput<'recovery_existing_request_only'> & {
      cycleId: string;
      transitionId: string;
      expectedFingerprint: string;
      attemptId: string;
      requestId: string;
    }): Promise<StoreCollectionOrchestratorSchedulerProjection<'recovery_existing_request_only'>>;
  };
  history: StoreCollectionOrchestratorHistoryPort;
  recordCodec: StoreCollectionOrchestratorRecordCodec;
  now?: () => Date;
  createCycleId?: () => string;
  historyRetentionLimit?: number;
  pollIntervalMs?: number;
  setInterval?: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void;
  onError?: (error: unknown) => void;
}

export interface StoreCollectionOrchestratorCycleResult {
  cycleId: string;
  state: 'completed' | 'stopped';
  outcomes: readonly StoreCollectionOrchestratorOutcome[];
  skippedStoreIds: readonly StoreId[];
  plannedDueStoreIds: readonly StoreId[];
  attemptedStoreIds: readonly StoreId[];
}

export class StoreCollectionOrchestratorError extends Error {
  constructor(
    readonly code:
      | StoreCollectionOrchestratorFailureCode
      | 'DRAIN_TIMEOUT'
      | 'ORCHESTRATOR_STOPPING'
      | 'USER_OPERATION_BLOCKED',
    message: string,
  ) {
    super(message);
    this.name = 'StoreCollectionOrchestratorError';
  }
}

export class StopRequestedSignal extends Error {}

export class SchedulerResolutionUnknownSignal extends Error {}

export class SchedulerDefinitivelyFailedSignal extends Error {}

export class ManualContextDriftSignal extends Error {}

export type CapabilityIdentityDomain =
  | 'automation'
  | 'policy'
  | 'recovery_admission'
  | 'transition_execution'
  | 'transition_recovery';

export type CapabilityIdentityLifecycle = 'active' | 'released' | 'retired';

export interface CapabilityIdentityRecord {
  domain: CapabilityIdentityDomain;
  lifecycle: CapabilityIdentityLifecycle;
  owner: string;
  cycleId: string;
  transitionId?: string;
}

export interface PendingTransitionRecoveryPlan {
  transition: StoreCollectionOrchestratorTransition;
  disposition: 'interrupt' | 'scheduler_succeeded' | 'scheduler_failed'
    | 'scheduler_not_created' | 'scheduler_unresolved';
  transitionAuthority?: StoreCollectionRecoveryAutomationAuthority;
  error?: unknown;
}

export interface ProtectedSchedulerRecoveryAdmission {
  recoveryAdmission: StoreCollectionSchedulerRecoveryAdmission;
  executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
  context: StoreContextEnvelope;
  attemptId: string;
  requestId: string;
  scopeDigest: string;
}

export interface VisibleRuntimeIntentRecord {
  initial: StoreCollectionVisibleRuntimeIntent;
  terminalCleanup: StoreCollectionVisibleRuntimeIntent;
}

export type StoreCollectionOrchestratorCycleMode = 'normal' | 'recover_existing_only' | 'manual';

export type StoreCollectionOrchestratorCycleRequest =
  | { mode: 'normal' | 'recover_existing_only' }
  | {
    mode: 'manual';
    context: StoreContextEnvelope;
    manualKey: string;
  };

export type TransitionFieldShape = 'none' | 'context' | 'scheduler';
