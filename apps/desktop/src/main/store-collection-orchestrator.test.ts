import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  StoreCollectionOrchestrator,
  STORE_COLLECTION_TRANSITION_PHASES,
  deriveStoreCollectionSchedulerExecutionIdentity,
  isStoreCollectionTransitionPhaseAllowed,
  storeCollectionTransitionPhaseFieldsValid,
  storeCollectionOrchestratorTransitionIntegrityDigest,
  storeCollectionSchedulerRecoveryAdmissionScopeDigest,
  type StoreCollectionAutomationCapability,
  type StoreCollectionAutomationAuthority,
  type StoreCollectionAuthorityReadback,
  type StoreCollectionOrchestratorDependencies,
  type StoreCollectionOrchestratorHistoryPort,
  type StoreCollectionOrchestratorRecordCodec,
  type StoreCollectionOrchestratorSchedulerProjection,
  type StoreCollectionOrchestratorTransition,
  type StoreCollectionOrchestratorTransitionPhase,
  type StoreCollectionOrchestratorTransitionPurpose,
  type StoreCollectionPolicySuppressionGuard,
  type StoreCollectionSchedulerRecoveryAdmission,
  type StoreCollectionTransitionCapability,
} from './store-collection-orchestrator';

const NOW = new Date('2026-07-23T16:00:00.000Z');
const OWNER = 'collection-owner-1';

function runtimeCapability(label: string): StoreCollectionAutomationCapability {
  return Object.freeze({ label }) as unknown as StoreCollectionAutomationCapability;
}

function policyGuard(label: string): StoreCollectionPolicySuppressionGuard {
  return Object.freeze({ label }) as unknown as StoreCollectionPolicySuppressionGuard;
}

function transitionCapability(label: string): StoreCollectionTransitionCapability {
  return Object.freeze({ label }) as unknown as StoreCollectionTransitionCapability;
}

function recoveryAdmission(label: string): StoreCollectionSchedulerRecoveryAdmission {
  return Object.freeze({ label }) as unknown as StoreCollectionSchedulerRecoveryAdmission;
}

class MemoryHistory implements StoreCollectionOrchestratorHistoryPort {
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

class AuthenticatedTestCodec implements StoreCollectionOrchestratorRecordCodec {
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

function context(
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

function store(
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

function fingerprint(storeId: string): string {
  return createHash('sha256').update(`fingerprint:${storeId}`).digest('hex');
}

function authority(value: StoreContextEnvelope | null): StoreCollectionAuthorityReadback {
  return { activeStoreId: value?.storeId ?? null, context: value };
}

type HarnessOptions = {
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

function harness(options: HarnessOptions = {}) {
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

function readHistory(test: ReturnType<typeof harness>) {
  return JSON.parse(test.codec.open(test.history.get()!));
}

function matrixTransition(
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

describe('StoreCollectionOrchestrator', () => {
  it('completes recovery-only startup with zero side effects when protected history has no pending transition', async () => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      inspection: () => ({
        state: 'due',
        expectedFingerprint: fingerprint('must-not-be-inspected'),
      }),
    });

    await expect(test.orchestrator.recoverExistingTransitionsOnly()).resolves.toEqual({
      cycleId: 'cycle-1',
      state: 'completed',
      outcomes: [],
      skippedStoreIds: [],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    expect(test.inspectStoreSchedule).not.toHaveBeenCalled();
    expect(test.acquireAutomationLease).not.toHaveBeenCalled();
    expect(test.acquirePolicyDispatchSuppression).not.toHaveBeenCalled();
    expect(test.readActiveAuthority).not.toHaveBeenCalled();
    expect(test.transitionAuthorityForCollection).not.toHaveBeenCalled();
    expect(test.closeVisibleRuntime).not.toHaveBeenCalled();
    expect(test.assertCollectionLeaseReleased).not.toHaveBeenCalled();
    expect(test.startCollectionOnlyVisibleRuntime).not.toHaveBeenCalled();
    expect(test.verifyVisibleLingxingIdentity).not.toHaveBeenCalled();
    expect(test.getActiveStoreId).not.toHaveBeenCalled();
    expect(test.registerSchedulerRecoveryAdmission).not.toHaveBeenCalled();
    expect(test.deriveTransitionCapability).not.toHaveBeenCalled();
    expect(test.readTransitionAuthority).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.recover).not.toHaveBeenCalled();
    expect(test.release).not.toHaveBeenCalled();
    expect(test.releasePolicy).not.toHaveBeenCalled();
    expect(test.history.sets).toBe(0);
  });

  it('recovers only the exact protected scheduler attempt/request without due inspection or execution', async () => {
    const interrupted = harness({
      stores: [store('store-a', 'profile-a')],
      recover: async (input) => ({
        state: 'waiting',
        authority: authority(input.context),
        owner: input.owner,
        capability: input.capability,
        transitionCapability: input.transitionCapability,
        transitionScope: input.transitionScope,
        cycleId: input.cycleId,
        transitionId: input.transitionId,
        fingerprint: input.expectedFingerprint,
        attemptId: input.attemptId,
        requestId: input.requestId,
      }),
    });
    await expect(interrupted.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    const pending = readHistory(interrupted).transitions.find((item: any) => (
      item.purpose === 'collection' && item.phase === 'scheduler_accepted'
    ));

    const restarted = harness({
      stores: [store('store-a', 'profile-a')],
      history: interrupted.history,
      codec: interrupted.codec,
      inspection: () => {
        throw new Error('recovery-only startup must not inspect due stores');
      },
    });
    await expect(restarted.orchestrator.recoverExistingTransitionsOnly()).resolves.toMatchObject({
      state: 'completed',
      outcomes: [expect.objectContaining({
        state: 'succeeded',
        transitionId: pending.transitionId,
        attemptId: pending.schedulerAttemptId,
        requestId: pending.schedulerRequestId,
      })],
      skippedStoreIds: [],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    expect(restarted.inspectStoreSchedule).not.toHaveBeenCalled();
    expect(restarted.execute).not.toHaveBeenCalled();
    expect(restarted.recover).toHaveBeenCalledOnce();
    expect(restarted.recover.mock.calls[0][0]).toMatchObject({
      transitionId: pending.transitionId,
      attemptId: pending.schedulerAttemptId,
      requestId: pending.schedulerRequestId,
      expectedFingerprint: pending.expectedFingerprint,
      transitionScope: expect.objectContaining({
        capabilityDomain: 'recovery_existing_request_only',
      }),
    });
  });

  it('rejects a regular cycle while a recovery-only cycle owns the transition lock', async () => {
    const interrupted = harness({
      stores: [store('store-a', 'profile-a')],
      recover: async (input) => ({
        state: 'waiting',
        authority: authority(input.context),
        owner: input.owner,
        capability: input.capability,
        transitionCapability: input.transitionCapability,
        transitionScope: input.transitionScope,
        cycleId: input.cycleId,
        transitionId: input.transitionId,
        fingerprint: input.expectedFingerprint,
        attemptId: input.attemptId,
        requestId: input.requestId,
      }),
    });
    await expect(interrupted.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });

    let releaseRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    const restarted = harness({
      stores: [store('store-a', 'profile-a')],
      history: interrupted.history,
      codec: interrupted.codec,
      recover: async (input) => {
        await recoveryGate;
        return {
          state: 'succeeded',
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
      },
    });

    const recovery = restarted.orchestrator.recoverExistingTransitionsOnly();
    const regularRejection = expect(restarted.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'USER_OPERATION_BLOCKED',
    });
    expect(restarted.orchestrator.isTransitionLocked()).toBe(true);
    releaseRecovery();
    await regularRejection;
    await expect(recovery).resolves.toMatchObject({ state: 'completed' });
    expect(restarted.recover).toHaveBeenCalledOnce();
    expect(restarted.execute).not.toHaveBeenCalled();
    expect(restarted.inspectStoreSchedule).not.toHaveBeenCalled();
  });

  it('keeps recovery-only startup sticky unknown and rejects every repeated attempt after an unverifiable recovery', async () => {
    const interrupted = harness({
      stores: [store('store-a', 'profile-a')],
      recover: async (input) => ({
        state: 'waiting',
        authority: authority(input.context),
        owner: input.owner,
        capability: input.capability,
        transitionCapability: input.transitionCapability,
        transitionScope: input.transitionScope,
        cycleId: input.cycleId,
        transitionId: input.transitionId,
        fingerprint: input.expectedFingerprint,
        attemptId: input.attemptId,
        requestId: input.requestId,
      }),
    });
    await expect(interrupted.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });

    const restarted = harness({
      stores: [store('store-a', 'profile-a')],
      history: interrupted.history,
      codec: interrupted.codec,
      recover: async (input) => ({
        state: 'succeeded',
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
        requestId: 'forged-recovery-request',
      }),
    });

    await expect(restarted.orchestrator.recoverExistingTransitionsOnly()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    expect(restarted.orchestrator.isTransitionLocked()).toBe(true);
    const recoveryCalls = restarted.recover.mock.calls.length;
    const leaseCalls = restarted.acquireAutomationLease.mock.calls.length;

    await expect(restarted.orchestrator.recoverExistingTransitionsOnly()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    expect(restarted.recover).toHaveBeenCalledTimes(recoveryCalls);
    expect(restarted.acquireAutomationLease).toHaveBeenCalledTimes(leaseCalls);
    expect(restarted.execute).not.toHaveBeenCalled();
    expect(restarted.inspectStoreSchedule).not.toHaveBeenCalled();
  });

  it('makes corrupt protected history sticky unknown before recovery-only startup can touch authority or scheduling', async () => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
    });
    test.history.value = 'not-an-authenticated-history-envelope';

    await expect(test.orchestrator.recoverExistingTransitionsOnly()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
    await expect(test.orchestrator.recoverExistingTransitionsOnly()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    expect(test.inspectStoreSchedule).not.toHaveBeenCalled();
    expect(test.acquireAutomationLease).not.toHaveBeenCalled();
    expect(test.readActiveAuthority).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.recover).not.toHaveBeenCalled();
  });

  it('lets stopAndDrain await the shared recovery-only cycle and rejects new startup recovery after drain begins', async () => {
    const interrupted = harness({
      stores: [store('store-a', 'profile-a')],
      recover: async (input) => ({
        state: 'waiting',
        authority: authority(input.context),
        owner: input.owner,
        capability: input.capability,
        transitionCapability: input.transitionCapability,
        transitionScope: input.transitionScope,
        cycleId: input.cycleId,
        transitionId: input.transitionId,
        fingerprint: input.expectedFingerprint,
        attemptId: input.attemptId,
        requestId: input.requestId,
      }),
    });
    await expect(interrupted.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });

    let releaseRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    const restarted = harness({
      stores: [store('store-a', 'profile-a')],
      history: interrupted.history,
      codec: interrupted.codec,
      recover: async (input) => {
        await recoveryGate;
        return {
          state: 'succeeded',
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
      },
    });

    const active = restarted.orchestrator.recoverExistingTransitionsOnly();
    await vi.waitFor(() => expect(restarted.recover).toHaveBeenCalledOnce());
    const drain = restarted.orchestrator.stopAndDrain(1_000);

    await expect(restarted.orchestrator.recoverExistingTransitionsOnly()).rejects.toMatchObject({
      code: 'ORCHESTRATOR_STOPPING',
    });
    await expect(restarted.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'ORCHESTRATOR_STOPPING',
    });
    expect(restarted.recover).toHaveBeenCalledOnce();
    expect(restarted.execute).not.toHaveBeenCalled();
    expect(restarted.inspectStoreSchedule).not.toHaveBeenCalled();

    releaseRecovery();

    await expect(active).resolves.toMatchObject({ state: 'stopped' });
    await expect(drain).resolves.toBeUndefined();
    await expect(restarted.orchestrator.recoverExistingTransitionsOnly()).rejects.toMatchObject({
      code: 'ORCHESTRATOR_STOPPING',
    });
    expect(restarted.execute).not.toHaveBeenCalled();
    expect(restarted.inspectStoreSchedule).not.toHaveBeenCalled();
  });

  it('terminalizes a protected claimed transition during recovery-only startup without starting a new collection', async () => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      inspection: () => ({
        state: 'due',
        expectedFingerprint: fingerprint('must-not-run-after-claimed'),
      }),
    });
    const claimed = {
      transitionId: 'startup-claimed-transition',
      capabilityId: 'startup-claimed-capability',
      cycleId: 'startup-claimed-cycle',
      owner: OWNER,
      fromStoreId: null,
      toStoreId: context().storeId,
      browserProfileId: context().browserProfileId,
      purpose: 'collection' as const,
      fromAuthority: authority(null),
      originAuthority: authority(null),
      expectedFingerprint: fingerprint('startup-claimed'),
      phase: 'claimed' as const,
      startedAt: NOW.toISOString(),
    };
    test.history.value = test.codec.seal(JSON.stringify({
      schemaVersion: 4,
      transitions: [{
        ...claimed,
        integrityDigest: storeCollectionOrchestratorTransitionIntegrityDigest(claimed),
      }],
      outcomes: [],
    }));

    await expect(test.orchestrator.recoverExistingTransitionsOnly()).resolves.toEqual({
      cycleId: 'cycle-1',
      state: 'completed',
      outcomes: [],
      skippedStoreIds: [],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    expect(readHistory(test).transitions).toContainEqual(expect.objectContaining({
      transitionId: claimed.transitionId,
      phase: 'interrupted',
      failureCode: 'APP_EXIT_INTERRUPTED',
    }));
    expect(test.inspectStoreSchedule).not.toHaveBeenCalled();
    expect(test.acquireAutomationLease).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.recover).not.toHaveBeenCalled();
  });

  it('recovers multiple pending transitions by each exact protected request without scanning or executing due work', async () => {
    const leavePending = async (storeId: string, browserProfileId: string) => {
      const seeded = harness({
        stores: [store(storeId, browserProfileId)],
        recover: async (input) => ({
          state: 'waiting',
          authority: authority(input.context),
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          cycleId: input.cycleId,
          transitionId: input.transitionId,
          fingerprint: input.expectedFingerprint,
          attemptId: input.attemptId,
          requestId: input.requestId,
        }),
      });
      await expect(seeded.orchestrator.runCycle()).rejects.toMatchObject({
        code: 'SAFETY_STATE_UNKNOWN',
      });
      return seeded;
    };
    const first = await leavePending('store-a', 'profile-a');
    const second = await leavePending('store-b', 'profile-b');
    const firstHistory = readHistory(first);
    const secondHistory = readHistory(second);
    first.history.value = first.codec.seal(JSON.stringify({
      schemaVersion: 5,
      transitions: [...firstHistory.transitions, ...secondHistory.transitions],
      outcomes: [],
      semanticAttempts: [
        ...firstHistory.semanticAttempts,
        ...secondHistory.semanticAttempts,
      ],
    }));
    const expectedRequests = [...firstHistory.transitions, ...secondHistory.transitions]
      .filter((transition: any) => (
        transition.purpose === 'collection'
        && transition.schedulerAttemptId
        && transition.schedulerRequestId
      ))
      .map((transition: any) => ({
        transitionId: transition.transitionId,
        attemptId: transition.schedulerAttemptId,
        requestId: transition.schedulerRequestId,
      }));

    const restarted = harness({
      stores: [
        store('store-b', 'profile-b'),
        store('store-a', 'profile-a'),
      ],
      history: first.history,
      codec: first.codec,
      inspection: () => {
        throw new Error('multi-pending recovery must not inspect due stores');
      },
    });
    await expect(restarted.orchestrator.recoverExistingTransitionsOnly()).resolves.toMatchObject({
      state: 'completed',
      outcomes: [
        expect.objectContaining({ storeId: 'store-a', state: 'succeeded' }),
        expect.objectContaining({ storeId: 'store-b', state: 'succeeded' }),
      ],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    expect(restarted.recover.mock.calls.map(([input]) => ({
      transitionId: input.transitionId,
      attemptId: input.attemptId,
      requestId: input.requestId,
    }))).toEqual(expectedRequests);
    expect(restarted.inspectStoreSchedule).not.toHaveBeenCalled();
    expect(restarted.execute).not.toHaveBeenCalled();
  });

  it('forces an exact current active store before scheduled due time through the shared safe collection chain', async () => {
    const requested = context('store-a', 'profile-a', 1);
    const manualFingerprint = fingerprint('manual-store-a');
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: requested,
      inspection: () => ({ state: 'not_due' }),
      manualInspection: () => ({
        state: 'eligible',
        expectedFingerprint: manualFingerprint,
      }),
    });

    await expect(test.orchestrator.runStoreNow(requested)).resolves.toMatchObject({
      state: 'completed',
      skippedStoreIds: [],
      plannedDueStoreIds: ['store-a'],
      attemptedStoreIds: ['store-a'],
      outcomes: [expect.objectContaining({
        storeId: 'store-a',
        fingerprint: manualFingerprint,
        state: 'succeeded',
        schedulerSucceeded: true,
        cleanupStatus: 'confirmed',
      })],
    });

    expect(test.inspectStoreSchedule).not.toHaveBeenCalled();
    expect(test.inspectManualStoreSchedule).toHaveBeenCalledOnce();
    expect(test.inspectManualStoreSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-a', browserProfileId: 'profile-a' }),
      requested,
    );
    expect(test.execute).toHaveBeenCalledOnce();
    expect(test.recover).toHaveBeenCalledOnce();
    expect(test.startCollectionOnlyVisibleRuntime).toHaveBeenCalledOnce();
    expect(test.verifyVisibleLingxingIdentity).toHaveBeenCalledOnce();
    expect(test.releasePolicy).toHaveBeenCalledOnce();
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.orchestrator.isTransitionLocked()).toBe(false);
  });

  it('skips a DB-declared manual duplicate without creating a scheduler request or visible runtime', async () => {
    const requested = context('store-a', 'profile-a', 1);
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: requested,
      manualInspection: () => ({
        state: 'duplicate',
        expectedFingerprint: fingerprint('manual-duplicate'),
      }),
    });

    await expect(test.orchestrator.runStoreNow(requested)).resolves.toEqual({
      cycleId: 'cycle-1',
      state: 'completed',
      outcomes: [],
      skippedStoreIds: ['store-a'],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    expect(test.inspectManualStoreSchedule).toHaveBeenCalledOnce();
    expect(test.inspectStoreSchedule).not.toHaveBeenCalled();
    expect(test.deriveTransitionCapability).not.toHaveBeenCalled();
    expect(test.transitionAuthorityForCollection).not.toHaveBeenCalled();
    expect(test.startCollectionOnlyVisibleRuntime).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.recover).not.toHaveBeenCalled();
    expect(test.releasePolicy).toHaveBeenCalledOnce();
    expect(test.release).toHaveBeenCalledOnce();
  });

  it('skips an exact protected semantic manual attempt even when the DB inspector says eligible', async () => {
    const requested = context('store-a', 'profile-a', 1);
    const protectedFingerprint = fingerprint('manual-protected');
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: requested,
      manualInspection: () => ({
        state: 'eligible',
        expectedFingerprint: protectedFingerprint,
      }),
    });

    await expect(test.orchestrator.runStoreNow(requested)).resolves.toMatchObject({
      attemptedStoreIds: ['store-a'],
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
    });
    const historyWritesBeforeRead = test.history.sets;
    const protectedReadback = test.orchestrator.readProtectedSemanticAttempt({
      storeId: requested.storeId,
      browserProfileId: requested.browserProfileId,
      expectedFingerprint: protectedFingerprint,
    });
    expect(protectedReadback).toMatchObject({
      semanticAttempt: {
        storeId: 'store-a',
        browserProfileId: 'profile-a',
        expectedFingerprint: protectedFingerprint,
      },
      terminalOutcome: {
        storeId: 'store-a',
        browserProfileId: 'profile-a',
        fingerprint: protectedFingerprint,
        state: 'succeeded',
      },
    });
    expect(Object.isFrozen(protectedReadback)).toBe(true);
    expect(Object.isFrozen(protectedReadback!.semanticAttempt)).toBe(true);
    expect(Object.isFrozen(protectedReadback!.terminalOutcome)).toBe(true);
    expect(test.orchestrator.readProtectedSemanticAttempt({
      storeId: requested.storeId,
      browserProfileId: requested.browserProfileId,
      expectedFingerprint: fingerprint('not-protected'),
    })).toBeNull();
    expect(test.history.sets).toBe(historyWritesBeforeRead);
    const current = test.current();
    expect(current).not.toBeNull();

    await expect(test.orchestrator.runStoreNow(current!)).resolves.toEqual({
      cycleId: 'cycle-1',
      state: 'completed',
      outcomes: [],
      skippedStoreIds: ['store-a'],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    expect(test.inspectManualStoreSchedule).toHaveBeenCalledTimes(2);
    expect(test.execute).toHaveBeenCalledOnce();
    expect(test.recover).toHaveBeenCalledOnce();
  });

  it('fails duplicate authenticated semantic read-model records closed without repairing or writing history', async () => {
    const requested = context('store-a', 'profile-a', 1);
    const protectedFingerprint = fingerprint('duplicate-read-model');
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: requested,
      manualInspection: () => ({
        state: 'eligible',
        expectedFingerprint: protectedFingerprint,
      }),
    });
    await expect(test.orchestrator.runStoreNow(requested)).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
    });
    const history = readHistory(test);
    test.history.value = test.codec.seal(JSON.stringify({
      ...history,
      semanticAttempts: [
        ...history.semanticAttempts,
        { ...history.semanticAttempts[0] },
      ],
    }));
    const historyWritesBeforeRead = test.history.sets;

