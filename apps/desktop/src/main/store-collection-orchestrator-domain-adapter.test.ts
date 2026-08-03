import { describe, expect, it, vi } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type BrowserProfileId,
  type StoreConnection,
  type StoreId,
  type StoreRecord,
  type StoreRuntimeConfigProjection,
  type StoreSessionMetadata,
} from '@amazon-ai-ops/shared-types';
import {
  deriveStoreCollectionSchedulerExecutionIdentity,
  type StoreCollectionTransitionCapabilityScope,
} from './store-collection-orchestrator';
import {
  StoreCoordinator,
  type StoreAuthorityRepository,
  type StoreSessionGenerationAuthority,
} from './store-coordinator';
import { StoreCollectionOrchestratorDomainAdapter } from './store-collection-orchestrator-domain-adapter';
import {
  deriveStoreCollectionWindow,
  storeCollectionScheduleSemanticFingerprint,
} from './store-collection-scheduler';

class MemoryRepository implements StoreAuthorityRepository {
  readonly stores = new Map<StoreId, StoreRecord>();

  transaction<T>(work: () => T): T { return work(); }
  listStores(): StoreRecord[] { return [...this.stores.values()]; }
  getStore(storeId: StoreId): StoreRecord | undefined { return this.stores.get(storeId); }
  createStore(): StoreRecord { throw new Error('unused'); }
  updateStore(): StoreRecord { throw new Error('unused'); }
  archiveStore(): StoreRecord { throw new Error('unused'); }
  restoreStore(): StoreRecord { throw new Error('unused'); }
  createConnection(): StoreConnection { throw new Error('unused'); }
  updateConnection(): StoreConnection { throw new Error('unused'); }
  removeConnection(): void { throw new Error('unused'); }
  listConnections(): StoreConnection[] { return []; }
  listSessionMetadata(): StoreSessionMetadata[] { return []; }
}

class MemorySessions implements StoreSessionGenerationAuthority {
  readonly generations = new Map<StoreId, number>();
  current(storeId: StoreId): number { return this.generations.get(storeId) ?? 0; }
  advance(storeId: StoreId): number {
    const next = this.current(storeId) + 1;
    this.generations.set(storeId, next);
    return next;
  }
  advanceMany(storeIds: readonly StoreId[]): ReadonlyMap<StoreId, number> {
    return new Map([...new Set(storeIds)].map((storeId) => [storeId, this.advance(storeId)]));
  }
  assertCurrent(context: { storeId: StoreId; sessionGeneration: number }): void {
    if (this.current(context.storeId) !== context.sessionGeneration) throw new Error('stale generation');
  }
}

