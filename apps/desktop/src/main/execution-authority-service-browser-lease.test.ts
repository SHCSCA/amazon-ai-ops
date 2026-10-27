import { describe, expect, it } from 'vitest';
import { createHarness, deferred } from './execution-authority-service.test-harness';
describe("ExecutionAuthorityService safety orchestration", () => {
it('holds an exact external-write lease through visible browser takeover', async () => {
    const harness = createHarness();
    const started = deferred();
    const release = deferred();
    harness.setBringToFrontWork(async () => {
      started.resolve();
      await release.promise;
    });

    const takeover = harness.service.takeOverVisibleBrowser({
      context: harness.context,
      batchId: harness.batchId,
    });
    await started.promise;

    expect(harness.leases.current(harness.context.storeId)).toMatchObject({
      purpose: 'external_write',
      owner: `takeover:${harness.batchId}`,
    });
    expect(() => harness.leases.enterTransitionBarrier('store-switch'))
      .toThrowError(expect.objectContaining({ code: 'LEASES_ACTIVE' }));

    release.resolve();
    await expect(takeover).resolves.toEqual({ status: 'VISIBLE', batchId: harness.batchId });
    expect(harness.leases.current(harness.context.storeId)).toBeUndefined();
  });

it('cannot start browser takeover while a user transition barrier is held', async () => {
    const harness = createHarness();
    harness.leases.enterTransitionBarrier('store-switch');

    await expect(harness.service.takeOverVisibleBrowser({
      context: harness.context,
      batchId: harness.batchId,
    })).rejects.toMatchObject({ code: 'TRANSITION_BARRIER_HELD' });
    expect(harness.runtimeResolutionCount()).toBe(0);
  });
});
