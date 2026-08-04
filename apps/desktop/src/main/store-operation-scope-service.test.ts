import { describe, expect, it } from 'vitest';
import type {
  BrowserProfileId,
  StoreContextEnvelope,
  StoreId,
  StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  operationScopeSettingKey,
  StoreOperationScopeService,
} from './store-operation-scope-service';

function context(storeId: StoreId, profileId: BrowserProfileId, generation: number): StoreContextEnvelope {
  return {
    storeId,
    browserProfileId: profileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22' as StoreContextEnvelope['businessDate'],
    sessionGeneration: generation,
  };
}

function store(storeId: StoreId, profileId: BrowserProfileId, displayName: string): StoreRecord {
  return {
    storeId,
    browserProfileId: profileId,
    displayName,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    status: 'active',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

function harness() {
  const firstStore = store('scope-store-a' as StoreId, 'scope-profile-a' as BrowserProfileId, 'SHC001-US');
  const secondStore = store('scope-store-b' as StoreId, 'scope-profile-b' as BrowserProfileId, 'SHC002-US');
  const firstContext = context(firstStore.storeId, firstStore.browserProfileId, 1);
  const secondContext = context(secondStore.storeId, secondStore.browserProfileId, 2);
  const stores = new Map<StoreId, StoreRecord>([[firstStore.storeId, firstStore], [secondStore.storeId, secondStore]]);
  const values = new Map<string, string>();
  let active = firstContext;
  const service = new StoreOperationScopeService({
    storeCoordinator: {
      assertActiveStoreContext(input) {
        if (JSON.stringify(input) !== JSON.stringify(active)) throw new Error('stale store context');
        return active;
      },
      getStore(storeId) {
        const value = stores.get(storeId as StoreId);
        if (!value) throw new Error('unknown store');
        return value;
      },
    },
    settings: {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => values.set(key, value),
    },
  });
  return {
    service,
    values,
    firstStore,
    secondStore,
    firstContext,
    secondContext,
    switchTo: (next: StoreContextEnvelope) => { active = next; },
  };
}

describe('StoreOperationScopeService', () => {
  it('persists independent US/USD ranges under immutable store ids', () => {
    const h = harness();
    const first = h.service.save(h.firstContext, {
      dateFrom: '2026-07-01',
      dateTo: '2026-07-22',
      storeName: 'SHC001-US',
      marketplaceCode: 'US',
      currency: 'USD',
      asin: 'b0gttjfqtm',
      batchId: 'batch-a',
    });
    h.switchTo(h.secondContext);
    const second = h.service.save(h.secondContext, {
      dateFrom: '2026-07-10',
      dateTo: '2026-07-20',
      storeName: 'SHC002-US',
      marketplaceCode: 'US',
      currency: 'USD',
      batchId: 'batch-b',
    });

    expect(first).toMatchObject({ storeName: 'SHC001-US', asin: 'B0GTTJFQTM', batchId: 'batch-a' });
    expect(second).toMatchObject({ storeName: 'SHC002-US', batchId: 'batch-b' });
    expect(h.values.has('operation_scope')).toBe(false);
    expect(h.values.has(operationScopeSettingKey(h.firstStore.storeId))).toBe(true);
    expect(h.values.has(operationScopeSettingKey(h.secondStore.storeId))).toBe(true);

    h.switchTo(h.firstContext);
    expect(h.service.get(h.firstContext)).toEqual(first);
    h.switchTo(h.secondContext);
    expect(h.service.get(h.secondContext)).toEqual(second);
  });

  it('rejects stale authority, forged store identity, unsupported currency, and invalid ASIN', () => {
    const h = harness();
    const base = {
      dateFrom: '2026-07-01',
      dateTo: '2026-07-22',
      storeName: 'SHC001-US',
      marketplaceCode: 'US',
      currency: 'USD',
    };
    h.switchTo(h.secondContext);
    expect(() => h.service.save(h.firstContext, base)).toThrow(/stale/i);
    h.switchTo(h.firstContext);
    expect(() => h.service.save(h.firstContext, { ...base, storeName: 'SHC002-US' })).toThrow(/StoreContext/);
    expect(() => h.service.save(h.firstContext, { ...base, currency: 'USDT' })).toThrow(/USD/);
    expect(() => h.service.save(h.firstContext, { ...base, asin: 'BAD' })).toThrow(/ASIN/);
    expect(h.values.size).toBe(0);
  });

  it('fails closed on corrupted persisted data without borrowing another store scope', () => {
    const h = harness();
    h.values.set(operationScopeSettingKey(h.firstStore.storeId), JSON.stringify({ storeName: 'SHC002-US' }));
    expect(h.service.get(h.firstContext)).toBeNull();
    h.switchTo(h.secondContext);
    expect(h.service.get(h.secondContext)).toBeNull();
  });
});
