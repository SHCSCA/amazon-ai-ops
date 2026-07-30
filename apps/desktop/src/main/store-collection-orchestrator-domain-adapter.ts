import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionAutomationAuthority,
  type StoreCollectionAuthorityReadback,
  type StoreCollectionOrchestratorDependencies,
  type StoreCollectionSchedulerRecoveryAdmission,
  type StoreCollectionSchedulerRecoveryAdmissionReceipt,
  type StoreCollectionTransitionCapabilityDomain,
  type StoreCollectionTransitionCapabilityReceipt,
  type StoreCollectionTransitionCapabilityScope,
  type StoreCollectionTransitionAutomationAuthority,
  deriveStoreCollectionSchedulerExecutionIdentity,
  storeCollectionSchedulerRecoveryAdmissionScopeDigest,
} from './store-collection-orchestrator';
import {
  type StoreCoordinator,
  type StoreCoordinatorCollectionTransitionCapability,
} from './store-coordinator';
import type { StoreCollectionScheduler } from './store-collection-scheduler';

type AdapterPorts = Pick<
  StoreCollectionOrchestratorDependencies,
  | 'listActiveStores'
  | 'inspectStoreSchedule'
  | 'getActiveStoreId'
  | 'registerSchedulerRecoveryAdmission'
  | 'deriveTransitionCapability'
  | 'readActiveAuthority'
  | 'transitionAuthorityForCollection'
>;

export interface StoreCollectionOrchestratorDomainAdapterOptions {
  coordinator: Pick<
    StoreCoordinator,
    | 'listStores'
    | 'getCollectionAuthority'
    | 'issueCollectionTransitionCapability'
    | 'transitionForCollection'
  >;
  scheduler: Pick<StoreCollectionScheduler, 'inspectForStore'>;
  now?: () => Date;
}

interface AutomationCapabilityRecord {
  owner: string;
  active: boolean;
}

interface TransitionCapabilityRecord {
  owner: string;
  automationCapability: StoreCollectionAutomationAuthority['capability'];
  scopeIdentity: StoreCollectionTransitionCapabilityScope;
  scopeSnapshot: StoreCollectionTransitionCapabilityScope;
  coordinatorCapability?: StoreCoordinatorCollectionTransitionCapability;
  recoveryAdmission?: StoreCollectionSchedulerRecoveryAdmission;
  recoveryScopeDigest?: string;
  schedulerAttemptId?: string;
  schedulerRequestId?: string;
  executionScopeIdentity?: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
  used: boolean;
  schedulerClaimed: boolean;
}

interface RecoveryAdmissionRecord {
  owner: string;
  automationCapability: StoreCollectionAutomationAuthority['capability'];
  executionScopeIdentity: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
  executionScopeSnapshot: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
  contextIdentity: StoreContextEnvelope;
  contextSnapshot: StoreContextEnvelope;
  attemptId: string;
  requestId: string;
  scopeDigest: string;
  consumed: boolean;
}

export interface StoreCollectionSchedulerTransitionAuthorityClaim<
  Domain extends StoreCollectionTransitionCapabilityDomain,
> {
  transitionScope: StoreCollectionTransitionCapabilityScope<Domain>;
  executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
}

const FINGERPRINT = /^[a-f0-9]{64}$/;

/**
 * Main-only, browser-free adapter foundation for StoreCollectionOrchestrator.
 * It intentionally does not implement automation leases, visible runtime
 * operations, scheduler execute/recover, IPC, or any browser controller.
 */
export class StoreCollectionOrchestratorDomainAdapter implements AdapterPorts {
  private readonly now: () => Date;
  private readonly automationCapabilities = new WeakMap<object, AutomationCapabilityRecord>();
  private readonly recoveryAdmissions = new WeakMap<object, RecoveryAdmissionRecord>();
  private readonly transitionCapabilities = new WeakMap<object, TransitionCapabilityRecord>();
  private readonly issuedScopeIds = new Set<string>();

  constructor(private readonly options: StoreCollectionOrchestratorDomainAdapterOptions) {
    this.now = options.now ?? (() => new Date());
  }

  issueAutomationAuthority(ownerInput: string): StoreCollectionAutomationAuthority {
    const owner = normalizeOwner(ownerInput);
    const capability = Object.freeze({}) as StoreCollectionAutomationAuthority['capability'];
    this.automationCapabilities.set(capability, { owner, active: true });
    return { owner, capability };
  }

