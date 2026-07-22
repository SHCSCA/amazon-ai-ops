import { describe, expect, it, vi } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  assertExecutionProjectionBelongsToContext,
  createPreviewExecutionAuthorityApi,
  readExecutionAuthorityWindowApi,
} from './execution-authority-window-api';

const context = {
  storeId: 'preview-store-shc001',
  browserProfileId: 'preview-profile-shc001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-23',
  sessionGeneration: 7,
} as StoreContextEnvelope;

describe('execution authority window adapter', () => {
  it('accepts only the complete closed preload surface', () => {
    expect(readExecutionAuthorityWindowApi({ electronAPI: {} })).toBeNull();
    expect(readExecutionAuthorityWindowApi({
      electronAPI: { executionAuthority: { listBatches: async () => [] } },
    })).toBeNull();
    const api = createPreviewExecutionAuthorityApi();
    expect(readExecutionAuthorityWindowApi({ electronAPI: { executionAuthority: api } })).toBe(api);
  });

  it('requires current-page identity resolution before creating a grant-bound batch', async () => {
    const api = createPreviewExecutionAuthorityApi();
    await expect(api.createBatch({ context, grantId: 'preview-grant-human' }))
      .rejects.toThrow(/先解析当前 Ads 页身份/);

    const identity = await api.resolveIdentity({
      context,
      grantId: 'preview-grant-human',
      adEntityId: 'preview-ad-entity-keyword-1',
    });
    expect(identity).toMatchObject({
      storeId: context.storeId,
      marketplace: 'US',
      currency: 'USD',
      resolvedSessionGeneration: context.sessionGeneration,
    });

    const result = await api.createBatch({ context, grantId: 'preview-grant-human' });
    expect(result.created).toBe(true);
    expect(result.projection.jobs[0]).toMatchObject({
      expectedBidCents: 120,
      targetBidCents: 108,
      changePct: -10,
    });
    expect(() => assertExecutionProjectionBelongsToContext(context, result.projection)).not.toThrow();
  });

  it('demonstrates serial before/after/reload evidence without calling a real API', async () => {
    const api = createPreviewExecutionAuthorityApi();
    const progress = vi.fn();
    const unsubscribe = api.onProgress(progress);
    await api.resolveIdentity({ context, grantId: 'preview-grant-policy', adEntityId: 'preview-ad-entity-keyword-1' });
    const created = await api.createBatch({ context, grantId: 'preview-grant-policy' });
    const completed = await api.startBatch({ context, batchId: created.projection.batch.id });
    unsubscribe();

    expect(completed.batch.status).toBe('succeeded');
    expect(completed.jobs[0].evidence.map((item) => item.slot)).toEqual(['before', 'after', 'reload']);
    expect(completed.jobs[0].submitIntentId).toContain('preview-intent');
    expect(progress.mock.calls.flatMap((call) => call).map((event) => event.phase))
      .toEqual(expect.arrayContaining(['identity', 'queue', 'preflight', 'submit', 'readback', 'terminal']));
  });

  it('makes UNKNOWN terminal and rejects automatic retry', async () => {
    const api = createPreviewExecutionAuthorityApi();
    const grantId = 'preview-grant-unknown-human';
    await api.resolveIdentity({ context, grantId, adEntityId: 'preview-ad-entity-keyword-1' });
    const created = await api.createBatch({ context, grantId });
    const unknown = await api.startBatch({ context, batchId: created.projection.batch.id });
    expect(unknown.batch.status).toBe('unknown');
    await expect(api.startBatch({ context, batchId: unknown.batch.id }))
      .rejects.toThrow(/禁止自动重试/);
  });

  it('rejects foreign store, raises and changes over ten percent', async () => {
    const api = createPreviewExecutionAuthorityApi();
    await api.resolveIdentity({ context, grantId: 'preview-grant-human', adEntityId: 'preview-ad-entity-keyword-1' });
    const { projection } = await api.createBatch({ context, grantId: 'preview-grant-human' });

    expect(() => assertExecutionProjectionBelongsToContext({
      ...context,
      storeId: 'preview-store-shc002',
    } as StoreContextEnvelope, projection)).toThrow(/跨店铺/);
    expect(() => assertExecutionProjectionBelongsToContext(context, {
      ...projection,
      jobs: projection.jobs.map((job) => ({ ...job, expectedBidCents: 100, targetBidCents: 111, changePct: 11 })),
    })).toThrow(/越权提价|10%/);
  });
});
