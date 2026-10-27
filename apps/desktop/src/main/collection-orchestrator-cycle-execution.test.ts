import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  deriveStoreCollectionSchedulerExecutionIdentity,
  type StoreCollectionOrchestratorSchedulerProjection,
} from './store-collection-orchestrator';
import {
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
});