  retireAutomationAuthority(authority: StoreCollectionAutomationAuthority): void {
    const record = this.assertAutomationAuthority(authority);
    this.automationCapabilities.set(authority.capability, { ...record, active: false });
  }

  listActiveStores(): readonly StoreRecord[] {
    const stores = this.options.coordinator.listStores({ statuses: ['active'] })
      .filter((store) => store.status === 'active')
      .map(cloneStore)
      .sort((left, right) => codepointCompare(left.storeId, right.storeId));
    assertUniqueActiveStoreSnapshot(stores);
    return stores;
  }

  inspectStoreSchedule(storeInput: StoreRecord) {
    const store = this.requireSnapshotStore(storeInput);
    const now = this.now();
    return this.options.scheduler.inspectForStore(store, {
      businessDate: businessDateFor(now),
      now,
    });
  }

  getActiveStoreId() {
    const authority = this.options.coordinator.getCollectionAuthority();
    this.assertAuthorityAgainstSnapshot(authority);
    return authority.activeStoreId;
  }

  async readActiveAuthority(
    input: StoreCollectionAutomationAuthority,
  ): ReturnType<StoreCollectionOrchestratorDependencies['readActiveAuthority']> {
    this.assertAutomationAuthority(input);
    const authority = this.options.coordinator.getCollectionAuthority();
    this.assertAuthorityAgainstSnapshot(authority);
    return {
      ...input,
      authority,
    };
  }

  async registerSchedulerRecoveryAdmission(
    input: StoreCollectionAutomationAuthority & {
      executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
      context: StoreContextEnvelope;
      attemptId: string;
      requestId: string;
    },
  ): Promise<StoreCollectionSchedulerRecoveryAdmissionReceipt> {
    this.assertAutomationAuthority(input);
    this.assertTransitionScope(input.executionScope);
    const context = normalizeStoreContextEnvelope(input.context);
    if (input.executionScope.capabilityDomain !== 'transition_execution'
      || input.executionScope.purpose !== 'collection'
      || !input.executionScope.target
      || input.executionScope.target.storeId !== context.storeId
      || input.executionScope.target.browserProfileId !== context.browserProfileId
      || input.executionScope.target.marketplace !== context.marketplace
      || input.executionScope.target.currency !== context.currency
      || input.executionScope.target.businessTimezone !== context.businessTimezone) {
      throw new Error('recovery admission execution scope does not match the historical Store/Profile context');
    }
    const identity = deriveStoreCollectionSchedulerExecutionIdentity({
      cycleId: input.executionScope.cycleId,
      transitionId: input.executionScope.transitionId,
      fingerprint: input.executionScope.expectedFingerprint ?? '',
      transitionScope: input.executionScope,
      context,
    });
    if (identity.attemptId !== input.attemptId || identity.requestId !== input.requestId) {
      throw new Error('recovery admission attempt/request is not derived from the execution scope');
    }
    const scopeDigest = storeCollectionSchedulerRecoveryAdmissionScopeDigest({
      executionScope: input.executionScope,
      context,
      attemptId: input.attemptId,
      requestId: input.requestId,
    });
    const recoveryAdmission = Object.freeze({}) as StoreCollectionSchedulerRecoveryAdmission;
    this.recoveryAdmissions.set(recoveryAdmission, {
      owner: input.owner,
      automationCapability: input.capability,
      executionScopeIdentity: input.executionScope,
      executionScopeSnapshot: cloneTransitionScope(
        input.executionScope,
      ) as StoreCollectionTransitionCapabilityScope<'transition_execution'>,
      contextIdentity: input.context,
      contextSnapshot: normalizeStoreContextEnvelope(context),
      attemptId: input.attemptId,
      requestId: input.requestId,
      scopeDigest,
      consumed: false,
    });
    return {
      owner: input.owner,
      capability: input.capability,
      recoveryAdmission,
      executionScope: input.executionScope,
      context: input.context,
      attemptId: input.attemptId,
      requestId: input.requestId,
      scopeDigest,
      registered: true,
    };
  }

