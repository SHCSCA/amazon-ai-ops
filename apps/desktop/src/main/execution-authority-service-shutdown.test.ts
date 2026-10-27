import  {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { StoreCollectionPolicySuppressionController } from './store-collection-policy-suppression';
import { createHarness, deferred, FakePolicyDispatchTimer } from './execution-authority-service.test-harness';
describe("ExecutionAuthorityService safety orchestration", () => {
it('drains an admitted visible-browser takeover and rejects later browser admission', async () => {
    const harness = createHarness();
    const started = deferred();
    const release = deferred();
    harness.setBringToFrontWork(async () => {
      started.resolve();
      await release.promise;
    });
    const events: string[] = [];

    const takeover = harness.service.takeOverVisibleBrowser({
      context: harness.context,
      batchId: harness.batchId,
    }).then((result) => {
      events.push('takeover-settled');
      return result;
    });
    await started.promise;
    const shutdown = harness.service.prepareForShutdown(1_000).then(() => {
      events.push('shutdown-settled');
    });

    await expect(harness.service.takeOverVisibleBrowser({
      context: harness.context,
      batchId: harness.batchId,
    })).rejects.toThrow('应用正在退出，禁止启动新的外部写入。');
    await Promise.resolve();
    expect(events).toEqual([]);

    release.resolve();
    await takeover;
    await shutdown;
    expect(events).toEqual(['takeover-settled', 'shutdown-settled']);
  });

it('drains identity resolution admitted before shutdown', async () => {
    const harness = createHarness(1, { registerIdentity: false, createBatch: false });
    const started = deferred();
    const release = deferred();
    harness.setBringToFrontWork(async () => {
      started.resolve();
      await release.promise;
    });
    const events: string[] = [];

    const resolving = harness.service.resolveIdentity({
      context: harness.context,
      grantId: 'grant-1',
      adEntityId: 'opaque-keyword-1',
    }).then((identity) => {
      events.push('identity-settled');
      return identity;
    });
    await started.promise;
    const shutdown = harness.service.prepareForShutdown(1_000).then(() => {
      events.push('shutdown-settled');
    });
    await Promise.resolve();
    expect(events).toEqual([]);

    release.resolve();
    await expect(resolving).resolves.toMatchObject({ adEntityId: 'opaque-keyword-1' });
    await shutdown;
    expect(events).toEqual(['identity-settled', 'shutdown-settled']);
  });

it('drains admitted legacy browser work and keeps admission closed after a timeout retry', async () => {
    const harness = createHarness();
    const started = deferred();
    const release = deferred();
    const legacy = harness.service.withAdmittedBrowserOperation(
      'legacy:collect-ad-report',
      async () => {
        started.resolve();
        await release.promise;
        return 'done';
      },
    );
    await started.promise;

    await expect(harness.service.prepareForShutdown(10)).rejects.toMatchObject({
      name: 'ExecutionAuthorityShutdownError',
      code: 'DRAIN_TIMEOUT',
    });
    await expect(harness.service.withAdmittedBrowserOperation(
      'legacy:late-work',
      async () => 'not-run',
    )).rejects.toThrow('应用正在退出，禁止启动新的外部写入。');

    release.resolve();
    await expect(legacy).resolves.toBe('done');
    await expect(harness.service.prepareForShutdown(100)).resolves.toBeUndefined();
  });

it('does not own or release the collection suppression guard during shutdown', async () => {
    const controller = new StoreCollectionPolicySuppressionController();
    const recoveryCapability = controller.issueStartupRecoveryConfirmationCapability();
    const lease = await controller.acquirePolicyDispatchSuppression({
      owner: 'collection-owner',
      capability: Object.freeze({}) as never,
    });
    const harness = createHarness(1, {
      policyDispatchSuppression: controller,
    });

    await harness.service.prepareForShutdown(10);

    expect(controller.inspectPolicyDispatchSuppression()).toMatchObject({
      state: 'startup_unknown',
      suppressed: true,
      activeGuardCount: 1,
    });
    await lease.release();
    expect(controller.isPolicyDispatchSuppressed()).toBe(true);
    expect(controller.confirmStartupRecoverySafe(recoveryCapability)).toMatchObject({
      capability: recoveryCapability,
      startupRecoverySafe: true,
    });
    expect(controller.isPolicyDispatchSuppressed()).toBe(false);
  });

it('rejects shutdown with DRAIN_TIMEOUT while an admitted execution still owns the save boundary', async () => {
    const harness = createHarness();
    const running = harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });
    await harness.page.afterScreenshotStarted;

    const shutdown = harness.service.prepareForShutdown(10);
    try {
      await expect(shutdown).rejects.toMatchObject({
        name: 'ExecutionAuthorityShutdownError',
        code: 'DRAIN_TIMEOUT',
      });
      expect(harness.executionRepository.getExecutionBatch(harness.context, harness.batchId))
        .toEqual(expect.objectContaining({
          batch: expect.objectContaining({ status: 'unknown' }),
          jobs: [expect.objectContaining({ status: 'unknown' })],
        }));
    } finally {
      harness.page.allowAfterScreenshot();
      await running.catch(() => undefined);
    }
  });

it('waits for the exact admitted execution to settle before reporting a successful drain', async () => {
    const harness = createHarness();
    const running = harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });
    await harness.page.afterScreenshotStarted;

    let shutdownSettled = false;
    const shutdown = harness.service.prepareForShutdown(1_000);
    void shutdown.then(
      () => { shutdownSettled = true; },
      () => { shutdownSettled = true; },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    harness.page.allowAfterScreenshot();
    await running;
    await expect(shutdown).resolves.toBeUndefined();
    expect(shutdownSettled).toBe(true);
  });

