import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  StoreCollectionOrchestratorError,
  storeCollectionOrchestratorTransitionIntegrityDigest,
} from './store-collection-orchestrator';
import {
  NOW,
  OWNER,
  transitionCapability,
  recoveryAdmission,
  context,
  store,
  fingerprint,
  authority,
  harness,
  readHistory,
} from "./collection-orchestrator.test-fixtures";

describe('StoreCollectionOrchestrator', () => {
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

it('restores from a same-store generation that has advanced beyond the durable origin lower bound', async () => {
    const durableOrigin = context('store-b', 'profile-b', 44, '2026-08-13');
    let test!: ReturnType<typeof harness>;
    test = harness({
      initialContext: durableOrigin,
      inspection: (item) => ({
        state: item.storeId === 'store-a' ? 'due' : 'not_due',
        ...(item.storeId === 'store-a' ? { expectedFingerprint: fingerprint(item.storeId) } : {}),
      }),
      transition: async (input) => {
        if (input.target?.storeId === 'store-a') {
          const collectionContext = context('store-a', 'profile-a', 1, '2026-08-16');
          test.setCurrent(collectionContext);
          return {
            owner: input.owner,
            capability: input.capability,
            transitionCapability: input.transitionCapability,
            transitionScope: input.transitionScope,
            reason: 'collection_automation',
            mode: 'collection_only',
            previous: input.previous,
            current: authority(collectionContext),
            targetGenerationBefore: 0,
            targetGenerationAfter: 1,
          };
        }
        const restoredContext = context('store-b', 'profile-b', 51, '2026-08-16');
        test.setCurrent(restoredContext);
        return {
          owner: input.owner,
          capability: input.capability,
          transitionCapability: input.transitionCapability,
          transitionScope: input.transitionScope,
          reason: 'collection_automation',
          mode: 'collection_only',
          previous: input.previous,
          current: authority(restoredContext),
          targetGenerationBefore: 50,
          targetGenerationAfter: 51,
        };
      },
    });

    const result = await test.orchestrator.runCycle().catch((error: unknown) => ({
      failureCode: error instanceof StoreCollectionOrchestratorError ? error.code : 'UNEXPECTED_ERROR',
    }));
    expect(result).toMatchObject({
      outcomes: [{ storeId: 'store-a', state: 'succeeded' }],
    });
    expect(test.current()).toEqual(context('store-b', 'profile-b', 51, '2026-08-16'));
    expect(readHistory(test).transitions.find((item: any) => item.purpose === 'restore'))
      .toMatchObject({ phase: 'completed', sessionGeneration: 51 });
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
});
