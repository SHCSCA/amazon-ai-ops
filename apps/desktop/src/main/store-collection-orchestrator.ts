import { createHash, randomUUID } from 'node:crypto';
import {
  normalizeBrowserProfileId,
  normalizeStoreId,
  normalizeStoreContextEnvelope,
  type BrowserProfileId,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';

const LEGACY_HISTORY_SCHEMA_VERSION = 4;
const HISTORY_SCHEMA_VERSION = 5;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_HISTORY_RETENTION_LIMIT = 500;
const MAX_HISTORY_PLAINTEXT_BYTES = 1_048_576;
const MAX_HISTORY_ENVELOPE_BYTES = 4_194_304;
export const STORE_COLLECTION_MAX_DAILY_SEMANTIC_ATTEMPTS_PER_STORE_PROFILE = 32;
const DIGEST = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9:_-]{1,160}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

declare const automationCapabilityBrand: unique symbol;
export type StoreCollectionAutomationCapability = Readonly<object> & {
  readonly [automationCapabilityBrand]: 'StoreCollectionAutomationCapability';
};

declare const transitionCapabilityBrand: unique symbol;
export type StoreCollectionTransitionCapability = Readonly<object> & {
  readonly [transitionCapabilityBrand]: 'StoreCollectionTransitionCapability';
};

declare const visibleRuntimeIntentBrand: unique symbol;
export type StoreCollectionVisibleRuntimeIntent = Readonly<{
  domainCapability: Readonly<object>;
  initialCapability: Readonly<object>;
  terminalCleanupCapability: Readonly<object>;
  selectedCapability: Readonly<object>;
  readonly [visibleRuntimeIntentBrand]: 'StoreCollectionVisibleRuntimeIntent';
}>;

declare const schedulerRecoveryAdmissionBrand: unique symbol;
export type StoreCollectionSchedulerRecoveryAdmission = Readonly<object> & {
  readonly [schedulerRecoveryAdmissionBrand]: 'StoreCollectionSchedulerRecoveryAdmission';
};

declare const policySuppressionGuardBrand: unique symbol;
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
type TransitionPhase = StoreCollectionOrchestratorTransitionPhase;
type OutcomeState = 'succeeded' | 'blocked' | 'failed';

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

interface StoreCollectionOrchestratorHistory {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  transitions: StoreCollectionOrchestratorTransition[];
  outcomes: StoreCollectionOrchestratorOutcome[];
  semanticAttempts: StoreCollectionSemanticAttempt[];
}