  async deriveTransitionCapability<Domain extends StoreCollectionTransitionCapabilityDomain>(
    input: StoreCollectionAutomationAuthority & {
      scope: StoreCollectionTransitionCapabilityScope<Domain>;
      recoveryAdmission?: StoreCollectionSchedulerRecoveryAdmission;
      recoveryScopeDigest?: string;
      schedulerAttemptId?: string;
      schedulerRequestId?: string;
    },
  ): Promise<StoreCollectionTransitionCapabilityReceipt<Domain>> {
    this.assertAutomationAuthority(input);
    const scope = input.scope;
    this.assertTransitionScope(scope);
    const currentAuthority = this.options.coordinator.getCollectionAuthority();
    this.assertAuthorityAgainstSnapshot(currentAuthority);
    if (scope.capabilityDomain === 'transition_execution'
      && !sameAuthority(scope.fromAuthority, currentAuthority)) {
      throw new Error('transition capability scope is stale against current Main authority');
    }
    let recoveryRecord: RecoveryAdmissionRecord | undefined;
    if (scope.capabilityDomain === 'recovery_existing_request_only') {
      recoveryRecord = input.recoveryAdmission
        ? this.recoveryAdmissions.get(input.recoveryAdmission)
        : undefined;
      if (!recoveryRecord
        || recoveryRecord.consumed
        || recoveryRecord.owner !== input.owner
        || recoveryRecord.automationCapability !== input.capability
        || input.recoveryScopeDigest !== recoveryRecord.scopeDigest
        || input.schedulerAttemptId !== recoveryRecord.attemptId
        || input.schedulerRequestId !== recoveryRecord.requestId
        || !sameRecoveryScope(
          recoveryRecord.executionScopeSnapshot,
          scope as StoreCollectionTransitionCapabilityScope<'recovery_existing_request_only'>,
        )) {
        throw new Error('recovery capability requires one exact unconsumed protected-history admission');
      }
      recoveryRecord.consumed = true;
    } else if (input.recoveryAdmission !== undefined
      || input.recoveryScopeDigest !== undefined
      || input.schedulerAttemptId !== undefined
      || input.schedulerRequestId !== undefined) {
      throw new Error('execution capability cannot carry recovery admission fields');
    }
    const scopeKey = `${scope.capabilityDomain}:${scope.capabilityId}`;
    if (this.issuedScopeIds.has(scopeKey)) {
      throw new Error('transition capability scope was already issued');
    }
    const transitionCapability = Object.freeze(
      {},
    ) as StoreCollectionTransitionCapabilityReceipt<Domain>['transitionCapability'];
    const coordinatorCapability = scope.capabilityDomain === 'transition_execution'
      ? this.options.coordinator.issueCollectionTransitionCapability()
      : undefined;
    this.transitionCapabilities.set(transitionCapability, {
      owner: input.owner,
      automationCapability: input.capability,
      scopeIdentity: scope,
      scopeSnapshot: cloneTransitionScope(scope),
      ...(coordinatorCapability ? { coordinatorCapability } : {}),
      ...(recoveryRecord && input.recoveryAdmission ? {
        recoveryAdmission: input.recoveryAdmission,
        recoveryScopeDigest: recoveryRecord.scopeDigest,
        schedulerAttemptId: recoveryRecord.attemptId,
        schedulerRequestId: recoveryRecord.requestId,
        executionScopeIdentity: recoveryRecord.executionScopeIdentity,
      } : {}),
      used: false,
      schedulerClaimed: false,
    });
    this.issuedScopeIds.add(scopeKey);
    return {
      owner: input.owner,
      capability: input.capability,
      transitionCapability,
      transitionScope: scope,
      derived: true,
      ...(recoveryRecord && input.recoveryAdmission ? {
        recoveryAdmission: input.recoveryAdmission,
        recoveryScopeDigest: recoveryRecord.scopeDigest,
        schedulerAttemptId: recoveryRecord.attemptId,
        schedulerRequestId: recoveryRecord.requestId,
      } : {}),
    };
  }

