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
    expect(() => manager.acquire({ storeId: 'store-one' as StoreId, owner: 'collector', purpose: 'collection' })).toThrow(/unreleased/);
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

  it('returns a frozen cross-store snapshot and rejects any active lease globally', () => {
    let token = 0;
    const manager = new BrowserLeaseManager(
      () => 10_000,
      () => `lease-token-${String(++token).padStart(4, '0')}`,
      5_000,
    );
    manager.acquire({
      storeId: 'store-two' as StoreId,
      owner: 'collector-two',
      purpose: 'collection',
    });
    manager.acquire({
      storeId: 'store-one' as StoreId,
      owner: 'writer-one',
      purpose: 'external_write',
    });

    const snapshot = manager.activeLeases();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.map((lease) => lease.storeId)).toEqual(['store-one', 'store-two']);
    expect(snapshot.every((lease) => Object.isFrozen(lease))).toBe(true);
    expect(() => {
      (snapshot[0] as { owner: string }).owner = 'forged';
    }).toThrow();
    expect(manager.current('store-one')?.owner).toBe('writer-one');
    expect(() => manager.assertNoActiveLeases()).toThrow(/2 browser lease/);
  });

  it('keeps expired holders blocking until their exact identity is explicitly released', () => {
    let now = 1_000;
    let token = 0;
    const manager = new BrowserLeaseManager(
      () => now,
      () => `lease-token-${String(++token).padStart(4, '0')}`,
      1_000,
    );
    const first = manager.acquire({
      storeId: 'store-one' as StoreId,
      owner: 'collector-one',
      purpose: 'collection',
    });
    const second = manager.acquire({
      storeId: 'store-two' as StoreId,
      owner: 'writer-two',
      purpose: 'external_write',
    });
    now = 2_001;

    expect(() => manager.assertNoActiveLeases()).toThrow(/2 browser lease/);
    expect(manager.current('store-one')).toBe(first);
    expect(manager.current('store-two')).toBe(second);
    expect(() => manager.acquire({
      storeId: 'store-one' as StoreId,
      owner: 'replacement',
      purpose: 'collection',
    })).toThrow(/unreleased/);
    expect(() => manager.enterTransitionBarrier('store-switch')).toThrow(/2 unreleased/);

    manager.release(first);
    manager.release(second);
    expect(manager.assertNoActiveLeases()).toEqual([]);
  });

  it('holds one global barrier across close, lease proof, start, and identity completion', () => {
    let token = 0;
    const manager = new BrowserLeaseManager(
      () => 10_000,
      () => `lease-token-${String(++token).padStart(4, '0')}`,
      5_000,
    );
    const entered = manager.enterTransitionBarrier('collection-cycle');
    expect(entered.stage).toBe('entered');
    expect(() => manager.acquire({
      storeId: 'store-two' as StoreId,
      owner: 'racing-writer',
      purpose: 'external_write',
    })).toThrow(/transition barrier/);

    const closed = manager.confirmTransitionRuntimeClosed(entered);
    expect(() => manager.confirmTransitionRuntimeClosed(entered)).toThrow(/forged|replayed|stale/);
    const empty = manager.confirmTransitionLeasesEmpty(closed);
    expect(() => manager.acquire({
      storeId: 'store-one' as StoreId,
      owner: 'racing-collector',
      purpose: 'collection',
    })).toThrow(/transition barrier/);
    const started = manager.confirmTransitionRuntimeStarted(empty);
    const release = manager.completeTransitionIdentityVerified(started);

    expect(release).toMatchObject({
      owner: 'collection-cycle',
      epoch: entered.epoch,
      released: true,
      outcome: 'identity_verified',
    });
    expect(manager.acquire({
      storeId: 'store-one' as StoreId,
      owner: 'next-collector',
      purpose: 'collection',
    }).storeId).toBe('store-one');
  });

  it('rejects forged stage proofs and recovers sticky unknown only through a new exact close proof', () => {
    const manager = new BrowserLeaseManager(
      () => 10_000,
      () => 'lease-token-0001',
      5_000,
    );
    const entered = manager.enterTransitionBarrier('collection-cycle');
    expect(() => manager.confirmTransitionRuntimeClosed({
      ...entered,
    })).toThrow(/forged|replayed|stale/);
    const sticky = manager.markTransitionSafetyUnknown(entered);
    expect(manager.markTransitionSafetyUnknown(sticky)).toBe(sticky);
    expect(() => manager.acquire({
      storeId: 'store-one' as StoreId,
      owner: 'blocked',
      purpose: 'collection',
    })).toThrow(/transition barrier/);

    const closed = manager.confirmTransitionRuntimeClosed(sticky);
    const empty = manager.confirmTransitionLeasesEmpty(closed);
    const release = manager.completeTransitionAfterExactEmpty(empty, 'aborted');
    expect(release.outcome).toBe('aborted');
  });

  it('supports an exact re-close after a started runtime fails without releasing the barrier early', () => {
    const manager = new BrowserLeaseManager();
    const entered = manager.enterTransitionBarrier('collection-cycle');
    const firstClosed = manager.confirmTransitionRuntimeClosed(entered);
    const firstEmpty = manager.confirmTransitionLeasesEmpty(firstClosed);
    const started = manager.confirmTransitionRuntimeStarted(firstEmpty);

    const reclosed = manager.confirmTransitionRuntimeClosed(started);
    const secondEmpty = manager.confirmTransitionLeasesEmpty(reclosed);
    expect(() => manager.acquire({
      storeId: 'store-one' as StoreId,
      owner: 'still-blocked',
      purpose: 'collection',
    })).toThrow(/transition barrier/);
    expect(manager.completeTransitionAfterExactEmpty(secondEmpty, 'terminal_close'))
      .toMatchObject({ released: true, outcome: 'terminal_close' });
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
