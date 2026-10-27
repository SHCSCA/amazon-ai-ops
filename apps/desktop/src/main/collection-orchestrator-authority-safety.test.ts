import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  storeCollectionOrchestratorTransitionIntegrityDigest,
  type StoreCollectionAutomationCapability,
  type StoreCollectionAutomationAuthority,
  type StoreCollectionOrchestratorDependencies,
  type StoreCollectionPolicySuppressionGuard,
  type StoreCollectionTransitionCapability,
} from './store-collection-orchestrator';
import {
  NOW,
  OWNER,
  runtimeCapability,
  policyGuard,
  transitionCapability,
  MemoryHistory,
  context,
  store,
  fingerprint,
  authority,
  harness,
  readHistory,
} from "./collection-orchestrator.test-fixtures";

describe('StoreCollectionOrchestrator', () => {
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
    const failure = await test.orchestrator.runCycle().catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    const seen = new Set<unknown>();
    const messages: string[] = [];
    let cause: unknown = failure;
    while (cause instanceof Error && !seen.has(cause)) {
      seen.add(cause);
      messages.push(cause.message);
      cause = (cause as Error & { cause?: unknown }).cause;
    }
    expect(cause).toBeUndefined();
    expect(messages).toContain('scheduler cleanup close failed');
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
});