  async transitionAuthorityForCollection(
    input: Parameters<StoreCollectionOrchestratorDependencies['transitionAuthorityForCollection']>[0],
  ): ReturnType<StoreCollectionOrchestratorDependencies['transitionAuthorityForCollection']> {
    this.assertAutomationAuthority(input);
    const record = this.transitionCapabilities.get(input.transitionCapability);
    if (!record
      || record.used
      || record.owner !== input.owner
      || record.automationCapability !== input.capability
      || record.scopeIdentity !== input.transitionScope
      || !sameTransitionScope(record.scopeSnapshot, input.transitionScope)
      || record.scopeSnapshot.capabilityDomain !== 'transition_execution'
      || !record.coordinatorCapability
      || !sameAuthority(input.previous, record.scopeSnapshot.fromAuthority)
      || !sameTarget(input.target, record.scopeSnapshot.target)) {
      throw new Error('collection transition capability is forged, replayed, or scope-mismatched');
    }
    record.used = true;
    const receipt = this.options.coordinator.transitionForCollection({
      capability: record.coordinatorCapability,
      reason: input.reason,
      mode: input.mode,
      previous: input.previous,
      target: input.target,
    });
    this.assertAuthorityAgainstSnapshot(receipt.current);
    return {
      owner: input.owner,
      capability: input.capability,
      transitionCapability: input.transitionCapability,
      transitionScope: input.transitionScope,
      reason: 'collection_automation',
      mode: 'collection_only',
      previous: receipt.previous,
      current: receipt.current,
      targetGenerationBefore: receipt.targetGenerationBefore,
      targetGenerationAfter: receipt.targetGenerationAfter,
    };
  }

  /**
   * Non-consuming issuer-backed proof for Main-only visible-runtime ports.
   * Authority transition itself does not retire this capability: the same
   * execution authority must remain valid for headed-runtime cleanup and
   * identity verification. Scheduler claim is the terminal hand-off here.
   */
  assertTransitionAuthority(
    authority: StoreCollectionTransitionAutomationAuthority<'transition_execution'>,
  ): void {
    this.assertAutomationAuthority(authority);
    const record = authority?.transitionCapability
      ? this.transitionCapabilities.get(authority.transitionCapability)
      : undefined;
    if (!record
      || record.owner !== authority.owner
      || record.automationCapability !== authority.capability
      || record.scopeIdentity !== authority.transitionScope
      || !sameTransitionScope(record.scopeSnapshot, authority.transitionScope)
      || record.scopeSnapshot.capabilityDomain !== 'transition_execution'
      || authority.transitionScope.capabilityDomain !== 'transition_execution'
      || !record.coordinatorCapability
      || record.schedulerClaimed
      || record.recoveryAdmission !== undefined) {
      throw new Error(
        'visible transition authority is forged, mutated, retired, replayed, used by scheduler, or cross-domain',
      );
    }
  }

  /**
   * Main-only one-shot admission for the scheduler execution/recovery ports.
   *
   * The scheduler adapter must not trust a structurally plausible capability
   * echoed by its caller. This method proves the object identities were issued
   * by this adapter, are owned by the same live automation authority, retain
   * their original immutable scope snapshot, and still point at the exact
   * active Store/Profile/Generation authority. A claimed scheduler capability
   * cannot be replayed.
   */
  claimSchedulerTransitionAuthority<Domain extends StoreCollectionTransitionCapabilityDomain>(
    authority: StoreCollectionTransitionAutomationAuthority<Domain>,
    expected: {
      capabilityDomain: Domain;
      context: StoreContextEnvelope;
      expectedAuthority: StoreCollectionAuthorityReadback;
      attemptId: string;
      requestId: string;
    },
  ): StoreCollectionSchedulerTransitionAuthorityClaim<Domain> {
    this.assertAutomationAuthority(authority);
    const context = normalizeStoreContextEnvelope(expected.context);
    const record = this.transitionCapabilities.get(authority.transitionCapability);
    const recoveryRecord = record?.recoveryAdmission
      ? this.recoveryAdmissions.get(record.recoveryAdmission)
      : undefined;
    if (!record
      || record.schedulerClaimed
      || record.owner !== authority.owner
      || record.automationCapability !== authority.capability
      || record.scopeIdentity !== authority.transitionScope
      || !sameTransitionScope(record.scopeSnapshot, authority.transitionScope)
      || record.scopeSnapshot.capabilityDomain !== expected.capabilityDomain
      || authority.transitionScope.capabilityDomain !== expected.capabilityDomain
      || record.scopeSnapshot.purpose !== 'collection'
      || (expected.capabilityDomain === 'transition_execution' && !record.used)
      || (expected.capabilityDomain === 'recovery_existing_request_only' && (
        !record.recoveryAdmission
        || !record.executionScopeIdentity
        || !record.recoveryScopeDigest
        || record.schedulerAttemptId !== expected.attemptId
        || record.schedulerRequestId !== expected.requestId
        || !recoveryRecord
        || !recoveryRecord.consumed
        || recoveryRecord.owner !== authority.owner
        || recoveryRecord.automationCapability !== authority.capability
        || recoveryRecord.executionScopeIdentity !== record.executionScopeIdentity
        || !sameContext(recoveryRecord.contextSnapshot, context)
        || recoveryRecord.scopeDigest !== record.recoveryScopeDigest
      ))) {
      throw new Error('scheduler transition capability is forged, replayed, or scope-mismatched');
    }
    this.assertTransitionScope(authority.transitionScope);
    const exactAuthority: StoreCollectionAuthorityReadback = {
      activeStoreId: context.storeId,
      context,
    };
    this.assertAuthorityAgainstSnapshot(expected.expectedAuthority);
    if (!sameAuthority(expected.expectedAuthority, exactAuthority)) {
      throw new Error('scheduler expected authority is outside the exact Store/Profile/Generation context');
    }
    if (expected.capabilityDomain === 'transition_execution') {
      const currentAuthority = this.options.coordinator.getCollectionAuthority();
      this.assertAuthorityAgainstSnapshot(currentAuthority);
      if (!sameAuthority(currentAuthority, exactAuthority)) {
        throw new Error('scheduler transition capability is stale against current Main authority');
      }
    }
    if (!record.scopeSnapshot.target
      || record.scopeSnapshot.target.storeId !== context.storeId
      || record.scopeSnapshot.target.browserProfileId !== context.browserProfileId
      || record.scopeSnapshot.target.marketplace !== context.marketplace
      || record.scopeSnapshot.target.currency !== context.currency
      || record.scopeSnapshot.target.businessTimezone !== context.businessTimezone) {
      throw new Error('scheduler transition target does not match the exact Store/Profile context');
    }
    record.schedulerClaimed = true;
    return {
      transitionScope: authority.transitionScope,
      executionScope: (record.executionScopeIdentity
        ?? authority.transitionScope) as StoreCollectionTransitionCapabilityScope<'transition_execution'>,
    };
  }

