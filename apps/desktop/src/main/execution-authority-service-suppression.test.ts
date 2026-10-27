import  {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { StoreCollectionPolicySuppressionController } from './store-collection-policy-suppression';
import { seedSecondSameStorePolicyGrant, registerSecondIdentity } from './execution-authority-service.test-authority';
import  {
  NOW,
  MutablePolicyDispatchSuppression,
  createHarness,
  FakePolicyDispatchTimer,
} from './execution-authority-service.test-harness';
describe("ExecutionAuthorityService safety orchestration", () => {
it('keeps a suppressed policy grant durably pending with zero runtime, identity, or batch side effects', async () => {
    const suppression = new MutablePolicyDispatchSuppression(true);
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      policyDispatchSuppression: suppression,
    });
    const createBatch = vi.spyOn(harness.executionRepository, 'createExactExecutionBatch');
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(() => harness.service.recoverStartup()).not.toThrow();
    await Promise.resolve();

    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'pending',
      attemptCount: 0,
      code: 'DISPATCH_PENDING',
      batchJobCount: 0,
    });
    expect(harness.runtimeResolutionCount()).toBe(0);
    expect(createBatch).not.toHaveBeenCalled();
    expect(harness.executionRepository.listCanonicalKeywordIdentities(harness.context)).toEqual([]);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 0 });
    expect(harness.page.clickCount).toBe(0);

    suppression.setSuppressed(false);
    await Promise.resolve();
    expect(harness.runtimeResolutionCount()).toBe(0);
    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0])
      .toMatchObject({ status: 'completed', attemptCount: 1 });
    expect(harness.page.clickCount).toBe(1);
  });

it('keeps startup_unknown recovery, resume, and due retry side-effect free until explicit confirmation and resume', async () => {
    const timer = new FakePolicyDispatchTimer();
    const controller = new StoreCollectionPolicySuppressionController();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      policyDispatchTimer: timer.timer,
      policyDispatchSuppression: controller,
    });
    const createBatch = vi.spyOn(harness.executionRepository, 'createExactExecutionBatch');
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);
    harness.executionRepository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: grant.id,
      status: 'attempting',
      trigger: 'grant_issued',
      attempt: 1,
      code: 'DISPATCH_ATTEMPT_STARTED',
      detail: 'Seed a pre-startup retry without browser work.',
    });
    harness.executionRepository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: grant.id,
      status: 'waiting_runtime',
      trigger: 'timer_retry',
      attempt: 1,
      code: 'RUNTIME_UNAVAILABLE',
      detail: 'Seed a due startup retry.',
      nextRetryAt: NOW,
    });

    expect(() => harness.service.recoverStartup()).not.toThrow();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    await Promise.resolve();

    expect(controller.inspectPolicyDispatchSuppression()).toMatchObject({
      state: 'startup_unknown',
      suppressed: true,
    });
    expect(timer.activeCount()).toBe(0);
    expect(harness.runtimeResolutionCount()).toBe(0);
    expect(createBatch).not.toHaveBeenCalled();
    expect(harness.executionRepository.listCanonicalKeywordIdentities(harness.context)).toEqual([]);
    expect(harness.page.clickCount).toBe(0);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 0 });

    const recoveryCapability = controller.issueStartupRecoveryConfirmationCapability();
    expect(controller.confirmStartupRecoverySafe(recoveryCapability)).toEqual({
      capability: recoveryCapability,
      startupRecoverySafe: true,
    });
    await Promise.resolve();
    expect(harness.runtimeResolutionCount()).toBe(0);
    expect(createBatch).not.toHaveBeenCalled();
    expect(harness.page.clickCount).toBe(0);

    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0])
      .toMatchObject({ status: 'completed', attemptCount: 2 });
    expect(harness.page.clickCount).toBe(1);
  });