    let firstError: unknown;
    let repeatedError: unknown;
    try {
      test.orchestrator.readProtectedSemanticAttempt({
        storeId: requested.storeId,
        browserProfileId: requested.browserProfileId,
        expectedFingerprint: protectedFingerprint,
      });
    } catch (error) {
      firstError = error;
    }
    try {
      test.orchestrator.readProtectedSemanticAttempt({
        storeId: requested.storeId,
        browserProfileId: requested.browserProfileId,
        expectedFingerprint: protectedFingerprint,
      });
    } catch (error) {
      repeatedError = error;
    }
    expect(firstError).toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(repeatedError).toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.history.sets).toBe(historyWritesBeforeRead);
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('rejects inactive targets and stale Main context before manual inspection or request creation', async () => {
    const current = context('store-a', 'profile-a', 2, '2026-07-24');
    const inactiveTarget = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: current,
    });
    await expect(inactiveTarget.orchestrator.runStoreNow(
      context('store-b', 'profile-b', 1, '2026-07-24'),
    )).rejects.toMatchObject({ code: 'USER_OPERATION_BLOCKED' });
    expect(inactiveTarget.acquireAutomationLease).not.toHaveBeenCalled();
    expect(inactiveTarget.inspectManualStoreSchedule).not.toHaveBeenCalled();

    const stale = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: current,
    });
    await expect(stale.orchestrator.runStoreNow(
      context('store-a', 'profile-a', 1, '2026-07-23'),
    )).rejects.toMatchObject({ code: 'USER_OPERATION_BLOCKED' });
    expect(stale.acquireAutomationLease).toHaveBeenCalledOnce();
    expect(stale.inspectManualStoreSchedule).not.toHaveBeenCalled();
    expect(stale.transitionAuthorityForCollection).not.toHaveBeenCalled();
    expect(stale.startCollectionOnlyVisibleRuntime).not.toHaveBeenCalled();
    expect(stale.execute).not.toHaveBeenCalled();
    expect(stale.releasePolicy).toHaveBeenCalledOnce();
    expect(stale.release).toHaveBeenCalledOnce();
    expect(stale.orchestrator.isTransitionLocked()).toBe(false);
  });

  it('rechecks exact Main authority after manual inspection and blocks a cross-midnight context change', async () => {
    const requested = context('store-a', 'profile-a', 1, '2026-07-23');
    let test!: ReturnType<typeof harness>;
    test = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: requested,
      manualInspection: (_store, exactContext) => {
        expect(exactContext).toEqual(requested);
        test.setCurrent(context('store-a', 'profile-a', 1, '2026-07-24'));
        return {
          state: 'eligible',
          expectedFingerprint: fingerprint('next-business-date-must-not-run'),
        };
      },
    });

    await expect(test.orchestrator.runStoreNow(requested)).rejects.toMatchObject({
      code: 'USER_OPERATION_BLOCKED',
    });
    expect(test.readActiveAuthority).toHaveBeenCalledTimes(2);
    expect(test.inspectManualStoreSchedule).toHaveBeenCalledOnce();
    expect(test.deriveTransitionCapability).not.toHaveBeenCalled();
    expect(test.transitionAuthorityForCollection).not.toHaveBeenCalled();
    expect(test.startCollectionOnlyVisibleRuntime).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.recover).not.toHaveBeenCalled();
    expect(test.releasePolicy).toHaveBeenCalledOnce();
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.orchestrator.isTransitionLocked()).toBe(false);
  });

  it('blocks a manual request when the collection transition crosses into a different LA business date', async () => {
    const requested = context('store-a', 'profile-a', 1, '2026-07-23');
    let test!: ReturnType<typeof harness>;
    test = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: requested,
      transition: async (input) => {
        const before = input.previous.context?.sessionGeneration ?? 0;
        const next = input.target === null
          ? null
          : context(
            input.target.storeId,
            input.target.browserProfileId,
            before + 1,
            '2026-07-24',
          );
        test.setCurrent(next);
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          reason: 'collection_automation' as const,
          mode: 'collection_only' as const,
          previous: input.previous,
          current: authority(next),
          targetGenerationBefore: input.target === null ? null : before,
          targetGenerationAfter: input.target === null ? null : before + 1,
        };
      },
    });

    await expect(test.orchestrator.runStoreNow(requested)).resolves.toMatchObject({
      state: 'completed',
      plannedDueStoreIds: ['store-a'],
      attemptedStoreIds: ['store-a'],
      outcomes: [expect.objectContaining({
        state: 'blocked',
        failureCode: 'SCHEDULE_PRECHECK_FAILED',
        schedulerSucceeded: false,
        cleanupStatus: 'confirmed',
      })],
    });
    expect(test.inspectManualStoreSchedule).toHaveBeenCalledOnce();
    expect(test.transitionAuthorityForCollection).toHaveBeenCalled();
    expect(test.startCollectionOnlyVisibleRuntime).not.toHaveBeenCalled();
    expect(test.verifyVisibleLingxingIdentity).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.recover).not.toHaveBeenCalled();
    expect(test.releasePolicy).toHaveBeenCalledOnce();
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.orchestrator.isTransitionLocked()).toBe(false);
  });

  it('fails a manual business-date eligibility rejection closed before runtime or request creation', async () => {
    const requested = context('store-a', 'profile-a', 1, '2026-07-23');
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: requested,
      manualInspection: (_store, exactContext) => {
        expect(exactContext.businessDate).toBe('2026-07-23');
        throw new Error('current LA business date differs from exact context');
      },
    });

    await expect(test.orchestrator.runStoreNow(requested)).rejects.toMatchObject({
      code: 'SCHEDULE_PRECHECK_FAILED',
    });
    expect(test.inspectManualStoreSchedule).toHaveBeenCalledOnce();
    expect(test.transitionAuthorityForCollection).not.toHaveBeenCalled();
    expect(test.startCollectionOnlyVisibleRuntime).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.recover).not.toHaveBeenCalled();
    expect(test.releasePolicy).toHaveBeenCalledOnce();
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.orchestrator.isTransitionLocked()).toBe(false);
  });

  it('uses a manual call only to recover pending protected requests and never inspects or executes new work', async () => {
    const interrupted = harness({
      stores: [store('store-a', 'profile-a')],
      recover: async (input) => ({
        state: 'waiting',
        authority: authority(input.context),
        owner: input.owner,
        capability: input.capability,
        transitionCapability: input.transitionCapability,
        transitionScope: input.transitionScope,
        cycleId: input.cycleId,
        transitionId: input.transitionId,
        fingerprint: input.expectedFingerprint,
        attemptId: input.attemptId,
        requestId: input.requestId,
      }),
    });
    await expect(interrupted.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });

    const pendingReader = harness({
      stores: [store('store-a', 'profile-a')],
      history: interrupted.history,
      codec: interrupted.codec,
    });
    const pendingReadWrites = pendingReader.history.sets;
    expect(pendingReader.orchestrator.readProtectedSemanticAttempt({
      storeId: context('store-a', 'profile-a').storeId,
      browserProfileId: context('store-a', 'profile-a').browserProfileId,
      expectedFingerprint: fingerprint('store-a'),
    })).toMatchObject({
      semanticAttempt: {
        storeId: 'store-a',
        browserProfileId: 'profile-a',
        expectedFingerprint: fingerprint('store-a'),
      },
      terminalOutcome: null,
    });
    expect(pendingReader.history.sets).toBe(pendingReadWrites);

    const restarted = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: null,
      history: interrupted.history,
      codec: interrupted.codec,
      manualInspection: () => ({
        state: 'eligible',
        expectedFingerprint: fingerprint('must-not-execute'),
      }),
    });
    await expect(restarted.orchestrator.runStoreNow(
      context('store-a', 'profile-a', 99, '2026-07-29'),
    )).resolves.toMatchObject({
      state: 'completed',
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
      skippedStoreIds: [],
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
    });

    expect(restarted.recover).toHaveBeenCalledOnce();
    expect(restarted.inspectManualStoreSchedule).not.toHaveBeenCalled();
    expect(restarted.inspectStoreSchedule).not.toHaveBeenCalled();
    expect(restarted.execute).not.toHaveBeenCalled();
    expect(restarted.startCollectionOnlyVisibleRuntime).not.toHaveBeenCalled();
  });

  it('single-flights only the same exact manual context and rejects cross-mode or different-context promise aliasing', async () => {
    const requested = context('store-a', 'profile-a', 1);
    let releaseRuntime!: () => void;
    const runtimeGate = new Promise<void>((resolve) => { releaseRuntime = resolve; });
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: requested,
      startRuntime: async (input) => {
        await runtimeGate;
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          started: true as const,
          authority: authority(input.context),
        };
      },
    });

    const active = test.orchestrator.runStoreNow(requested);
    expect(test.orchestrator.runStoreNow(requested)).toBe(active);
    await expect(test.orchestrator.runStoreNow(
      context('store-a', 'profile-a', 2),
    )).rejects.toMatchObject({ code: 'USER_OPERATION_BLOCKED' });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'USER_OPERATION_BLOCKED',
    });
    await expect(test.orchestrator.recoverExistingTransitionsOnly()).rejects.toMatchObject({
      code: 'USER_OPERATION_BLOCKED',
    });

    await vi.waitFor(() => expect(test.startCollectionOnlyVisibleRuntime).toHaveBeenCalledOnce());
    const drain = test.orchestrator.stopAndDrain(1_000);
    await expect(test.orchestrator.runStoreNow(requested)).rejects.toMatchObject({
      code: 'ORCHESTRATOR_STOPPING',
    });
    releaseRuntime();
    await expect(active).resolves.toMatchObject({ state: 'stopped' });
    await expect(drain).resolves.toBeUndefined();
    expect(test.execute).not.toHaveBeenCalled();

    let releaseScheduledRuntime!: () => void;
    const scheduledGate = new Promise<void>((resolve) => { releaseScheduledRuntime = resolve; });
    const scheduled = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: requested,
      startRuntime: async (input) => {
        await scheduledGate;
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          started: true as const,
          authority: authority(input.context),
        };
      },
    });
    const activeScheduled = scheduled.orchestrator.runCycle();
    await vi.waitFor(() => expect(scheduled.startCollectionOnlyVisibleRuntime).toHaveBeenCalledOnce());
    await expect(scheduled.orchestrator.runStoreNow(requested)).rejects.toMatchObject({
      code: 'USER_OPERATION_BLOCKED',
    });
    expect(scheduled.inspectManualStoreSchedule).not.toHaveBeenCalled();
    releaseScheduledRuntime();
    await expect(activeScheduled).resolves.toMatchObject({ state: 'completed' });
  });

  it('rejects manual entry after stop and keeps corrupt-history UNKNOWN sticky without side effects', async () => {
    const requested = context('store-a', 'profile-a', 1);
    const stopped = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: requested,
    });
    stopped.orchestrator.stop();
    await expect(stopped.orchestrator.runStoreNow(requested)).rejects.toMatchObject({
      code: 'ORCHESTRATOR_STOPPING',
    });
    expect(stopped.acquireAutomationLease).not.toHaveBeenCalled();
    expect(stopped.inspectManualStoreSchedule).not.toHaveBeenCalled();

    const corrupt = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: requested,
    });
    corrupt.history.value = 'not-an-authenticated-history-envelope';
    await expect(corrupt.orchestrator.runStoreNow(requested)).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    await expect(corrupt.orchestrator.runStoreNow(requested)).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    expect(corrupt.acquireAutomationLease).not.toHaveBeenCalled();
    expect(corrupt.inspectManualStoreSchedule).not.toHaveBeenCalled();
    expect(corrupt.execute).not.toHaveBeenCalled();
    expect(corrupt.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('performs no lease or runtime/authority side effect when every store is not_due', async () => {
    const test = harness({ inspection: () => ({ state: 'not_due' }) });
    const result = await test.orchestrator.runCycle();
    expect(test.acquireAutomationLease).not.toHaveBeenCalled();
    expect(test.closeVisibleRuntime).not.toHaveBeenCalled();
    expect(test.transitionAuthorityForCollection).not.toHaveBeenCalled();
    expect(test.readActiveAuthority).not.toHaveBeenCalled();
    expect(test.history.sets).toBe(0);
    expect(result).toMatchObject({
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
      skippedStoreIds: ['store-a', 'store-b'],
    });
  });

  it('has zero close/transition/readback/restore side effects when automation lease acquisition fails', async () => {
    const selected = context('store-a', 'profile-a', 2);
    const test = harness({
      initialContext: selected,
      acquire: async () => { throw new Error('busy'); },
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'AUTOMATION_LEASE_UNAVAILABLE' });
    expect(test.closeVisibleRuntime).not.toHaveBeenCalled();
    expect(test.transitionAuthorityForCollection).not.toHaveBeenCalled();
    expect(test.readActiveAuthority).not.toHaveBeenCalled();
    expect(test.orchestrator.isTransitionLocked()).toBe(false);
  });

  it('runs due stores in stable codepoint order with one owner/token and verified generation readbacks', async () => {
    const test = harness();
    const result = await test.orchestrator.runCycle();
    expect(result.outcomes.map((item) => item.storeId)).toEqual(['store-a', 'store-b']);
    expect(result.outcomes.every((item) => item.state === 'succeeded')).toBe(true);
    for (const [input] of test.transitionAuthorityForCollection.mock.calls) {
      expect(input).toMatchObject({
        owner: OWNER,
        capability: test.latestCapability(),
        reason: 'collection_automation',
        mode: 'collection_only',
      });
    }
    for (const spy of [
      test.closeVisibleRuntime,
      test.assertCollectionLeaseReleased,
      test.startCollectionOnlyVisibleRuntime,
      test.verifyVisibleLingxingIdentity,
      test.execute,
      test.recover,
    ]) {
      expect(spy.mock.calls.every(([input]) => (
        input.owner === OWNER && input.capability === test.latestCapability()
      ))).toBe(true);
    }
    expect(test.transitionCapabilities.length).toBeGreaterThanOrEqual(3);
    expect(new Set(test.transitionCapabilities).size).toBe(test.transitionCapabilities.length);
    expect(test.transitionCapabilities.every((item) => (
      (item as object) !== (test.latestCapability() as object)
      && (item as object) !== (test.latestPolicyGuard() as object)
    ))).toBe(true);
    for (const spy of [
      test.closeVisibleRuntime,
      test.assertCollectionLeaseReleased,
      test.startCollectionOnlyVisibleRuntime,
      test.verifyVisibleLingxingIdentity,
      test.execute,
      test.recover,
      test.readTransitionAuthority,
      test.transitionAuthorityForCollection,
    ]) {
      expect(spy.mock.calls.every(([input]) => (
        input.transitionCapability
        && input.transitionScope
        && input.transitionScope.transitionId
      ))).toBe(true);
    }
    expect(result.outcomes[0]).toMatchObject({
      fingerprint: fingerprint('store-a'),
      attemptId: expect.stringMatching(/^sca:[a-f0-9]{64}$/),
      requestId: expect.stringMatching(/^scr:[a-f0-9]{64}$/),
    });
    expect(test.execute.mock.calls.every(([input]) => (
      input.transitionScope.capabilityDomain === 'transition_execution'
    ))).toBe(true);
    expect(test.recover.mock.calls.every(([input]) => (
      input.transitionScope.capabilityDomain === 'recovery_existing_request_only'
    ))).toBe(true);
    expect(test.recover).toHaveBeenCalledTimes(test.execute.mock.calls.length);
    for (let index = 0; index < test.execute.mock.calls.length; index += 1) {
      const executionInput = test.execute.mock.calls[index][0];
      const recoveryInput = test.recover.mock.calls[index][0];
      expect(recoveryInput.transitionId).toBe(executionInput.transitionId);
      expect(recoveryInput.transitionCapability).not.toBe(executionInput.transitionCapability);
      expect(recoveryInput.transitionScope).not.toBe(executionInput.transitionScope);
      expect(recoveryInput.transitionScope.capabilityId)
        .toBe(`${executionInput.transitionScope.capabilityId}:recovery`);
    }
  });

  it('promotes each restored operator context so two due stores restore generation 8→9→10', async () => {
    const selected = context('store-c', 'profile-c', 8, '2026-07-23');
    const test = harness({
      stores: [
        store('store-b', 'profile-b'),
        store('store-c', 'profile-c'),
        store('store-a', 'profile-a'),
      ],
      initialContext: selected,
      inspection: (item) => item.storeId === selected.storeId
        ? { state: 'not_due' }
        : { state: 'due', expectedFingerprint: fingerprint(item.storeId) },
    });
    const result = await test.orchestrator.runCycle();
    expect(result.outcomes.map((item) => item.storeId)).toEqual(['store-a', 'store-b']);
    expect(test.current()).toMatchObject({
      storeId: selected.storeId,
      browserProfileId: selected.browserProfileId,
      businessDate: selected.businessDate,
      sessionGeneration: 10,
    });
    const restoreCalls = test.transitionAuthorityForCollection.mock.calls
      .map(([input]) => input)
      .filter((input) => input.target?.storeId === selected.storeId);
    expect(restoreCalls.map((input) => input.transitionScope.originAuthority.context)).toEqual([
      expect.objectContaining({
        storeId: selected.storeId,
        browserProfileId: selected.browserProfileId,
        businessDate: selected.businessDate,
        sessionGeneration: 8,
      }),
      expect.objectContaining({
        storeId: selected.storeId,
        browserProfileId: selected.browserProfileId,
        businessDate: selected.businessDate,
        sessionGeneration: 9,
      }),
    ]);
    const history = readHistory(test);
    expect(history.transitions
      .filter((item: any) => item.purpose === 'collection')
      .map((item: any) => item.originAuthority.context?.sessionGeneration)).toEqual([8, 9]);
    expect(history.transitions
      .filter((item: any) => item.purpose === 'restore')
      .map((item: any) => [item.businessDate, item.sessionGeneration])).toEqual([
      ['2026-07-23', 9],
      ['2026-07-23', 10],
    ]);
  });

  it('rejects a stale second restore that reuses 8→9 after the first restore advanced the operator origin to 9', async () => {
    const selected = context('store-c', 'profile-c', 8, '2026-07-23');
    let test!: ReturnType<typeof harness>;
    const generations = new Map([
      [selected.storeId, 8],
      [context('store-a', 'profile-a').storeId, 0],
      [context('store-b', 'profile-b').storeId, 0],
    ]);
    test = harness({
      stores: [
        store('store-b', 'profile-b'),
        store('store-c', 'profile-c'),
        store('store-a', 'profile-a'),
      ],
      initialContext: selected,
      inspection: (item) => item.storeId === selected.storeId
        ? { state: 'not_due' }
        : { state: 'due', expectedFingerprint: fingerprint(item.storeId) },
      transition: async (input) => {
        const previous = authority(test.current());
        const target = input.target!;
        const before = generations.get(target.storeId) ?? 0;
        const staleSecondRestore = target.storeId === selected.storeId && before === 9;
        const reportedBefore = staleSecondRestore ? 8 : before;
        const after = staleSecondRestore ? 9 : before + 1;
        const next = context(target.storeId, target.browserProfileId, after, '2026-07-23');
        generations.set(target.storeId, after);
        test.setCurrent(next);
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          reason: 'collection_automation',
          mode: 'collection_only',
          previous,
          current: authority(next),
          targetGenerationBefore: reportedBefore,
          targetGenerationAfter: after,
        };
      },
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(readHistory(test).transitions
      .filter((item: any) => item.purpose === 'collection')
      .map((item: any) => item.originAuthority.context?.sessionGeneration)).toEqual([8, 9]);
    expect(test.releasePolicy).not.toHaveBeenCalled();
  });

  it('is globally single-flight and blocks user operations while active', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      startRuntime: async (input) => {
        await gate;
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          started: true,
          authority: authority(input.context),
        };
      },
    });
    const first = test.orchestrator.runCycle();
    const second = test.orchestrator.runCycle();
    expect(second).toBe(first);
    const recoveryRejection = expect(
      test.orchestrator.recoverExistingTransitionsOnly(),
    ).rejects.toMatchObject({ code: 'USER_OPERATION_BLOCKED' });
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
    expect(() => test.orchestrator.assertUserOperationAllowed()).toThrow(/拒绝/);
    releaseGate();
    await recoveryRejection;
    await first;
  });

  it.each(['LOGIN_REQUIRED', 'REAUTH_REQUIRED', 'MFA_REQUIRED', 'IDENTITY_UNVERIFIED'] as const)(
    'blocks %s without scheduler execution and continues another store',
    async (code) => {
      const test = harness({
        verifyIdentity: async (input) => {
          if (input.context.storeId === 'store-a') throw Object.assign(new Error('secret'), { code });
          return {
            owner: input.owner,
            capability: input.capability,
            transitionCapability: input.transitionCapability,
            transitionScope: input.transitionScope,
            verified: true,
            authority: authority(input.context),
          };
        },
      });
      const result = await test.orchestrator.runCycle();
      expect(result.outcomes[0]).toMatchObject({ state: 'blocked', failureCode: code });
      expect(result.outcomes[1]).toMatchObject({ state: 'succeeded' });
      expect(test.execute).toHaveBeenCalledTimes(1);
      expect(test.recover).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(readHistory(test))).not.toContain('secret');
    },
  );

  it.each(['waiting', 'due', 'claimed', 'not_found', 'unknown'] as const)(
    'keeps scheduler state %s nonterminal and sticky instead of issuing a new request',
    async (state) => {
      const test = harness({
        stores: [store('store-a', 'profile-a')],
        recover: async (input) => ({
          state,
          authority: authority(input.context),
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          cycleId: input.cycleId,
          transitionId: input.transitionId,
          fingerprint: input.expectedFingerprint,
          attemptId: input.attemptId,
          requestId: input.requestId,
        }),
      });
      await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
      const history = readHistory(test);
      expect(history.outcomes).toHaveLength(0);
      expect(history.transitions.find((item: any) => item.purpose === 'collection'))
        .toMatchObject({ phase: 'scheduler_accepted' });
      expect(test.execute).toHaveBeenCalledOnce();
      expect(test.releasePolicy).not.toHaveBeenCalled();
    },
  );

  it('persists an exactly attributed scheduler failed recovery as a legal terminal with the durable ids', async () => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      recover: async (input) => ({
        state: 'failed',
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
      }),
    });
    const result = await test.orchestrator.runCycle();
    expect(result.outcomes[0]).toMatchObject({
      state: 'failed',
      schedulerSucceeded: false,
      failureCode: 'SCHEDULER_FAILED',
      attemptId: expect.stringMatching(/^sca:/),
      requestId: expect.stringMatching(/^scr:/),
    });
  });

  it.each([
    ['stale fingerprint', { fingerprint: 'f'.repeat(64) }],
    ['duplicate prior success', { duplicate: true }],
    ['not accepted', { accepted: false }],
    ['wrong cycle owner', { cycleId: 'other-cycle' }],
  ])('rejects scheduler succeeded projection with %s', async (_label, patch) => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      recover: async (input) => {
        return {
          state: 'succeeded',
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
          ...patch,
        } as StoreCollectionOrchestratorSchedulerProjection<'recovery_existing_request_only'>;
      },
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(readHistory(test).outcomes).toHaveLength(0);
    expect(test.releasePolicy).not.toHaveBeenCalled();
  });

  it('passes deterministic execution ids into scheduler and requires their exact echo', async () => {
    const test = harness({ stores: [store('store-a', 'profile-a')] });
    const result = await test.orchestrator.runCycle();
    const [schedulerInput] = test.execute.mock.calls[0];
    const expected = deriveStoreCollectionSchedulerExecutionIdentity({
      cycleId: schedulerInput.cycleId,
      transitionId: schedulerInput.transitionId,
      fingerprint: schedulerInput.expectedFingerprint,
      transitionScope: schedulerInput.transitionScope,
      context: schedulerInput.context,
    });
    expect(schedulerInput).toMatchObject(expected);
    expect(result.outcomes[0]).toMatchObject(expected);
  });

  it('persists requested before execute and accepted before recover for the exact durable ids', async () => {
    let test!: ReturnType<typeof harness>;
    test = harness({
      stores: [store('store-a', 'profile-a')],
      execute: async (input) => {
        const pending = readHistory(test).transitions.find((item: any) => (
          item.transitionId === input.transitionId
        ));
        expect(pending).toMatchObject({
          phase: 'scheduler_request_bound',
          schedulerAttemptId: input.attemptId,
          schedulerRequestId: input.requestId,
        });
        return {
          state: 'accepted',
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
      },
      recover: async (input) => {
        const accepted = readHistory(test).transitions.find((item: any) => (
          item.transitionId === input.transitionId
        ));
        expect(accepted).toMatchObject({
          phase: 'scheduler_accepted',
          schedulerAttemptId: input.attemptId,
          schedulerRequestId: input.requestId,
        });
        return {
          state: 'succeeded',
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
      },
    });
    await expect(test.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
    });
  });

  it('registers one exact protected-history admission after scheduler acceptance and binds recovery derivation to it', async () => {
    const test = harness({ stores: [store('store-a', 'profile-a')] });

    await expect(test.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
    });

    expect(test.registerSchedulerRecoveryAdmission).toHaveBeenCalledOnce();
    const registrationInput = test.registerSchedulerRecoveryAdmission.mock.calls[0][0];
    const registration = await test.registerSchedulerRecoveryAdmission.mock.results[0].value;
    expect(registrationInput.executionScope).toMatchObject({
      capabilityDomain: 'transition_execution',
      purpose: 'collection',
    });
    expect(registrationInput).toMatchObject({
      attemptId: expect.stringMatching(/^sca:[a-f0-9]{64}$/),
      requestId: expect.stringMatching(/^scr:[a-f0-9]{64}$/),
    });
    const recoveryDerivation = test.deriveTransitionCapability.mock.calls.find(
      ([input]) => input.scope.capabilityDomain === 'recovery_existing_request_only',
    )![0];
    expect(recoveryDerivation).toMatchObject({
      recoveryAdmission: registration.recoveryAdmission,
      recoveryScopeDigest: registration.scopeDigest,
      schedulerAttemptId: registration.attemptId,
      schedulerRequestId: registration.requestId,
    });
    expect(recoveryDerivation.scope).toMatchObject({
      capabilityDomain: 'recovery_existing_request_only',
      capabilityId: `${registration.executionScope.capabilityId}:recovery`,
      cycleId: registration.executionScope.cycleId,
      transitionId: registration.executionScope.transitionId,
    });
  });

  it.each([
    {
      name: 'missing registration',
      patch: { registered: false as const },
    },
    {
      name: 'wrong digest',
      patch: { scopeDigest: 'f'.repeat(64) },
    },
    {
      name: 'other request',
      patch: { requestId: `scr:${'f'.repeat(64)}` },
    },
    {
      name: 'other attempt',
      patch: { attemptId: `sca:${'f'.repeat(64)}` },
    },
  ])('rejects protected-history admission receipt with $name before recovery capability issue', async ({ patch }) => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      registerRecovery: async (input) => ({
        owner: input.owner,
        capability: input.capability,
        recoveryAdmission: recoveryAdmission('malformed-registration'),
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
        registered: true,
        ...patch,
      } as never),
    });

    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    expect(test.registerSchedulerRecoveryAdmission).toHaveBeenCalledOnce();
    expect(test.recover).not.toHaveBeenCalled();
    expect(readHistory(test).transitions.find((item: any) => item.purpose === 'collection'))
      .toMatchObject({ phase: 'scheduler_accepted' });
  });

  it('rejects a recovery admission aliased to another active capability domain', async () => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      registerRecovery: async (input) => ({
        owner: input.owner,
        capability: input.capability,
        recoveryAdmission: input.capability as unknown as StoreCollectionSchedulerRecoveryAdmission,
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
        registered: true,
      }),
    });

    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    expect(test.recover).not.toHaveBeenCalled();
  });

  it('re-registers a fresh one-shot admission from verified pending history after restart', async () => {
    const first = harness({
      stores: [store('store-a', 'profile-a')],
      recover: async (input) => ({
        state: 'waiting',
        authority: authority(input.context),
        owner: input.owner,
        capability: input.capability,
        transitionCapability: input.transitionCapability,
        transitionScope: input.transitionScope,
        cycleId: input.cycleId,
        transitionId: input.transitionId,
        fingerprint: input.expectedFingerprint,
        attemptId: input.attemptId,
        requestId: input.requestId,
      }),
    });
    await expect(first.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    const firstRegistration = await first.registerSchedulerRecoveryAdmission.mock.results[0].value;

    const restarted = harness({
      stores: [store('store-a', 'profile-a')],
      history: first.history,
      codec: first.codec,
      inspection: () => ({ state: 'not_due' }),
    });
    await expect(restarted.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
    });
    const restartedRegistration =
      await restarted.registerSchedulerRecoveryAdmission.mock.results[0].value;

    expect(first.registerSchedulerRecoveryAdmission).toHaveBeenCalledOnce();
    expect(restarted.registerSchedulerRecoveryAdmission).toHaveBeenCalledOnce();
    expect(restartedRegistration.recoveryAdmission).not.toBe(firstRegistration.recoveryAdmission);
    expect(restartedRegistration).toMatchObject({
      attemptId: firstRegistration.attemptId,
      requestId: firstRegistration.requestId,
      scopeDigest: firstRegistration.scopeDigest,
    });
    expect(restarted.execute).not.toHaveBeenCalled();
  });

  it('rejects an execute receipt forged with a recovery-only capability and never calls recover', async () => {
    const forgedRecoveryCapability = transitionCapability('forged-recovery-for-execute');
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      execute: async (input) => ({
        state: 'accepted',
        authority: authority(input.context),
        owner: input.owner,
        capability: input.capability,
        transitionCapability: forgedRecoveryCapability,
        transitionScope: Object.freeze({
          ...input.transitionScope,
          capabilityDomain: 'recovery_existing_request_only',
          capabilityId: `${input.transitionScope.capabilityId}:forged-recovery`,
        }),
        cycleId: input.cycleId,
        transitionId: input.transitionId,
        fingerprint: input.expectedFingerprint,
        accepted: true,
        duplicate: false,
        attemptId: input.attemptId,
        requestId: input.requestId,
      }) as never,
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.execute.mock.calls[0][0].transitionScope.capabilityDomain).toBe('transition_execution');
    expect(test.recover).not.toHaveBeenCalled();
    expect(readHistory(test).transitions.find((item: any) => item.purpose === 'collection'))
      .toMatchObject({ phase: 'scheduler_request_bound' });
    expect(test.releasePolicy).not.toHaveBeenCalled();
  });

  it('rejects recover when it replays the prior execute capability and scope', async () => {
    let executionInput: Parameters<StoreCollectionOrchestratorDependencies['scheduler']['execute']>[0] | undefined;
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      execute: async (input) => {
        executionInput = input;
        return {
          state: 'accepted',
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
      },
      recover: async (input) => ({
        state: 'succeeded',
        authority: authority(input.context),
        owner: input.owner,
        capability: input.capability,
        transitionCapability: executionInput!.transitionCapability,
        transitionScope: executionInput!.transitionScope,
        cycleId: input.cycleId,
        transitionId: input.transitionId,
        fingerprint: input.expectedFingerprint,
        accepted: true,
        duplicate: false,
        attemptId: input.attemptId,
        requestId: input.requestId,
      }) as never,
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(executionInput?.transitionScope.capabilityDomain).toBe('transition_execution');
    expect(test.recover.mock.calls[0][0].transitionScope.capabilityDomain)
      .toBe('recovery_existing_request_only');
    expect(readHistory(test).transitions.find((item: any) => item.purpose === 'collection'))
      .toMatchObject({ phase: 'scheduler_accepted' });
    expect(test.releasePolicy).not.toHaveBeenCalled();
  });

  it('recovers a crash-bound scheduler request only by querying the old ids and never executes a new request', async () => {
    const first = harness({
      stores: [store('store-a', 'profile-a')],
      execute: async () => { throw new Error('crash after durable bind'); },
    });
    await expect(first.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    const pending = readHistory(first).transitions.find((item: any) => item.purpose === 'collection');
    expect(pending).toMatchObject({
      phase: 'scheduler_request_bound',
      schedulerAttemptId: expect.stringMatching(/^sca:/),
      schedulerRequestId: expect.stringMatching(/^scr:/),
    });
    expect(readHistory(first).outcomes).toHaveLength(0);
    expect(first.recover).not.toHaveBeenCalled();

    const recovered = harness({
      stores: [store('store-a', 'profile-a')],
      history: first.history,
      codec: first.codec,
      inspection: () => ({ state: 'not_due' }),
    });
    const result = await recovered.orchestrator.runCycle();
    expect(recovered.execute).not.toHaveBeenCalled();
    expect(recovered.recover).toHaveBeenCalledOnce();
    expect(recovered.recover.mock.calls[0][0]).toMatchObject({
      transitionId: pending.transitionId,
      attemptId: pending.schedulerAttemptId,
      requestId: pending.schedulerRequestId,
    });
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        transitionId: pending.transitionId,
        state: 'succeeded',
        attemptId: pending.schedulerAttemptId,
        requestId: pending.schedulerRequestId,
      }),
    ]);
  });

  it('keeps scheduler UNKNOWN pending when the first restore fails even if finally restores, then recovers only the old ids', async () => {
    const selected = context('store-b', 'profile-b', 8, '2026-07-23');
    let transitionCalls = 0;
    let first!: ReturnType<typeof harness>;
    first = harness({
      initialContext: selected,
      inspection: (item) => item.storeId === 'store-a'
        ? { state: 'due', expectedFingerprint: fingerprint(item.storeId) }
        : { state: 'not_due' },
      recover: async (input) => ({
        state: 'waiting',
        authority: authority(input.context),
        owner: input.owner,
        capability: input.capability,
        transitionCapability: input.transitionCapability,
        transitionScope: input.transitionScope,
        cycleId: input.cycleId,
        transitionId: input.transitionId,
        fingerprint: input.expectedFingerprint,
        attemptId: input.attemptId,
        requestId: input.requestId,
      }),
      transition: async (input) => {
        transitionCalls += 1;
        if (transitionCalls === 2) throw new Error('first operator restore failed');
        const previous = authority(first.current());
        const target = input.target!;
        const next = target.storeId === selected.storeId
          ? context(target.storeId, target.browserProfileId, 9, selected.businessDate)
          : context(target.storeId, target.browserProfileId, 1, selected.businessDate);
        first.setCurrent(next);
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          reason: 'collection_automation',
          mode: 'collection_only',
          previous,
          current: authority(next),
          targetGenerationBefore: target.storeId === selected.storeId ? 8 : 0,
          targetGenerationAfter: next.sessionGeneration,
        };
      },
    });
    await expect(first.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    const afterFinally = readHistory(first);
    const pending = afterFinally.transitions.find((item: any) => (
      item.purpose === 'collection'
      && (item.phase === 'scheduler_request_bound' || item.phase === 'scheduler_accepted')
    ));
    expect(pending).toMatchObject({
      phase: 'scheduler_accepted',
      schedulerAttemptId: expect.stringMatching(/^sca:/),
      schedulerRequestId: expect.stringMatching(/^scr:/),
    });
    expect(afterFinally.outcomes).toHaveLength(0);
    expect(first.execute).toHaveBeenCalledOnce();
    expect(first.releasePolicy).not.toHaveBeenCalled();
    expect(first.current()).toMatchObject({
      storeId: selected.storeId,
      sessionGeneration: 9,
    });

    const second = harness({
      initialContext: first.current(),
      history: first.history,
      codec: first.codec,
      inspection: () => ({ state: 'not_due' }),
    });
    const recovered = await second.orchestrator.runCycle();
    expect(second.execute).not.toHaveBeenCalled();
    expect(second.recover).toHaveBeenCalledOnce();
    expect(second.recover.mock.calls[0][0]).toMatchObject({
      transitionId: pending.transitionId,
      attemptId: pending.schedulerAttemptId,
      requestId: pending.schedulerRequestId,
      transitionScope: expect.objectContaining({
        capabilityDomain: 'recovery_existing_request_only',
      }),
    });
    expect(recovered.outcomes).toEqual([
      expect.objectContaining({
        transitionId: pending.transitionId,
        state: 'succeeded',
        attemptId: pending.schedulerAttemptId,
        requestId: pending.schedulerRequestId,
      }),
    ]);
  });

  it('changes deterministic scheduler ids for every execution-scope identity axis', async () => {
    const test = harness({ stores: [store('store-a', 'profile-a')] });
    await test.orchestrator.runCycle();
    const [input] = test.execute.mock.calls[0];
    const base = {
      cycleId: input.cycleId,
      transitionId: input.transitionId,
      fingerprint: input.expectedFingerprint,
      transitionScope: input.transitionScope,
      context: input.context,
    };
    const baseline = deriveStoreCollectionSchedulerExecutionIdentity(base);
    const anotherFingerprint = fingerprint('another-scope');
    const anotherContext = context(
      'store-c',
      'profile-c',
      base.context.sessionGeneration,
      base.context.businessDate,
    );
    const variations = [
      {
        ...base,
        cycleId: 'cycle-another',
        transitionScope: { ...base.transitionScope, cycleId: 'cycle-another' },
      },
      {
        ...base,
        transitionId: 'transition-another',
        transitionScope: { ...base.transitionScope, transitionId: 'transition-another' },
      },
      {
        ...base,
        fingerprint: anotherFingerprint,
        transitionScope: { ...base.transitionScope, expectedFingerprint: anotherFingerprint },
      },
      {
        ...base,
        transitionScope: { ...base.transitionScope, capabilityId: 'capability-another' },
      },
      {
        ...base,
        context: context(
          base.context.storeId,
          base.context.browserProfileId,
          base.context.sessionGeneration + 1,
          base.context.businessDate,
        ),
      },
      {
        ...base,
        context: anotherContext,
        transitionScope: {
          ...base.transitionScope,
          target: {
            ...base.transitionScope.target!,
            storeId: anotherContext.storeId,
            browserProfileId: anotherContext.browserProfileId,
          },
        },
      },
    ];
    for (const variation of variations) {
      const derived = deriveStoreCollectionSchedulerExecutionIdentity(variation);
      expect(derived.attemptId).not.toBe(baseline.attemptId);
      expect(derived.requestId).not.toBe(baseline.requestId);
    }
  });

  it('keeps replayed ids from another transition nonterminal and sticky', async () => {
    let priorIdentity: { attemptId: string; requestId: string } | undefined;
    let calls = 0;
    let expectedFingerprint = fingerprint('replayed-ids-first');
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      inspection: () => ({ state: 'due', expectedFingerprint }),
      recover: async (input) => {
        calls += 1;
        const currentIdentity = {
          attemptId: input.attemptId,
          requestId: input.requestId,
        };
        const returnedIdentity = calls === 1 ? currentIdentity : priorIdentity!;
        priorIdentity ??= currentIdentity;
        return {
          state: 'succeeded',
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
          ...returnedIdentity,
        };
      },
    });
    await expect(test.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
    });
    expectedFingerprint = fingerprint('replayed-ids-second');
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    const history = readHistory(test);
    const pending = history.transitions.find((item: any) => (
      item.purpose === 'collection' && item.phase === 'scheduler_accepted'
    ));
    expect(pending).toMatchObject({
      schedulerAttemptId: expect.stringMatching(/^sca:/),
      schedulerRequestId: expect.stringMatching(/^scr:/),
    });
    expect(history.outcomes).toHaveLength(1);
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('retains an exact terminal attempt as the scheduler dedupe identity across restart', async () => {
    const first = harness({
      stores: [store('store-a', 'profile-a')],
      historyRetentionLimit: 1,
    });
    await expect(first.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
    });

    const restarted = harness({
      stores: [store('store-a', 'profile-a')],
      history: first.history,
      codec: first.codec,
      historyRetentionLimit: 1,
    });
    await expect(restarted.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [],
      skippedStoreIds: ['store-a'],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    expect(first.execute).toHaveBeenCalledOnce();
    expect(restarted.execute).not.toHaveBeenCalled();
    const history = readHistory(restarted);
    expect(history.outcomes).toHaveLength(1);
  });

  it('skips an exact collection attempt on a second scheduler cycle from protected history', async () => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
    });

    await expect(test.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
    });
    await expect(test.orchestrator.runCycle()).resolves.toMatchObject({
      state: 'completed',
      outcomes: [],
      skippedStoreIds: ['store-a'],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    expect(test.execute).toHaveBeenCalledOnce();
  });

  it('does not suppress another Store/Profile with the same fingerprint', async () => {
    const sharedFingerprint = fingerprint('shared-schedule');
    const stores = [
      store('store-a', 'profile-a'),
      store('store-b', 'profile-b'),
    ];
    const first = harness({
      stores,
      inspection: (item) => item.storeId === 'store-a'
        ? { state: 'due', expectedFingerprint: sharedFingerprint }
        : { state: 'not_due' },
    });
    await expect(first.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ storeId: 'store-a', state: 'succeeded' })],
    });

    const restarted = harness({
      stores,
      history: first.history,
      codec: first.codec,
      inspection: () => ({ state: 'due', expectedFingerprint: sharedFingerprint }),
    });
    await expect(restarted.orchestrator.runCycle()).resolves.toMatchObject({
      skippedStoreIds: ['store-a'],
      plannedDueStoreIds: ['store-b'],
      attemptedStoreIds: ['store-b'],
      outcomes: [expect.objectContaining({ storeId: 'store-b', state: 'succeeded' })],
    });

    expect(restarted.execute).toHaveBeenCalledOnce();
  });

  it('skips an exact failed terminal attempt after restart', async () => {
    const first = harness({
      stores: [store('store-a', 'profile-a')],
      recover: async (input) => ({
        state: 'failed',
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
      }),
    });
    await expect(first.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ state: 'failed' })],
    });

    const restarted = harness({
      stores: [store('store-a', 'profile-a')],
      history: first.history,
      codec: first.codec,
    });
    await expect(restarted.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [],
      skippedStoreIds: ['store-a'],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    expect(restarted.execute).not.toHaveBeenCalled();
  });

  it('recovers an exact pending attempt without planning or executing it again', async () => {
    const first = harness({
      stores: [store('store-a', 'profile-a')],
      recover: async (input) => ({
        state: 'waiting',
        authority: authority(input.context),
        owner: input.owner,
        capability: input.capability,
        transitionCapability: input.transitionCapability,
        transitionScope: input.transitionScope,
        cycleId: input.cycleId,
        transitionId: input.transitionId,
        fingerprint: input.expectedFingerprint,
        attemptId: input.attemptId,
        requestId: input.requestId,
      }),
    });
    await expect(first.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });

    const restarted = harness({
      stores: [store('store-a', 'profile-a')],
      history: first.history,
      codec: first.codec,
    });
    await expect(restarted.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ storeId: 'store-a', state: 'succeeded' })],
      skippedStoreIds: ['store-a'],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    expect(restarted.recover).toHaveBeenCalledOnce();
    expect(restarted.execute).not.toHaveBeenCalled();
  });

  it('fails closed when protected history has ambiguous exact collection attempts', async () => {
    const seed = harness({
      stores: [store('store-a', 'profile-a')],
    });
    await expect(seed.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
    });
    const corrupted = readHistory(seed);
    corrupted.semanticAttempts.push({ ...corrupted.semanticAttempts[0] });
    seed.history.value = seed.codec.seal(JSON.stringify(corrupted));
    const restarted = harness({
      stores: [store('store-a', 'profile-a')],
      history: seed.history,
      codec: seed.codec,
    });

    await expect(restarted.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    expect(restarted.acquireAutomationLease).not.toHaveBeenCalled();
    expect(restarted.execute).not.toHaveBeenCalled();
    expect(restarted.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('persists a legal failed terminal when scheduler succeeds but cleanup proof fails', async () => {
    let closeCalls = 0;
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      close: async (input) => {
        closeCalls += 1;
        if (closeCalls === 2) throw new Error('scheduler cleanup close failed');
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          closed: true,
          authority: input.expectedAuthority,
        };
      },
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    const collectionOutcome = readHistory(test).outcomes.find((item: any) => item.storeId === 'store-a');
    expect(collectionOutcome).toMatchObject({
      state: 'failed',
      schedulerSucceeded: true,
      cleanupStatus: 'unknown',
      failureCode: 'RUNTIME_CLOSE_FAILED',
    });
    expect(collectionOutcome.attemptId).toMatch(/^sca:/);
    expect(collectionOutcome.requestId).toMatch(/^scr:/);
    expect(test.releasePolicy).not.toHaveBeenCalled();
  });

  it('checks stop after runtime start and cleans/restores without identity verify or scheduler', async () => {
    const selected = context('store-b', 'profile-b', 5);
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const test = harness({
      initialContext: selected,
      inspection: (item) => ({
        state: item.storeId === 'store-a' ? 'due' : 'not_due',
        ...(item.storeId === 'store-a' ? { expectedFingerprint: fingerprint(item.storeId) } : {}),
      }),
      startRuntime: async (input) => {
        await gate;
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          started: true,
          authority: authority(input.context),
        };
      },
    });
    const active = test.orchestrator.runCycle();
    await vi.waitFor(() => expect(test.startCollectionOnlyVisibleRuntime).toHaveBeenCalledOnce());
    const drain = test.orchestrator.stopAndDrain(1_000);
    releaseGate();
    await drain;
    await expect(active).resolves.toMatchObject({ state: 'stopped' });
    expect(test.verifyVisibleLingxingIdentity).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.recover).not.toHaveBeenCalled();
    expect(test.current()?.storeId).toBe(selected.storeId);
  });

  it('checks stop immediately after transition readback and does not start a new visible runtime', async () => {
    let releaseTransition!: () => void;
    const gate = new Promise<void>((resolve) => { releaseTransition = resolve; });
    const target = context('store-a', 'profile-a', 1);
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      transition: async (input) => {
        await gate;
        if (input.target === null) {
          test.setCurrent(null);
          return {
            owner: input.owner,
            capability: input.capability,
            transitionCapability: input.transitionCapability,
            transitionScope: input.transitionScope,
            reason: 'collection_automation',
            mode: 'collection_only',
            previous: input.previous,
            current: authority(null),
            targetGenerationBefore: null,
            targetGenerationAfter: null,
          };
        }
        test.setCurrent(target);
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          reason: 'collection_automation',
          mode: 'collection_only',
          previous: input.previous,
          current: authority(target),
          targetGenerationBefore: 0,
          targetGenerationAfter: 1,
        };
      },
    });
    const active = test.orchestrator.runCycle();
    await vi.waitFor(() => expect(test.transitionAuthorityForCollection).toHaveBeenCalledOnce());
    test.orchestrator.stop();
    releaseTransition();
    await active;
    expect(test.startCollectionOnlyVisibleRuntime).not.toHaveBeenCalled();
    expect(test.verifyVisibleLingxingIdentity).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.recover).not.toHaveBeenCalled();
  });

  it('makes generation receipt failure sticky SAFETY_STATE_UNKNOWN', async () => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      transition: async (input) => {
        const target = context('store-a', 'profile-a', 1);
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          reason: 'collection_automation',
          mode: 'collection_only',
          previous: input.previous,
          current: authority(target),
          targetGenerationBefore: 1,
          targetGenerationAfter: 1,
        };
      },
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
  });

  it('makes an independent authority readback mismatch after transition sticky', async () => {
    const target = context('store-a', 'profile-a', 1);
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      transition: async (input) => ({
        owner: input.owner,
        capability: input.capability,
        transitionCapability: input.transitionCapability,
        transitionScope: input.transitionScope,
        reason: 'collection_automation',
        mode: 'collection_only',
        previous: input.previous,
        current: authority(target),
        targetGenerationBefore: 0,
        targetGenerationAfter: 1,
      }),
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('reads authority after transition throws and never guesses activeStoreId null', async () => {
    const selected = context('store-b', 'profile-b', 4);
    const test = harness({
      initialContext: selected,
      inspection: (item) => ({
        state: item.storeId === 'store-a' ? 'due' : 'not_due',
        ...(item.storeId === 'store-a' ? { expectedFingerprint: fingerprint(item.storeId) } : {}),
      }),
      transition: async () => { throw new Error('partial transition'); },
    });
    const result = await test.orchestrator.runCycle();
    expect(test.readActiveAuthority).toHaveBeenCalled();
    expect(result.attemptedStoreIds).toEqual(['store-a']);
    expect(test.current()?.storeId).toBe(selected.storeId);
  });

  it.each([
    ['non-US business timezone', {
      ...context('store-a', 'profile-a', 8),
      businessTimezone: 'UTC',
    } as StoreContextEnvelope],
    ['profile not present in activeStores snapshot', context('store-a', 'profile-x', 8)],
  ] as const)('rejects initial authority with %s before any runtime or transition touch', async (_label, initialContext) => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext,
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.closeVisibleRuntime).not.toHaveBeenCalled();
    expect(test.transitionAuthorityForCollection).not.toHaveBeenCalled();
    expect(test.startCollectionOnlyVisibleRuntime).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.releasePolicy).not.toHaveBeenCalled();
  });

  it.each([
    ['UTC authority', {
      ...context('store-a', 'profile-a', 8),
      businessTimezone: 'UTC',
    } as StoreContextEnvelope],
    ['unknown Store/Profile authority', context('store-a', 'profile-x', 8)],
  ] as const)('rejects a persisted %s snapshot before lease acquisition', async (_label, invalidContext) => {
    const test = harness({ stores: [store('store-a', 'profile-a')] });
    const invalid = {
      transitionId: 'utc-pending-transition',
      capabilityId: 'utc-pending-capability',
      cycleId: 'utc-old-cycle',
      owner: OWNER,
      fromStoreId: invalidContext.storeId,
      toStoreId: invalidContext.storeId,
      browserProfileId: invalidContext.browserProfileId,
      purpose: 'collection' as const,
      fromAuthority: authority(invalidContext),
      originAuthority: authority(invalidContext),
      expectedFingerprint: fingerprint('store-a'),
      phase: 'claimed' as const,
      startedAt: NOW.toISOString(),
    };
    test.history.value = test.codec.seal(JSON.stringify({
      schemaVersion: 4,
      transitions: [{
        ...invalid,
        integrityDigest: storeCollectionOrchestratorTransitionIntegrityDigest(invalid),
      }],
      outcomes: [],
    }));
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.acquireAutomationLease).not.toHaveBeenCalled();
    expect(test.closeVisibleRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ['runtime close', { close: async () => { throw new Error('close'); } }],
    ['collection lease', { collectionLease: async () => { throw new Error('lease'); } }],
    ['authority readback', { readAuthority: async () => { throw new Error('read'); } }],
  ] as const)('makes %s proof failure sticky and rejects completion', async (_label, overrides) => {
    const test = harness({ stores: [store('store-a', 'profile-a')], ...overrides });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
    expect(() => test.orchestrator.start()).toThrow(/安全状态未知/);
  });

  it('derives opaque initial and terminal cleanup intents when the first close fails once', async () => {
    const closeIntents: Array<Parameters<
      StoreCollectionOrchestratorDependencies['closeVisibleRuntime']
    >[0]['visibleRuntimeIntent']> = [];
    const leaseIntents: Array<Parameters<
      StoreCollectionOrchestratorDependencies['assertCollectionLeaseReleased']
    >[0]['visibleRuntimeIntent']> = [];
    let closeAttempt = 0;
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      close: async (input) => {
        closeIntents.push(input.visibleRuntimeIntent);
        closeAttempt += 1;
        if (closeAttempt === 1) throw new Error('transient initial close');
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          closed: true,
          authority: input.expectedAuthority,
        };
      },
      collectionLease: async (input) => {
        leaseIntents.push(input.visibleRuntimeIntent);
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          released: true,
          authority: input.expectedAuthority,
        };
      },
    });

    await Promise.allSettled([test.orchestrator.runCycle()]);

    expect(closeIntents.length).toBeGreaterThanOrEqual(4);
    const [
      collectionInitial,
      collectionTerminal,
      restoreInitial,
      restoreTerminal,
    ] = closeIntents;
    expect(collectionInitial.selectedCapability).toBe(
      collectionInitial.initialCapability,
    );
    expect(collectionTerminal.domainCapability).toBe(
      collectionInitial.domainCapability,
    );
    expect(collectionTerminal.selectedCapability).toBe(
      collectionInitial.terminalCleanupCapability,
    );
    expect(leaseIntents[0]).toBe(collectionTerminal);
    expect(restoreInitial.domainCapability).not.toBe(
      collectionInitial.domainCapability,
    );
    expect(restoreInitial.selectedCapability).toBe(
      restoreInitial.initialCapability,
    );
    expect(restoreTerminal.domainCapability).toBe(
      restoreInitial.domainCapability,
    );
    expect(restoreTerminal.selectedCapability).toBe(
      restoreInitial.terminalCleanupCapability,
    );
    expect(leaseIntents[1]).toBe(restoreInitial);
    expect(leaseIntents[2]).toBe(restoreTerminal);
    expect(test.startCollectionOnlyVisibleRuntime).not.toHaveBeenCalled();
    expect(test.verifyVisibleLingxingIdentity).not.toHaveBeenCalled();
  });

  it('still closes in finally when history persistence fails after runtime touch', async () => {
    const history = new MemoryHistory();
    history.failAtSet = 3;
    const test = harness({ stores: [store('store-a', 'profile-a')], history });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.closeVisibleRuntime.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(test.assertCollectionLeaseReleased.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('keeps sticky user lock when underlying automation lease release fails', async () => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      acquire: async () => ({
        owner: OWNER,
        capability: runtimeCapability('release-failure'),
        release: async () => { throw new Error('release'); },
      }),
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('best-effort releases a malformed automation lease without runtime or authority side effects', async () => {
    const malformedRelease = vi.fn(async () => ({ released: true }));
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      acquire: async () => ({
        owner: OWNER,
        capability: null,
        release: malformedRelease,
      } as never),
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(malformedRelease).toHaveBeenCalledOnce();
    expect(test.acquirePolicyDispatchSuppression).not.toHaveBeenCalled();
    expect(test.closeVisibleRuntime).not.toHaveBeenCalled();
    expect(test.transitionAuthorityForCollection).not.toHaveBeenCalled();
  });

  it('rejects a policy guard aliased to the global automation capability', async () => {
    const aliasedRelease = vi.fn(async (input?: StoreCollectionAutomationAuthority) => ({
      owner: input?.owner ?? OWNER,
      capability: input?.capability ?? runtimeCapability('unused'),
      guard: (input?.capability ?? runtimeCapability('unused')) as unknown as StoreCollectionPolicySuppressionGuard,
      released: true as const,
    }));
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      acquirePolicy: async (input) => ({
        ...input,
        guard: input.capability as unknown as StoreCollectionPolicySuppressionGuard,
        release: async () => aliasedRelease(input),
      }),
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(aliasedRelease).not.toHaveBeenCalled();
    expect(test.releasePolicy).not.toHaveBeenCalled();
    expect(test.closeVisibleRuntime).not.toHaveBeenCalled();
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('rejects a transition capability aliased to the active policy domain object', async () => {
    const guard = policyGuard('policy-transition-alias');
    const guardRelease = vi.fn(async (input: StoreCollectionAutomationAuthority) => ({
      ...input,
      guard,
      released: true as const,
    }));
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      acquirePolicy: async (input) => ({
        ...input,
        guard,
        release: async () => guardRelease(input),
      }),
      deriveTransition: async (input) => ({
        owner: input.owner,
        capability: input.capability,
        transitionCapability: guard as unknown as StoreCollectionTransitionCapability,
        transitionScope: input.scope,
        derived: true,
      }),
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.closeVisibleRuntime).not.toHaveBeenCalled();
    expect(guardRelease).not.toHaveBeenCalled();
    expect(test.releasePolicy).not.toHaveBeenCalled();
  });

  it('rejects the same automation capability object when reissued across cycles without releasing it twice', async () => {
    const shared = runtimeCapability('cross-cycle-automation');
    let expectedFingerprint = fingerprint('automation-reissue-first');
    const sharedRelease = vi.fn(async () => ({
      owner: OWNER,
      capability: shared,
      released: true as const,
    }));
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      inspection: () => ({ state: 'due', expectedFingerprint }),
      acquire: async () => ({
        owner: OWNER,
        capability: shared,
        release: sharedRelease,
      }),
    });
    await expect(test.orchestrator.runCycle()).resolves.toMatchObject({ state: 'completed' });
    expectedFingerprint = fingerprint('automation-reissue-second');
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(sharedRelease).toHaveBeenCalledOnce();
  });

  it('keeps a reissued cross-cycle policy guard suppressed and never calls its release again', async () => {
    const sharedGuard = policyGuard('cross-cycle-policy');
    let currentCapability: StoreCollectionAutomationCapability | undefined;
    let expectedFingerprint = fingerprint('policy-reissue-first');
    const sharedRelease = vi.fn(async () => ({
      owner: OWNER,
      capability: currentCapability!,
      guard: sharedGuard,
      released: true as const,
    }));
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      inspection: () => ({ state: 'due', expectedFingerprint }),
      acquirePolicy: async (input) => {
        currentCapability = input.capability;
        return {
          ...input,
          guard: sharedGuard,
          release: sharedRelease,
        };
      },
    });
    await expect(test.orchestrator.runCycle()).resolves.toMatchObject({ state: 'completed' });
    expectedFingerprint = fingerprint('policy-reissue-second');
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(sharedRelease).toHaveBeenCalledOnce();
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it.each([
    ['wrong transition capability', 'capability'],
    ['cloned transition scope', 'scope'],
    ['wrong authority generation', 'authority'],
  ] as const)('makes a %s receipt sticky and never reaches scheduler', async (_label, failure) => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      startRuntime: async (input) => ({
        owner: input.owner,
        capability: input.capability,
        transitionCapability: failure === 'capability'
          ? transitionCapability('forged')
          : input.transitionCapability,
        transitionScope: failure === 'scope'
          ? { ...input.transitionScope }
          : input.transitionScope,
        started: true,
        authority: failure === 'authority'
          ? authority(context(
            input.context.storeId,
            input.context.browserProfileId,
            input.context.sessionGeneration + 1,
            input.context.businessDate,
          ))
          : authority(input.context),
      }),
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.recover).not.toHaveBeenCalled();
    expect(test.releasePolicy).not.toHaveBeenCalled();
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('restores the operator-selected store and records restore purpose without a collection outcome', async () => {
    const selected = context('store-b', 'profile-b', 8);
    const test = harness({
      initialContext: selected,
      inspection: (item) => ({
        state: item.storeId === 'store-a' ? 'due' : 'not_due',
        ...(item.storeId === 'store-a' ? { expectedFingerprint: fingerprint(item.storeId) } : {}),
      }),
    });
    const result = await test.orchestrator.runCycle();
    expect(result.outcomes).toHaveLength(1);
    expect(test.current()?.storeId).toBe(selected.storeId);
    const history = readHistory(test);
    expect(history.transitions.filter((item: any) => item.purpose === 'restore')).toHaveLength(1);
    expect(history.outcomes).toHaveLength(1);
  });

  it.each([
    ['durable generation 8 reported as 1→2', {
      before: 1,
      after: 2,
      current: context('store-b', 'profile-b', 2),
    }],
    ['wrong restore timezone', {
      before: 8,
      after: 9,
      current: {
        ...context('store-b', 'profile-b', 9),
        businessTimezone: 'UTC',
      } as StoreContextEnvelope,
    }],
    ['returned context generation older than the durable origin', {
      before: 8,
      after: 9,
      current: context('store-b', 'profile-b', 7),
    }],
    ['returned business date older than the durable origin', {
      before: 8,
      after: 9,
      current: context('store-b', 'profile-b', 9, '2026-07-22'),
    }],
  ] as const)('rejects %s and never completes the restore transition', async (_label, invalid) => {
    const selected = context('store-b', 'profile-b', 8, '2026-07-23');
    let test!: ReturnType<typeof harness>;
    test = harness({
      initialContext: selected,
      inspection: (item) => ({
        state: item.storeId === 'store-a' ? 'due' : 'not_due',
        ...(item.storeId === 'store-a' ? { expectedFingerprint: fingerprint(item.storeId) } : {}),
      }),
      transition: async (input) => {
        if (input.target?.storeId === context('store-a', 'profile-a').storeId) {
          const target = context('store-a', 'profile-a', 1);
          test.setCurrent(target);
          return {
            owner: input.owner,
            capability: input.capability,
            transitionCapability: input.transitionCapability,
            transitionScope: input.transitionScope,
            reason: 'collection_automation',
            mode: 'collection_only',
            previous: input.previous,
            current: authority(target),
            targetGenerationBefore: 0,
            targetGenerationAfter: 1,
          };
        }
        test.setCurrent(invalid.current);
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          reason: 'collection_automation',
          mode: 'collection_only',
          previous: input.previous,
          current: authority(invalid.current),
          targetGenerationBefore: invalid.before,
          targetGenerationAfter: invalid.after,
        };
      },
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    const restores = readHistory(test).transitions.filter((item: any) => item.purpose === 'restore');
    expect(restores.length).toBeGreaterThanOrEqual(1);
    expect(restores.every((item: any) => item.phase !== 'completed')).toBe(true);
    expect(test.releasePolicy).not.toHaveBeenCalled();
  });

  it('rejects a same Store/Profile receipt that rolls durable generation 8 back through 0→1', async () => {
    const selected = context('store-a', 'profile-a', 8, '2026-07-23');
    let test!: ReturnType<typeof harness>;
    test = harness({
      stores: [store('store-a', 'profile-a')],
      initialContext: selected,
      transition: async (input) => {
        const rolledBack = context('store-a', 'profile-a', 1, '2026-07-23');
        test.setCurrent(rolledBack);
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          reason: 'collection_automation',
          mode: 'collection_only',
          previous: input.previous,
          current: authority(rolledBack),
          targetGenerationBefore: 0,
          targetGenerationAfter: 1,
        };
      },
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.startCollectionOnlyVisibleRuntime).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.releasePolicy).not.toHaveBeenCalled();
  });

  it.each([
    ['selected store', context('store-b', 'profile-b', 8)],
    ['null authority', null],
  ] as const)('never records the failing restore transition completed when final close proof fails for %s', async (_label, initialContext) => {
    let closeCalls = 0;
    const test = harness({
      initialContext,
      inspection: (item) => ({
        state: item.storeId === 'store-a' ? 'due' : 'not_due',
        ...(item.storeId === 'store-a' ? { expectedFingerprint: fingerprint(item.storeId) } : {}),
      }),
      close: async (input) => {
        closeCalls += 1;
        if (closeCalls === 4) throw new Error('final restore close failed');
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          closed: true,
          authority: input.expectedAuthority,
        };
      },
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    const history = readHistory(test);
    const restore = history.transitions.filter((item: any) => item.purpose === 'restore');
    expect(restore.length).toBeGreaterThanOrEqual(1);
    expect(restore[0]).toMatchObject({ phase: 'failed', failureCode: 'RUNTIME_CLOSE_FAILED' });
    expect(restore[0].phase).not.toBe('completed');
    expect(test.releasePolicy).not.toHaveBeenCalled();
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('keeps a restore nonterminal when neither final proof nor best-effort cleanup can prove the operator authority', async () => {
    let closeCalls = 0;
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      close: async (input) => {
        closeCalls += 1;
        if (closeCalls >= 4) throw new Error('restore close remains unverifiable');
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          closed: true,
          authority: input.expectedAuthority,
        };
      },
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    const restores = readHistory(test).transitions.filter((item: any) => item.purpose === 'restore');
    expect(restores.length).toBeGreaterThanOrEqual(1);
    expect(restores.every((item: any) => item.phase !== 'completed' && item.completedAt === undefined)).toBe(true);
    expect(restores.some((item: any) => item.phase === 'cleanup_pending')).toBe(true);
    expect(test.releasePolicy).not.toHaveBeenCalled();
  });

  it('keeps restore cleanup_pending durable until the final close/lease/readback proof resolves', async () => {
    const selected = context('store-b', 'profile-b', 8);
    let closeCalls = 0;
    let releaseFinalClose!: () => void;
    const finalCloseGate = new Promise<void>((resolve) => { releaseFinalClose = resolve; });
    const test = harness({
      initialContext: selected,
      inspection: (item) => ({
        state: item.storeId === 'store-a' ? 'due' : 'not_due',
        ...(item.storeId === 'store-a' ? { expectedFingerprint: fingerprint(item.storeId) } : {}),
      }),
      close: async (input) => {
        closeCalls += 1;
        if (closeCalls === 4) await finalCloseGate;
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          closed: true,
          authority: input.expectedAuthority,
        };
      },
    });
    const active = test.orchestrator.runCycle();
    await vi.waitFor(() => expect(closeCalls).toBe(4));
    const beforeFinalProof = readHistory(test);
    expect(beforeFinalProof.transitions.find((item: any) => item.purpose === 'restore'))
      .toMatchObject({ phase: 'cleanup_pending' });
    releaseFinalClose();
    await active;
    expect(readHistory(test).transitions.find((item: any) => item.purpose === 'restore'))
      .toMatchObject({ phase: 'completed' });
  });

  it('propagates restore rejection through stopAndDrain', async () => {
    const selected = context('store-b', 'profile-b', 8);
    let calls = 0;
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const test = harness({
      initialContext: selected,
      inspection: (item) => ({
        state: item.storeId === 'store-a' ? 'due' : 'not_due',
        ...(item.storeId === 'store-a' ? { expectedFingerprint: fingerprint(item.storeId) } : {}),
      }),
      startRuntime: async (input) => {
        await gate;
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          started: true,
          authority: authority(input.context),
        };
      },
      transition: async (input) => {
        calls += 1;
        if (calls === 2) throw new Error('restore failed');
        const target = context('store-a', 'profile-a', 1);
        test.setCurrent(target);
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          reason: 'collection_automation',
          mode: 'collection_only',
          previous: input.previous,
          current: authority(target),
          targetGenerationBefore: 0,
          targetGenerationAfter: 1,
        };
      },
    });
    const active = test.orchestrator.runCycle();
    await vi.waitFor(() => expect(test.startCollectionOnlyVisibleRuntime).toHaveBeenCalledOnce());
    const drain = test.orchestrator.stopAndDrain(1_000);
    releaseGate();
    await expect(drain).rejects.toBeTruthy();
    await expect(active).rejects.toBeTruthy();
  });

  it('recovers nonterminal transitions every cycle but writes only when recovery changes history', async () => {
    const seed = harness({ inspection: () => ({ state: 'not_due' }) });
    const pending = {
      transitionId: 'pending-1',
      capabilityId: 'pending-capability-1',
      cycleId: 'old-cycle',
      owner: OWNER,
      fromStoreId: null,
      toStoreId: context().storeId,
      browserProfileId: context().browserProfileId,
      purpose: 'collection' as const,
      fromAuthority: authority(null),
      originAuthority: authority(null),
      expectedFingerprint: fingerprint('store-a'),
      phase: 'runtime_started' as const,
      businessDate: context().businessDate,
      sessionGeneration: 2,
      startedAt: NOW.toISOString(),
    };
    seed.history.value = seed.codec.seal(JSON.stringify({
      schemaVersion: 4,
      transitions: [{
        ...pending,
        integrityDigest: storeCollectionOrchestratorTransitionIntegrityDigest(pending),
      }],
      outcomes: [],
    }));
    await seed.orchestrator.runCycle();
    const writesAfterRecovery = seed.history.sets;
    expect(writesAfterRecovery).toBeGreaterThan(1);
    await seed.orchestrator.runCycle();
    expect(seed.history.sets).toBe(writesAfterRecovery);
    const history = readHistory(seed);
    expect(history.transitions.find((item: any) => item.transitionId === 'pending-1'))
      .toMatchObject({ phase: 'interrupted' });
    expect(history.transitions.some((item: any) => (
      item.purpose === 'restore' && item.phase === 'completed'
    ))).toBe(true);
    const recoveryDerivation = seed.deriveTransitionCapability.mock.calls.find(
      ([input]) => input.scope.purpose === 'restore',
    );
    expect(recoveryDerivation?.[0].scope).toMatchObject({
      purpose: 'restore',
      originAuthority: authority(null),
    });
    expect(recoveryDerivation?.[0].scope.transitionId).not.toBe('pending-1');
    expect(recoveryDerivation?.[0].scope.capabilityId).not.toBe('pending-capability-1');
    expect(history.outcomes[0]).toMatchObject({ failureCode: 'APP_EXIT_INTERRUPTED' });
  });

  it('rejects a replayed one-time transition capability across execution and recovery domains', async () => {
    const replayed = transitionCapability('replayed-transition-capability');
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      deriveTransition: async (input) => ({
        owner: input.owner,
        capability: input.capability,
        transitionCapability: replayed,
        transitionScope: input.scope,
        derived: true,
        ...(input.recoveryAdmission ? {
          recoveryAdmission: input.recoveryAdmission,
          recoveryScopeDigest: input.recoveryScopeDigest,
          schedulerAttemptId: input.schedulerAttemptId,
          schedulerRequestId: input.schedulerRequestId,
        } : {}),
      }),
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.deriveTransitionCapability.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(test.deriveTransitionCapability.mock.calls.slice(0, 2).map(([input]) => (
      input.scope.capabilityDomain
    ))).toEqual(['transition_execution', 'recovery_existing_request_only']);
    expect(test.releasePolicy).not.toHaveBeenCalled();
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('rejects a retired transition capability when it is reissued in a later cycle', async () => {
    const replayed = transitionCapability('cross-cycle-transition-capability');
    let expectedFingerprint = fingerprint('transition-reissue-first');
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      inspection: () => ({ state: 'due', expectedFingerprint }),
      deriveTransition: async (input) => ({
        owner: input.owner,
        capability: input.capability,
        transitionCapability: input.scope.capabilityDomain === 'transition_execution'
          && input.scope.purpose === 'collection'
          ? replayed
          : transitionCapability(`fresh-${input.scope.capabilityId}`),
        transitionScope: input.scope,
        derived: true,
        ...(input.recoveryAdmission ? {
          recoveryAdmission: input.recoveryAdmission,
          recoveryScopeDigest: input.recoveryScopeDigest,
          schedulerAttemptId: input.schedulerAttemptId,
          schedulerRequestId: input.schedulerRequestId,
        } : {}),
      }),
    });
    await expect(test.orchestrator.runCycle()).resolves.toMatchObject({ state: 'completed' });
    expectedFingerprint = fingerprint('transition-reissue-second');
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    const collectionExecutionDerivations = test.deriveTransitionCapability.mock.calls
      .map(([input]) => input.scope)
      .filter((scope) => (
        scope.capabilityDomain === 'transition_execution'
        && scope.purpose === 'collection'
      ));
    expect(collectionExecutionDerivations).toHaveLength(2);
    expect(test.releasePolicy).toHaveBeenCalledOnce();
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('rejects a cloned scope from the transition capability issuer before authority touch', async () => {
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      deriveTransition: async (input) => ({
        owner: input.owner,
        capability: input.capability,
        transitionCapability: transitionCapability('scope-clone'),
        transitionScope: { ...input.scope },
        derived: true,
      }),
    });
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.closeVisibleRuntime).not.toHaveBeenCalled();
    expect(test.transitionAuthorityForCollection).not.toHaveBeenCalled();
    expect(test.releasePolicy).not.toHaveBeenCalled();
  });

  it('rejects claimed history carrying post-activation fields before lease acquisition', async () => {
    const test = harness({ stores: [store('store-a', 'profile-a')] });
    const targetContext = context('store-a', 'profile-a');
    const invalidClaimed = {
      transitionId: 'invalid-claimed-transition',
      capabilityId: 'invalid-claimed-capability',
      cycleId: 'old-cycle',
      owner: OWNER,
      fromStoreId: null,
      toStoreId: targetContext.storeId,
      browserProfileId: targetContext.browserProfileId,
      purpose: 'collection' as const,
      fromAuthority: authority(null),
      originAuthority: authority(null),
      expectedFingerprint: fingerprint('store-a'),
      phase: 'claimed' as const,
      businessDate: targetContext.businessDate,
      sessionGeneration: 1,
      startedAt: NOW.toISOString(),
    };
    test.history.value = test.codec.seal(JSON.stringify({
      schemaVersion: 4,
      transitions: [{
        ...invalidClaimed,
        integrityDigest: storeCollectionOrchestratorTransitionIntegrityDigest(invalidClaimed),
      }],
      outcomes: [],
    }));
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.acquireAutomationLease).not.toHaveBeenCalled();
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('rejects an illegal claimed-to-completed phase edge without mutating durable history', () => {
    const test = harness({ stores: [store('store-a', 'profile-a')] });
    const targetContext = context('store-a', 'profile-a');
    const claimed = {
      transitionId: 'claimed-transition',
      capabilityId: 'claimed-capability',
      cycleId: 'cycle-edge',
      owner: OWNER,
      fromStoreId: null,
      toStoreId: targetContext.storeId,
      browserProfileId: targetContext.browserProfileId,
      purpose: 'collection' as const,
      fromAuthority: authority(null),
      originAuthority: authority(null),
      expectedFingerprint: fingerprint('store-a'),
      phase: 'claimed' as const,
      startedAt: NOW.toISOString(),
    };
    const persisted = {
      ...claimed,
      integrityDigest: storeCollectionOrchestratorTransitionIntegrityDigest(claimed),
    };
    test.history.value = test.codec.seal(JSON.stringify({
      schemaVersion: 4,
      transitions: [persisted],
      outcomes: [],
    }));
    expect(() => (test.orchestrator as any).updateTransition(persisted, {
      phase: 'completed',
      completedAt: NOW.toISOString(),
    })).toThrowError(expect.objectContaining({ code: 'CORRUPT_PERSISTENCE' }));
    expect(readHistory(test).transitions[0]).toEqual(persisted);
  });

  it('enforces the complete purpose-by-phase edge matrix for every phase pair', () => {
    const edges: Record<
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
    const terminal = new Set<StoreCollectionOrchestratorTransitionPhase>([
      'completed', 'blocked', 'failed', 'interrupted',
    ]);
    for (const purpose of ['collection', 'restore'] as const) {
      for (const previous of STORE_COLLECTION_TRANSITION_PHASES) {
        for (const next of STORE_COLLECTION_TRANSITION_PHASES) {
          const expected = !terminal.has(previous)
            && edges[purpose][previous].includes(next);
          expect(
            isStoreCollectionTransitionPhaseAllowed(purpose, previous, next),
            `${purpose}: ${previous} -> ${next}`,
          ).toBe(expected);
        }
      }
    }
    expect(isStoreCollectionTransitionPhaseAllowed(
      'collection',
      'scheduler_request_bound',
      'interrupted',
    )).toBe(false);
    expect(isStoreCollectionTransitionPhaseAllowed(
      'collection',
      'scheduler_accepted',
      'interrupted',
    )).toBe(false);
  });

  it('enforces the complete purpose-by-phase field matrix including restore-null and scheduler identities', () => {
    const collection: Record<
      StoreCollectionOrchestratorTransitionPhase,
      ReadonlyArray<'none' | 'context' | 'scheduler'>
    > = {
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
    };
    const restoreStore: Record<
      StoreCollectionOrchestratorTransitionPhase,
      ReadonlyArray<'none' | 'context' | 'scheduler'>
    > = {
      claimed: ['none'],
      authority_touch_pending: ['none'],
      previous_closed: ['none'],
      activated: ['context'],
      runtime_started: [],
      identity_verified: [],
      scheduler_request_bound: [],
      scheduler_accepted: [],
      scheduler_reconciled: [],
      cleanup_pending: ['context'],
      completed: ['context'],
      blocked: [],
      failed: ['none', 'context'],
      interrupted: ['none', 'context'],
    };
    const restoreNull: typeof restoreStore = {
      ...restoreStore,
      activated: ['none'],
      cleanup_pending: ['none'],
      completed: ['none'],
      failed: ['none'],
      interrupted: ['none'],
    };
    const shapes = ['none', 'context', 'scheduler'] as const;
    for (const phase of STORE_COLLECTION_TRANSITION_PHASES) {
      for (const shape of shapes) {
        expect(
          storeCollectionTransitionPhaseFieldsValid(
            matrixTransition('collection', phase, shape),
          ),
          `collection ${phase} ${shape}`,
        ).toBe(collection[phase].includes(shape));
        expect(
          storeCollectionTransitionPhaseFieldsValid(
            matrixTransition('restore', phase, shape, 'store'),
          ),
          `restore-store ${phase} ${shape}`,
        ).toBe(restoreStore[phase].includes(shape));
        expect(
          storeCollectionTransitionPhaseFieldsValid(
            matrixTransition('restore', phase, shape, 'null'),
          ),
          `restore-null ${phase} ${shape}`,
        ).toBe(restoreNull[phase].includes(shape));
      }
    }
  });

  it('atomically persists every collection terminal with exactly one bound outcome', async () => {
    const test = harness();
    await test.orchestrator.runCycle();
    const history = readHistory(test);
    const collection = history.transitions.filter((item: any) => item.purpose === 'collection');
    expect(collection.every((transition: any) => (
      history.outcomes.filter((outcome: any) => outcome.transitionId === transition.transitionId).length === 1
    ))).toBe(true);
  });

  it('retains two Store/Profile semantic attempts outside transition compaction at retentionLimit=1', async () => {
    const first = harness({ historyRetentionLimit: 1 });
    await first.orchestrator.runCycle();
    const history = readHistory(first);
    expect(history.transitions).toHaveLength(1);
    expect(history.transitions[0]).toMatchObject({ toStoreId: 'store-b', purpose: 'collection' });
    expect(history.outcomes).toHaveLength(1);
    expect(history.outcomes[0].transitionId).toBe(history.transitions[0].transitionId);
    expect(history.semanticAttempts).toHaveLength(2);

    const restarted = harness({
      history: first.history,
      codec: first.codec,
      historyRetentionLimit: 1,
    });
    await expect(restarted.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [],
      skippedStoreIds: ['store-a', 'store-b'],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });
    expect(restarted.execute).not.toHaveBeenCalled();

    const changed = harness({
      history: first.history,
      codec: first.codec,
      historyRetentionLimit: 1,
      inspection: (item) => ({
        state: 'due',
        expectedFingerprint: item.storeId === 'store-a'
          ? fingerprint('store-a-new')
          : fingerprint('store-b'),
      }),
    });
    await expect(changed.orchestrator.runCycle()).resolves.toMatchObject({
      skippedStoreIds: ['store-b'],
      plannedDueStoreIds: ['store-a'],
      attemptedStoreIds: ['store-a'],
      outcomes: [expect.objectContaining({ storeId: 'store-a', state: 'succeeded' })],
    });
    expect(changed.execute).toHaveBeenCalledOnce();
  });

  it('keeps only each Store/Profile latest business-day semantic attempts across days', async () => {
    const history = new MemoryHistory();
    const codec = new AuthenticatedTestCodec();
    const stores = [
      store('store-a', 'profile-a'),
      store('store-b', 'profile-b'),
    ];

    for (const businessDate of ['2026-07-23', '2026-07-24', '2026-07-25']) {
      const daily = harness({
        stores,
        history,
        codec,
        businessDate,
        inspection: (item) => ({
          state: 'due',
          expectedFingerprint: fingerprint(`${item.storeId}:${businessDate}`),
        }),
      });
      await expect(daily.orchestrator.runCycle()).resolves.toMatchObject({
        attemptedStoreIds: ['store-a', 'store-b'],
      });
      const protectedHistory = readHistory(daily);
      expect(protectedHistory.semanticAttempts).toHaveLength(2);
      expect(protectedHistory.semanticAttempts.map((attempt: any) => (
        [attempt.storeId, attempt.browserProfileId, attempt.businessDate]
      ))).toEqual([
        ['store-a', 'profile-a', businessDate],
        ['store-b', 'profile-b', businessDate],
      ]);
    }
  });

  it('fails closed before scheduler execute when businessDate rolls behind the protected watermark', async () => {
    const history = new MemoryHistory();
    const codec = new AuthenticatedTestCodec();
    for (const businessDate of ['2026-07-23', '2026-07-24']) {
      const daily = harness({
        stores: [store('store-a', 'profile-a')],
        history,
        codec,
        businessDate,
        inspection: () => ({
          state: 'due',
          expectedFingerprint: fingerprint(`store-a:${businessDate}`),
        }),
      });
      await expect(daily.orchestrator.runCycle()).resolves.toMatchObject({
        outcomes: [expect.objectContaining({ state: 'succeeded' })],
      });
    }

    const rolledBack = harness({
      stores: [store('store-a', 'profile-a')],
      history,
      codec,
      businessDate: '2026-07-23',
      inspection: () => ({
        state: 'due',
        expectedFingerprint: fingerprint('store-a:rolled-back'),
      }),
    });
    await expect(rolledBack.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    expect(rolledBack.execute).not.toHaveBeenCalled();
    expect(rolledBack.orchestrator.isTransitionLocked()).toBe(true);
    expect(readHistory(rolledBack).semanticAttempts).toEqual([
      expect.objectContaining({
        storeId: 'store-a',
        browserProfileId: 'profile-a',
        businessDate: '2026-07-24',
      }),
    ]);
  });

  it('fails closed before the 33rd same-day semantic attempt for one Store/Profile', async () => {
    const history = new MemoryHistory();
    const codec = new AuthenticatedTestCodec();
    for (let index = 0; index < 32; index += 1) {
      const allowed = harness({
        stores: [store('store-a', 'profile-a')],
        history,
        codec,
        businessDate: '2026-07-24',
        inspection: () => ({
          state: 'due',
          expectedFingerprint: fingerprint(`store-a:2026-07-24:${index}`),
        }),
      });
      await expect(allowed.orchestrator.runCycle()).resolves.toMatchObject({
        outcomes: [expect.objectContaining({ state: 'succeeded' })],
      });
    }
    const protectedAttemptsBeforeOverflow = readHistory(
      harness({ history, codec }),
    ).semanticAttempts;

    const overflow = harness({
      stores: [store('store-a', 'profile-a')],
      history,
      codec,
      businessDate: '2026-07-24',
      inspection: () => ({
        state: 'due',
        expectedFingerprint: fingerprint('store-a:2026-07-24:overflow'),
      }),
    });
    await expect(overflow.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    expect(overflow.execute).not.toHaveBeenCalled();
    expect(readHistory(overflow).semanticAttempts).toEqual(
      protectedAttemptsBeforeOverflow,
    );
  });

  it('retains all same-day fingerprints so A to B to A cannot execute A twice', async () => {
    const history = new MemoryHistory();
    const codec = new AuthenticatedTestCodec();
    for (const expectedFingerprint of [
      fingerprint('same-day-a'),
      fingerprint('same-day-b'),
    ]) {
      const attempted = harness({
        stores: [store('store-a', 'profile-a')],
        history,
        codec,
        businessDate: '2026-07-24',
        inspection: () => ({ state: 'due', expectedFingerprint }),
      });
      await expect(attempted.orchestrator.runCycle()).resolves.toMatchObject({
        outcomes: [expect.objectContaining({ state: 'succeeded' })],
      });
      expect(attempted.execute).toHaveBeenCalledOnce();
    }

    const repeatedA = harness({
      stores: [store('store-a', 'profile-a')],
      history,
      codec,
      businessDate: '2026-07-24',
      inspection: () => ({
        state: 'due',
        expectedFingerprint: fingerprint('same-day-a'),
      }),
    });
    await expect(repeatedA.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [],
      skippedStoreIds: ['store-a'],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });
    expect(repeatedA.execute).not.toHaveBeenCalled();
    expect(readHistory(repeatedA).semanticAttempts).toHaveLength(2);
  });

  it('fully validates and compacts v4 scheduler-bound history before migrating its marker watermark', async () => {
    const history = new MemoryHistory();
    const codec = new AuthenticatedTestCodec();
    const legacyFingerprints = new Map<string, string>();
    for (const businessDate of ['2026-07-23', '2026-07-24']) {
      const expectedFingerprint = fingerprint(`legacy:${businessDate}`);
      legacyFingerprints.set(businessDate, expectedFingerprint);
      const daily = harness({
        stores: [store('store-a', 'profile-a')],
        history,
        codec,
        businessDate,
        inspection: () => ({ state: 'due', expectedFingerprint }),
      });
      await expect(daily.orchestrator.runCycle()).resolves.toMatchObject({
        outcomes: [expect.objectContaining({ state: 'succeeded' })],
      });
    }
    const v5 = readHistory(harness({ history, codec }));
    history.value = codec.seal(JSON.stringify({
      schemaVersion: 4,
      transitions: v5.transitions,
      outcomes: v5.outcomes,
    }));

    const rolledBack = harness({
      stores: [store('store-a', 'profile-a')],
      history,
      codec,
      businessDate: '2026-07-23',
      inspection: () => ({
        state: 'due',
        expectedFingerprint: legacyFingerprints.get('2026-07-23')!,
      }),
    });
    await expect(rolledBack.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    expect(rolledBack.execute).not.toHaveBeenCalled();
    const migrated = readHistory(rolledBack);
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.semanticAttempts).toEqual([
      expect.objectContaining({
        storeId: 'store-a',
        browserProfileId: 'profile-a',
        businessDate: '2026-07-24',
        expectedFingerprint: legacyFingerprints.get('2026-07-24'),
      }),
    ]);
  });

  it('migrates a valid v4 scheduler-bound transition into a durable same-day marker', async () => {
    const seed = harness({
      stores: [store('store-a', 'profile-a')],
      businessDate: '2026-07-24',
      inspection: () => ({
        state: 'due',
        expectedFingerprint: fingerprint('legacy-positive-a'),
      }),
    });
    await expect(seed.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
    });
    const v5 = readHistory(seed);
    seed.history.value = seed.codec.seal(JSON.stringify({
      schemaVersion: 4,
      transitions: v5.transitions,
      outcomes: v5.outcomes,
    }));

    const migrated = harness({
      stores: [store('store-a', 'profile-a')],
      history: seed.history,
      codec: seed.codec,
      businessDate: '2026-07-24',
      inspection: () => ({
        state: 'due',
        expectedFingerprint: fingerprint('legacy-positive-b'),
      }),
    });
    await expect(migrated.orchestrator.runCycle()).resolves.toMatchObject({
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
    });
    const protectedHistory = readHistory(migrated);
    expect(protectedHistory.schemaVersion).toBe(5);
    expect(protectedHistory.semanticAttempts).toEqual([
      expect.objectContaining({
        businessDate: '2026-07-24',
        expectedFingerprint: fingerprint('legacy-positive-a'),
      }),
      expect.objectContaining({
        businessDate: '2026-07-24',
        expectedFingerprint: fingerprint('legacy-positive-b'),
      }),
    ]);
  });

  it('rejects a corrupt older v4 transition before compacting it away', async () => {
    const history = new MemoryHistory();
    const codec = new AuthenticatedTestCodec();
    for (const businessDate of ['2026-07-23', '2026-07-24']) {
      const daily = harness({
        stores: [store('store-a', 'profile-a')],
        history,
        codec,
        businessDate,
        inspection: () => ({
          state: 'due',
          expectedFingerprint: fingerprint(`legacy-corrupt:${businessDate}`),
        }),
      });
      await expect(daily.orchestrator.runCycle()).resolves.toMatchObject({
        outcomes: [expect.objectContaining({ state: 'succeeded' })],
      });
    }
    const v5 = readHistory(harness({ history, codec }));
    const older = v5.transitions.find((transition: any) => (
      transition.purpose === 'collection'
      && transition.businessDate === '2026-07-23'
    ));
    older.integrityDigest = 'f'.repeat(64);
    history.value = codec.seal(JSON.stringify({
      schemaVersion: 4,
      transitions: v5.transitions,
      outcomes: v5.outcomes,
    }));
    const restarted = harness({
      stores: [store('store-a', 'profile-a')],
      history,
      codec,
      inspection: () => ({ state: 'not_due' }),
    });

    await expect(restarted.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    expect(restarted.acquireAutomationLease).not.toHaveBeenCalled();
    expect(restarted.execute).not.toHaveBeenCalled();
  });

  it('rejects exact-key history additions and makes persistence safety sticky', async () => {
    const test = harness({ inspection: () => ({ state: 'not_due' }) });
    test.history.value = test.codec.seal(JSON.stringify({
      schemaVersion: 2,
      transitions: [],
      outcomes: [],
      injected: true,
    }));
    await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.orchestrator.isTransitionLocked()).toBe(true);
  });

  it('uses cloned Store DTOs and deterministic codepoint sorting for preflight', async () => {
    const a = store('store-10', 'profile-a') as StoreRecord & { injected?: string };
    a.injected = 'must-not-cross-port';
    const z = store('store-2', 'profile-z');
    const seen: StoreRecord[] = [];
    const test = harness({
      stores: [z, a],
      inspection: (item) => {
        seen.push(item);
        return { state: 'not_due' };
      },
    });
    await test.orchestrator.runCycle();
    expect(seen.map((item) => item.storeId)).toEqual(['store-10', 'store-2']);
    expect(seen[0]).not.toBe(a);
    expect(seen[0]).not.toHaveProperty('injected');
  });

  it('makes start idempotent and isolates a throwing onError observer', async () => {
    const onError = vi.fn(() => { throw new Error('observer'); });
    const setInterval = vi.fn(() => ({ unref: vi.fn() }) as never);
    const clearInterval = vi.fn();
    const test = harness({
      inspection: () => { throw new Error('precheck'); },
      onError,
      setInterval,
      clearInterval,
    });
    test.orchestrator.start();
    test.orchestrator.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(setInterval).toHaveBeenCalledOnce();
    test.orchestrator.stop();
    expect(clearInterval).toHaveBeenCalledOnce();
  });

  it('does not let an existing timer hide sticky SAFETY_STATE_UNKNOWN from a later start call', async () => {
    const onError = vi.fn();
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      close: async () => { throw new Error('close failed'); },
      onError,
      setInterval: () => ({ unref: vi.fn() }) as never,
      clearInterval: vi.fn(),
    });
    test.orchestrator.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(() => test.orchestrator.start()).toThrow(/安全状态未知/);
    test.orchestrator.stop();
  });

  it('rejects duplicate store/profile and unsupported locale before lease acquisition', async () => {
    const invalid = [
      [store('store-a', 'profile-a'), store('store-a', 'profile-b')],
      [store('store-a', 'profile-a'), store('store-b', 'profile-a')],
      [store('store-a', 'profile-a', { businessTimezone: 'America/New_York' })],
    ];
    for (const stores of invalid) {
      const test = harness({ stores });
      await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'UNSUPPORTED_STORE' });
      expect(test.acquireAutomationLease).not.toHaveBeenCalled();
    }
  });

  it('exposes no credential, challenge, execution-controller, or policy-dispatch dependency', () => {
    const test = harness();
    const keys = Object.keys((test.orchestrator as any).dependencies);
    expect(keys).not.toContain('credentialFill');
    expect(keys).not.toContain('mfaHandler');
    expect(keys).not.toContain('executionController');
    expect(keys).not.toContain('policyDispatch');
  });
});