  private assertAutomationAuthority(
    authority: StoreCollectionAutomationAuthority,
  ): AutomationCapabilityRecord {
    if (!authority || typeof authority !== 'object' || !authority.capability) {
      throw new Error('Main automation authority is required');
    }
    const record = this.automationCapabilities.get(authority.capability);
    if (!record || !record.active || record.owner !== authority.owner) {
      throw new Error('Main automation capability is forged, retired, or owner-mismatched');
    }
    return record;
  }

  private assertTransitionScope(scope: StoreCollectionTransitionCapabilityScope): void {
    if (!scope
      || typeof scope !== 'object'
      || !['transition_execution', 'recovery_existing_request_only'].includes(scope.capabilityDomain)
      || !safeText(scope.capabilityId)
      || !safeText(scope.cycleId)
      || !safeText(scope.transitionId)
      || (scope.purpose !== 'collection' && scope.purpose !== 'restore')
      || (scope.purpose === 'collection' && (
        scope.target === null
        || typeof scope.expectedFingerprint !== 'string'
        || !FINGERPRINT.test(scope.expectedFingerprint)
      ))
      || (scope.purpose === 'restore' && scope.expectedFingerprint !== null)) {
      throw new Error('transition capability scope is invalid');
    }
    this.assertAuthorityAgainstSnapshot(scope.fromAuthority);
    this.assertAuthorityAgainstSnapshot(scope.originAuthority);
    if (scope.target) this.requireSnapshotStore(scope.target);
  }

  private requireSnapshotStore(
    storeInput: Pick<
      StoreRecord,
      'storeId' | 'browserProfileId' | 'marketplace' | 'currency' | 'businessTimezone'
    >,
  ): StoreRecord {
    const store = this.listActiveStores().find((candidate) => (
      candidate.storeId === storeInput.storeId
      && candidate.browserProfileId === storeInput.browserProfileId
    ));
    if (!store
      || storeInput.marketplace !== 'US'
      || storeInput.currency !== 'USD'
      || storeInput.businessTimezone !== 'America/Los_Angeles') {
      throw new Error('store is not in the exact active US/USD/LA Store/Profile snapshot');
    }
    return store;
  }

  private assertAuthorityAgainstSnapshot(authority: {
    activeStoreId: StoreContextEnvelope['storeId'] | null;
    context: StoreContextEnvelope | null;
  }): void {
    if (authority.activeStoreId === null) {
      if (authority.context !== null) throw new Error('null authority cannot carry context');
      return;
    }
    if (!authority.context) throw new Error('active authority requires context');
    const context = normalizeStoreContextEnvelope(authority.context);
    if (context.storeId !== authority.activeStoreId
      || context.marketplace !== 'US'
      || context.currency !== 'USD'
      || context.businessTimezone !== 'America/Los_Angeles') {
      throw new Error('active authority is outside the US/USD/LA domain');
    }
    this.requireSnapshotStore(context);
  }
}

