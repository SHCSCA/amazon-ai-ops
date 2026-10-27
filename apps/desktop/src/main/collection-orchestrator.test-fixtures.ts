import {
  createHash,
  createHmac,
} from 'node:crypto';
import { vi } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  StoreCollectionOrchestrator,
  deriveStoreCollectionSchedulerExecutionIdentity,
  storeCollectionSchedulerRecoveryAdmissionScopeDigest,
  type StoreCollectionAutomationCapability,
  type StoreCollectionAuthorityReadback,
  type StoreCollectionOrchestratorDependencies,
  type StoreCollectionOrchestratorHistoryPort,
  type StoreCollectionOrchestratorRecordCodec,
  type StoreCollectionOrchestratorTransition,
  type StoreCollectionOrchestratorTransitionPhase,
  type StoreCollectionOrchestratorTransitionPurpose,
  type StoreCollectionPolicySuppressionGuard,
  type StoreCollectionSchedulerRecoveryAdmission,
  type StoreCollectionTransitionCapability,
} from './store-collection-orchestrator';

export const NOW = new Date('2026-07-23T16:00:00.000Z');

export const OWNER = 'collection-owner-1';

export function runtimeCapability(label: string): StoreCollectionAutomationCapability {
  return Object.freeze({ label }) as unknown as StoreCollectionAutomationCapability;
}

export function policyGuard(label: string): StoreCollectionPolicySuppressionGuard {
  return Object.freeze({ label }) as unknown as StoreCollectionPolicySuppressionGuard;
}

export function transitionCapability(label: string): StoreCollectionTransitionCapability {
  return Object.freeze({ label }) as unknown as StoreCollectionTransitionCapability;
}

export function recoveryAdmission(label: string): StoreCollectionSchedulerRecoveryAdmission {
  return Object.freeze({ label }) as unknown as StoreCollectionSchedulerRecoveryAdmission;
}

export class MemoryHistory implements StoreCollectionOrchestratorHistoryPort {
  value: string | null = null;
  sets = 0;
  failAtSet: number | null = null;
  get(): string | null { return this.value; }
  set(value: string): void {
    this.sets += 1;
    if (this.failAtSet === this.sets) throw new Error('history write failed');
    this.value = value;
  }
  transaction<T>(work: () => T): T { return work(); }
}

export class AuthenticatedTestCodec implements StoreCollectionOrchestratorRecordCodec {
  available = true;
  isAvailable(): boolean { return this.available; }
  seal(plaintext: string): string {
    const payload = Buffer.from(plaintext, 'utf8').toString('base64');
    const mac = createHmac('sha256', 'orchestrator-test-key').update(payload).digest('hex');
    return `test:v2:${mac}:${payload}`;
  }
  open(envelope: string): string {
    const match = /^test:v2:([a-f0-9]{64}):(.+)$/.exec(envelope);
    if (!match) throw new Error('invalid envelope');
    const expected = createHmac('sha256', 'orchestrator-test-key').update(match[2]).digest('hex');
    if (expected !== match[1]) throw new Error('modified envelope');
    return Buffer.from(match[2], 'base64').toString('utf8');
  }
}

export function context(
  storeId = 'store-a',
  browserProfileId = 'profile-a',
  generation = 1,
  businessDate = '2026-07-23',
): StoreContextEnvelope {
  return normalizeStoreContextEnvelope({
    storeId,
    browserProfileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate,
    sessionGeneration: generation,
  });
}