it('removes a rejected policy dispatch lane before reporting the shutdown drain complete', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;
    const appendDispatchEvent = harness.executionRepository.appendPolicyGrantDispatchEvent
      .bind(harness.executionRepository);
    let rejectSettledLaneWrite = false;
    const appendSpy = vi.spyOn(harness.executionRepository, 'appendPolicyGrantDispatchEvent')
      .mockImplementation((context, input) => {
        if (rejectSettledLaneWrite) throw new Error('injected settled policy lane rejection');
        return appendDispatchEvent(context, input);
      });

    harness.page.pauseBeforePermit = true;
    const dispatching = harness.service.enqueuePolicyGrant(harness.context, grant);
    await harness.page.prepareSaveReady;
    const shutdown = harness.service.prepareForShutdown(1_000);
    rejectSettledLaneWrite = true;
    harness.page.allowPermitCheck();

    await expect(dispatching).rejects.toThrow('injected settled policy lane rejection');
    appendSpy.mockRestore();
    await expect(shutdown).resolves.toBeUndefined();
    expect(() => harness.service.assertStoreMutationAllowed(harness.context)).not.toThrow();
  });

it('keeps external-write admission closed across repeated successful shutdown calls', async () => {
    const harness = createHarness();

    await expect(harness.service.prepareForShutdown(10)).resolves.toBeUndefined();
    await expect(harness.service.prepareForShutdown(10)).resolves.toBeUndefined();

    expect(() => harness.service.createBatch({
      context: harness.context,
      grantId: 'grant-1',
    })).toThrow('应用正在退出，禁止启动新的外部写入。');
    await expect(harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    })).rejects.toThrow('应用正在退出，禁止启动新的外部写入。');
  });

it('clears policy retry timers on shutdown and ignores a late callback', async () => {
    const timer = new FakePolicyDispatchTimer();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      runtimeReady: false,
      policyDispatchRetryMs: 1_000,
      policyDispatchTimer: timer.timer,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;
    await harness.service.enqueuePolicyGrant(harness.context, grant);
    const before = harness.database.prepare(`
      SELECT COUNT(*) AS count FROM causal_events
      WHERE store_id = 'store-one' AND entity_type = 'policy_grant_dispatch_v1'
    `).get() as { count: number };
    expect(timer.activeCount()).toBe(1);

    await harness.service.prepareForShutdown(10);
    expect(timer.activeCount()).toBe(0);
    expect(timer.cleared).toHaveLength(1);

    timer.forceRunLatest();
    await Promise.resolve();
    expect(harness.page.clickCount).toBe(0);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one'
    `).get()).toEqual({ count: 0 });
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM causal_events
      WHERE store_id = 'store-one' AND entity_type = 'policy_grant_dispatch_v1'
    `).get()).toEqual(before);
  });
});
