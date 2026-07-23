import { describe, expect, it, vi } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  STORE_COLLECTION_SCHEDULER_IPC_CHANNELS,
  registerStoreCollectionSchedulerIpcHandlers,
} from './store-collection-scheduler-ipc';

const storeContext = {
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-23',
  sessionGeneration: 4,
} as StoreContextEnvelope;

function harness() {
  const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
  const scheduler = {
    get: vi.fn(() => ({ storeId: storeContext.storeId, state: 'waiting' })),
    runNow: vi.fn(async () => ({ accepted: true, duplicate: false })),
  };
  registerStoreCollectionSchedulerIpcHandlers({
    handle(channel, listener) { handlers.set(channel, listener); },
  }, scheduler as never);
  return { handlers, scheduler };
}

describe('store collection scheduler IPC', () => {
  it('registers only the context-authorized get and run channels', () => {
    const test = harness();
    expect([...test.handlers.keys()]).toEqual([...STORE_COLLECTION_SCHEDULER_IPC_CHANNELS]);
  });

  it('passes the complete StoreContext to Main authority for both operations', async () => {
    const test = harness();
    const request = { storeContext };

    test.handlers.get('store-collection-scheduler:get')!(null, request);
    await test.handlers.get('store-collection-scheduler:run-now')!(null, request);

    expect(test.scheduler.get).toHaveBeenCalledWith(storeContext);
    expect(test.scheduler.runNow).toHaveBeenCalledWith(storeContext);
  });

  it('rejects missing context and renderer-supplied schedule or store overrides', () => {
    const test = harness();
    const get = test.handlers.get('store-collection-scheduler:get')!;

    expect(() => get(null, {})).toThrow(/storeContext must be an object/);
    expect(() => get(null, {
      storeContext,
      scheduleLocalTime: '00:00',
      storeId: 'store-two',
    })).toThrow(/unsupported fields/);
    expect(test.scheduler.get).not.toHaveBeenCalled();
  });
});
