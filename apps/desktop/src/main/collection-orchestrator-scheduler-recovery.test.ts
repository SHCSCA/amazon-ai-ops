import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  deriveStoreCollectionSchedulerExecutionIdentity,
  storeCollectionSchedulerRecoveryAdmissionScopeDigest,
  type StoreCollectionOrchestratorDependencies,
  type StoreCollectionSchedulerRecoveryAdmission,
} from './store-collection-orchestrator';
import {
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
});
