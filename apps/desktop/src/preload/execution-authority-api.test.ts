import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createExecutionAuthorityPreloadApi } from './execution-authority-api';

const context = normalizeStoreContextEnvelope({
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-23',
  sessionGeneration: 4,
});

describe('execution authority preload API', () => {
  it('is frozen and never accepts bid, Ads ids, channel names or paths', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const on = vi.fn();
    const removeListener = vi.fn();
    const api = createExecutionAuthorityPreloadApi({ invoke, on, removeListener });
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.keys(api)).toEqual([
      'listBatches',
      'discoverRecommendationTarget',
      'resolveIdentity',
      'createBatch',
      'startBatch',
      'cancelBatch',
      'takeOverVisibleBrowser',
      'onProgress',
    ]);
    await api.discoverRecommendationTarget({ context, recommendationId: 81 });
    expect(invoke).toHaveBeenLastCalledWith(
      'execution-authority:discover-recommendation-target',
      { context, recommendationId: 81 },
    );
    await api.createBatch({ context, grantId: 'grant-1' });
    expect(invoke).toHaveBeenLastCalledWith(
      'execution-authority:create-batch',
      { context, grantId: 'grant-1' },
    );
    await api.startBatch({ context, batchId: 'batch-1' });
    expect(invoke).toHaveBeenLastCalledWith(
      'execution-authority:start-batch',
      { context, batchId: 'batch-1' },
    );
  });

  it('subscribes and removes the exact progress listener', () => {
    const invoke = vi.fn(async () => ({}));
    const on = vi.fn();
    const removeListener = vi.fn();
    const callback = vi.fn();
    const api = createExecutionAuthorityPreloadApi({ invoke, on, removeListener });
    const unsubscribe = api.onProgress(callback);
    const handler = on.mock.calls[0][1];
    handler({}, {
      storeId: context.storeId,
      batchId: 'batch-1',
      phase: 'queue',
      status: 'queued',
      message: 'queued',
      occurredAt: '2026-07-23T00:00:00.000Z',
    });
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'batch-1' }));
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith('execution-authority:progress', handler);
  });
});