interface LegacyStoreCollectionOrchestratorHistory {
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

interface AutomationPortInput<
  Domain extends StoreCollectionTransitionCapabilityDomain = 'transition_execution',
> extends StoreCollectionTransitionAutomationAuthority<Domain> {
  context: StoreContextEnvelope;
  expectedAuthority: StoreCollectionAuthorityReadback;
}

interface AuthorityBoundConfirmation extends StoreCollectionExecutionAutomationAuthority {
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

function emptyCycleResult(cycleId: string): StoreCollectionOrchestratorCycleResult {
  return {
    cycleId,
    state: 'completed',
    outcomes: [],
    skippedStoreIds: [],
    plannedDueStoreIds: [],
    attemptedStoreIds: [],
  };
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

class StopRequestedSignal extends Error {}
class SchedulerResolutionUnknownSignal extends Error {}
class SchedulerDefinitivelyFailedSignal extends Error {}
class ManualContextDriftSignal extends Error {}

type CapabilityIdentityDomain =
  | 'automation'
  | 'policy'
  | 'recovery_admission'
  | 'transition_execution'
  | 'transition_recovery';
type CapabilityIdentityLifecycle = 'active' | 'released' | 'retired';

interface CapabilityIdentityRecord {
  domain: CapabilityIdentityDomain;
  lifecycle: CapabilityIdentityLifecycle;
  owner: string;
  cycleId: string;
  transitionId?: string;
}

interface PendingTransitionRecoveryPlan {
  transition: StoreCollectionOrchestratorTransition;
  disposition: 'interrupt' | 'scheduler_succeeded' | 'scheduler_failed'
    | 'scheduler_not_created' | 'scheduler_unresolved';
  transitionAuthority?: StoreCollectionRecoveryAutomationAuthority;
  error?: unknown;
}

interface ProtectedSchedulerRecoveryAdmission {
  recoveryAdmission: StoreCollectionSchedulerRecoveryAdmission;
  executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
  context: StoreContextEnvelope;
  attemptId: string;
  requestId: string;
  scopeDigest: string;
}

interface VisibleRuntimeIntentRecord {
  initial: StoreCollectionVisibleRuntimeIntent;
  terminalCleanup: StoreCollectionVisibleRuntimeIntent;
}

type StoreCollectionOrchestratorCycleMode = 'normal' | 'recover_existing_only' | 'manual';

type StoreCollectionOrchestratorCycleRequest =
  | { mode: 'normal' | 'recover_existing_only' }
  | {
    mode: 'manual';
    context: StoreContextEnvelope;
    manualKey: string;
  };

/**
 * Main-only multi-store visible collection coordinator. Credentials, account
 * challenge handling, execution controls and policy dispatch are deliberately
 * absent from this capability surface.
 */
export class StoreCollectionOrchestrator {
  private readonly now: () => Date;
  private readonly createCycleId: () => string;
  private readonly historyRetentionLimit: number;
  private readonly pollIntervalMs: number;
  private readonly createInterval: NonNullable<StoreCollectionOrchestratorDependencies['setInterval']>;
  private readonly cancelInterval: NonNullable<StoreCollectionOrchestratorDependencies['clearInterval']>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cycle: Promise<StoreCollectionOrchestratorCycleResult> | null = null;
  private cycleMode: StoreCollectionOrchestratorCycleMode | null = null;
  private cycleManualKey: string | null = null;
  private transitionLocked = false;
  private stopRequested = false;
  private drainRequested = false;
  private safetyStateUnknown = false;
  private readonly capabilityIdentityRegistry = new WeakMap<object, CapabilityIdentityRecord>();
  private readonly issuedTransitionCapabilityIds = new Set<string>();
  private readonly visibleRuntimeIntents = new WeakMap<object, VisibleRuntimeIntentRecord>();

  constructor(private readonly dependencies: StoreCollectionOrchestratorDependencies) {
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

  start(): void {
    if (this.safetyStateUnknown) throw this.safetyError();
    if (this.timer) return;
    this.assertCanStart();
    this.stopRequested = false;
    this.timer = this.createInterval(() => {
      void this.runCycle().catch((error) => this.reportError(error));
    }, this.pollIntervalMs);
    (this.timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
    void this.runCycle().catch((error) => this.reportError(error));
  }

  stop(): void {
    this.stopRequested = true;
    if (this.timer) {
      this.cancelInterval(this.timer);
      this.timer = null;
    }
  }

  async stopAndDrain(timeoutMs = 5_000): Promise<void> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new RangeError('store collection orchestrator drain timeout must be non-negative');
    }
    this.drainRequested = true;
    this.stop();
    const active = this.cycle;
    if (!active) {
      if (this.safetyStateUnknown) throw this.safetyError();
      return;
    }
    if (timeoutMs === 0) {
      throw new StoreCollectionOrchestratorError('DRAIN_TIMEOUT', '编排器尚未证明清理、回店和租约释放完成。');
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const settled = await Promise.race([
        active.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      if (!settled) {
        throw new StoreCollectionOrchestratorError('DRAIN_TIMEOUT', '编排器尚未证明清理、回店和租约释放完成。');
      }
      if (this.safetyStateUnknown) throw this.safetyError();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  isTransitionLocked(): boolean {
    return this.transitionLocked || this.safetyStateUnknown;
  }

  assertUserOperationAllowed(): void {
    if (this.isTransitionLocked()) {
      throw new StoreCollectionOrchestratorError(
        this.safetyStateUnknown ? 'SAFETY_STATE_UNKNOWN' : 'USER_OPERATION_BLOCKED',
        '可见采集运行时正在切换或安全状态未知，Main 已拒绝当前用户操作。',
      );
    }
  }

  readProtectedSemanticAttempt(
    input: StoreCollectionProtectedSemanticAttemptQuery,
  ): Readonly<StoreCollectionProtectedSemanticAttemptReadback> | null {
    if (this.safetyStateUnknown) throw this.safetyError();
    try {
      const storeIdValue = input?.storeId;
      const browserProfileIdValue = input?.browserProfileId;
      const expectedFingerprintValue = input?.expectedFingerprint;
      const storeId = normalizeStoreId(storeIdValue);
      const browserProfileId = normalizeBrowserProfileId(browserProfileIdValue);
      if (storeIdValue !== storeId
        || browserProfileIdValue !== browserProfileId
        || !validFingerprint(expectedFingerprintValue)) {
        throw corruptHistory();
      }
      const history = this.readProtectedHistorySnapshot();
      const matches = history.semanticAttempts.filter((attempt) => (
        attempt.storeId === storeId
        && attempt.browserProfileId === browserProfileId
        && attempt.expectedFingerprint === expectedFingerprintValue
        && !isSchedulerNotCreatedSemanticAttempt(history, attempt)
      ));
      if (matches.length === 0) return null;
      if (matches.length !== 1) throw corruptHistory();
      const semanticAttempt = matches[0];
      const outcomes = history.outcomes.filter((outcome) => (
        outcome.transitionId === semanticAttempt.transitionId
      ));
      if (outcomes.length > 1) throw corruptHistory();
      const terminalOutcome = outcomes[0] ?? null;
      if (terminalOutcome) {
        const transition = history.transitions.find((candidate) => (
          candidate.transitionId === semanticAttempt.transitionId
        ));
        if (!transition || !isTerminalPhase(transition.phase)) throw corruptHistory();
      }
      return Object.freeze({
        semanticAttempt: Object.freeze({ ...semanticAttempt }),
        terminalOutcome: terminalOutcome
          ? Object.freeze({ ...terminalOutcome })
          : null,
      });
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
  }

  runCycle(): Promise<StoreCollectionOrchestratorCycleResult> {
    return this.startCycle({ mode: 'normal' });
  }

  recoverExistingTransitionsOnly(): Promise<StoreCollectionOrchestratorCycleResult> {
    return this.startCycle({ mode: 'recover_existing_only' });
  }

  runStoreNow(value: StoreContextEnvelope): Promise<StoreCollectionOrchestratorCycleResult> {
    let context: StoreContextEnvelope;
    try {
      context = Object.freeze(normalizeStoreContextEnvelope(value));
    } catch (error) {
      const rejected = new StoreCollectionOrchestratorError(
        'USER_OPERATION_BLOCKED',
        '手动采集上下文无效；Main 已拒绝执行。',
      );
      (rejected as StoreCollectionOrchestratorError & { cause?: unknown }).cause = error;
      return Promise.reject(rejected);
    }
    return this.startCycle({
      mode: 'manual',
      context,
      manualKey: manualCollectionCycleKey(context),
    });
  }

  private startCycle(
    request: StoreCollectionOrchestratorCycleRequest,
  ): Promise<StoreCollectionOrchestratorCycleResult> {
    try {
      this.assertCanStart();
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.cycle) {
      if (request.mode === this.cycleMode
        && (request.mode !== 'manual' || request.manualKey === this.cycleManualKey)) {
        return this.cycle;
      }
      return Promise.reject(new StoreCollectionOrchestratorError(
        'USER_OPERATION_BLOCKED',
        '另一条采集或恢复链正在运行；Main 已拒绝复用不相关的 in-flight Promise。',
      ));
    }
    this.transitionLocked = true;
    this.cycleMode = request.mode;
    this.cycleManualKey = request.mode === 'manual' ? request.manualKey : null;
    const cycle = this.executeCycle(request);
    this.cycle = cycle;
    void cycle.finally(() => {
      if (this.cycle === cycle) {
        this.cycle = null;
        this.cycleMode = null;
        this.cycleManualKey = null;
      }
      if (!this.safetyStateUnknown) this.transitionLocked = false;
    }).catch(() => undefined);
    return cycle;
  }

  private assertCanStart(): void {
    if (this.safetyStateUnknown) throw this.safetyError();
    if (this.drainRequested || this.stopRequested) {
      throw new StoreCollectionOrchestratorError('ORCHESTRATOR_STOPPING', '编排器已进入关闭流程。');
    }
  }

  private async executeCycle(
    request: StoreCollectionOrchestratorCycleRequest,
  ): Promise<StoreCollectionOrchestratorCycleResult> {
    let pendingTransitions: StoreCollectionOrchestratorTransition[];
    let attemptedCollectionKeys: ReadonlySet<string>;
    try {
      const historySnapshot = this.readProtectedHistorySnapshot();
      pendingTransitions = historySnapshot.transitions
        .filter((transition) => !isTerminalPhase(transition.phase));
      attemptedCollectionKeys = this.attemptedCollectionSemanticKeys(historySnapshot);
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
    const cycleId = this.createCycleId();
    const manualRecoveryOnly = request.mode === 'manual' && pendingTransitions.length > 0;
    if (request.mode === 'recover_existing_only' && pendingTransitions.length === 0) {
      return emptyCycleResult(cycleId);
    }
    let activeStores: StoreRecord[];
    try {
      activeStores = this.stableActiveStoreSnapshot();
    } catch (error) {
      if (error instanceof StoreCollectionOrchestratorError
        && error.code === 'UNSUPPORTED_STORE') {
        throw error;
      }
      throw this.markSafetyUnknown(error);
    }
    try {
      // Validate every persisted authority snapshot before even terminalizing an
      // untouched claim. Otherwise an unknown Store/Profile could be rewritten
      // into history and silently bypass the active-store boundary.
      for (const transition of pendingTransitions) {
        this.assertAuthorityAgainstActiveStoreSnapshot(transition.fromAuthority, activeStores);
        this.assertAuthorityAgainstActiveStoreSnapshot(transition.originAuthority, activeStores);
      }
      const untouched = pendingTransitions.filter((transition) => transition.phase === 'claimed');
      if (untouched.length > 0) this.interruptTransitions(untouched);
      pendingTransitions = pendingTransitions.filter((transition) => transition.phase !== 'claimed');
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
    if ((request.mode === 'recover_existing_only' || manualRecoveryOnly)
      && pendingTransitions.length === 0) {
      return emptyCycleResult(cycleId);
    }
    let dueSnapshot: {
      due: Array<{
        store: StoreRecord;
        expectedFingerprint: string;
        requiredBusinessDate?: string;
      }>;
      skipped: StoreRecord[];
    } = request.mode === 'normal'
      ? this.stableDueStoreSnapshot(activeStores, attemptedCollectionKeys)
      : { due: [], skipped: [] };
    const manualStore = request.mode === 'manual' && !manualRecoveryOnly
      ? this.exactActiveManualStore(request.context, activeStores)
      : undefined;
    if (request.mode !== 'manual'
      && dueSnapshot.due.length === 0
      && pendingTransitions.length === 0) {
      return {
        cycleId,
        state: 'completed',
        outcomes: [],
        skippedStoreIds: dueSnapshot.skipped.map((store) => store.storeId),
        plannedDueStoreIds: [],
        attemptedStoreIds: [],
      };
    }

    let acquired: StoreCollectionAutomationLease;
    try {
      acquired = await this.dependencies.acquireAutomationLease();
    } catch {
      // Lease acquisition failed before any authority/runtime mutation: zero cleanup side effects.
      throw new StoreCollectionOrchestratorError('AUTOMATION_LEASE_UNAVAILABLE', '无法获得 Main 自动化租约。');
    }
    try {
      this.assertFreshAutomationLease(acquired, cycleId);
    } catch (error) {
      if (!this.hasRegisteredCapabilityIdentity(acquired?.capability)) {
        await this.releaseMalformedAutomationLease(acquired);
      }
      throw this.markSafetyUnknown(error);
    }

    const lease = acquired;
    const auth = cloneAuthority(lease);
    const outcomes: StoreCollectionOrchestratorOutcome[] = [];
    const attemptedStoreIds: StoreId[] = [];
    let currentAuthority: StoreCollectionAuthorityReadback | undefined;
    let operatorAuthority: StoreCollectionAuthorityReadback | undefined;
    let policyLease: StoreCollectionPolicySuppressionLease | undefined;
    let touchedAuthorityOrRuntime = false;
    let operatorRestoreProven = false;
    let handledRecovery = false;
    let cycleError: unknown;

    try {
      policyLease = await this.acquirePolicySuppression(auth, cycleId);
      await this.assertPolicySuppressed(auth, policyLease.guard);
      currentAuthority = await this.readAuthority(auth);
      this.assertAuthorityAgainstActiveStoreSnapshot(currentAuthority, activeStores);

      let operatorStoreId: StoreId | null | undefined;
      if (request.mode === 'manual' && manualStore) {
        this.assertManualContextCurrent(request.context, currentAuthority);
        try {
          operatorStoreId = this.dependencies.getActiveStoreId();
        } catch (error) {
          throw this.markSafetyUnknown(error);
        }
        if (operatorStoreId !== request.context.storeId) {
          throw new StoreCollectionOrchestratorError(
            'USER_OPERATION_BLOCKED',
            '手动采集上下文已过期；Main 当前活动店铺不一致。',
          );
        }
        dueSnapshot = this.stableManualStoreSnapshot(
          manualStore,
          request.context,
          attemptedCollectionKeys,
        );
        currentAuthority = await this.readAuthority(auth);
        this.assertAuthorityAgainstActiveStoreSnapshot(currentAuthority, activeStores);
        this.assertManualContextCurrent(request.context, currentAuthority);
        try {
          operatorStoreId = this.dependencies.getActiveStoreId();
        } catch (error) {
          throw this.markSafetyUnknown(error);
        }
        if (operatorStoreId !== request.context.storeId) {
          throw new StoreCollectionOrchestratorError(
            'USER_OPERATION_BLOCKED',
            '手动采集资格预检后 Main 活动店铺已改变；未创建 scheduler request。',
          );
        }
      }

      if (pendingTransitions.length > 0) {
        handledRecovery = true;
        const recoveryPlans = await this.recoverPendingTransitions({
          transitions: pendingTransitions,
          auth,
          policyGuard: policyLease.guard,
        });
        pendingTransitions = recoveryPlans.map((plan) => plan.transition);
        const recoveryOrigin = this.commonRecoveryOrigin(pendingTransitions);
        operatorAuthority = cloneAuthorityReadback(recoveryOrigin);
        touchedAuthorityOrRuntime = true;
        currentAuthority = await this.restoreOperatorStore({
          cycleId,
          currentAuthority,
          operatorAuthority: recoveryOrigin,
          auth,
          policyGuard: policyLease.guard,
        });
        const interruptible = recoveryPlans
          .filter((plan) => plan.disposition === 'interrupt')
          .map((plan) => plan.transition);
        this.interruptTransitions(interruptible);
        for (const plan of recoveryPlans) {
          if (plan.disposition === 'scheduler_succeeded') {
            const finalized = this.finalizeRecoveredSchedulerTransition(plan, true);
            outcomes.push(finalized);
          } else if (plan.disposition === 'scheduler_failed') {
            const finalized = this.finalizeRecoveredSchedulerTransition(plan, false);
            outcomes.push(finalized);
          } else if (plan.disposition === 'scheduler_not_created') {
            const finalized = this.finalizeRecoveredSchedulerTransition(
              plan,
              false,
              'SCHEDULER_NOT_SUCCEEDED',
            );
            outcomes.push(finalized);
          }
        }
        operatorRestoreProven = true;
        const unresolved = recoveryPlans.filter((plan) => plan.disposition === 'scheduler_unresolved');
        if (unresolved.length > 0) {
          const recoveryError = unresolved.reduce<unknown>(
            (combined, plan) => combineFailures(combined, plan.error),
            new StoreCollectionOrchestratorError(
              'SAFETY_STATE_UNKNOWN',
              'durable scheduler request 尚无法按原 attempt/request 查询归因；未生成新请求。',
            ),
          );
          throw this.markSafetyUnknown(recoveryError);
        }
      }

      if (operatorStoreId === undefined) {
        try {
          operatorStoreId = this.dependencies.getActiveStoreId();
        } catch (error) {
          throw this.markSafetyUnknown(error);
        }
      }
      if (operatorStoreId !== currentAuthority.activeStoreId) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'Main 操作员店铺与 capability-bound authority 不一致。',
        ));
      }
      operatorAuthority = cloneAuthorityReadback(currentAuthority);
      if (operatorAuthority.activeStoreId !== null
        && !activeStores.some((store) => (
          store.storeId === operatorAuthority!.activeStoreId
          && store.browserProfileId === operatorAuthority!.context?.browserProfileId
        ))) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'OPERATOR_STORE_RESTORE_FAILED',
          'Main 返回的操作员店铺不在活跃店铺快照中。',
        ));
      }

      for (const due of handledRecovery ? [] : dueSnapshot.due) {
        if (this.stopRequested) break;
        attemptedStoreIds.push(due.store.storeId);
        const result = await this.runStore({
          cycleId,
          currentAuthority,
          originAuthority: operatorAuthority,
          due,
          auth,
          policyGuard: policyLease.guard,
          onTouched: () => {
            touchedAuthorityOrRuntime = true;
            operatorRestoreProven = false;
          },
          onRestored: () => {
            operatorRestoreProven = true;
          },
        });
        outcomes.push(result.outcome);
        currentAuthority = result.authority;
        this.assertAuthorityAgainstActiveStoreSnapshot(result.authority, activeStores);
        // Every successful restore may advance the durable operator session
        // generation/business date. The next store must restore to that exact
        // independently read back context, never to the cycle's stale origin.
        operatorAuthority = cloneAuthorityReadback(result.authority);
        if (result.mustStop) break;
      }
    } catch (error) {
      cycleError = error;
    } finally {
      if (touchedAuthorityOrRuntime && !operatorRestoreProven && operatorAuthority && policyLease) {
        try {
          const knownCurrent = await this.readAuthority(auth);
          currentAuthority = await this.restoreOperatorStore({
            cycleId,
            currentAuthority: knownCurrent,
            operatorAuthority,
            auth,
            policyGuard: policyLease.guard,
          });
          const recoverable = this.readPendingTransitions();
          if (recoverable.length > 0) {
            const recoveryOrigin = this.commonRecoveryOrigin(recoverable);
            this.assertAuthorityExact(recoveryOrigin, operatorAuthority);
            this.interruptTransitions(recoverable.filter((transition) => (
              isStoreCollectionTransitionPhaseAllowed(
                transition.purpose,
                transition.phase,
                'interrupted',
              )
            )));
          }
          operatorRestoreProven = true;
        } catch (restoreError) {
          cycleError = combineFailures(cycleError, this.markSafetyUnknown(restoreError));
        }
      }
      if (policyLease) {
        if (!this.safetyStateUnknown && (!touchedAuthorityOrRuntime || operatorRestoreProven)) {
          try {
            await this.assertPolicySuppressed(auth, policyLease.guard);
            await this.releasePolicySuppression(policyLease, auth);
          } catch (policyReleaseError) {
            cycleError = combineFailures(cycleError, this.markSafetyUnknown(policyReleaseError));
          }
        } else {
          cycleError = combineFailures(cycleError, this.markSafetyUnknown(
            new StoreCollectionOrchestratorError(
              'SAFETY_STATE_UNKNOWN',
              '安全状态未知，policy dispatch suppression guard 保持占用等待人工恢复。',
            ),
          ));
        }
      }
      try {
        await this.releaseAutomationLease(lease, auth);
      } catch (releaseError) {
        cycleError = combineFailures(cycleError, this.markSafetyUnknown(
          new StoreCollectionOrchestratorError('LEASE_RELEASE_FAILED', 'Main 自动化租约释放失败。'),
        ));
      }
    }

    if (this.safetyStateUnknown) throw combineFailures(cycleError, this.safetyError());
    if (cycleError) throw cycleError;
    return {
      cycleId,
      state: this.stopRequested ? 'stopped' : 'completed',
      outcomes,
      skippedStoreIds: dueSnapshot.skipped.map((store) => store.storeId),
      plannedDueStoreIds: dueSnapshot.due.map((due) => due.store.storeId),
      attemptedStoreIds,
    };
  }

  private async runStore(input: {
    cycleId: string;
    currentAuthority: StoreCollectionAuthorityReadback;
    originAuthority: StoreCollectionAuthorityReadback;
    due: {
      store: StoreRecord;
      expectedFingerprint: string;
      requiredBusinessDate?: string;
    };
    auth: StoreCollectionAutomationAuthority;
    policyGuard: StoreCollectionPolicySuppressionGuard;
    onTouched(): void;
    onRestored(): void;
  }): Promise<{
    outcome: StoreCollectionOrchestratorOutcome;
    authority: StoreCollectionAuthorityReadback;
    mustStop: boolean;
  }> {
    const { cycleId, currentAuthority, originAuthority, due, auth } = input;
    const startedAt = this.now().toISOString();
    let transition = this.newTransition({
      cycleId,
      owner: auth.owner,
      fromStoreId: currentAuthority.activeStoreId,
      store: due.store,
      fromAuthority: currentAuthority,
      originAuthority,
      startedAt,
      purpose: 'collection',
      expectedFingerprint: due.expectedFingerprint,
    });
    try {
      this.appendTransition(transition);
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
    const transitionAuth = await this.deriveTransitionAuthority(
      transition,
      auth,
      input.policyGuard,
      'transition_execution',
    );

    let context: StoreContextEnvelope | undefined;
    let authority = cloneAuthorityReadback(currentAuthority);
    let outcomeState: OutcomeState = 'failed';
    let failureCode: StoreCollectionOrchestratorFailureCode = 'TRANSITION_FAILED';
    let attemptId: string | undefined;
    let requestId: string | undefined;
    let schedulerSucceeded = false;
    let cleanupStatus: StoreCollectionOrchestratorOutcome['cleanupStatus'] = 'confirmed';
    let mustStop = false;
    let criticalError: unknown;
    let bodyFinished = false;
    let schedulerResolutionUnknown = false;
    let schedulerDefinitivelyFailed = false;
    let stage: 'close' | 'transition' | 'runtime_start' | 'identity' | 'scheduler' = 'close';
    try {
      transition = this.updateTransition(transition, { phase: 'authority_touch_pending' });
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
    input.onTouched();

    try {
      authority = await this.closeAndConfirm(transitionAuth, authority, 'initial');
      transition = this.updateTransition(transition, { phase: 'previous_closed' });
      this.throwIfStopping();

      stage = 'transition';
      let receipt: StoreCollectionTransitionReceipt;
      try {
        await this.assertPolicySuppressed(auth, input.policyGuard);
        receipt = await this.dependencies.transitionAuthorityForCollection({
          ...transitionAuth,
          reason: 'collection_automation',
          mode: 'collection_only',
          previous: cloneAuthorityReadback(authority),
          target: transitionTargetFromStore(due.store),
        });
      } catch (error) {
        mustStop = true;
        failureCode = 'TRANSITION_FAILED';
        authority = await this.readTransitionAuthority(transitionAuth, authority);
        throw error;
      }
      context = this.validateTransitionReceipt(receipt, {
        auth: transitionAuth,
        expectedPrevious: authority,
        target: transitionTargetFromStore(due.store),
      })!;
      await this.assertPolicySuppressed(auth, input.policyGuard);
      authority = await this.readTransitionAuthority(transitionAuth, receipt.current);
      this.assertAuthorityExact(authority, receipt.current);
      transition = this.updateTransition(transition, {
        phase: 'activated',
        businessDate: context.businessDate,
        sessionGeneration: context.sessionGeneration,
      });
      if (due.requiredBusinessDate !== undefined
        && context.businessDate !== due.requiredBusinessDate) {
        throw new ManualContextDriftSignal();
      }
      this.throwIfStopping();

      stage = 'runtime_start';
      const started = await this.dependencies.startCollectionOnlyVisibleRuntime({
        ...transitionAuth,
        context,
        expectedAuthority: cloneAuthorityReadback(authority),
        visibleRuntimeIntent: this.visibleRuntimeIntent(transitionAuth, 'initial'),
      });
      this.validateConfirmation(started, transitionAuth, authority, 'started');
      transition = this.updateTransition(transition, { phase: 'runtime_started' });
      this.throwIfStopping();

      stage = 'identity';
      const verified = await this.dependencies.verifyVisibleLingxingIdentity({
        ...transitionAuth,
        context,
        expectedAuthority: cloneAuthorityReadback(authority),
        visibleRuntimeIntent: this.visibleRuntimeIntent(transitionAuth, 'initial'),
      });
      this.validateConfirmation(verified, transitionAuth, authority, 'verified');
      transition = this.updateTransition(transition, { phase: 'identity_verified' });
      this.throwIfStopping();

      stage = 'scheduler';
      await this.assertPolicySuppressed(auth, input.policyGuard);
      const schedulerIdentity = deriveStoreCollectionSchedulerExecutionIdentity({
        cycleId,
        transitionId: transition.transitionId,
        fingerprint: due.expectedFingerprint,
        transitionScope: transitionAuth.transitionScope,
        context,
      });
      transition = this.updateTransition(transition, {
        phase: 'scheduler_request_bound',
        schedulerAttemptId: schedulerIdentity.attemptId,
        schedulerRequestId: schedulerIdentity.requestId,
      });
      attemptId = schedulerIdentity.attemptId;
      requestId = schedulerIdentity.requestId;
      const accepted = await this.dependencies.scheduler.execute({
        ...transitionAuth,
        context,
        expectedAuthority: cloneAuthorityReadback(authority),
        cycleId,
        transitionId: transition.transitionId,
        expectedFingerprint: due.expectedFingerprint,
        ...schedulerIdentity,
      });
      this.validateSchedulerAccepted(accepted, {
        auth: transitionAuth,
        context,
        cycleId,
        transitionId: transition.transitionId,
        expectedFingerprint: due.expectedFingerprint,
      });
      transition = this.updateTransition(transition, { phase: 'scheduler_accepted' });
      const recoveryAdmission = await this.registerProtectedSchedulerRecoveryAdmission(
        transition,
        auth,
      );
      const recoveryAuth = await this.deriveTransitionAuthority(
        transition,
        auth,
        input.policyGuard,
        'recovery_existing_request_only',
        recoveryAdmission,
      );
      const projection = await this.dependencies.scheduler.recover({
        ...recoveryAuth,
        context,
        expectedAuthority: cloneAuthorityReadback(authority),
        cycleId,
        transitionId: transition.transitionId,
        expectedFingerprint: due.expectedFingerprint,
        ...schedulerIdentity,
      });
      const recoveredState = this.validateSchedulerRecovery(projection, {
        auth: recoveryAuth,
        executionIdentityScope: transitionAuth.transitionScope,
        context,
        cycleId,
        transitionId: transition.transitionId,
        expectedFingerprint: due.expectedFingerprint,
      });
      if (recoveredState === 'failed') {
        this.setCapabilityLifecycle(
          recoveryAuth.transitionCapability,
          'transition_recovery',
          'retired',
        );
        schedulerDefinitivelyFailed = true;
        throw new SchedulerDefinitivelyFailedSignal();
      }
      if (recoveredState !== 'succeeded') {
        throw new SchedulerResolutionUnknownSignal();
      }
      this.setCapabilityLifecycle(
        recoveryAuth.transitionCapability,
        'transition_recovery',
        'retired',
      );
      schedulerSucceeded = true;
      transition = this.updateTransition(transition, {
        phase: 'scheduler_reconciled',
      });
      outcomeState = 'succeeded';
      failureCode = undefined as never;
      bodyFinished = true;
    } catch (error) {
      if (error instanceof StopRequestedSignal) {
        failureCode = 'APP_EXIT_INTERRUPTED';
        mustStop = true;
      } else if (error instanceof SchedulerDefinitivelyFailedSignal) {
        failureCode = 'SCHEDULER_FAILED';
        outcomeState = 'failed';
        bodyFinished = true;
      } else if (error instanceof ManualContextDriftSignal) {
        failureCode = 'SCHEDULE_PRECHECK_FAILED';
        outcomeState = 'blocked';
        bodyFinished = true;
        mustStop = true;
      } else if (error instanceof SchedulerResolutionUnknownSignal
        || transition.phase === 'scheduler_request_bound'
        || transition.phase === 'scheduler_accepted') {
        failureCode = 'SAFETY_STATE_UNKNOWN';
        schedulerResolutionUnknown = true;
        criticalError = this.markSafetyUnknown(error);
        mustStop = true;
      } else if (isIdentityFailure(error)) {
        failureCode = normalizeIdentityFailure(error);
        outcomeState = 'blocked';
        bodyFinished = true;
      } else if (isCriticalSafetyError(error)) {
        failureCode = normalizeFailureCode(error, 'SAFETY_STATE_UNKNOWN');
        criticalError = this.markSafetyUnknown(error);
        mustStop = true;
      } else if (error instanceof StoreCollectionOrchestratorError
        && error.code === 'SAFETY_STATE_UNKNOWN') {
        failureCode = error.code;
        criticalError = this.markSafetyUnknown(error);
        mustStop = true;
      } else {
        if (stage === 'runtime_start') {
          failureCode = 'RUNTIME_START_FAILED';
        } else if (stage === 'identity') {
          failureCode = 'IDENTITY_UNVERIFIED';
          outcomeState = 'blocked';
        } else if (stage === 'scheduler') {
          failureCode = 'SCHEDULER_FAILED';
        } else {
          failureCode = 'TRANSITION_FAILED';
          mustStop = true;
        }
        bodyFinished = stage !== 'transition';
      }
    } finally {
      if (context) {
        try {
          if (!schedulerResolutionUnknown && !schedulerDefinitivelyFailed) {
            transition = this.updateTransition(transition, { phase: 'cleanup_pending' });
          }
        } catch (error) {
          criticalError = combineFailures(criticalError, this.markSafetyUnknown(error));
        }
      }
      try {
        const expected = await this.readTransitionAuthority(transitionAuth, authority);
        authority = await this.closeAndConfirm(transitionAuth, expected, 'terminal_cleanup');
      } catch (error) {
        criticalError = combineFailures(criticalError, this.markSafetyUnknown(error));
        failureCode = normalizeFailureCode(error, 'SAFETY_STATE_UNKNOWN');
        outcomeState = 'failed';
        cleanupStatus = 'unknown';
        mustStop = true;
      }
    }

    // Keep the collection transition non-terminal until the durable restore
    // transition has proved the operator authority, final runtime close, and
    // collection-lease release. A crash anywhere before this point therefore
    // leaves a recoverable collection/restore transition in history.
    try {
      authority = await this.restoreOperatorStore({
        cycleId,
        currentAuthority: authority,
        operatorAuthority: originAuthority,
        auth,
        policyGuard: input.policyGuard,
      });
      input.onRestored();
    } catch (restoreError) {
      criticalError = combineFailures(criticalError, restoreError);
      failureCode = 'OPERATOR_STORE_RESTORE_FAILED';
      outcomeState = 'failed';
      cleanupStatus = 'unknown';
      mustStop = true;
    }

    if (schedulerResolutionUnknown) {
      throw criticalError ?? this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'scheduler 请求结果无法按 durable attempt/request 归因；保留非终态等待恢复查询。',
      ));
    }

    const terminalPhase: TransitionPhase = outcomeState === 'succeeded'
      ? 'completed'
      : outcomeState === 'blocked'
        ? 'blocked'
        : 'failed';
    const completedAt = this.now().toISOString();
    let outcome: StoreCollectionOrchestratorOutcome;
    try {
      ({ transition, outcome } = this.completeCollectionTransition(transition, {
        phase: terminalPhase,
        completedAt,
        ...(failureCode ? { failureCode } : {}),
      }, {
        outcomeId: randomUUID(),
        cycleId,
        transitionId: transition.transitionId,
        owner: auth.owner,
        storeId: due.store.storeId,
        browserProfileId: due.store.browserProfileId,
        ...(context ? {
          businessDate: context.businessDate,
          sessionGeneration: context.sessionGeneration,
        } : {}),
        fingerprint: due.expectedFingerprint,
        ...(attemptId ? { attemptId } : {}),
         ...(requestId ? { requestId } : {}),
        schedulerSucceeded,
        cleanupStatus,
        state: outcomeState,
        startedAt,
        completedAt,
        ...(failureCode ? { failureCode } : {}),
      }));
    } catch (error) {
      criticalError = combineFailures(criticalError, this.markSafetyUnknown(error));
      throw criticalError;
    }
    this.setCapabilityLifecycle(transitionAuth.transitionCapability, 'transition_execution', 'retired');
    if (criticalError) throw criticalError;
    if (!bodyFinished && outcomeState === 'failed') mustStop = true;
    return { outcome, authority, mustStop };
  }

  private async restoreOperatorStore(input: {
    cycleId: string;
    currentAuthority: StoreCollectionAuthorityReadback;
    operatorAuthority: StoreCollectionAuthorityReadback;
    auth: StoreCollectionAutomationAuthority;
    policyGuard: StoreCollectionPolicySuppressionGuard;
  }): Promise<StoreCollectionAuthorityReadback> {
    const { auth, operatorAuthority } = input;
    let transition = this.newTransition({
      cycleId: input.cycleId,
      owner: auth.owner,
      fromStoreId: input.currentAuthority.activeStoreId,
      store: operatorAuthority.context ? storeFromContext(operatorAuthority.context) : null,
      fromAuthority: input.currentAuthority,
      originAuthority: operatorAuthority,
      startedAt: this.now().toISOString(),
      purpose: 'restore',
    });
    let transitionAuth: StoreCollectionExecutionAutomationAuthority | undefined;
    let readback = cloneAuthorityReadback(input.currentAuthority);
    let restoreFailure: unknown;
    try {
      this.appendTransition(transition);
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
    try {
      transitionAuth = await this.deriveTransitionAuthority(
        transition,
        auth,
        input.policyGuard,
        'transition_execution',
      );
      transition = this.updateTransition(transition, { phase: 'authority_touch_pending' });
      readback = await this.readTransitionAuthority(transitionAuth, readback);
      readback = await this.closeAndConfirm(transitionAuth, readback, 'initial');
      transition = this.updateTransition(transition, { phase: 'previous_closed' });

      if (!authorityMatchesRestoreTarget(readback, operatorAuthority)) {
        await this.assertPolicySuppressed(auth, input.policyGuard);
        const target = operatorAuthority.context
          ? transitionTargetFromContext(operatorAuthority.context)
          : null;
        const receipt = await this.dependencies.transitionAuthorityForCollection({
          ...transitionAuth,
          reason: 'collection_automation',
          mode: 'collection_only',
          previous: cloneAuthorityReadback(readback),
          target,
        });
        this.validateTransitionReceipt(receipt, {
          auth: transitionAuth,
          expectedPrevious: readback,
          target,
          minimumTargetAuthority: operatorAuthority,
        });
        await this.assertPolicySuppressed(auth, input.policyGuard);
        readback = await this.readTransitionAuthority(transitionAuth, receipt.current);
        this.assertAuthorityExact(readback, receipt.current);
      }
      transition = this.updateTransition(transition, {
        phase: 'activated',
        ...(readback.context ? {
          businessDate: readback.context.businessDate,
          sessionGeneration: readback.context.sessionGeneration,
        } : {}),
      });
      const activatedAuthority = cloneAuthorityReadback(readback);
      transition = this.updateTransition(transition, { phase: 'cleanup_pending' });

      // A restore is not terminal until authority, runtime close and collection
      // lease release have all been independently re-read under this transition capability.
      readback = await this.readTransitionAuthority(transitionAuth, readback);
      readback = await this.closeAndConfirm(transitionAuth, readback, 'terminal_cleanup');
      this.assertAuthorityExact(readback, activatedAuthority);
      if (!authorityMatchesRestoreTarget(readback, operatorAuthority)) {
        throw new StoreCollectionOrchestratorError(
          'OPERATOR_STORE_RESTORE_FAILED',
          '未能证明操作员原店铺或原空 authority 已恢复。',
        );
      }
      transition = this.updateTransition(transition, {
        phase: 'completed',
        completedAt: this.now().toISOString(),
      });
      this.setCapabilityLifecycle(transitionAuth.transitionCapability, 'transition_execution', 'retired');
      return readback;
    } catch (error) {
      restoreFailure = error;
      const failureCode = normalizeFailureCode(error, 'OPERATOR_STORE_RESTORE_FAILED');
      let cleanupProven = false;
      if (transitionAuth) {
        try {
          readback = await this.readTransitionAuthority(transitionAuth, readback);
          readback = await this.closeAndConfirm(transitionAuth, readback, 'terminal_cleanup');
          cleanupProven = authorityMatchesRestoreTarget(readback, operatorAuthority);
        } catch (cleanupError) {
          restoreFailure = combineFailures(restoreFailure, cleanupError);
        }
      }
      try {
        if (!isTerminalPhase(transition.phase) && cleanupProven) {
          transition = this.updateTransition(transition, {
            phase: 'failed',
            completedAt: this.now().toISOString(),
            failureCode,
          });
          this.setCapabilityLifecycle(
            transitionAuth!.transitionCapability,
            'transition_execution',
            'retired',
          );
        }
      } catch (historyError) {
        restoreFailure = combineFailures(restoreFailure, historyError);
      }
      throw this.markSafetyUnknown(combineFailures(
        restoreFailure,
        new StoreCollectionOrchestratorError(
          'OPERATOR_STORE_RESTORE_FAILED',
          '未能证明操作员原店铺已恢复且可见采集运行时已关闭。',
        ),
      ));
    }
  }

  private async closeAndConfirm(
    auth: StoreCollectionExecutionAutomationAuthority,
    expectedAuthority: StoreCollectionAuthorityReadback,
    intent: 'initial' | 'terminal_cleanup',
  ): Promise<StoreCollectionAuthorityReadback> {
    this.assertAuthorityWithinTransitionScope(auth, expectedAuthority);
    const visibleRuntimeIntent = this.visibleRuntimeIntent(auth, intent);
    let closeResult: Awaited<ReturnType<StoreCollectionOrchestratorDependencies['closeVisibleRuntime']>>;
    try {
      closeResult = await this.dependencies.closeVisibleRuntime({
        ...auth,
        expectedAuthority: cloneAuthorityReadback(expectedAuthority),
        visibleRuntimeIntent,
      });
      if (!closeResult || closeResult.closed !== true) {
        throw new Error('invalid close confirmation');
      }
      this.assertTransitionCapabilityBound(closeResult, auth);
      this.assertAuthorityExact(closeResult.authority, expectedAuthority);
    } catch (error) {
      if (error instanceof StoreCollectionOrchestratorError
        && error.code === 'SAFETY_STATE_UNKNOWN') {
        throw error;
      }
      throw new StoreCollectionOrchestratorError('RUNTIME_CLOSE_FAILED', '无法证明可见采集运行时已关闭。');
    }
    try {
      const leaseResult = await this.dependencies.assertCollectionLeaseReleased({
        ...auth,
        expectedAuthority: cloneAuthorityReadback(expectedAuthority),
        visibleRuntimeIntent,
      });
      if (!leaseResult || leaseResult.released !== true) {
        throw new Error('invalid collection lease confirmation');
      }
      this.assertTransitionCapabilityBound(leaseResult, auth);
      this.assertAuthorityExact(leaseResult.authority, expectedAuthority);
    } catch (error) {
      if (error instanceof StoreCollectionOrchestratorError
        && error.code === 'SAFETY_STATE_UNKNOWN') {
        throw error;
      }
      throw new StoreCollectionOrchestratorError('COLLECTION_LEASE_ACTIVE', '无法证明采集租约已释放。');
    }
    const finalReadback = await this.readTransitionAuthority(auth, expectedAuthority);
    this.assertAuthorityExact(finalReadback, expectedAuthority);
    return finalReadback;
  }

  private visibleRuntimeIntent(
    auth: StoreCollectionExecutionAutomationAuthority,
    intent: 'initial' | 'terminal_cleanup',
  ): StoreCollectionVisibleRuntimeIntent {
    let record = this.visibleRuntimeIntents.get(auth.transitionCapability);
    if (!record) {
      if (intent !== 'initial') {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'visible runtime terminal cleanup intent was requested before initial intent issuance.',
        ));
      }
      const domainCapability = Object.freeze({});
      const initialCapability = Object.freeze({});
      const terminalCleanupCapability = Object.freeze({});
      record = Object.freeze({
        initial: Object.freeze({
          domainCapability,
          initialCapability,
          terminalCleanupCapability,
          selectedCapability: initialCapability,
        }) as StoreCollectionVisibleRuntimeIntent,
        terminalCleanup: Object.freeze({
          domainCapability,
          initialCapability,
          terminalCleanupCapability,
          selectedCapability: terminalCleanupCapability,
        }) as StoreCollectionVisibleRuntimeIntent,
      });
      this.visibleRuntimeIntents.set(auth.transitionCapability, record);
    }
    return intent === 'initial' ? record.initial : record.terminalCleanup;
  }

  private async readAuthority(
    auth: StoreCollectionAutomationAuthority,
  ): Promise<StoreCollectionAuthorityReadback> {
    try {
      const confirmation = await this.dependencies.readActiveAuthority(auth);
      this.assertCapabilityBound(confirmation, auth);
      this.assertAuthority(confirmation.authority);
      return cloneAuthorityReadback(confirmation.authority);
    } catch {
      throw this.markSafetyUnknown(
        new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'Main authority 回读失败。'),
      );
    }
  }

  private async readTransitionAuthority(
    auth: StoreCollectionExecutionAutomationAuthority,
    expectedAuthority: StoreCollectionAuthorityReadback,
  ): Promise<StoreCollectionAuthorityReadback> {
    this.assertAuthorityWithinTransitionScope(auth, expectedAuthority);
    try {
      const confirmation = await this.dependencies.readTransitionAuthority({
        ...auth,
        expectedAuthority: cloneAuthorityReadback(expectedAuthority),
      });
      this.assertTransitionCapabilityBound(confirmation, auth);
      this.assertAuthorityExact(confirmation.authority, expectedAuthority);
      return cloneAuthorityReadback(confirmation.authority);
    } catch {
      throw this.markSafetyUnknown(
        new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'Main transition-scoped authority 回读失败。',
        ),
      );
    }
  }