function store(storeId: string, profileId: string): StoreRecord {
  return {
    storeId: storeId as StoreId,
    browserProfileId: profileId as BrowserProfileId,
    displayName: storeId,
    marketplace: 'US',
    currency: 'USD',
    status: 'active',
    businessTimezone: 'America/Los_Angeles',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function config(
  storeId: StoreId,
  lookbackDays = 7,
  collectionScheduleLocalTime = '08:00',
): StoreRuntimeConfigProjection {
  return {
    current: {
      configId: `config-${storeId}`,
      storeId,
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      status: 'active',
      revision: 1,
      values: {
        aiRecommendationsEnabled: true,
        collectionScheduleLocalTime,
        collectionLookbackDays: lookbackDays,
        analysisWindowDays: 30,
        defaultTargetAcosPercent: 28,
        minimumRecommendationConfidencePercent: 75,
        evidenceRetentionDays: 90,
      },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    versions: [],
  };
}

function harness(options: { now?: Date } = {}) {
  const repository = new MemoryRepository();
  const sessions = new MemorySessions();
  const now = options.now ?? new Date('2026-07-23T16:00:00.000Z');
  const storeA = store('store-a', 'profile-a');
  const storeB = store('store-b', 'profile-b');
  repository.stores.set(storeA.storeId, storeA);
  repository.stores.set(storeB.storeId, storeB);
  const coordinator = new StoreCoordinator({
    repository,
    sessions,
    now: () => now,
  });
  const businessDate = '2026-07-23';
  const window = deriveStoreCollectionWindow(businessDate, 7);
  const inspectForStore = vi.fn((record: StoreRecord) => ({
    state: record.storeId === storeA.storeId ? 'not_due' as const : 'due' as const,
    expectedFingerprint: storeCollectionScheduleSemanticFingerprint({
      storeId: record.storeId,
      browserProfileId: record.browserProfileId,
      businessDate,
      lookbackDays: 7,
      ...window,
    }),
  }));
  const inspectUniqueCollectionJobForSemanticScope = vi.fn(() => undefined);
  const adapter = new StoreCollectionOrchestratorDomainAdapter({
    coordinator,
    scheduler: { inspectForStore },
    config: {
      getForStoreRecord: (record) => config(
        record.storeId,
        7,
        record.storeId === storeA.storeId ? '10:00' : '08:00',
      ),
    },
    repository: { inspectUniqueCollectionJobForSemanticScope },
    now: () => now,
  });
  return {
    adapter,
    coordinator,
    inspectForStore,
    inspectUniqueCollectionJobForSemanticScope,
    repository,
    sessions,
    storeA,
    storeB,
  };
}

describe('StoreCollectionOrchestratorDomainAdapter', () => {
  it('maps active-store list and pure per-store inspection without changing active UI context', () => {
    const test = harness();
    const activeBefore = test.coordinator.switchStore(test.storeA.storeId).context;

    expect(test.adapter.listActiveStores().map((item) => item.storeId))
      .toEqual([test.storeA.storeId, test.storeB.storeId]);
    expect(test.adapter.inspectStoreSchedule(test.storeA)).toEqual({
      state: 'not_due',
      expectedFingerprint: storeCollectionScheduleSemanticFingerprint({
        storeId: test.storeA.storeId,
        browserProfileId: test.storeA.browserProfileId,
        businessDate: '2026-07-23',
        lookbackDays: 7,
        dateStart: '2026-07-16',
        dateEnd: '2026-07-22',
      }),
    });
    expect(test.adapter.inspectStoreSchedule(test.storeB)).toEqual({
      state: 'due',
      expectedFingerprint: storeCollectionScheduleSemanticFingerprint({
        storeId: test.storeB.storeId,
        browserProfileId: test.storeB.browserProfileId,
        businessDate: '2026-07-23',
        lookbackDays: 7,
        dateStart: '2026-07-16',
        dateEnd: '2026-07-22',
      }),
    });
    expect(test.inspectForStore).not.toHaveBeenCalled();
    expect(test.coordinator.getActiveStoreContext()).toEqual(activeBefore);
    expect(test.adapter.getActiveStoreId()).toBe(test.storeA.storeId);
    expect(test.inspectUniqueCollectionJobForSemanticScope).toHaveBeenCalledWith({
      storeId: test.storeB.storeId,
      browserProfileId: test.storeB.browserProfileId,
      businessDate: '2026-07-23',
      dateStart: '2026-07-16',
      dateEnd: '2026-07-22',
      mode: 'create-and-download',
      reportTypes: [
        'campaign', 'ad_group', 'placement', 'advertised_product',
        'auto_targeting', 'keyword', 'product_targeting', 'user_search_term',
      ],
    });
  });

  it('suppresses a due schedule when protected history is absent but the exact durable DB scope exists', () => {
    const test = harness();
    test.inspectUniqueCollectionJobForSemanticScope.mockReturnValue({
      job: { state: 'queued' },
    } as never);

    expect(test.adapter.inspectStoreSchedule(test.storeB)).toEqual({
      state: 'not_due',
      expectedFingerprint: storeCollectionScheduleSemanticFingerprint({
        storeId: test.storeB.storeId,
        browserProfileId: test.storeB.browserProfileId,
        businessDate: '2026-07-23',
        lookbackDays: 7,
        dateStart: '2026-07-16',
        dateEnd: '2026-07-22',
      }),
    });
    expect(test.inspectUniqueCollectionJobForSemanticScope).toHaveBeenCalledTimes(1);
  });

  it('does not let legacy history alone suppress a due scope without exact durable DB authority', () => {
    const test = harness();
    const expectedFingerprint = storeCollectionScheduleSemanticFingerprint({
      storeId: test.storeB.storeId,
      browserProfileId: test.storeB.browserProfileId,
      businessDate: '2026-07-23',
      lookbackDays: 7,
      dateStart: '2026-07-16',
      dateEnd: '2026-07-22',
    });
    test.inspectForStore.mockImplementation(() => {
      throw new Error('legacy history must not be consulted');
    });

    expect(test.adapter.inspectStoreSchedule(test.storeB)).toEqual({
      state: 'due',
      expectedFingerprint,
    });
    expect(test.inspectForStore).not.toHaveBeenCalled();
    expect(test.inspectUniqueCollectionJobForSemanticScope).toHaveBeenCalledTimes(1);
  });

  it('manual eligibility ignores legacy history and scheduled time, using only exact durable DB scope', () => {
    const test = harness();
    const exactContext = normalizeStoreContextEnvelope({
      storeId: test.storeA.storeId,
      browserProfileId: test.storeA.browserProfileId,
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      businessDate: '2026-07-23',
      sessionGeneration: 1,
    });

    const eligible = test.adapter.inspectManualStoreSchedule(test.storeA, exactContext);
    expect(eligible).toEqual({
      state: 'eligible',
      expectedFingerprint: storeCollectionScheduleSemanticFingerprint({
        storeId: test.storeA.storeId,
        browserProfileId: test.storeA.browserProfileId,
        businessDate: '2026-07-23',
        lookbackDays: 7,
        dateStart: '2026-07-16',
        dateEnd: '2026-07-22',
      }),
    });
    expect(test.inspectUniqueCollectionJobForSemanticScope).toHaveBeenNthCalledWith(1, {
      storeId: test.storeA.storeId,
      browserProfileId: test.storeA.browserProfileId,
      businessDate: exactContext.businessDate,
      dateStart: '2026-07-16',
      dateEnd: '2026-07-22',
      mode: 'create-and-download',
      reportTypes: [
        'campaign', 'ad_group', 'placement', 'advertised_product',
        'auto_targeting', 'keyword', 'product_targeting', 'user_search_term',
      ],
    });
    expect(test.inspectForStore).not.toHaveBeenCalled();

    test.inspectUniqueCollectionJobForSemanticScope.mockReturnValue({
      job: { state: 'failed' },
    } as never);
    expect(test.adapter.inspectManualStoreSchedule(test.storeA, exactContext)).toEqual({
      state: 'duplicate',
      expectedFingerprint: eligible.expectedFingerprint,
    });
    expect(test.inspectForStore).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'wrong Store',
      now: undefined,
      context: (test: ReturnType<typeof harness>) => ({
        storeId: test.storeB.storeId,
        browserProfileId: test.storeB.browserProfileId,
        businessDate: '2026-07-23',
      }),
    },
    {
      name: 'wrong Profile',
      now: undefined,
      context: (test: ReturnType<typeof harness>) => ({
        storeId: test.storeA.storeId,
        browserProfileId: test.storeB.browserProfileId,
        businessDate: '2026-07-23',
      }),
    },
    {
      name: 'cross-midnight businessDate',
      now: new Date('2026-07-24T07:01:00.000Z'),
      context: (test: ReturnType<typeof harness>) => ({
        storeId: test.storeA.storeId,
        browserProfileId: test.storeA.browserProfileId,
        businessDate: '2026-07-23',
      }),
    },
  ])('manual inspection fails closed on $name context drift', ({ now, context }) => {
    const test = harness({ ...(now ? { now } : {}) });
    const partial = context(test);
    const exactContext = normalizeStoreContextEnvelope({
      ...partial,
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      sessionGeneration: 1,
    });

    expect(() => test.adapter.inspectManualStoreSchedule(test.storeA, exactContext)).toThrow();
    expect(test.inspectUniqueCollectionJobForSemanticScope).not.toHaveBeenCalled();
  });

  it('propagates duplicate or corrupt durable semantic authority as fail-closed inspection errors', () => {
    const test = harness();
    test.inspectUniqueCollectionJobForSemanticScope.mockImplementation(() => {
      throw new Error('duplicate/corrupt semantic authority');
    });

    expect(() => test.adapter.inspectStoreSchedule(test.storeB))
      .toThrow(/duplicate\/corrupt semantic authority/);
  });

  it('maps exact capability-bound A to B and B to A authority transitions', async () => {
    const test = harness();
    test.coordinator.switchStore(test.storeA.storeId);
    const automation = test.adapter.issueAutomationAuthority('adapter-owner');

    const transition = async (
      targetStore: StoreRecord,
      purpose: 'collection' | 'restore',
      suffix: string,
    ) => {
      const read = await test.adapter.readActiveAuthority(automation);
      const target = {
        storeId: targetStore.storeId,
        browserProfileId: targetStore.browserProfileId,
        marketplace: 'US' as const,
        currency: 'USD' as const,
        businessTimezone: 'America/Los_Angeles' as const,
      };
      const scope: StoreCollectionTransitionCapabilityScope<'transition_execution'> = Object.freeze({
        capabilityDomain: 'transition_execution',
        capabilityId: `capability-${suffix}`,
        cycleId: `cycle-${suffix}`,
        transitionId: `transition-${suffix}`,
        purpose,
        fromAuthority: read.authority,
        originAuthority: read.authority,
        target,
        expectedFingerprint: purpose === 'collection' ? 'b'.repeat(64) : null,
      });
      const derived = await test.adapter.deriveTransitionCapability({ ...automation, scope });
      return test.adapter.transitionAuthorityForCollection({
        ...automation,
        transitionCapability: derived.transitionCapability,
        transitionScope: scope,
        reason: 'collection_automation',
        mode: 'collection_only',
        previous: read.authority,
        target,
      });
    };

    const toB = await transition(test.storeB, 'collection', 'to-b');
    expect(toB).toMatchObject({
      previous: { activeStoreId: test.storeA.storeId, context: { sessionGeneration: 1 } },
      current: { activeStoreId: test.storeB.storeId, context: { sessionGeneration: 1 } },
      targetGenerationBefore: 0,
      targetGenerationAfter: 1,
    });
    const restoredA = await transition(test.storeA, 'restore', 'restore-a');
    expect(restoredA).toMatchObject({
      previous: { activeStoreId: test.storeB.storeId, context: { sessionGeneration: 1 } },
      current: { activeStoreId: test.storeA.storeId, context: { sessionGeneration: 3 } },
      targetGenerationBefore: 2,
      targetGenerationAfter: 3,
    });
  });

  it('rejects forged/replayed capabilities, stale previous authority and duplicate profiles', async () => {
    const test = harness();
    test.coordinator.switchStore(test.storeA.storeId);
    const automation = test.adapter.issueAutomationAuthority('adapter-owner');
    const read = await test.adapter.readActiveAuthority(automation);
    const target = {
      storeId: test.storeB.storeId,
      browserProfileId: test.storeB.browserProfileId,
      marketplace: 'US' as const,
      currency: 'USD' as const,
      businessTimezone: 'America/Los_Angeles' as const,
    };
    const scope: StoreCollectionTransitionCapabilityScope<'transition_execution'> = Object.freeze({
      capabilityDomain: 'transition_execution',
      capabilityId: 'capability-stale',
      cycleId: 'cycle-stale',
      transitionId: 'transition-stale',
      purpose: 'collection',
      fromAuthority: read.authority,
      originAuthority: read.authority,
      target,
      expectedFingerprint: 'c'.repeat(64),
    });
    const derived = await test.adapter.deriveTransitionCapability({ ...automation, scope });
    test.coordinator.reconnectStore(test.storeA.storeId);
    await expect(test.adapter.transitionAuthorityForCollection({
      ...automation,
      transitionCapability: derived.transitionCapability,
      transitionScope: scope,
      reason: 'collection_automation',
      mode: 'collection_only',
      previous: read.authority,
      target,
    })).rejects.toThrow(/stale/);
    await expect(test.adapter.transitionAuthorityForCollection({
      ...automation,
      transitionCapability: derived.transitionCapability,
      transitionScope: scope,
      reason: 'collection_automation',
      mode: 'collection_only',
      previous: read.authority,
      target,
    })).rejects.toThrow(/forged, replayed/);

    await expect(test.adapter.readActiveAuthority({
      owner: automation.owner,
      capability: Object.freeze({}) as never,
    })).rejects.toThrow(/forged/);

    test.repository.stores.set(test.storeB.storeId, {
      ...test.storeB,
      browserProfileId: test.storeA.browserProfileId,
    });
    expect(() => test.adapter.listActiveStores()).toThrow(/duplicate Store\/Profile/);
  });

  it('issues recovery authority only from one exact admission and does not require current Main authority to remain historical', async () => {
    const test = harness();
    test.coordinator.switchStore(test.storeA.storeId);
    const automation = test.adapter.issueAutomationAuthority('adapter-owner');
    const previous = (await test.adapter.readActiveAuthority(automation)).authority;
    const target = {
      storeId: test.storeB.storeId,
      browserProfileId: test.storeB.browserProfileId,
      marketplace: 'US' as const,
      currency: 'USD' as const,
      businessTimezone: 'America/Los_Angeles' as const,
    };
    const executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'> =
      Object.freeze({
        capabilityDomain: 'transition_execution',
        capabilityId: 'protected-execution',
        cycleId: 'protected-cycle',
        transitionId: 'protected-transition',
        purpose: 'collection',
        fromAuthority: previous,
        originAuthority: previous,
        target,
        expectedFingerprint: 'd'.repeat(64),
      });
    const execution = await test.adapter.deriveTransitionCapability({
      ...automation,
      scope: executionScope,
    });
    const transitioned = await test.adapter.transitionAuthorityForCollection({
      ...automation,
      transitionCapability: execution.transitionCapability,
      transitionScope: executionScope,
      reason: 'collection_automation',
      mode: 'collection_only',
      previous,
      target,
    });
    const historicalContext = transitioned.current.context!;
    const identity = deriveStoreCollectionSchedulerExecutionIdentity({
      cycleId: executionScope.cycleId,
      transitionId: executionScope.transitionId,
      fingerprint: executionScope.expectedFingerprint!,
      transitionScope: executionScope,
      context: historicalContext,
    });
    const recoveryScope: StoreCollectionTransitionCapabilityScope<'recovery_existing_request_only'> =
      Object.freeze({
        ...executionScope,
        capabilityDomain: 'recovery_existing_request_only',
        capabilityId: `${executionScope.capabilityId}:recovery`,
      });

    await expect(test.adapter.deriveTransitionCapability({
      ...automation,
      scope: recoveryScope,
    })).rejects.toThrow(/protected-history admission/);

    const admission = await test.adapter.registerSchedulerRecoveryAdmission({
      ...automation,
      executionScope,
      context: historicalContext,
      ...identity,
    });
    await expect(test.adapter.deriveTransitionCapability({
      ...automation,
      scope: recoveryScope,
      recoveryAdmission: Object.freeze({}) as never,
      recoveryScopeDigest: admission.scopeDigest,
      schedulerAttemptId: admission.attemptId,
      schedulerRequestId: admission.requestId,
    })).rejects.toThrow(/protected-history admission/);
    await expect(test.adapter.deriveTransitionCapability({
      ...automation,
      scope: recoveryScope,
      recoveryAdmission: admission.recoveryAdmission,
      recoveryScopeDigest: admission.scopeDigest,
      schedulerAttemptId: admission.attemptId,
      schedulerRequestId: `scr:${'f'.repeat(64)}`,
    })).rejects.toThrow(/protected-history admission/);

    const secondAdmission = await test.adapter.registerSchedulerRecoveryAdmission({
      ...automation,
      executionScope,
      context: historicalContext,
      ...identity,
    });
    const recovery = await test.adapter.deriveTransitionCapability({
      ...automation,
      scope: recoveryScope,
      recoveryAdmission: secondAdmission.recoveryAdmission,
      recoveryScopeDigest: secondAdmission.scopeDigest,
      schedulerAttemptId: secondAdmission.attemptId,
      schedulerRequestId: secondAdmission.requestId,
    });
    await expect(test.adapter.deriveTransitionCapability({
      ...automation,
      scope: {
        ...recoveryScope,
        capabilityId: `${executionScope.capabilityId}:recovery`,
      },
      recoveryAdmission: secondAdmission.recoveryAdmission,
      recoveryScopeDigest: secondAdmission.scopeDigest,
      schedulerAttemptId: secondAdmission.attemptId,
      schedulerRequestId: secondAdmission.requestId,
    })).rejects.toThrow(/protected-history admission/);

    test.coordinator.switchStore(test.storeA.storeId);
    expect(test.adapter.claimSchedulerTransitionAuthority({
      ...automation,
      transitionCapability: recovery.transitionCapability,
      transitionScope: recoveryScope,
    }, {
      capabilityDomain: 'recovery_existing_request_only',
      context: historicalContext,
      expectedAuthority: transitioned.current,
      ...identity,
    })).toEqual({
      transitionScope: recoveryScope,
      executionScope,
    });
    expect(() => test.adapter.claimSchedulerTransitionAuthority({
      ...automation,
      transitionCapability: recovery.transitionCapability,
      transitionScope: recoveryScope,
    }, {
      capabilityDomain: 'recovery_existing_request_only',
      context: historicalContext,
      expectedAuthority: transitioned.current,
      ...identity,
    })).toThrow(/forged, replayed/);
  });

  it('validates issuer-backed visible authority across transition touch and retires it at scheduler claim', async () => {
    const test = harness();
    test.coordinator.switchStore(test.storeA.storeId);
    const automation = test.adapter.issueAutomationAuthority('visible-owner');
    const previous = (await test.adapter.readActiveAuthority(automation)).authority;
    const target = {
      storeId: test.storeB.storeId,
      browserProfileId: test.storeB.browserProfileId,
      marketplace: 'US' as const,
      currency: 'USD' as const,
      businessTimezone: 'America/Los_Angeles' as const,
    };
    const scope: StoreCollectionTransitionCapabilityScope<'transition_execution'> = Object.freeze({
      capabilityDomain: 'transition_execution',
      capabilityId: 'visible-execution',
      cycleId: 'visible-cycle',
      transitionId: 'visible-transition',
      purpose: 'collection',
      fromAuthority: previous,
      originAuthority: previous,
      target,
      expectedFingerprint: 'e'.repeat(64),
    });
    const derived = await test.adapter.deriveTransitionCapability({ ...automation, scope });
    const authority = {
      ...automation,
      transitionCapability: derived.transitionCapability,
      transitionScope: scope,
    };

    expect(() => test.adapter.assertTransitionAuthority(authority)).not.toThrow();
    expect(() => test.adapter.assertTransitionAuthority(authority)).not.toThrow();
    expect(() => test.adapter.assertTransitionAuthority({
      ...authority,
      transitionCapability: Object.freeze({}) as never,
    })).toThrow(/forged/);
    expect(() => test.adapter.assertTransitionAuthority({
      ...authority,
      transitionScope: { ...scope },
    })).toThrow(/mutated/);
    expect(() => test.adapter.assertTransitionAuthority({
      ...authority,
      owner: 'cross-owner',
    })).toThrow(/forged/);
    expect(() => test.adapter.assertTransitionAuthority({
      ...authority,
      transitionScope: {
        ...scope,
        capabilityDomain: 'recovery_existing_request_only',
        capabilityId: `${scope.capabilityId}:recovery`,
      },
    } as never)).toThrow(/cross-domain|mutated/);

    const transitioned = await test.adapter.transitionAuthorityForCollection({
      ...authority,
      reason: 'collection_automation',
      mode: 'collection_only',
      previous,
      target,
    });
    expect(() => test.adapter.assertTransitionAuthority(authority)).not.toThrow();

    const identity = deriveStoreCollectionSchedulerExecutionIdentity({
      cycleId: scope.cycleId,
      transitionId: scope.transitionId,
      fingerprint: scope.expectedFingerprint!,
      transitionScope: scope,
      context: transitioned.current.context!,
    });
    test.adapter.claimSchedulerTransitionAuthority(authority, {
      capabilityDomain: 'transition_execution',
      context: transitioned.current.context!,
      expectedAuthority: transitioned.current,
      ...identity,
    });
    expect(() => test.adapter.assertTransitionAuthority(authority)).toThrow(/used by scheduler/);

    const mutation = harness();
    mutation.coordinator.switchStore(mutation.storeA.storeId);
    const mutationAutomation = mutation.adapter.issueAutomationAuthority('mutation-owner');
    const mutationPrevious = (await mutation.adapter.readActiveAuthority(mutationAutomation)).authority;
    const mutableScope: StoreCollectionTransitionCapabilityScope<'transition_execution'> = {
      ...scope,
      capabilityId: 'mutable-execution',
      cycleId: 'mutable-cycle',
      transitionId: 'mutable-transition',
      fromAuthority: mutationPrevious,
      originAuthority: mutationPrevious,
    };
    const mutableDerived = await mutation.adapter.deriveTransitionCapability({
      ...mutationAutomation,
      scope: mutableScope,
    });
    mutableScope.expectedFingerprint = 'f'.repeat(64);
    expect(() => mutation.adapter.assertTransitionAuthority({
      ...mutationAutomation,
      transitionCapability: mutableDerived.transitionCapability,
      transitionScope: mutableScope,
    })).toThrow(/mutated/);
  });

  it('exposes no visible-runtime, browser, scheduler execute/recover or Renderer API', () => {
    const { adapter } = harness();
    expect(adapter).not.toHaveProperty('startCollection');
    expect(adapter).not.toHaveProperty('closeVisibleRuntime');
    expect(adapter).not.toHaveProperty('scheduler');
    expect(adapter).not.toHaveProperty('execute');
    expect(adapter).not.toHaveProperty('recover');
    expect(adapter).not.toHaveProperty('switchStore');
    expect(adapter).not.toHaveProperty('reconnectStore');
  });
});
