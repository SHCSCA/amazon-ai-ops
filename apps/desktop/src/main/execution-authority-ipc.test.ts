import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  EXECUTION_AUTHORITY_IPC_CHANNELS,
  registerExecutionAuthorityIpcHandlers,
} from './execution-authority-ipc';

const context = normalizeStoreContextEnvelope({
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-23',
  sessionGeneration: 4,
});

describe('execution authority fixed IPC surface', () => {
  it('registers only closed grant, batch and takeover routes', async () => {
    const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
    const service = {
      listBatches: vi.fn(() => []),
      resolveIdentity: vi.fn(async () => ({ identityVersionId: 'identity-1' })),
      createBatch: vi.fn(() => ({ created: true, projection: { batch: {}, jobs: [] } })),
      startBatch: vi.fn(async () => ({ batch: {}, jobs: [] })),
      cancelBatch: vi.fn(() => ({ batch: {}, jobs: [] })),
      reconcileUnknownBatch: vi.fn(async () => ({ status: 'CONFIRMED_ORIGINAL', batchId: 'batch-1' })),
      takeOverVisibleBrowser: vi.fn(async () => ({ status: 'VISIBLE', batchId: 'batch-1' })),
    };
    registerExecutionAuthorityIpcHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      service as never,
    );
    expect([...handlers.keys()]).toEqual(EXECUTION_AUTHORITY_IPC_CHANNELS);

    await handlers.get('execution-authority:resolve-identity')?.({}, {
      context, grantId: 'grant-1', adEntityId: 'keyword-1',
    });
    expect(service.resolveIdentity).toHaveBeenCalledWith({
      context, grantId: 'grant-1', adEntityId: 'keyword-1',
    });
    await handlers.get('execution-authority:start-batch')?.({}, { context, batchId: 'batch-1' });
    expect(service.startBatch).toHaveBeenCalledWith({ context, batchId: 'batch-1' });
    await handlers.get('execution-authority:reconcile-unknown')?.({}, { context, batchId: 'batch-1' });
    expect(service.reconcileUnknownBatch).toHaveBeenCalledWith({ context, batchId: 'batch-1' });
  });

  it('rejects Renderer bid, stable-id and path injection and path-bearing results', async () => {
    const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
    registerExecutionAuthorityIpcHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        listBatches: vi.fn(() => [{ screenshotPath: 'D:\\secret.png' }]),
        resolveIdentity: vi.fn(),
        createBatch: vi.fn(),
        startBatch: vi.fn(),
        cancelBatch: vi.fn(),
        reconcileUnknownBatch: vi.fn(),
        takeOverVisibleBrowser: vi.fn(),
      } as never,
    );
    expect(() => handlers.get('execution-authority:create-batch')?.({}, {
      context,
      grantId: 'grant-1',
      targetBidCents: 55,
      keywordId: 'forged',
    })).toThrow(/unsupported field/);
    await expect(Promise.resolve(handlers.get('execution-authority:start-batch')?.({}, {
      context,
      batchId: 'batch-1',
      evidencePath: 'D:\\forged.png',
    }))).rejects.toThrow(/unsupported field/);
    expect(() => handlers.get('execution-authority:list-batches')?.({}, { context }))
      .toThrow(/禁止字段|绝对路径/);
  });
});