  private assertAuthorityWithinTransitionScope(
    auth: StoreCollectionExecutionAutomationAuthority,
    authority: StoreCollectionAuthorityReadback,
  ): void {
    this.assertAuthority(authority);
    const scope = auth.transitionScope;
    const allowed = sameAuthority(authority, scope.fromAuthority)
      || authorityMatchesRestoreTarget(authority, scope.originAuthority)
      || authorityMatchesTransitionTarget(authority, scope.target);
    if (!allowed) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'authority 不在当前 transition capability 的 Store/Profile/Generation scope 内。',
      ));
    }
  }

  private validateTransitionReceipt(
    receipt: StoreCollectionTransitionReceipt,
    input: {
      auth: StoreCollectionExecutionAutomationAuthority;
      expectedPrevious: StoreCollectionAuthorityReadback;
      target: StoreCollectionTransitionTarget | null;
      minimumTargetAuthority?: StoreCollectionAuthorityReadback;
    },
  ): StoreContextEnvelope | null {
    this.assertAuthorityWithinTransitionScope(input.auth, input.expectedPrevious);
    const recoveryTarget = input.auth.transitionScope.originAuthority.context
      ? transitionTargetFromContext(input.auth.transitionScope.originAuthority.context)
      : null;
    if (!sameTransitionTarget(input.target, input.auth.transitionScope.target)
      && !sameTransitionTarget(input.target, recoveryTarget)) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '切店目标不在当前 transition capability scope 内。',
      ));
    }
    if (!receipt
      || receipt.reason !== 'collection_automation'
      || receipt.mode !== 'collection_only') {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '切店回执缺少 collection-only 模式证明。',
      ));
    }
    this.assertTransitionCapabilityBound(receipt, input.auth);
    this.assertAuthorityExact(receipt.previous, input.expectedPrevious);
    if (input.target === null) {
      if (receipt.current.activeStoreId !== null
        || receipt.current.context !== null
        || receipt.targetGenerationBefore !== null
        || receipt.targetGenerationAfter !== null) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          '空 authority 恢复回执无效。',
        ));
      }
      return null;
    }
    if (!Number.isInteger(receipt.targetGenerationBefore)
      || !Number.isInteger(receipt.targetGenerationAfter)
      || (receipt.targetGenerationAfter ?? -1) <= (receipt.targetGenerationBefore ?? -1)) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '切店回执缺少 generation 单调递增证明。',
      ));
    }
    this.assertAuthority(receipt.current, input.target.storeId);
    if (!receipt.current.context) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '切店回执缺少目标 StoreContext。',
      ));
    }
    const context = normalizeStoreContextEnvelope(receipt.current.context);
    if (context.storeId !== input.target.storeId
      || context.browserProfileId !== input.target.browserProfileId
      || context.marketplace !== 'US'
      || context.currency !== 'USD'
      || context.businessTimezone !== 'America/Los_Angeles'
      || context.sessionGeneration !== receipt.targetGenerationAfter) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '切店回执与目标店铺或 generation 不一致。',
      ));
    }
    if (input.expectedPrevious.context) {
      const previousContext = normalizeStoreContextEnvelope(input.expectedPrevious.context);
      if (previousContext.storeId === context.storeId
        && previousContext.browserProfileId === context.browserProfileId
        && (
          receipt.targetGenerationBefore !== previousContext.sessionGeneration
          || context.sessionGeneration <= previousContext.sessionGeneration
          || codepointCompare(context.businessDate, previousContext.businessDate) < 0
        )) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'same Store/Profile transition 未证明 previous generation/date 的严格单调推进。',
        ));
      }
    }
    if (input.minimumTargetAuthority) {
      const durableTarget = input.minimumTargetAuthority;
      if (durableTarget.activeStoreId !== input.target.storeId
        || !durableTarget.context) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'durable restore origin 与目标 StoreContext 不一致。',
        ));
      }
      const durableContext = normalizeStoreContextEnvelope(durableTarget.context);
      if (durableContext.storeId !== context.storeId
        || durableContext.browserProfileId !== context.browserProfileId
        || durableContext.marketplace !== 'US'
        || durableContext.currency !== 'USD'
        || durableContext.businessTimezone !== 'America/Los_Angeles'
        || (receipt.targetGenerationBefore ?? -1) < durableContext.sessionGeneration
        || context.sessionGeneration <= durableContext.sessionGeneration
        || codepointCompare(context.businessDate, durableContext.businessDate) < 0) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'restore 回执未证明完整 US/USD/LA context、日期单调性或 durable generation 递增。',
        ));
      }
    }
    return context;
  }

  private validateConfirmation(
    confirmation: AuthorityBoundConfirmation & Partial<Record<'started' | 'verified', true>>,
    auth: StoreCollectionExecutionAutomationAuthority,
    expectedAuthority: StoreCollectionAuthorityReadback,
    flag: 'started' | 'verified',
  ): void {
    if (!confirmation || confirmation[flag] !== true) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '可见采集阶段回执缺少当前 capability 证明。',
      ));
    }
    this.assertTransitionCapabilityBound(confirmation, auth);
    this.assertAuthorityExact(confirmation.authority, expectedAuthority);
  }

  private validateSchedulerAccepted(
    projection: StoreCollectionOrchestratorSchedulerProjection<'transition_execution'>,
    input: {
      auth: StoreCollectionExecutionAutomationAuthority;
      context: StoreContextEnvelope;
      cycleId: string;
      transitionId: string;
      expectedFingerprint: string;
    },
  ): void {
    if (input.auth.transitionScope.capabilityDomain !== 'transition_execution') {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'scheduler execute 仅接受 transition_execution capability。',
      ));
    }
    this.validateSchedulerProjectionBinding(
      projection,
      input,
      input.auth.transitionScope,
    );
    if (projection.state !== 'accepted'
      || projection.accepted !== true
      || projection.duplicate !== false) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'scheduler execute 未返回 exact durable request 的 accepted 证明。',
      ));
    }
  }

  private validateSchedulerRecovery(
    projection: StoreCollectionOrchestratorSchedulerProjection<'recovery_existing_request_only'>,
    input: {
      auth: StoreCollectionRecoveryAutomationAuthority;
      executionIdentityScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
      context: StoreContextEnvelope;
      cycleId: string;
      transitionId: string;
      expectedFingerprint: string;
    },
  ): 'accepted' | 'succeeded' | 'failed' | 'not_found' | 'unknown' {
    if (input.auth.transitionScope.capabilityDomain !== 'recovery_existing_request_only') {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'scheduler recover 仅接受 recovery_existing_request_only capability。',
      ));
    }
    this.validateSchedulerProjectionBinding(
      projection,
      input,
      input.executionIdentityScope,
    );
    if (projection.state === 'accepted'
      || projection.state === 'succeeded'
      || projection.state === 'failed') {
      if (projection.accepted !== true || projection.duplicate !== false) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'scheduler recover 状态未绑定已接受的 exact durable request。',
        ));
      }
      return projection.state;
    }
    if (projection.state === 'not_found') {
      if (projection.accepted !== undefined || projection.duplicate !== undefined) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'scheduler recover 的 not_found 回执不得携带已接受标记。',
        ));
      }
      return projection.state;
    }
    return 'unknown';
  }

  private validateSchedulerProjectionBinding<Domain extends StoreCollectionTransitionCapabilityDomain>(
    projection: StoreCollectionOrchestratorSchedulerProjection<Domain>,
    input: {
      auth: StoreCollectionTransitionAutomationAuthority<Domain>;
      context: StoreContextEnvelope;
      cycleId: string;
      transitionId: string;
      expectedFingerprint: string;
    },
    executionIdentityScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>,
  ): void {
    const expectedIdentity = deriveStoreCollectionSchedulerExecutionIdentity({
      cycleId: input.cycleId,
      transitionId: input.transitionId,
      fingerprint: input.expectedFingerprint,
      transitionScope: executionIdentityScope,
      context: input.context,
    });
    if (!projection
      || projection.cycleId !== input.cycleId
      || projection.transitionId !== input.transitionId
      || projection.fingerprint !== input.expectedFingerprint
      || projection.attemptId !== expectedIdentity.attemptId
      || projection.requestId !== expectedIdentity.requestId) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'scheduler 回执无法归因到 exact cycle/transition/fingerprint/attempt/request。',
      ));
    }
    this.assertTransitionCapabilityBound(projection, input.auth);
    this.assertAuthority(projection.authority, input.context.storeId);
    this.assertAuthorityExact(projection.authority, { activeStoreId: input.context.storeId, context: input.context });
  }

  private assertAuthority(value: StoreCollectionAuthorityReadback | undefined, expectedStoreId?: StoreId | null): void {
    if (!value || (value.activeStoreId !== null && typeof value.activeStoreId !== 'string')) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'authority 回读无效。'));
    }
    if (value.activeStoreId === null) {
      if (value.context !== null) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'authority 空店铺仍携带上下文。'));
      }
    } else {
      if (!value.context) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'authority 缺少活动上下文。'));
      }
      let context: StoreContextEnvelope;
      try {
        context = normalizeStoreContextEnvelope(value.context);
      } catch {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'authority 上下文无效。'));
      }
      if (context.storeId !== value.activeStoreId) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'authority 店铺与上下文不一致。'));
      }
    }
    if (expectedStoreId !== undefined && value.activeStoreId !== expectedStoreId) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'authority 活动店铺与预期不一致。'));
    }
  }

  private assertAuthorityExact(
    actual: StoreCollectionAuthorityReadback,
    expected: StoreCollectionAuthorityReadback,
  ): void {
    this.assertAuthority(actual);
    this.assertAuthority(expected);
    if (!sameAuthority(actual, expected)) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'capability-bound authority 的 Store/Profile/Generation 上下文不一致。',
      ));
    }
  }

  private assertCapabilityBound(
    value: StoreCollectionAutomationAuthority | undefined,
    auth: StoreCollectionAutomationAuthority,
  ): void {
    this.assertCapabilityIdentity(auth.capability, 'automation', 'active');
    if (!value || value.owner !== auth.owner || value.capability !== auth.capability) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '阶段回执未绑定当前不可重放 automation capability。',
      ));
    }
  }

  private assertTransitionCapabilityBound<Domain extends StoreCollectionTransitionCapabilityDomain>(
    value: StoreCollectionTransitionAutomationAuthority<Domain> | undefined,
    auth: StoreCollectionTransitionAutomationAuthority<Domain>,
  ): void {
    this.assertCapabilityBound(value, auth);
    this.assertCapabilityIdentity(
      auth.transitionCapability,
      capabilityIdentityDomain(auth.transitionScope.capabilityDomain),
      'active',
    );
    if (!value
      || value.transitionCapability !== auth.transitionCapability
      || value.transitionScope !== auth.transitionScope) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '阶段回执未绑定当前 transition capability 与完整 scope。',
      ));
    }
  }

  private registerCapabilityIdentity(
    value: Readonly<object>,
    record: CapabilityIdentityRecord,
  ): void {
    if (this.capabilityIdentityRegistry.has(value)) {
      throw new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'Main 重用了 capability 对象或把同一对象签发到不同 authority domain。',
      );
    }
    this.capabilityIdentityRegistry.set(value, { ...record });
  }

  private hasRegisteredCapabilityIdentity(value: unknown): boolean {
    return runtimeCapability(value) && this.capabilityIdentityRegistry.has(value);
  }

  private assertCapabilityIdentity(
    value: Readonly<object>,
    domain: CapabilityIdentityDomain,
    lifecycle: CapabilityIdentityLifecycle,
  ): void {
    const record = this.capabilityIdentityRegistry.get(value);
    if (!record || record.domain !== domain || record.lifecycle !== lifecycle) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        `capability identity 未绑定 active ${domain} lifecycle。`,
      ));
    }
  }

  private setCapabilityLifecycle(
    value: Readonly<object>,
    domain: CapabilityIdentityDomain,
    lifecycle: CapabilityIdentityLifecycle,
  ): void {
    const record = this.capabilityIdentityRegistry.get(value);
    if (!record || record.domain !== domain || record.lifecycle !== 'active') {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        `capability identity 无法进入 ${lifecycle} lifecycle。`,
      ));
    }
    this.capabilityIdentityRegistry.set(value, { ...record, lifecycle });
  }

  private async registerProtectedSchedulerRecoveryAdmission(
    transition: StoreCollectionOrchestratorTransition,
    auth: StoreCollectionAutomationAuthority,
  ): Promise<ProtectedSchedulerRecoveryAdmission> {
    const verifiedMatches = this.readPendingTransitions().filter((candidate) => (
      candidate.transitionId === transition.transitionId
    ));
    const verified = verifiedMatches[0];
    if (verifiedMatches.length !== 1
      || !verified
      || verified.integrityDigest !== transition.integrityDigest
      || !isSchedulerBoundPendingTransition(verified)) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'protected history 未唯一证明 scheduler-bound pending transition。',
      ));
    }
    const context = contextFromTransition(verified);
    const executionScope = freezeTransitionScope(
      transitionScopeFromTransition(verified, 'transition_execution'),
    );
    const identity = deriveStoreCollectionSchedulerExecutionIdentity({
      cycleId: verified.cycleId,
      transitionId: verified.transitionId,
      fingerprint: verified.expectedFingerprint!,
      transitionScope: executionScope,
      context,
    });
    if (identity.attemptId !== verified.schedulerAttemptId
      || identity.requestId !== verified.schedulerRequestId) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'protected history 的 scheduler attempt/request 无法由 execution scope 复算。',
      ));
    }
    const scopeDigest = storeCollectionSchedulerRecoveryAdmissionScopeDigest({
      executionScope,
      context,
      attemptId: identity.attemptId,
      requestId: identity.requestId,
    });
    const receipt = await this.dependencies.registerSchedulerRecoveryAdmission({
      ...auth,
      executionScope,
      context,
      attemptId: identity.attemptId,
      requestId: identity.requestId,
    });
    this.assertCapabilityBound(receipt, auth);
    if (!receipt
      || receipt.registered !== true
      || !runtimeCapability(receipt.recoveryAdmission)
      || receipt.executionScope !== executionScope
      || receipt.context !== context
      || receipt.attemptId !== identity.attemptId
      || receipt.requestId !== identity.requestId
      || receipt.scopeDigest !== scopeDigest) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'recovery admission 回执未绑定 verified history execution scope/attempt/request。',
      ));
    }
    this.registerCapabilityIdentity(receipt.recoveryAdmission, {
      domain: 'recovery_admission',
      lifecycle: 'active',
      owner: auth.owner,
      cycleId: verified.cycleId,
      transitionId: verified.transitionId,
    });
    return {
      recoveryAdmission: receipt.recoveryAdmission,
      executionScope,
      context,
      attemptId: identity.attemptId,
      requestId: identity.requestId,
      scopeDigest,
    };
  }

  private async deriveTransitionAuthority<Domain extends StoreCollectionTransitionCapabilityDomain>(
    transition: StoreCollectionOrchestratorTransition,
    auth: StoreCollectionAutomationAuthority,
    policyGuard: StoreCollectionPolicySuppressionGuard,
    capabilityDomain: Domain,
    recoveryAdmission?: ProtectedSchedulerRecoveryAdmission,
  ): Promise<StoreCollectionTransitionAutomationAuthority<Domain>> {
    const scope = freezeTransitionScope(transitionScopeFromTransition(transition, capabilityDomain));
    let receipt: StoreCollectionTransitionCapabilityReceipt<Domain>;
    try {
      if ((capabilityDomain === 'recovery_existing_request_only') !== Boolean(recoveryAdmission)) {
        throw new Error('recovery transition capability requires one protected-history admission');
      }
      receipt = await this.dependencies.deriveTransitionCapability({
        ...auth,
        scope,
        ...(recoveryAdmission ? {
          recoveryAdmission: recoveryAdmission.recoveryAdmission,
          recoveryScopeDigest: recoveryAdmission.scopeDigest,
          schedulerAttemptId: recoveryAdmission.attemptId,
          schedulerRequestId: recoveryAdmission.requestId,
        } : {}),
      });
      if (!receipt || receipt.derived !== true || !runtimeCapability(receipt.transitionCapability)) {
        throw new Error('invalid transition capability receipt');
      }
      this.assertCapabilityBound(receipt, auth);
      if (receipt.transitionScope !== scope
        || this.issuedTransitionCapabilityIds.has(scope.capabilityId)) {
        throw new Error('replayed, aliased, or scope-mismatched transition capability');
      }
      if (recoveryAdmission) {
        this.assertCapabilityIdentity(
          recoveryAdmission.recoveryAdmission,
          'recovery_admission',
          'active',
        );
        if (receipt.recoveryAdmission !== recoveryAdmission.recoveryAdmission
          || receipt.recoveryScopeDigest !== recoveryAdmission.scopeDigest
          || receipt.schedulerAttemptId !== recoveryAdmission.attemptId
          || receipt.schedulerRequestId !== recoveryAdmission.requestId) {
          throw new Error('recovery capability receipt did not consume the exact protected-history admission');
        }
      } else if (receipt.recoveryAdmission !== undefined
        || receipt.recoveryScopeDigest !== undefined
        || receipt.schedulerAttemptId !== undefined
        || receipt.schedulerRequestId !== undefined) {
        throw new Error('execution capability receipt carried an unauthorized recovery admission');
      }
      this.registerCapabilityIdentity(receipt.transitionCapability, {
        domain: capabilityIdentityDomain(capabilityDomain),
        lifecycle: 'active',
        owner: auth.owner,
        cycleId: transition.cycleId,
        transitionId: transition.transitionId,
      });
      this.assertCapabilityIdentity(policyGuard, 'policy', 'active');
      this.issuedTransitionCapabilityIds.add(scope.capabilityId);
      if (recoveryAdmission) {
        this.setCapabilityLifecycle(
          recoveryAdmission.recoveryAdmission,
          'recovery_admission',
          'retired',
        );
      }
      return {
        ...auth,
        transitionCapability: receipt.transitionCapability,
        transitionScope: scope,
      };
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
  }

  private assertFreshAutomationLease(value: StoreCollectionAutomationLease, cycleId: string): void {
    assertAutomationLease(value);
    this.registerCapabilityIdentity(value.capability, {
      domain: 'automation',
      lifecycle: 'active',
      owner: value.owner,
      cycleId,
    });
  }

  private async releaseMalformedAutomationLease(value: unknown): Promise<void> {
    if (!value || typeof value !== 'object' || typeof (value as { release?: unknown }).release !== 'function') return;
    try {
      await (value as { release(): Promise<unknown> }).release();
    } catch {
      // The caller marks the state unknown whether or not this best-effort release succeeds.
    }
  }

  private async releaseAutomationLease(
    lease: StoreCollectionAutomationLease,
    auth: StoreCollectionAutomationAuthority,
  ): Promise<void> {
    const receipt = await lease.release();
    if (!receipt || receipt.released !== true) throw new Error('automation lease release not proven');
    this.assertCapabilityBound(receipt, auth);
    this.setCapabilityLifecycle(auth.capability, 'automation', 'released');
  }

  private async acquirePolicySuppression(
    auth: StoreCollectionAutomationAuthority,
    cycleId: string,
  ): Promise<StoreCollectionPolicySuppressionLease> {
    let acquired: StoreCollectionPolicySuppressionLease;
    try {
      acquired = await this.dependencies.acquirePolicyDispatchSuppression(auth);
    } catch {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '无法获得独立 policy dispatch suppression guard。',
      ));
    }
    try {
      assertPolicySuppressionLease(acquired);
      this.assertCapabilityBound(acquired, auth);
      this.registerCapabilityIdentity(acquired.guard, {
        domain: 'policy',
        lifecycle: 'active',
        owner: auth.owner,
        cycleId,
      });
      return acquired;
    } catch (error) {
      // A guard that cannot be proven fresh and domain-distinct must remain
      // suppressed. Calling release here could release an aliased or replayed
      // authority object whose ownership is unknown.
      throw this.markSafetyUnknown(error);
    }
  }

  private async assertPolicySuppressed(
    auth: StoreCollectionAutomationAuthority,
    guard: StoreCollectionPolicySuppressionGuard,
  ): Promise<void> {
    this.assertCapabilityIdentity(guard, 'policy', 'active');
    try {
      const receipt = await this.dependencies.readPolicyDispatchSuppression({ ...auth, guard });
      if (!receipt || receipt.suppressed !== true || receipt.guard !== guard) {
        throw new Error('invalid policy suppression proof');
      }
      this.assertCapabilityBound(receipt, auth);
    } catch (error) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '独立 policy guard 未证明 dispatch 持续被抑制。',
      ));
    }
  }

  private async releasePolicySuppression(
    lease: StoreCollectionPolicySuppressionLease,
    auth: StoreCollectionAutomationAuthority,
  ): Promise<void> {
    this.assertCapabilityIdentity(lease.guard, 'policy', 'active');
    const receipt = await lease.release();
    if (!receipt || receipt.released !== true || receipt.guard !== lease.guard) {
      throw new Error('policy suppression release not proven');
    }
    this.assertCapabilityBound(receipt, auth);
    this.setCapabilityLifecycle(lease.guard, 'policy', 'released');
  }

  private throwIfStopping(): void {
    if (this.stopRequested) throw new StopRequestedSignal();
  }

  private assertAuthorityAgainstActiveStoreSnapshot(
    authority: StoreCollectionAuthorityReadback,
    activeStores: readonly StoreRecord[],
  ): void {
    this.assertAuthority(authority);
    if (authority.activeStoreId === null) return;
    const context = normalizeStoreContextEnvelope(authority.context!);
    const exactStore = activeStores.find((store) => (
      store.storeId === authority.activeStoreId
      && store.browserProfileId === context.browserProfileId
    ));
    if (!exactStore
      || context.storeId !== authority.activeStoreId
      || context.marketplace !== 'US'
      || context.currency !== 'USD'
      || context.businessTimezone !== 'America/Los_Angeles'
      || exactStore.marketplace !== context.marketplace
      || exactStore.currency !== context.currency
      || exactStore.businessTimezone !== context.businessTimezone) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'authority 未与 activeStores 的 US/USD/America/Los_Angeles Store/Profile snapshot 精确绑定。',
      ));
    }
  }

  private stableActiveStoreSnapshot(): StoreRecord[] {
    const stores = this.dependencies.listActiveStores()
      .filter((store) => store.status === 'active')
      .map(cloneStoreRecord)
      .sort((left, right) => codepointCompare(left.storeId, right.storeId));
    const ids = new Set<StoreId>();
    const profiles = new Set<BrowserProfileId>();
    for (const store of stores) {
      if (store.marketplace !== 'US'
        || store.currency !== 'USD'
        || store.businessTimezone !== 'America/Los_Angeles'
        || ids.has(store.storeId)
        || profiles.has(store.browserProfileId)) {
        throw new StoreCollectionOrchestratorError(
          'UNSUPPORTED_STORE',
          '活跃店铺必须具有独立的 US/USD/America/Los_Angeles Store 与 Profile。',
        );
      }
      ids.add(store.storeId);
      profiles.add(store.browserProfileId);
    }
    return stores;
  }

  private exactActiveManualStore(
    context: StoreContextEnvelope,
    activeStores: readonly StoreRecord[],
  ): StoreRecord {
    const exact = activeStores.find((store) => (
      store.storeId === context.storeId
      && store.browserProfileId === context.browserProfileId
      && store.marketplace === context.marketplace
      && store.currency === context.currency
      && store.businessTimezone === context.businessTimezone
    ));
    if (!exact) {
      throw new StoreCollectionOrchestratorError(
        'USER_OPERATION_BLOCKED',
        '手动采集目标不是当前 active US/USD/America/Los_Angeles Store/Profile。',
      );
    }
    return exact;
  }

  private assertManualContextCurrent(
    context: StoreContextEnvelope,
    currentAuthority: StoreCollectionAuthorityReadback,
  ): void {
    const expected: StoreCollectionAuthorityReadback = {
      activeStoreId: context.storeId,
      context,
    };
    if (!sameAuthority(currentAuthority, expected)) {
      throw new StoreCollectionOrchestratorError(
        'USER_OPERATION_BLOCKED',
        '手动采集上下文已过期；Store/Profile/业务日/会话代次与 Main authority 不完全一致。',
      );
    }
  }

  private stableManualStoreSnapshot(
    store: StoreRecord,
    exactContext: StoreContextEnvelope,
    attemptedCollectionKeys: ReadonlySet<string>,
  ): {
    due: Array<{
      store: StoreRecord;
      expectedFingerprint: string;
      requiredBusinessDate: string;
    }>;
    skipped: StoreRecord[];
  } {
    let inspected: StoreCollectionManualScheduleInspection;
    try {
      inspected = this.dependencies.inspectManualStoreSchedule(
        cloneStoreRecord(store),
        Object.freeze(normalizeStoreContextEnvelope(exactContext)),
      );
    } catch {
      throw new StoreCollectionOrchestratorError(
        'SCHEDULE_PRECHECK_FAILED',
        'Main-only 手动采集资格预检失败。',
      );
    }
    if ((inspected?.state !== 'eligible' && inspected?.state !== 'duplicate')
      || !validFingerprint(inspected.expectedFingerprint)) {
      throw new StoreCollectionOrchestratorError(
        'SCHEDULE_PRECHECK_FAILED',
        '手动采集资格预检缺少合法状态或 expected fingerprint。',
      );
    }
    const expectedFingerprint = inspected.expectedFingerprint;
    const protectedDuplicate = attemptedCollectionKeys.has(collectionAttemptSemanticKey({
      storeId: store.storeId,
      browserProfileId: store.browserProfileId,
      expectedFingerprint,
    }));
    if (inspected.state === 'duplicate' || protectedDuplicate) {
      return { due: [], skipped: [store] };
    }
    return {
      due: [{
        store,
        expectedFingerprint,
        requiredBusinessDate: exactContext.businessDate,
      }],
      skipped: [],
    };
  }

  private stableDueStoreSnapshot(
    activeStores: readonly StoreRecord[],
    attemptedCollectionKeys: ReadonlySet<string>,
  ): {
    due: Array<{ store: StoreRecord; expectedFingerprint: string }>;
    skipped: StoreRecord[];
  } {
    const due: Array<{ store: StoreRecord; expectedFingerprint: string }> = [];
    const skipped: StoreRecord[] = [];
    for (const store of activeStores) {
      let inspected: StoreCollectionScheduleInspection;
      try {
        inspected = this.dependencies.inspectStoreSchedule(cloneStoreRecord(store));
      } catch {
        throw new StoreCollectionOrchestratorError('SCHEDULE_PRECHECK_FAILED', 'Main-only 采集预检失败。');
      }
      if (inspected?.state === 'not_due') {
        skipped.push(store);
      } else if (inspected?.state === 'due' && validFingerprint(inspected.expectedFingerprint)) {
        const expectedFingerprint = inspected.expectedFingerprint;
        if (attemptedCollectionKeys.has(collectionAttemptSemanticKey({
          storeId: store.storeId,
          browserProfileId: store.browserProfileId,
          expectedFingerprint,
        }))) {
          skipped.push(store);
        } else {
          due.push({ store, expectedFingerprint });
        }
      } else {
        throw new StoreCollectionOrchestratorError('SCHEDULE_PRECHECK_FAILED', '采集预检缺少合法 expected fingerprint。');
      }
    }
    return { due, skipped };
  }

  private newTransition(input: {
    cycleId: string;
    owner: string;
    fromStoreId: StoreId | null;
    store: StoreRecord | null;
    fromAuthority: StoreCollectionAuthorityReadback;
    originAuthority: StoreCollectionAuthorityReadback;
    startedAt: string;
    purpose: StoreCollectionOrchestratorTransitionPurpose;
    expectedFingerprint?: string;
  }): StoreCollectionOrchestratorTransition {
    return withTransitionIntegrity({
      transitionId: randomUUID(),
      capabilityId: randomUUID(),
      cycleId: input.cycleId,
      owner: input.owner,
      fromStoreId: input.fromStoreId,
      toStoreId: input.store?.storeId ?? null,
      browserProfileId: input.store?.browserProfileId ?? null,
      purpose: input.purpose,
      fromAuthority: cloneAuthorityReadback(input.fromAuthority),
      originAuthority: cloneAuthorityReadback(input.originAuthority),
      ...(input.expectedFingerprint ? { expectedFingerprint: input.expectedFingerprint } : {}),
      phase: 'claimed',
      startedAt: input.startedAt,
    });
  }

  private appendTransition(transition: StoreCollectionOrchestratorTransition): void {
    this.mutateHistory((history) => ({ ...history, transitions: [...history.transitions, transition] }));
  }

  private updateTransition(
    transition: StoreCollectionOrchestratorTransition,
    patch: Omit<Partial<StoreCollectionOrchestratorTransition>, 'integrityDigest' | 'transitionId' | 'cycleId'
      | 'capabilityId' | 'owner' | 'fromStoreId' | 'toStoreId' | 'browserProfileId' | 'purpose'
      | 'fromAuthority' | 'originAuthority'
      | 'expectedFingerprint' | 'startedAt'>,
  ): StoreCollectionOrchestratorTransition {
    const next = withTransitionIntegrity({ ...transition, ...patch, integrityDigest: undefined });
    if (!isStoreCollectionTransitionPhaseAllowed(transition.purpose, transition.phase, next.phase)) {
      throw new StoreCollectionOrchestratorError(
        'CORRUPT_PERSISTENCE',
        `非法切换阶段：${transition.phase} -> ${next.phase}`,
      );
    }
    this.mutateHistory((history) => {
      const index = history.transitions.findIndex((item) => item.transitionId === transition.transitionId);
      if (index < 0 || history.transitions[index].integrityDigest !== transition.integrityDigest) {
        throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '切换记录已被替换。');
      }
      const transitions = [...history.transitions];
      transitions[index] = next;
      if (next.purpose !== 'collection' || next.phase !== 'scheduler_request_bound') {
        return { ...history, transitions };
      }
      const semanticAttempt = semanticAttemptFromTransition(next);
      const semanticKey = collectionAttemptSemanticKey(semanticAttempt);
      const latestProtectedBusinessDate = latestSemanticAttemptBusinessDate(
        history.semanticAttempts,
        semanticAttempt.storeId,
        semanticAttempt.browserProfileId,
      );
      if (latestProtectedBusinessDate !== undefined
        && semanticAttempt.businessDate < latestProtectedBusinessDate) {
        throw new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          '采集业务日早于 protected semantic attempt watermark。',
        );
      }
      const protectedAttemptsForBusinessDate = history.semanticAttempts.filter((attempt) => (
        attempt.storeId === semanticAttempt.storeId
        && attempt.browserProfileId === semanticAttempt.browserProfileId
        && attempt.businessDate === semanticAttempt.businessDate
      )).length;
      if (protectedAttemptsForBusinessDate
        >= STORE_COLLECTION_MAX_DAILY_SEMANTIC_ATTEMPTS_PER_STORE_PROFILE) {
        throw new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          '单店铺单业务日 protected semantic attempts 已达到安全上限。',
        );
      }
      if (history.semanticAttempts.some((attempt) => (
        (collectionAttemptSemanticKey(attempt) === semanticKey
          && !isSchedulerNotCreatedSemanticAttempt(history, attempt))
        || attempt.transitionId === semanticAttempt.transitionId
        || attempt.semanticAttemptId === semanticAttempt.semanticAttemptId
        || attempt.schedulerAttemptId === semanticAttempt.schedulerAttemptId
        || attempt.schedulerRequestId === semanticAttempt.schedulerRequestId
      ))) {
        throw corruptHistory();
      }
      return {
        ...history,
        transitions,
        semanticAttempts: compactSemanticAttemptsToLatestBusinessDate([
          ...history.semanticAttempts,
          semanticAttempt,
        ]),
      };
    });
    return next;
  }

  private completeCollectionTransition(
    transition: StoreCollectionOrchestratorTransition,
    patch: Pick<StoreCollectionOrchestratorTransition, 'phase' | 'completedAt'>
      & Partial<Pick<StoreCollectionOrchestratorTransition, 'failureCode'>>,
    outcomeValue: Omit<StoreCollectionOrchestratorOutcome, 'integrityDigest'>,
  ): { transition: StoreCollectionOrchestratorTransition; outcome: StoreCollectionOrchestratorOutcome } {
    const next = withTransitionIntegrity({ ...transition, ...patch, integrityDigest: undefined });
    if (!isStoreCollectionTransitionPhaseAllowed(transition.purpose, transition.phase, next.phase)) {
      throw new StoreCollectionOrchestratorError(
        'CORRUPT_PERSISTENCE',
        `非法采集终态：${transition.phase} -> ${next.phase}`,
      );
    }
    const outcome = withOutcomeIntegrity(outcomeValue);
    this.mutateHistory((history) => {
      const index = history.transitions.findIndex((item) => item.transitionId === transition.transitionId);
      if (index < 0 || history.transitions[index].integrityDigest !== transition.integrityDigest
        || history.outcomes.some((item) => item.transitionId === transition.transitionId)) {
        throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '采集终态已被替换或重复。');
      }
      const transitions = [...history.transitions];
      transitions[index] = next;
      return { ...history, transitions, outcomes: [...history.outcomes, outcome] };
    });
    return { transition: next, outcome };
  }

  private readPendingTransitions(): StoreCollectionOrchestratorTransition[] {
    return this.readProtectedHistorySnapshot().transitions
      .filter((transition) => !isTerminalPhase(transition.phase));
  }

  private readProtectedHistorySnapshot(): StoreCollectionOrchestratorHistory {
    const raw = this.dependencies.history.get();
    return raw
      ? this.readHistoryFromEnvelope(raw)
      : {
        schemaVersion: HISTORY_SCHEMA_VERSION,
        transitions: [],
        outcomes: [],
        semanticAttempts: [],
      };
  }

  private attemptedCollectionSemanticKeys(
    history: StoreCollectionOrchestratorHistory,
  ): ReadonlySet<string> {
    const attempted = new Set<string>();
    for (const semanticAttempt of history.semanticAttempts) {
      if (isSchedulerNotCreatedSemanticAttempt(history, semanticAttempt)) continue;
      const key = collectionAttemptSemanticKey(semanticAttempt);
      if (attempted.has(key)) throw corruptHistory();
      attempted.add(key);
    }
    return attempted;
  }

  private async recoverPendingTransitions(input: {
    transitions: readonly StoreCollectionOrchestratorTransition[];
    auth: StoreCollectionAutomationAuthority;
    policyGuard: StoreCollectionPolicySuppressionGuard;
  }): Promise<PendingTransitionRecoveryPlan[]> {
    const plans: PendingTransitionRecoveryPlan[] = [];
    for (const original of input.transitions) {
      if (!isSchedulerBoundPendingTransition(original)) {
        plans.push({ transition: original, disposition: 'interrupt' });
        continue;
      }
      let transition = original;
      let transitionAuthority: StoreCollectionRecoveryAutomationAuthority | undefined;
      try {
        const context = contextFromTransition(transition);
        const recoveryAdmission = await this.registerProtectedSchedulerRecoveryAdmission(
          transition,
          input.auth,
        );
        transitionAuthority = await this.deriveTransitionAuthority(
          transition,
          input.auth,
          input.policyGuard,
          'recovery_existing_request_only',
          recoveryAdmission,
        );
        const projection = await this.dependencies.scheduler.recover({
          ...transitionAuthority,
          context,
          expectedAuthority: { activeStoreId: context.storeId, context },
          cycleId: transition.cycleId,
          transitionId: transition.transitionId,
          expectedFingerprint: transition.expectedFingerprint!,
          attemptId: transition.schedulerAttemptId!,
          requestId: transition.schedulerRequestId!,
        });
        const recoveredState = this.validateSchedulerRecovery(projection, {
          auth: transitionAuthority,
          executionIdentityScope: freezeTransitionScope(
            transitionScopeFromTransition(transition, 'transition_execution'),
          ),
          context,
          cycleId: transition.cycleId,
          transitionId: transition.transitionId,
          expectedFingerprint: transition.expectedFingerprint!,
        });
        if (recoveredState === 'succeeded') {
          if (transition.phase === 'scheduler_request_bound') {
            transition = this.updateTransition(transition, { phase: 'scheduler_accepted' });
          }
          if (transition.phase === 'scheduler_accepted') {
            transition = this.updateTransition(transition, { phase: 'scheduler_reconciled' });
          }
          plans.push({
            transition,
            disposition: 'scheduler_succeeded',
            transitionAuthority,
          });
          continue;
        }
        if (recoveredState === 'failed'
          && (transition.phase === 'scheduler_request_bound'
            || transition.phase === 'scheduler_accepted')) {
          plans.push({
            transition,
            disposition: 'scheduler_failed',
            transitionAuthority,
          });
          continue;
        }
        if (recoveredState === 'accepted' && transition.phase === 'scheduler_request_bound') {
          transition = this.updateTransition(transition, { phase: 'scheduler_accepted' });
        }
        if (recoveredState === 'not_found' && transition.phase === 'scheduler_request_bound') {
          // The collector persists its initial running job before its first
          // external browser step. An exact request-bound miss therefore proves
          // this pre-acceptance attempt never crossed that durable boundary.
          // A scheduler_accepted miss remains unresolved and fail-closed below.
          plans.push({
            transition,
            disposition: 'scheduler_not_created',
            transitionAuthority,
          });
          continue;
        }
        plans.push({
          transition,
          disposition: 'scheduler_unresolved',
          transitionAuthority,
          error: new StoreCollectionOrchestratorError(
            'SAFETY_STATE_UNKNOWN',
            'scheduler recover 尚未证明原 durable request 的 succeeded/failed 终态。',
          ),
        });
      } catch (error) {
        plans.push({
          transition,
          disposition: 'scheduler_unresolved',
          ...(transitionAuthority ? { transitionAuthority } : {}),
          error,
        });
      }
    }
    return plans;
  }

  private finalizeRecoveredSchedulerTransition(
    plan: PendingTransitionRecoveryPlan,
    succeeded: boolean,
    failedCode: Extract<StoreCollectionOrchestratorFailureCode,
      'SCHEDULER_FAILED' | 'SCHEDULER_NOT_SUCCEEDED'> = 'SCHEDULER_FAILED',
  ): StoreCollectionOrchestratorOutcome {
    let transition = plan.transition;
    try {
      if (succeeded && transition.phase === 'scheduler_reconciled') {
        transition = this.updateTransition(transition, { phase: 'cleanup_pending' });
      }
      const completedAt = this.now().toISOString();
      const terminalPhase: TransitionPhase = succeeded ? 'completed' : 'failed';
      const failureCode = succeeded ? undefined : failedCode;
      const result = this.completeCollectionTransition(transition, {
        phase: terminalPhase,
        completedAt,
        ...(failureCode ? { failureCode } : {}),
      }, {
        outcomeId: randomUUID(),
        cycleId: transition.cycleId,
        transitionId: transition.transitionId,
        owner: transition.owner,
        storeId: transition.toStoreId!,
        browserProfileId: transition.browserProfileId!,
        businessDate: transition.businessDate!,
        sessionGeneration: transition.sessionGeneration!,
        fingerprint: transition.expectedFingerprint!,
        attemptId: transition.schedulerAttemptId!,
        requestId: transition.schedulerRequestId!,
        schedulerSucceeded: succeeded,
        cleanupStatus: 'confirmed',
        state: succeeded ? 'succeeded' : 'failed',
        startedAt: transition.startedAt,
        completedAt,
        ...(failureCode ? { failureCode } : {}),
      });
      if (plan.transitionAuthority) {
        this.setCapabilityLifecycle(
          plan.transitionAuthority.transitionCapability,
          'transition_recovery',
          'retired',
        );
      }
      return result.outcome;
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
  }

  private commonRecoveryOrigin(
    transitions: readonly StoreCollectionOrchestratorTransition[],
  ): StoreCollectionAuthorityReadback {
    const [first, ...rest] = transitions;
    if (!first || rest.some((transition) => !sameAuthority(transition.originAuthority, first.originAuthority))) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '非终态切换记录缺少唯一 durable operator origin。',
      ));
    }
    return cloneAuthorityReadback(first.originAuthority);
  }

  private interruptTransitions(pending: readonly StoreCollectionOrchestratorTransition[]): void {
    if (pending.length === 0) return;
    if (pending.some((transition) => (
      isUnreconciledSchedulerPending(transition)
      || !isStoreCollectionTransitionPhaseAllowed(
        transition.purpose,
        transition.phase,
        'interrupted',
      )
    ))) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '未 reconcile 的 durable scheduler request 或非法阶段不得被 interrupt 终态化。',
      ));
    }
    const pendingById = new Map(pending.map((transition) => [transition.transitionId, transition]));
    try {
      this.dependencies.history.transaction(() => {
        const raw = this.dependencies.history.get();
        if (!raw) throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '待恢复历史消失。');
        const history = this.readHistoryFromEnvelope(raw);
        const now = this.now().toISOString();
        const outcomes = [...history.outcomes];
        const transitions = history.transitions.map((transition) => {
          const expected = pendingById.get(transition.transitionId);
          if (!expected) return transition;
          if (transition.integrityDigest !== expected.integrityDigest || isTerminalPhase(transition.phase)) {
            throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '待恢复历史已被替换。');
          }
          const interrupted = withTransitionIntegrity({
            ...transition,
            integrityDigest: undefined,
            phase: 'interrupted',
            completedAt: now,
            failureCode: 'APP_EXIT_INTERRUPTED',
          });
          if (interrupted.purpose === 'collection') {
            const schedulerSucceeded = hasDurableSchedulerSuccess(transition);
            outcomes.push(withOutcomeIntegrity({
              outcomeId: randomUUID(),
              cycleId: interrupted.cycleId,
              transitionId: interrupted.transitionId,
              owner: interrupted.owner,
              storeId: interrupted.toStoreId!,
              browserProfileId: interrupted.browserProfileId!,
              ...(interrupted.businessDate === undefined ? {} : {
                businessDate: interrupted.businessDate,
              }),
              ...(interrupted.sessionGeneration === undefined ? {} : {
                sessionGeneration: interrupted.sessionGeneration,
              }),
              fingerprint: interrupted.expectedFingerprint!,
              ...(schedulerSucceeded ? {
                attemptId: interrupted.schedulerAttemptId,
                requestId: interrupted.schedulerRequestId,
              } : {}),
              schedulerSucceeded,
              cleanupStatus: 'confirmed',
              state: 'failed',
              startedAt: interrupted.startedAt,
              completedAt: now,
              failureCode: 'APP_EXIT_INTERRUPTED',
            }));
          }
          return interrupted;
        });
        if (pendingById.size !== pending.filter((item) => (
          transitions.some((transition) => transition.transitionId === item.transitionId)
        )).length) {
          throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '待恢复历史不完整。');
        }
        this.writeHistory(this.compactHistory({ ...history, transitions, outcomes }));
      });
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
  }

  private mutateHistory(
    mutate: (history: StoreCollectionOrchestratorHistory) => StoreCollectionOrchestratorHistory,
  ): void {
    try {
      this.dependencies.history.transaction(() => {
        const raw = this.dependencies.history.get();
        const history = raw
          ? this.readHistoryFromEnvelope(raw)
          : {
            schemaVersion: HISTORY_SCHEMA_VERSION,
            transitions: [],
            outcomes: [],
            semanticAttempts: [],
          } as StoreCollectionOrchestratorHistory;
        this.writeHistory(this.compactHistory(mutate(history)));
      });
    } catch (error) {
      if (error instanceof StoreCollectionOrchestratorError) throw error;
      throw new StoreCollectionOrchestratorError(
        'PERSISTENCE_PROTECTION_UNAVAILABLE',
        '切换历史事务或写入失败。',
      );
    }
  }

  private readHistoryFromEnvelope(raw: string): StoreCollectionOrchestratorHistory {
    if (Buffer.byteLength(raw, 'utf8') > MAX_HISTORY_ENVELOPE_BYTES) {
      throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '切换历史 envelope 超过大小上限。');
    }
    this.assertPersistenceProtectionAvailable();
    try {
      const plaintext = this.dependencies.recordCodec.open(raw);
      if (Buffer.byteLength(plaintext, 'utf8') > MAX_HISTORY_PLAINTEXT_BYTES) {
        throw new Error('history plaintext too large');
      }
      return normalizeStoredHistory(JSON.parse(plaintext));
    } catch (error) {
      if (error instanceof StoreCollectionOrchestratorError) throw error;
      throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '切换历史损坏。');
    }
  }

  private writeHistory(history: StoreCollectionOrchestratorHistory): void {
    assertHistory(history);
    this.assertPersistenceProtectionAvailable();
    const plaintext = JSON.stringify(history);
    if (Buffer.byteLength(plaintext, 'utf8') > MAX_HISTORY_PLAINTEXT_BYTES) {
      throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '切换历史超过大小上限。');
    }
    let envelope = '';
    try {
      envelope = this.dependencies.recordCodec.seal(plaintext);
    } catch {
      envelope = '';
    }
    if (!envelope || envelope === plaintext
      || Buffer.byteLength(envelope, 'utf8') > MAX_HISTORY_ENVELOPE_BYTES) {
      throw new StoreCollectionOrchestratorError(
        'PERSISTENCE_PROTECTION_UNAVAILABLE',
        '切换历史安全存储不可用。',
      );
    }
    this.dependencies.history.set(envelope);
  }

  private compactHistory(history: StoreCollectionOrchestratorHistory): StoreCollectionOrchestratorHistory {
    const terminal = history.transitions
      .map((transition, index) => ({ transition, index }))
      .filter(({ transition }) => isTerminalPhase(transition.phase))
      .sort((left, right) => {
        const byTime = codepointCompare(
          right.transition.completedAt ?? right.transition.startedAt,
          left.transition.completedAt ?? left.transition.startedAt,
        );
        return byTime || right.index - left.index;
      });
    const retained = terminal
      .filter(({ transition }) => transition.purpose === 'collection')
      .slice(0, this.historyRetentionLimit);
    if (retained.length < this.historyRetentionLimit) {
      retained.push(...terminal
        .filter(({ transition }) => transition.purpose === 'restore')
        .slice(0, this.historyRetentionLimit - retained.length));
    }
    const retainedTerminalIds = new Set(retained.map(({ transition }) => transition.transitionId));
    const transitions = history.transitions.filter((transition) => (
      !isTerminalPhase(transition.phase) || retainedTerminalIds.has(transition.transitionId)
    ));
    const retainedIds = new Set(transitions.map((transition) => transition.transitionId));
    return {
      ...history,
      transitions,
      outcomes: history.outcomes.filter((outcome) => retainedIds.has(outcome.transitionId)),
    };
  }

  private assertPersistenceProtectionAvailable(): void {
    let available = false;
    try {
      available = this.dependencies.recordCodec.isAvailable();
    } catch {
      available = false;
    }
    if (!available) {
      throw new StoreCollectionOrchestratorError(
        'PERSISTENCE_PROTECTION_UNAVAILABLE',
        '切换历史安全存储不可用。',
      );
    }
  }

  private markSafetyUnknown(error: unknown): StoreCollectionOrchestratorError {
    this.safetyStateUnknown = true;
    const safety = error instanceof StoreCollectionOrchestratorError
      && error.code === 'SAFETY_STATE_UNKNOWN'
      ? error
      : new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', '编排器无法证明 authority/runtime/persistence 安全状态。');
    (safety as StoreCollectionOrchestratorError & { cause?: unknown }).cause ??= error;
    return safety;
  }

  private safetyError(): StoreCollectionOrchestratorError {
    return new StoreCollectionOrchestratorError(
      'SAFETY_STATE_UNKNOWN',
      '编排器安全状态未知；必须由 Main 完成人工恢复后才能继续。',
    );
  }

  private reportError(error: unknown): void {
    try {
      this.dependencies.onError?.(error);
    } catch {
      // Observer failures are isolated so timer callbacks never create an unhandled rejection.
    }
  }
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