export function store(
  storeId = 'store-a',
  browserProfileId = 'profile-a',
  overrides: Partial<StoreRecord> = {},
): StoreRecord {
  const identity = context(storeId, browserProfileId);
  return {
    storeId: identity.storeId,
    browserProfileId: identity.browserProfileId,
    displayName: storeId,
    marketplace: 'US',
    currency: 'USD',
    status: 'active',
    businessTimezone: 'America/Los_Angeles',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as StoreRecord;
}

export function fingerprint(storeId: string): string {
  return createHash('sha256').update(`fingerprint:${storeId}`).digest('hex');
}

export function authority(value: StoreContextEnvelope | null): StoreCollectionAuthorityReadback {
  return { activeStoreId: value?.storeId ?? null, context: value };
}

export type HarnessOptions = {
  stores?: StoreRecord[];
  initialContext?: StoreContextEnvelope | null;
  businessDate?: string;
  inspection?: (value: StoreRecord) => { state: 'due' | 'not_due'; expectedFingerprint?: string };
  manualInspection?: (value: StoreRecord, exactContext: StoreContextEnvelope) => {
    state: 'eligible' | 'duplicate';
    expectedFingerprint: string;
  };
  acquire?: StoreCollectionOrchestratorDependencies['acquireAutomationLease'];
  registerRecovery?: StoreCollectionOrchestratorDependencies['registerSchedulerRecoveryAdmission'];
  deriveTransition?: StoreCollectionOrchestratorDependencies['deriveTransitionCapability'];
  acquirePolicy?: StoreCollectionOrchestratorDependencies['acquirePolicyDispatchSuppression'];
  readPolicy?: StoreCollectionOrchestratorDependencies['readPolicyDispatchSuppression'];
  transition?: StoreCollectionOrchestratorDependencies['transitionAuthorityForCollection'];
  readAuthority?: StoreCollectionOrchestratorDependencies['readActiveAuthority'];
  readTransitionAuthority?: StoreCollectionOrchestratorDependencies['readTransitionAuthority'];
  close?: StoreCollectionOrchestratorDependencies['closeVisibleRuntime'];
  collectionLease?: StoreCollectionOrchestratorDependencies['assertCollectionLeaseReleased'];
  startRuntime?: StoreCollectionOrchestratorDependencies['startCollectionOnlyVisibleRuntime'];
  verifyIdentity?: StoreCollectionOrchestratorDependencies['verifyVisibleLingxingIdentity'];
  execute?: StoreCollectionOrchestratorDependencies['scheduler']['execute'];
  recover?: StoreCollectionOrchestratorDependencies['scheduler']['recover'];
  history?: MemoryHistory;
  codec?: AuthenticatedTestCodec;
  historyRetentionLimit?: number;
  onError?: (error: unknown) => void;
  setInterval?: StoreCollectionOrchestratorDependencies['setInterval'];
  clearInterval?: StoreCollectionOrchestratorDependencies['clearInterval'];
};

export function harness(options: HarnessOptions = {}) {
  const stores = options.stores ?? [store('store-b', 'profile-b'), store('store-a', 'profile-a')];
  const history = options.history ?? new MemoryHistory();
  const codec = options.codec ?? new AuthenticatedTestCodec();
  let current = options.initialContext ?? null;
  const generations = new Map(stores.map((item) => [item.storeId, 0]));
  if (current) generations.set(current.storeId, current.sessionGeneration);
  const inspectStoreSchedule = vi.fn(options.inspection ?? ((item) => ({
    state: 'due' as const,
    expectedFingerprint: fingerprint(item.storeId),
  })));
  const inspectManualStoreSchedule = vi.fn(options.manualInspection ?? ((item) => ({
    state: 'eligible' as const,
    expectedFingerprint: fingerprint(item.storeId),
  })));
  const getActiveStoreId = vi.fn(() => current?.storeId ?? null);
  let capabilitySequence = 0;
  let latestCapability: StoreCollectionAutomationCapability | undefined;
  const release = vi.fn(async () => ({
    owner: OWNER,
    capability: latestCapability!,
    released: true as const,
  }));
  const acquireAutomationLease = vi.fn(async () => {
    const acquired = options.acquire ? await options.acquire() : {
      owner: OWNER,
      capability: runtimeCapability(`automation-${++capabilitySequence}`),
      release,
    };
    latestCapability = acquired.capability;
    return acquired;
  });
  let transitionCapabilitySequence = 0;
  let recoveryAdmissionSequence = 0;
  const transitionCapabilities: StoreCollectionTransitionCapability[] = [];
  const registerSchedulerRecoveryAdmission = vi.fn(options.registerRecovery ?? (async (input) => ({
    owner: input.owner,
    capability: input.capability,
    recoveryAdmission: recoveryAdmission(`recovery-admission-${++recoveryAdmissionSequence}`),
    executionScope: input.executionScope,
    context: input.context,
    attemptId: input.attemptId,
    requestId: input.requestId,
    scopeDigest: storeCollectionSchedulerRecoveryAdmissionScopeDigest({
      executionScope: input.executionScope,
      context: input.context,
      attemptId: input.attemptId,
      requestId: input.requestId,
    }),
    registered: true as const,
  })));
  const deriveTransitionCapability = vi.fn(options.deriveTransition ?? (async (input) => {
    const derived = transitionCapability(`transition-${++transitionCapabilitySequence}`);
    transitionCapabilities.push(derived);
    return {
      owner: input.owner,
      capability: input.capability,
      transitionCapability: derived,
      transitionScope: input.scope,
      derived: true as const,
      ...(input.recoveryAdmission ? {
        recoveryAdmission: input.recoveryAdmission,
        recoveryScopeDigest: input.recoveryScopeDigest,
        schedulerAttemptId: input.schedulerAttemptId,
        schedulerRequestId: input.schedulerRequestId,
      } : {}),
    };
  }));
  let latestPolicyGuard: StoreCollectionPolicySuppressionGuard | undefined;
  const releasePolicy = vi.fn(async () => ({
    owner: OWNER,
    capability: latestCapability!,
    guard: latestPolicyGuard!,
    released: true as const,
  }));
  const acquirePolicyDispatchSuppression = vi.fn(options.acquirePolicy ?? (async (input) => {
    latestPolicyGuard = policyGuard(`policy-${capabilitySequence}`);
    return {
      ...input,
      guard: latestPolicyGuard,
      release: releasePolicy,
    };
  }));
  const readPolicyDispatchSuppression = vi.fn(options.readPolicy ?? (async (input) => ({
    ...input,
    suppressed: true as const,
  })));
  const transitionAuthorityForCollection = vi.fn(options.transition ?? (async (input) => {
    const previous = authority(current);
    if (input.target === null) {
      current = null;
      return {
        owner: input.owner,
        capability: input.capability,
        transitionCapability: input.transitionCapability,
        transitionScope: input.transitionScope,
        reason: 'collection_automation' as const,
        mode: 'collection_only' as const,
        previous,
        current: authority(current),
        targetGenerationBefore: null,
        targetGenerationAfter: null,
      };
    }
    const before = generations.get(input.target.storeId) ?? 0;
    const next = before + 1;
    current = context(
      input.target.storeId,
      input.target.browserProfileId,
      next,
      options.businessDate,
    );
    generations.set(input.target.storeId, next);
    return {
      owner: input.owner,
      capability: input.capability,
      transitionCapability: input.transitionCapability,
      transitionScope: input.transitionScope,
      reason: 'collection_automation' as const,
      mode: 'collection_only' as const,
      previous,
      current: authority(current),
      targetGenerationBefore: before,
      targetGenerationAfter: next,
    };
  }));
  const readActiveAuthority = vi.fn(options.readAuthority ?? (async (input) => ({
    ...input,
    authority: authority(current),
  })));
  const readTransitionAuthority = vi.fn(options.readTransitionAuthority ?? (async (input) => ({
    owner: input.owner,
    capability: input.capability,
    transitionCapability: input.transitionCapability,
    transitionScope: input.transitionScope,
    authority: authority(current),
  })));
  const closeVisibleRuntime = vi.fn(options.close ?? (async (auth) => ({
    owner: auth.owner,
    capability: auth.capability,
    transitionCapability: auth.transitionCapability,
    transitionScope: auth.transitionScope,
    closed: true as const,
    authority: authority(current),
  })));
  const assertCollectionLeaseReleased = vi.fn(options.collectionLease ?? (async (auth) => ({
    owner: auth.owner,
    capability: auth.capability,
    transitionCapability: auth.transitionCapability,
    transitionScope: auth.transitionScope,
    released: true as const,
    authority: authority(current),
  })));
  const startCollectionOnlyVisibleRuntime = vi.fn(options.startRuntime ?? (async (input) => ({
    owner: input.owner,
    capability: input.capability,
    transitionCapability: input.transitionCapability,
    transitionScope: input.transitionScope,
    started: true as const,
    authority: authority(input.context),
  })));
  const verifyVisibleLingxingIdentity = vi.fn(options.verifyIdentity ?? (async (input) => ({
    owner: input.owner,
    capability: input.capability,
    transitionCapability: input.transitionCapability,
    transitionScope: input.transitionScope,
    verified: true as const,
    authority: authority(input.context),
  })));
  const execute = vi.fn(options.execute ?? (async (input) => {
    const identity = deriveStoreCollectionSchedulerExecutionIdentity({
      cycleId: input.cycleId,
      transitionId: input.transitionId,
      fingerprint: input.expectedFingerprint,
      transitionScope: input.transitionScope,
      context: input.context,
    });
    if (input.attemptId !== identity.attemptId || input.requestId !== identity.requestId) {
      throw new Error('scheduler received a non-derived execution identity');
    }
    return {
      state: 'accepted' as const,
      authority: authority(input.context),
      owner: input.owner,
      capability: input.capability,
      transitionCapability: input.transitionCapability,
      transitionScope: input.transitionScope,
      cycleId: input.cycleId,
      transitionId: input.transitionId,
      fingerprint: input.expectedFingerprint,
      accepted: true,
      duplicate: false,
      attemptId: input.attemptId,
      requestId: input.requestId,
    };
  }));
  const recover = vi.fn(options.recover ?? (async (input) => {
    return {
      state: 'succeeded' as const,
      authority: authority(input.context),
      owner: input.owner,
      capability: input.capability,
      transitionCapability: input.transitionCapability,
      transitionScope: input.transitionScope,
      cycleId: input.cycleId,
      transitionId: input.transitionId,
      fingerprint: input.expectedFingerprint,
      accepted: true,
      duplicate: false,
      attemptId: input.attemptId,
      requestId: input.requestId,
    };
  }));
  const orchestrator = new StoreCollectionOrchestrator({
    listActiveStores: () => stores,
    inspectStoreSchedule,
    inspectManualStoreSchedule,
    getActiveStoreId,
    acquireAutomationLease,
    registerSchedulerRecoveryAdmission,
    deriveTransitionCapability,
    acquirePolicyDispatchSuppression,
    readPolicyDispatchSuppression,
    transitionAuthorityForCollection,
    readActiveAuthority,
    readTransitionAuthority,
    closeVisibleRuntime,
    assertCollectionLeaseReleased,
    startCollectionOnlyVisibleRuntime,
    verifyVisibleLingxingIdentity,
    scheduler: { execute, recover },
    history,
    recordCodec: codec,
    now: () => NOW,
    createCycleId: () => 'cycle-1',
    historyRetentionLimit: options.historyRetentionLimit,
    onError: options.onError,
    setInterval: options.setInterval,
    clearInterval: options.clearInterval,
  });
  return {
    orchestrator,
    stores,
    history,
    codec,
    inspectStoreSchedule,
    inspectManualStoreSchedule,
    getActiveStoreId,
    acquireAutomationLease,
    registerSchedulerRecoveryAdmission,
    deriveTransitionCapability,
    acquirePolicyDispatchSuppression,
    readPolicyDispatchSuppression,
    transitionAuthorityForCollection,
    readActiveAuthority,
    readTransitionAuthority,
    closeVisibleRuntime,
    assertCollectionLeaseReleased,
    startCollectionOnlyVisibleRuntime,
    verifyVisibleLingxingIdentity,
    execute,
    recover,
    release,
    releasePolicy,
    latestCapability: () => latestCapability,
    latestPolicyGuard: () => latestPolicyGuard,
    transitionCapabilities,
    current: () => current,
    setCurrent: (value: StoreContextEnvelope | null) => { current = value; },
  };
}

export function readHistory(test: ReturnType<typeof harness>) {
  return JSON.parse(test.codec.open(test.history.get()!));
}

export function matrixTransition(
  purpose: StoreCollectionOrchestratorTransitionPurpose,
  phase: StoreCollectionOrchestratorTransitionPhase,
  shape: 'none' | 'context' | 'scheduler',
  restoreTarget: 'store' | 'null' = 'store',
): StoreCollectionOrchestratorTransition {
  const target = context('store-a', 'profile-a', 1);
  return {
    transitionId: 'matrix-transition',
    capabilityId: 'matrix-capability',
    cycleId: 'matrix-cycle',
    owner: OWNER,
    fromStoreId: null,
    toStoreId: purpose === 'restore' && restoreTarget === 'null' ? null : target.storeId,
    browserProfileId: purpose === 'restore' && restoreTarget === 'null'
      ? null
      : target.browserProfileId,
    purpose,
    fromAuthority: authority(null),
    originAuthority: authority(null),
    ...(purpose === 'collection' ? { expectedFingerprint: fingerprint('store-a') } : {}),
    phase,
    ...(shape === 'none' ? {} : {
      businessDate: target.businessDate,
      sessionGeneration: target.sessionGeneration,
    }),
    ...(shape === 'scheduler' ? {
      schedulerAttemptId: 'sca:matrix',
      schedulerRequestId: 'scr:matrix',
    } : {}),
    startedAt: NOW.toISOString(),
    integrityDigest: '0'.repeat(64),
  };
}
