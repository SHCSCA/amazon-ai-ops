import { describe, expect, it } from 'vitest';
import type { StoreContextEnvelope, StoreId } from '@amazon-ai-ops/shared-types';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { BrowserLeaseManager, SessionGenerationRegistry } from './browser-lease';

function storeContext(
  storeId: StoreId,
  sessionGeneration: number,
): StoreContextEnvelope {
  return normalizeStoreContextEnvelope({
    storeId,
    browserProfileId: `profile-${storeId}`,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration,
  });
}

describe('BrowserLeaseManager', () => {
  it('allows only one browser holder per store and isolates different stores', () => {
    let now = 1_000;
    let token = 0;
    const manager = new BrowserLeaseManager(
      () => now,
      () => `lease-token-${String(++token).padStart(4, '0')}`,
      5_000,
    );
    const first = manager.acquire({ storeId: 'store-one' as StoreId, owner: 'mission-1', purpose: 'external_write' });
    expect(() => manager.acquire({ storeId: 'store-one' as StoreId, owner: 'collector', purpose: 'collection' })).toThrow(/active/);
    expect(manager.acquire({ storeId: 'store-two' as StoreId, owner: 'collector', purpose: 'collection' }).storeId).toBe('store-two');

    manager.release(first);
    const next = manager.acquire({ storeId: 'store-one' as StoreId, owner: 'collector', purpose: 'collection' });
    expect(next.generation).toBeGreaterThan(first.generation);
    expect(() => manager.release(first)).toThrow(/stale|not found/);
    now += 5_001;
    expect(() => manager.renew(next)).toThrow(/expired/);
  });

  it('uses expiry as a CAS revision so a pre-renewal snapshot cannot renew or release', () => {
    let now = 10_000;
    const manager = new BrowserLeaseManager(
      () => now,
      () => 'lease-token-0001',
      5_000,
    );
    const original = manager.acquire({
      storeId: 'store-one' as StoreId,
      owner: 'mission-1',
      purpose: 'external_write',
    });
    now += 500;
    const renewed = manager.renew(original);

    expect(renewed.expiresAt).not.toBe(original.expiresAt);
    expect(() => manager.renew(original)).toThrow(/stale/);
    expect(() => manager.release(original)).toThrow(/stale/);
    expect(() => manager.release(renewed)).not.toThrow();
  });
});

describe('SessionGenerationRegistry', () => {
  it('invalidates old store contexts after advance without affecting another store', () => {
    const registry = new SessionGenerationRegistry();
    const first = 'store-one' as StoreId;
    const second = 'store-two' as StoreId;
    const generation = registry.advance(first);
    registry.assertCurrent(storeContext(first, generation));
    registry.advance(first);
    expect(() => registry.assertCurrent(storeContext(first, generation))).toThrow(/stale/);
    expect(registry.current(second)).toBe(0);
    expect(() => registry.assertCurrent(storeContext(second, 0))).toThrow(/not registered/);
  });

  it('increments on reconnect and store switch and requires the complete shared envelope', () => {
    const registry = new SessionGenerationRegistry();
    const first = 'store-one' as StoreId;
    const second = 'store-two' as StoreId;
    const firstGeneration = registry.switchStore(first);
    const firstContext = storeContext(first, firstGeneration);
    registry.assertActive(firstContext);

    const secondGeneration = registry.switchStore(second);
    expect(() => registry.assertCurrent(firstContext)).toThrow(/stale/);
    registry.assertActive(storeContext(second, secondGeneration));
    expect(() => registry.reconnect(first)).toThrow(/inactive store/);

    const reconnectedGeneration = registry.reconnect(second);
    expect(() => registry.assertCurrent(storeContext(second, secondGeneration))).toThrow(/stale/);
    registry.assertActive(storeContext(second, reconnectedGeneration));
    expect(() => registry.assertCurrent({
      storeId: second,
      sessionGeneration: reconnectedGeneration,
    } as StoreContextEnvelope)).toThrow(/browserProfileId/);
  });
});