function storeCollectionSemanticAttemptIntegrityDigest(
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

function storeCollectionSemanticAttemptId(value: Pick<
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

function semanticAttemptFromTransition(
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

function withTransitionIntegrity(
  value: Omit<StoreCollectionOrchestratorTransition, 'integrityDigest'> & { integrityDigest?: string },
): StoreCollectionOrchestratorTransition {
  const { integrityDigest: _ignored, ...rest } = value;
  return { ...rest, integrityDigest: storeCollectionOrchestratorTransitionIntegrityDigest(rest) };
}

function withOutcomeIntegrity(
  value: Omit<StoreCollectionOrchestratorOutcome, 'integrityDigest'> & { integrityDigest?: string },
): StoreCollectionOrchestratorOutcome {
  const { integrityDigest: _ignored, ...rest } = value;
  return { ...rest, integrityDigest: storeCollectionOrchestratorOutcomeIntegrityDigest(rest) };
}

function normalizeStoredHistory(value: unknown): StoreCollectionOrchestratorHistory {
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

function assertHistory(value: StoreCollectionOrchestratorHistory): void {
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

function assertHistoryGraph(
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

function assertSemanticAttempt(value: StoreCollectionSemanticAttempt): void {
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

function assertAuthoritySnapshot(value: StoreCollectionAuthorityReadback): void {
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

function assertTransition(value: StoreCollectionOrchestratorTransition): void {
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

function assertOutcome(value: StoreCollectionOrchestratorOutcome): void {
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

function isCleanupProofFailureCode(value: unknown): boolean {
  return value === 'SAFETY_STATE_UNKNOWN'
    || value === 'RUNTIME_CLOSE_FAILED'
    || value === 'COLLECTION_LEASE_ACTIVE'
    || value === 'OPERATOR_STORE_RESTORE_FAILED';
}

function assertExactKeys(
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

function assertAutomationLease(value: StoreCollectionAutomationLease): void {
  if (!value
    || !safeId(value.owner)
    || !runtimeCapability(value.capability)
    || typeof value.release !== 'function') {
    throw new Error('invalid automation lease');
  }
}

function assertPolicySuppressionLease(value: StoreCollectionPolicySuppressionLease): void {
  if (!value
    || !safeId(value.owner)
    || !runtimeCapability(value.capability)
    || !runtimeCapability(value.guard)
    || typeof value.release !== 'function') {
    throw new Error('invalid policy suppression lease');
  }
}

function cloneAuthority(value: StoreCollectionAutomationAuthority): StoreCollectionAutomationAuthority {
  return { owner: value.owner, capability: value.capability };
}

function cloneAuthorityReadback(value: StoreCollectionAuthorityReadback): StoreCollectionAuthorityReadback {
  return {
    activeStoreId: value.activeStoreId,
    context: value.context ? normalizeStoreContextEnvelope(value.context) : null,
  };
}

function sameAuthority(
  left: StoreCollectionAuthorityReadback,
  right: StoreCollectionAuthorityReadback,
): boolean {
  if (left.activeStoreId !== right.activeStoreId) return false;
  if (left.context === null || right.context === null) return left.context === right.context;
  const leftContext = normalizeStoreContextEnvelope(left.context);
  const rightContext = normalizeStoreContextEnvelope(right.context);
  return leftContext.storeId === rightContext.storeId
    && leftContext.browserProfileId === rightContext.browserProfileId
    && leftContext.marketplace === rightContext.marketplace
    && leftContext.currency === rightContext.currency
    && leftContext.businessTimezone === rightContext.businessTimezone
    && leftContext.businessDate === rightContext.businessDate
    && leftContext.sessionGeneration === rightContext.sessionGeneration;
}

function authorityMatchesRestoreTarget(
  actual: StoreCollectionAuthorityReadback,
  target: StoreCollectionAuthorityReadback,
): boolean {
  if (target.activeStoreId === null) return actual.activeStoreId === null && actual.context === null;
  if (actual.activeStoreId !== target.activeStoreId
    || actual.context === null
    || target.context === null) {
    return false;
  }
  const actualContext = normalizeStoreContextEnvelope(actual.context);
  const targetContext = normalizeStoreContextEnvelope(target.context);
  return actualContext.storeId === targetContext.storeId
    && actualContext.browserProfileId === targetContext.browserProfileId
    && actualContext.marketplace === 'US'
    && actualContext.currency === 'USD'
    && actualContext.businessTimezone === 'America/Los_Angeles'
    && targetContext.marketplace === 'US'
    && targetContext.currency === 'USD'
    && targetContext.businessTimezone === 'America/Los_Angeles'
    && codepointCompare(actualContext.businessDate, targetContext.businessDate) >= 0
    && actualContext.sessionGeneration >= targetContext.sessionGeneration;
}

function authorityMatchesTransitionTarget(
  actual: StoreCollectionAuthorityReadback,
  target: StoreCollectionTransitionTarget | null,
): boolean {
  if (target === null) return actual.activeStoreId === null && actual.context === null;
  return actual.activeStoreId === target.storeId
    && actual.context !== null
    && actual.context.browserProfileId === target.browserProfileId
    && actual.context.marketplace === target.marketplace
    && actual.context.currency === target.currency
    && actual.context.businessTimezone === target.businessTimezone;
}

function sameTransitionTarget(
  left: StoreCollectionTransitionTarget | null,
  right: StoreCollectionTransitionTarget | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.marketplace === right.marketplace
    && left.currency === right.currency
    && left.businessTimezone === right.businessTimezone;
}

function transitionTargetFromStore(store: StoreRecord): StoreCollectionTransitionTarget {
  return {
    storeId: store.storeId,
    browserProfileId: store.browserProfileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
  };
}

function manualCollectionCycleKey(context: StoreContextEnvelope): string {
  return JSON.stringify([
    context.storeId,
    context.browserProfileId,
    context.marketplace,
    context.currency,
    context.businessTimezone,
    context.businessDate,
    context.sessionGeneration,
  ]);
}

function collectionAttemptSemanticKey(input: {
  storeId: StoreId;
  browserProfileId: BrowserProfileId;
  expectedFingerprint: string;
}): string {
  return JSON.stringify([
    input.storeId,
    input.browserProfileId,
    input.expectedFingerprint,
  ]);
}

function isSchedulerNotCreatedSemanticAttempt(
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

function compactSemanticAttemptsToLatestBusinessDate(
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

function latestSemanticAttemptBusinessDate(
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

function transitionTargetFromContext(context: StoreContextEnvelope): StoreCollectionTransitionTarget {
  return {
    storeId: context.storeId,
    browserProfileId: context.browserProfileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
  };
}

function contextFromTransition(
  transition: StoreCollectionOrchestratorTransition,
): StoreContextEnvelope {
  if (transition.purpose !== 'collection'
    || !transition.toStoreId
    || !transition.browserProfileId
    || !transition.businessDate
    || transition.sessionGeneration === undefined) {
    throw corruptHistory();
  }
  return normalizeStoreContextEnvelope({
    storeId: transition.toStoreId,
    browserProfileId: transition.browserProfileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: transition.businessDate,
    sessionGeneration: transition.sessionGeneration,
  });
}

function isSchedulerBoundPendingTransition(
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

function isUnreconciledSchedulerPending(
  transition: StoreCollectionOrchestratorTransition,
): boolean {
  return transition.purpose === 'collection'
    && (transition.phase === 'scheduler_request_bound'
      || transition.phase === 'scheduler_accepted');
}

function hasDurableSchedulerSuccess(
  transition: StoreCollectionOrchestratorTransition,
): boolean {
  return transition.purpose === 'collection'
    && transition.schedulerAttemptId !== undefined
    && transition.schedulerRequestId !== undefined
    && (transition.phase === 'scheduler_reconciled'
      || transition.phase === 'cleanup_pending');
}

function storeFromContext(context: StoreContextEnvelope): StoreRecord {
  return {
    storeId: context.storeId,
    browserProfileId: context.browserProfileId,
    displayName: context.storeId,
    marketplace: 'US',
    currency: 'USD',
    status: 'active',
    businessTimezone: 'America/Los_Angeles',
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
  };
}

function transitionScopeFromTransition<Domain extends StoreCollectionTransitionCapabilityDomain>(
  transition: StoreCollectionOrchestratorTransition,
  capabilityDomain: Domain,
): StoreCollectionTransitionCapabilityScope<Domain> {
  return {
    capabilityDomain,
    capabilityId: capabilityDomain === 'transition_execution'
      ? transition.capabilityId
      : `${transition.capabilityId}:recovery`,
    cycleId: transition.cycleId,
    transitionId: transition.transitionId,
    purpose: transition.purpose,
    fromAuthority: cloneAuthorityReadback(transition.fromAuthority),
    originAuthority: cloneAuthorityReadback(transition.originAuthority),
    target: transition.toStoreId === null || transition.browserProfileId === null
      ? null
      : {
        storeId: transition.toStoreId,
        browserProfileId: transition.browserProfileId,
        marketplace: 'US',
        currency: 'USD',
        businessTimezone: 'America/Los_Angeles',
      },
    expectedFingerprint: transition.expectedFingerprint ?? null,
  };
}

function freezeTransitionScope<Domain extends StoreCollectionTransitionCapabilityDomain>(
  value: StoreCollectionTransitionCapabilityScope<Domain>,
): StoreCollectionTransitionCapabilityScope<Domain> {
  const freezeAuthority = (
    authority: StoreCollectionAuthorityReadback,
  ): StoreCollectionAuthorityReadback => Object.freeze({
    activeStoreId: authority.activeStoreId,
    context: authority.context
      ? Object.freeze(normalizeStoreContextEnvelope(authority.context))
      : null,
  });
  return Object.freeze({
    capabilityDomain: value.capabilityDomain,
    capabilityId: value.capabilityId,
    cycleId: value.cycleId,
    transitionId: value.transitionId,
    purpose: value.purpose,
    fromAuthority: freezeAuthority(value.fromAuthority),
    originAuthority: freezeAuthority(value.originAuthority),
    target: value.target ? Object.freeze({ ...value.target }) : null,
    expectedFingerprint: value.expectedFingerprint,
  });
}

function canonicalTransitionScope<Domain extends StoreCollectionTransitionCapabilityDomain>(
  value: StoreCollectionTransitionCapabilityScope<Domain>,
): StoreCollectionTransitionCapabilityScope<Domain> {
  return {
    capabilityDomain: value.capabilityDomain,
    capabilityId: value.capabilityId,
    cycleId: value.cycleId,
    transitionId: value.transitionId,
    purpose: value.purpose,
    fromAuthority: cloneAuthorityReadback(value.fromAuthority),
    originAuthority: cloneAuthorityReadback(value.originAuthority),
    target: value.target ? { ...value.target } : null,
    expectedFingerprint: value.expectedFingerprint,
  };
}

function capabilityIdentityDomain(
  domain: StoreCollectionTransitionCapabilityDomain,
): Extract<CapabilityIdentityDomain, 'transition_execution' | 'transition_recovery'> {
  return domain === 'transition_execution'
    ? 'transition_execution'
    : 'transition_recovery';
}

function runtimeCapability(value: unknown): value is Readonly<object> {
  return typeof value === 'object' && value !== null;
}

function cloneStoreRecord(value: StoreRecord): StoreRecord {
  return {
    storeId: value.storeId,
    browserProfileId: value.browserProfileId,
    displayName: value.displayName,
    marketplace: value.marketplace,
    currency: value.currency,
    status: value.status,
    businessTimezone: value.businessTimezone,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.archivedAt === undefined ? {} : { archivedAt: value.archivedAt }),
  };
}

function isCriticalSafetyError(error: unknown): boolean {
  return error instanceof StoreCollectionOrchestratorError
    && ['RUNTIME_CLOSE_FAILED', 'COLLECTION_LEASE_ACTIVE', 'SAFETY_STATE_UNKNOWN',
      'PERSISTENCE_PROTECTION_UNAVAILABLE', 'CORRUPT_PERSISTENCE'].includes(error.code);
}

function isIdentityFailure(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return isIdentityFailureCode(code);
}

function normalizeIdentityFailure(error: unknown): StoreCollectionOrchestratorFailureCode {
  const code = normalizeFailureCode(error, 'IDENTITY_UNVERIFIED');
  return isIdentityFailureCode(code) ? code : 'IDENTITY_UNVERIFIED';
}

function normalizeFailureCode(
  error: unknown,
  fallback: StoreCollectionOrchestratorFailureCode,
): StoreCollectionOrchestratorFailureCode {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return isFailureCode(code) ? code : fallback;
}

function isIdentityFailureCode(value: unknown): value is StoreCollectionOrchestratorFailureCode {
  return typeof value === 'string'
    && ['LOGIN_REQUIRED', 'REAUTH_REQUIRED', 'MFA_REQUIRED', 'IDENTITY_UNVERIFIED'].includes(value);
}

function isFailureCode(value: unknown): value is StoreCollectionOrchestratorFailureCode {
  return typeof value === 'string' && [
    'APP_EXIT_INTERRUPTED', 'AUTOMATION_LEASE_UNAVAILABLE', 'COLLECTION_LEASE_ACTIVE',
    'CORRUPT_PERSISTENCE', 'IDENTITY_UNVERIFIED', 'LEASE_RELEASE_FAILED', 'LOGIN_REQUIRED',
    'MFA_REQUIRED', 'OPERATOR_STORE_RESTORE_FAILED', 'PERSISTENCE_PROTECTION_UNAVAILABLE',
    'REAUTH_REQUIRED', 'RUNTIME_CLOSE_FAILED', 'RUNTIME_START_FAILED', 'SAFETY_STATE_UNKNOWN',
    'SCHEDULE_PRECHECK_FAILED', 'SCHEDULER_FAILED', 'SCHEDULER_NOT_SUCCEEDED',
    'TRANSITION_FAILED', 'UNSUPPORTED_STORE',
  ].includes(value);
}

export const STORE_COLLECTION_TRANSITION_PHASES = [
  'claimed',
  'authority_touch_pending',
  'previous_closed',
  'activated',
  'runtime_started',
  'identity_verified',
  'scheduler_request_bound',
  'scheduler_accepted',
  'scheduler_reconciled',
  'cleanup_pending',
  'completed',
  'blocked',
  'failed',
  'interrupted',
] as const satisfies readonly StoreCollectionOrchestratorTransitionPhase[];

type TransitionFieldShape = 'none' | 'context' | 'scheduler';

const TRANSITION_PHASE_FIELD_MATRIX: Record<
  StoreCollectionOrchestratorTransitionPurpose,
  Record<StoreCollectionOrchestratorTransitionPhase, readonly TransitionFieldShape[]>
> = {
  collection: {
    claimed: ['none'],
    authority_touch_pending: ['none'],
    previous_closed: ['none'],
    activated: ['context'],
    runtime_started: ['context'],
    identity_verified: ['context'],
    scheduler_request_bound: ['scheduler'],
    scheduler_accepted: ['scheduler'],
    scheduler_reconciled: ['scheduler'],
    cleanup_pending: ['context', 'scheduler'],
    completed: ['scheduler'],
    blocked: ['context'],
    failed: ['none', 'context', 'scheduler'],
    interrupted: ['none', 'context', 'scheduler'],
  },
  restore: {
    claimed: ['none'],
    authority_touch_pending: ['none'],
    previous_closed: ['none'],
    activated: ['none', 'context'],
    runtime_started: [],
    identity_verified: [],
    scheduler_request_bound: [],
    scheduler_accepted: [],
    scheduler_reconciled: [],
    cleanup_pending: ['none', 'context'],
    completed: ['none', 'context'],
    blocked: [],
    failed: ['none', 'context'],
    interrupted: ['none', 'context'],
  },
};

const TRANSITION_PHASE_EDGE_MATRIX: Record<
  StoreCollectionOrchestratorTransitionPurpose,
  Record<StoreCollectionOrchestratorTransitionPhase, readonly StoreCollectionOrchestratorTransitionPhase[]>
> = {
  collection: {
    claimed: ['authority_touch_pending', 'failed', 'interrupted'],
    authority_touch_pending: ['previous_closed', 'failed', 'interrupted'],
    previous_closed: ['activated', 'failed', 'interrupted'],
    activated: ['runtime_started', 'cleanup_pending', 'failed', 'interrupted'],
    runtime_started: ['identity_verified', 'cleanup_pending', 'failed', 'interrupted'],
    identity_verified: ['scheduler_request_bound', 'cleanup_pending', 'blocked', 'failed', 'interrupted'],
    scheduler_request_bound: ['scheduler_accepted', 'failed'],
    scheduler_accepted: ['scheduler_reconciled', 'failed'],
    scheduler_reconciled: ['cleanup_pending', 'failed', 'interrupted'],
    cleanup_pending: ['completed', 'blocked', 'failed', 'interrupted'],
    completed: [],
    blocked: [],
    failed: [],
    interrupted: [],
  },
  restore: {
    claimed: ['authority_touch_pending', 'failed', 'interrupted'],
    authority_touch_pending: ['previous_closed', 'failed', 'interrupted'],
    previous_closed: ['activated', 'failed', 'interrupted'],
    activated: ['cleanup_pending', 'failed', 'interrupted'],
    runtime_started: [],
    identity_verified: [],
    scheduler_request_bound: [],
    scheduler_accepted: [],
    scheduler_reconciled: [],
    cleanup_pending: ['completed', 'failed', 'interrupted'],
    completed: [],
    blocked: [],
    failed: [],
    interrupted: [],
  },
};

function isTerminalPhase(phase: TransitionPhase): boolean {
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

function validFingerprint(value: unknown): value is string {
  return typeof value === 'string' && DIGEST.test(value);
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && ISO_TIMESTAMP.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function combineFailures(primary: unknown, secondary: unknown): unknown {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const combined = secondary instanceof StoreCollectionOrchestratorError
    ? secondary
    : new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', '编排器发生多个安全故障。');
  (combined as StoreCollectionOrchestratorError & { cause?: unknown }).cause ??= primary;
  return combined;
}

function corruptHistory(): StoreCollectionOrchestratorError {
  return new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '切换历史结构或关联无效。');
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
