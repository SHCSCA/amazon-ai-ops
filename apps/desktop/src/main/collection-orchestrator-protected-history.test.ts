import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  STORE_COLLECTION_TRANSITION_PHASES,
  isStoreCollectionTransitionPhaseAllowed,
  storeCollectionTransitionPhaseFieldsValid,
  storeCollectionOrchestratorTransitionIntegrityDigest,
  type StoreCollectionOrchestratorTransitionPhase,
  type StoreCollectionOrchestratorTransitionPurpose,
} from './store-collection-orchestrator';
import {
  NOW,
  OWNER,
  MemoryHistory,
  AuthenticatedTestCodec,
  context,
  store,
  fingerprint,
  authority,
  harness,
  readHistory,
  matrixTransition,
} from "./collection-orchestrator.test-fixtures";

describe('StoreCollectionOrchestrator', () => {
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
});
