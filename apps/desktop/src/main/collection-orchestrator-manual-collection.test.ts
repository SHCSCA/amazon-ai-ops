import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  transitionCapability,
  context,
  store,
  fingerprint,
  authority,
  harness,
  readHistory,
} from "./collection-orchestrator.test-fixtures";

describe('StoreCollectionOrchestrator', () => {
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
});
