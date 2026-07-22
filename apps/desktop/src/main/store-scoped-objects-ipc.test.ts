import { describe, expect, it, vi } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  STORE_SCOPED_OBJECTS_IPC_CHANNELS,
  registerStoreScopedObjectsIpcHandlers,
} from './store-scoped-objects-ipc';

const context = {
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 3,
} as StoreContextEnvelope;

function harness() {
  const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
  const ipc = {
    handle: vi.fn((channel: string, listener: (event: unknown, input?: unknown) => unknown) => {
      handlers.set(channel, listener);
    }),
  };
  const service = {
    listProducts: vi.fn(() => ['products']),
    getProduct: vi.fn(() => ({ id: 1 })),
    createProduct: vi.fn(() => ({ id: 2 })),
    updateProduct: vi.fn(() => ({ id: 3 })),
    archiveProduct: vi.fn(() => ({ id: 4 })),
    listOperationEvents: vi.fn(() => ['events']),
    createOperationEvent: vi.fn(() => ({ id: 5 })),
    updateOperationEvent: vi.fn(() => ({ id: 6 })),
    deleteOperationEvent: vi.fn(() => ({ id: 7, deleted: true as const })),
  };
  const onObjectsChanged = vi.fn();
  registerStoreScopedObjectsIpcHandlers(
    ipc,
    service as unknown as Parameters<typeof registerStoreScopedObjectsIpcHandlers>[1],
    { onObjectsChanged },
  );
  return { handlers, ipc, service, onObjectsChanged };
}

describe('store-scoped objects IPC', () => {
  it('registers an explicit Main-only channel for every product and event CRUD action', () => {
    const { handlers, ipc } = harness();
    expect([...handlers.keys()]).toEqual(STORE_SCOPED_OBJECTS_IPC_CHANNELS);
    expect(ipc.handle).toHaveBeenCalledTimes(STORE_SCOPED_OBJECTS_IPC_CHANNELS.length);
  });

  it.each([
    ['store-objects:products:list', 'listProducts'],
    ['store-objects:products:get', 'getProduct'],
    ['store-objects:products:create', 'createProduct'],
    ['store-objects:products:update', 'updateProduct'],
    ['store-objects:products:archive', 'archiveProduct'],
    ['store-objects:operation-events:list', 'listOperationEvents'],
    ['store-objects:operation-events:create', 'createOperationEvent'],
    ['store-objects:operation-events:update', 'updateOperationEvent'],
    ['store-objects:operation-events:delete', 'deleteOperationEvent'],
  ] as const)('forwards full authority on %s', (channel, method) => {
    const { handlers, service } = harness();
    const input = { marker: channel };
    handlers.get(channel)?.({}, { storeContext: context, input });
    expect(service[method]).toHaveBeenCalledWith(context, input);
  });

  it('publishes changes only after successful mutations', () => {
    const { handlers, onObjectsChanged, service } = harness();
    handlers.get('store-objects:products:list')?.({}, { storeContext: context, input: {} });
    expect(onObjectsChanged).not.toHaveBeenCalled();

    handlers.get('store-objects:products:create')?.({}, { storeContext: context, input: { asin: 'B001' } });
    expect(onObjectsChanged).toHaveBeenCalledWith(context);

    service.updateProduct.mockImplementationOnce(() => { throw new Error('conflict'); });
    expect(() => handlers.get('store-objects:products:update')?.({}, {
      storeContext: context,
      input: { id: 1, expectedRevision: 'stale', patch: { title: 'x' } },
    })).toThrow('conflict');
    expect(onObjectsChanged).toHaveBeenCalledTimes(1);
  });

  it('applies the path-safe event projection at the final Main-to-Renderer boundary', () => {
    const { handlers, service } = harness();
    service.listOperationEvents.mockReturnValueOnce([{
      id: 18,
      eventDate: '2026-07-22',
      storeName: 'Same US Store',
      marketplaceCode: 'US',
      eventType: 'manual_note',
      title: '回读 C:\\Users\\operator\\proof.png 已确认',
      notes: '共享 \\\\fileserver\\ads\\proof.xlsx；结论保留。',
      details: '导出 file:///C:/Exports/result.csv；无需再次执行。',
      createdAt: '2026-07-22T01:00:00.000Z',
      updatedAt: '2026-07-22T01:00:00.000Z',
    }] as never);

    const result = handlers.get('store-objects:operation-events:list')?.({}, {
      storeContext: context,
      input: {},
    });
    expect(result).toEqual([
      expect.objectContaining({
        title: '回读 [本地文件] 已确认',
        notes: '共享 [本地文件]；结论保留。',
        details: '导出 [本地文件]；无需再次执行。',
      }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/C:\\Users|fileserver|file:\/\//i);
  });

  it('rejects requests that omit either StoreContext or the input object', () => {
    const { handlers } = harness();
    const list = handlers.get('store-objects:products:list');
    expect(() => list?.({}, { input: {} })).toThrow('storeContext must be an object');
    expect(() => list?.({}, { storeContext: context })).toThrow('input must be an object');
    expect(() => list?.({}, { storeContext: context, input: [] })).toThrow('input must be an object');
  });
});