it('fails closed when suppression readback throws and leaves policy dispatch pending', async () => {
    const suppression = new MutablePolicyDispatchSuppression();
    suppression.readError = new Error('suppression authority unavailable');
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      policyDispatchSuppression: suppression,
      logger,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0])
      .toMatchObject({ status: 'pending', attemptCount: 0 });
    expect(harness.runtimeResolutionCount()).toBe(0);
    expect(harness.page.clickCount).toBe(0);
    expect(logger.error).toHaveBeenCalledWith('execution.policy_suppression_read_failed', {
      error: suppression.readError,
    });
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0].nextRetryAt).toBeUndefined();
  });

it('holds an attempt that becomes suppressed immediately after its durable attempt event', async () => {
    const timer = new FakePolicyDispatchTimer();
    const suppression = new MutablePolicyDispatchSuppression();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      policyDispatchTimer: timer.timer,
      policyDispatchSuppression: suppression,
    });
    const append = harness.executionRepository.appendPolicyGrantDispatchEvent
      .bind(harness.executionRepository);
    let suppressionInjected = false;
    vi.spyOn(harness.executionRepository, 'appendPolicyGrantDispatchEvent')
      .mockImplementation((context, input) => {
        const result = append(context, input);
        if (input.status === 'attempting' && !suppressionInjected) {
          suppressionInjected = true;
          suppression.setSuppressed(true);
        }
        return result;
      });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    const held = harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]!;
    expect(held).toMatchObject({
      status: 'waiting_runtime',
      attemptCount: 1,
      code: 'RUNTIME_UNAVAILABLE',
      batchJobCount: 0,
    });
    expect(held).not.toHaveProperty('nextRetryAt');
    expect(harness.runtimeResolutionCount()).toBe(0);
    expect(timer.activeCount()).toBe(0);
    expect(harness.page.clickCount).toBe(0);

    suppression.setSuppressed(false);
    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0])
      .toMatchObject({ status: 'completed', attemptCount: 2 });
  });

it('drops a due retry while suppressed and requires explicit resume after release', async () => {
    const timer = new FakePolicyDispatchTimer();
    const suppression = new MutablePolicyDispatchSuppression();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      runtimeReady: false,
      policyDispatchRetryMs: 1_000,
      policyDispatchTimer: timer.timer,
      policyDispatchSuppression: suppression,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;
    await harness.service.enqueuePolicyGrant(harness.context, grant);
    expect(timer.activeCount()).toBe(1);
    expect(harness.runtimeResolutionCount()).toBe(1);

    suppression.setSuppressed(true);
    harness.setRuntimeReady(true);
    timer.runLatest();
    await Promise.resolve();
    expect(timer.activeCount()).toBe(0);
    expect(harness.runtimeResolutionCount()).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0])
      .toMatchObject({ status: 'waiting_runtime', attemptCount: 1 });

    suppression.setSuppressed(false);
    harness.page.allowAfterScreenshot();
    await Promise.resolve();
    expect(harness.runtimeResolutionCount()).toBe(1);
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0])
      .toMatchObject({ status: 'completed', attemptCount: 2 });
    expect(harness.page.clickCount).toBe(1);
  });

it('finishes an in-flight dispatch but suppression prevents the next durable lane item', async () => {
    const suppression = new MutablePolicyDispatchSuppression();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      policyDispatchSuppression: suppression,
    });
    seedSecondSameStorePolicyGrant(harness.database);
    registerSecondIdentity(harness);
    const firstGrant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;
    const secondGrant = harness.missionRepository.getMissionGrant(harness.context, 'grant-2')!;

    const first = harness.service.enqueuePolicyGrant(harness.context, firstGrant);
    await harness.page.afterScreenshotStarted;
    const second = harness.service.enqueuePolicyGrant(harness.context, secondGrant);
    suppression.setSuppressed(true);
    harness.page.allowAfterScreenshot();
    await Promise.all([first, second]);

    expect(harness.page.clickCount).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ grantId: 'grant-1', status: 'completed' }),
        expect.objectContaining({ grantId: 'grant-2', status: 'pending', attemptCount: 0 }),
      ]));
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-2'
    `).get()).toEqual({ count: 0 });

    suppression.setSuppressed(false);
    await Promise.resolve();
    expect(harness.page.clickCount).toBe(1);
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(harness.page.clickCount).toBe(2);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ grantId: 'grant-2', status: 'completed' }),
      ]));
  });
});
