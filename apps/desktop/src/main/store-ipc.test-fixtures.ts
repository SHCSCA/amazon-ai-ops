import { vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { type StoreCoordinator } from './store-coordinator';

export const activeContext = normalizeStoreContextEnvelope({
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-23',
  sessionGeneration: 4,
});

export function createCoordinator(): StoreCoordinator {
  return {
    listStores: vi.fn(() => []),
    getStore: vi.fn((storeId) => ({ storeId, status: 'active', marketplace: 'US' })),
    getConnection: vi.fn((storeId, id) => ({ id, storeId, provider: 'amazon_ads' })),
    createStore: vi.fn(),
    updateStore: vi.fn(),
    archiveStore: vi.fn(),
    restoreStore: vi.fn(),
    createConnection: vi.fn(() => ({ storeId: 'store-one' })),
    updateConnection: vi.fn(() => ({ storeId: 'store-one' })),
    removeConnection: vi.fn(),
    switchStore: vi.fn(() => ({ store: { storeId: 'store-two' }, context: activeContext })),
    reconnectStore: vi.fn(() => ({ store: { storeId: 'store-one' }, context: activeContext })),
    getActiveStoreContext: vi.fn(() => activeContext),
    getActiveStoreWorkspaceView: vi.fn(() => null),
    getOperatorWorkspaceSelection: vi.fn(() => null),
  } as unknown as StoreCoordinator;
}
