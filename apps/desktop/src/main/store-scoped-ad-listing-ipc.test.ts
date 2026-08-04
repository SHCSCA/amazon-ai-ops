import { describe, expect, it, vi } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  STORE_SCOPED_AD_LISTING_IPC_CHANNELS,
  registerStoreScopedAdListingIpcHandlers,
} from './store-scoped-ad-listing-ipc';

const context = {
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 5,
} as StoreContextEnvelope;

function harness() {
  const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
  const ipc = {
    handle: vi.fn((channel: string, listener: (event: unknown, input?: unknown) => unknown) => {
      handlers.set(channel, listener);
    }),
  };
  const service = {
    listAdObjects: vi.fn(() => ['ads']),
    listKeywordFacts: vi.fn(() => ['keywords']),
    listListingContent: vi.fn(() => ['listing']),
    getListingContent: vi.fn(() => ({ id: 1 })),
    createListingContent: vi.fn(() => ({ id: 2 })),
    updateListingContent: vi.fn(() => ({ id: 3 })),
    deleteListingContent: vi.fn(() => ({ id: 4, deleted: true as const })),
    listListingVersions: vi.fn(() => ['versions']),
  };
  const onListingChanged = vi.fn();
  registerStoreScopedAdListingIpcHandlers(
    ipc,
    service as unknown as Parameters<typeof registerStoreScopedAdListingIpcHandlers>[1],
    { onListingChanged },
  );
  return { handlers, ipc, service, onListingChanged };
}

describe('store-scoped ad/listing IPC', () => {
  it('registers only the explicit store-authorized allowlist', () => {
    const { handlers, ipc } = harness();
    expect([...handlers.keys()]).toEqual(STORE_SCOPED_AD_LISTING_IPC_CHANNELS);
    expect(ipc.handle).toHaveBeenCalledTimes(STORE_SCOPED_AD_LISTING_IPC_CHANNELS.length);
  });

  it.each([
    ['store-ad-listing:ad-objects:list', 'listAdObjects'],
    ['store-ad-listing:keyword-facts:list', 'listKeywordFacts'],
    ['store-ad-listing:listing:list', 'listListingContent'],
    ['store-ad-listing:listing:get', 'getListingContent'],
    ['store-ad-listing:listing:create', 'createListingContent'],
    ['store-ad-listing:listing:update', 'updateListingContent'],
    ['store-ad-listing:listing:delete', 'deleteListingContent'],
    ['store-ad-listing:listing-versions:list', 'listListingVersions'],
  ] as const)('forwards full StoreContext on %s', (channel, method) => {
    const { handlers, service } = harness();
    const input = { marker: channel };
    handlers.get(channel)?.({}, { storeContext: context, input });
    expect(service[method]).toHaveBeenCalledWith(context, input);
  });

  it('publishes data-updated only after successful Listing mutations', () => {
    const { handlers, onListingChanged, service } = harness();
    handlers.get('store-ad-listing:ad-objects:list')?.({}, { storeContext: context, input: {} });
    handlers.get('store-ad-listing:listing:list')?.({}, { storeContext: context, input: {} });
    expect(onListingChanged).not.toHaveBeenCalled();

    handlers.get('store-ad-listing:listing:create')?.({}, {
      storeContext: context,
      input: { asin: 'B0001' },
    });
    expect(onListingChanged).toHaveBeenCalledWith(context);

    service.updateListingContent.mockImplementationOnce(() => { throw new Error('conflict'); });
    expect(() => handlers.get('store-ad-listing:listing:update')?.({}, {
      storeContext: context,
      input: { id: 1, expectedRevision: 'stale', patch: { title: 'x' } },
    })).toThrow('conflict');
    expect(onListingChanged).toHaveBeenCalledTimes(1);
  });

  it('rejects requests missing the complete envelope or input object', () => {
    const { handlers } = harness();
    const list = handlers.get('store-ad-listing:keyword-facts:list');
    expect(() => list?.({}, { input: {} })).toThrow('storeContext must be an object');
    expect(() => list?.({}, { storeContext: context })).toThrow('input must be an object');
    expect(() => list?.({}, { storeContext: context, input: [] })).toThrow('input must be an object');
  });
});