function assertUniqueActiveStoreSnapshot(stores: readonly StoreRecord[]): void {
  const storeIds = new Set<string>();
  const profiles = new Set<string>();
  for (const store of stores) {
    if (store.marketplace !== 'US'
      || store.currency !== 'USD'
      || store.businessTimezone !== 'America/Los_Angeles'
      || !safeText(store.storeId)
      || !safeText(store.browserProfileId)
      || storeIds.has(store.storeId)
      || profiles.has(store.browserProfileId)) {
      throw new Error('active store snapshot contains unsupported or duplicate Store/Profile authority');
    }
    storeIds.add(store.storeId);
    profiles.add(store.browserProfileId);
  }
}

function cloneStore(store: StoreRecord): StoreRecord {
  return {
    storeId: store.storeId,
    browserProfileId: store.browserProfileId,
    displayName: store.displayName,
    marketplace: store.marketplace,
    currency: store.currency,
    status: store.status,
    businessTimezone: store.businessTimezone,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
    ...(store.archivedAt === undefined ? {} : { archivedAt: store.archivedAt }),
  };
}

function sameTarget(
  left: StoreCollectionTransitionCapabilityScope['target'],
  right: StoreCollectionTransitionCapabilityScope['target'],
): boolean {
  if (left === null || right === null) return left === right;
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.marketplace === right.marketplace
    && left.currency === right.currency
    && left.businessTimezone === right.businessTimezone;
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

function sameContext(left: StoreContextEnvelope, right: StoreContextEnvelope): boolean {
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.marketplace === right.marketplace
    && left.currency === right.currency
    && left.businessTimezone === right.businessTimezone
    && left.businessDate === right.businessDate
    && left.sessionGeneration === right.sessionGeneration;
}

function cloneAuthority(
  value: StoreCollectionAuthorityReadback,
): StoreCollectionAuthorityReadback {
  return {
    activeStoreId: value.activeStoreId,
    context: value.context ? normalizeStoreContextEnvelope(value.context) : null,
  };
}

function cloneTransitionScope(
  value: StoreCollectionTransitionCapabilityScope,
): StoreCollectionTransitionCapabilityScope {
  return {
    capabilityDomain: value.capabilityDomain,
    capabilityId: value.capabilityId,
    cycleId: value.cycleId,
    transitionId: value.transitionId,
    purpose: value.purpose,
    fromAuthority: cloneAuthority(value.fromAuthority),
    originAuthority: cloneAuthority(value.originAuthority),
    target: value.target ? { ...value.target } : null,
    expectedFingerprint: value.expectedFingerprint,
  };
}

function sameTransitionScope(
  left: StoreCollectionTransitionCapabilityScope,
  right: StoreCollectionTransitionCapabilityScope,
): boolean {
  return left.capabilityDomain === right.capabilityDomain
    && left.capabilityId === right.capabilityId
    && left.cycleId === right.cycleId
    && left.transitionId === right.transitionId
    && left.purpose === right.purpose
    && sameAuthority(left.fromAuthority, right.fromAuthority)
    && sameAuthority(left.originAuthority, right.originAuthority)
    && sameTarget(left.target, right.target)
    && left.expectedFingerprint === right.expectedFingerprint;
}

function sameRecoveryScope(
  execution: StoreCollectionTransitionCapabilityScope<'transition_execution'>,
  recovery: StoreCollectionTransitionCapabilityScope<'recovery_existing_request_only'>,
): boolean {
  return recovery.capabilityId === `${execution.capabilityId}:recovery`
    && recovery.cycleId === execution.cycleId
    && recovery.transitionId === execution.transitionId
    && recovery.purpose === execution.purpose
    && sameAuthority(recovery.fromAuthority, execution.fromAuthority)
    && sameAuthority(recovery.originAuthority, execution.originAuthority)
    && sameTarget(recovery.target, execution.target)
    && recovery.expectedFingerprint === execution.expectedFingerprint;
}

function businessDateFor(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('adapter clock is invalid');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  );
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function normalizeOwner(value: unknown): string {
  if (!safeText(value)) throw new TypeError('automation owner is required');
  return value;
}

function safeText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
}

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
