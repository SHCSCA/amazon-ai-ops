import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  StoreCollectionOrchestratorError,
  storeCollectionOrchestratorTransitionIntegrityDigest,
} from './store-collection-orchestrator';
import {
  NOW,
  OWNER,
  transitionCapability,
  context,
  store,
  fingerprint,
  authority,
  harness,
  readHistory,
} from "./collection-orchestrator.test-fixtures";

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
    const interruptedResult = await interrupted.orchestrator.runCycle().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({
        ok: false as const,
        code: error instanceof StoreCollectionOrchestratorError ? error.code : 'UNEXPECTED_ERROR',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    expect(interruptedResult).toEqual({
      ok: false,
      code: 'SAFETY_STATE_UNKNOWN',
      message: '编排器安全状态未知；必须由 Main 完成人工恢复后才能继续。',
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

it('terminalizes a request-bound transition when the exact durable scheduler request was never created', async () => {
    const interrupted = harness({
      stores: [store('store-a', 'profile-a')],
      execute: async () => {
        throw new Error('scheduler stopped before durable initial progress');
      },
    });
    await expect(interrupted.orchestrator.runCycle()).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });
    const pending = readHistory(interrupted).transitions.find((item: any) => (
      item.purpose === 'collection' && item.phase === 'scheduler_request_bound'
    ));
    expect(pending).toBeDefined();

    const restarted = harness({
      stores: [store('store-a', 'profile-a')],
      history: interrupted.history,
      codec: interrupted.codec,
      inspection: () => {
        throw new Error('recovery-only startup must not inspect due stores');
      },
      recover: async (input) => ({
        state: 'not_found',
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

    const recoveryResult = await restarted.orchestrator.recoverExistingTransitionsOnly().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => {
        const messages: string[] = [];
        const seen = new Set<unknown>();
        let current: unknown = error;
        while (current instanceof Error && !seen.has(current) && messages.length < 8) {
          seen.add(current);
          messages.push(current.message);
          current = (current as Error & { cause?: unknown }).cause;
        }
        return {
          ok: false as const,
          code: error instanceof StoreCollectionOrchestratorError ? error.code : 'UNEXPECTED_ERROR',
          message: error instanceof Error ? error.message : String(error),
          messages,
        };
      },
    );
    expect(recoveryResult.ok, JSON.stringify(recoveryResult)).toBe(true);
    if (!recoveryResult.ok) throw new Error(recoveryResult.message);
    expect(recoveryResult.value).toMatchObject({
      state: 'completed',
      outcomes: [expect.objectContaining({
        state: 'failed',
        failureCode: 'SCHEDULER_NOT_SUCCEEDED',
        transitionId: pending.transitionId,
      })],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });
    expect(readHistory(restarted).transitions.find((item: any) => (
      item.transitionId === pending.transitionId
    ))).toMatchObject({ phase: 'failed', failureCode: 'SCHEDULER_NOT_SUCCEEDED' });
    const retriableContext = context('store-a', 'profile-a');
    expect(restarted.orchestrator.readProtectedSemanticAttempt({
      storeId: retriableContext.storeId,
      browserProfileId: retriableContext.browserProfileId,
      expectedFingerprint: fingerprint('store-a'),
    })).toBeNull();
    expect(restarted.inspectStoreSchedule).not.toHaveBeenCalled();
    expect(restarted.execute).not.toHaveBeenCalled();
    expect(restarted.releasePolicy).toHaveBeenCalledOnce();

    const retry = harness({
      stores: [store('store-a', 'profile-a')],
      history: interrupted.history,
      codec: interrupted.codec,
    });
    await expect(retry.orchestrator.runCycle()).resolves.toMatchObject({
      state: 'completed',
      outcomes: [expect.objectContaining({ state: 'succeeded' })],
      attemptedStoreIds: ['store-a'],
    });
    expect(retry.execute).toHaveBeenCalledOnce();
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
});
