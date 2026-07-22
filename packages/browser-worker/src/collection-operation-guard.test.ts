import { describe, expect, it } from 'vitest';
import type { StoreContextEnvelope, StoreId } from '@amazon-ai-ops/shared-types';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  BrowserLeaseError,
  BrowserLeaseManager,
  SessionGenerationRegistry,
} from './browser-lease';
import {
  CollectionOperationGuard,
  CollectionOperationGuardError,
} from './collection-operation-guard';

function context(
  storeId: string,
  sessionGeneration: number,
  overrides: Partial<StoreContextEnvelope> = {},
): StoreContextEnvelope {
  return normalizeStoreContextEnvelope({
    storeId,
    browserProfileId: `profile-${storeId}`,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration,
    ...overrides,
  });
}

function harness() {
  let now = Date.parse('2026-07-22T08:00:00.000Z');
  let token = 0;
  const leases = new BrowserLeaseManager(
    () => now,
    () => `collection-lease-token-${String(++token).padStart(4, '0')}`,
    5_000,
  );
  const sessions = new SessionGenerationRegistry();
  const generation = sessions.switchStore('store-one');
  let active: StoreContextEnvelope | null = context('store-one', generation);
  const guard = new CollectionOperationGuard({
    leases,
    assertActiveContext: () => {
      if (!active) return null as unknown as StoreContextEnvelope;
      sessions.assertActive(active);
      return active;
    },
  });
  return {
    advanceClock(milliseconds: number) { now += milliseconds; },
    get active() { return active; },
    set active(value: StoreContextEnvelope | null) { active = value; },
    generation,
    guard,
    leases,
    sessions,
  };
}

describe('CollectionOperationGuard', () => {
  it('captures store authority, validates each step, renews, and releases after success', async () => {
    const test = harness();
    const result = await test.guard.run({
      context: test.active!,
      owner: 'lingxing-report-collection',
      ttlMs: 5_000,
    }, (operation) => {
      expect(operation.snapshot).toEqual({
        storeId: 'store-one',
        browserProfileId: 'profile-store-one',
        businessDate: '2026-07-22',
        sessionGeneration: test.generation,
      });
      expect(Object.isFrozen(operation.snapshot)).toBe(true);
      expect(operation.assertStepCurrent().purpose).toBe('collection');
      const originalExpiry = operation.currentLease().expiresAt;
      test.advanceClock(500);
      expect(operation.renew(5_000).expiresAt).not.toBe(originalExpiry);
      return 'collected';
    });

    expect(result).toBe('collected');
    expect(test.leases.current('store-one')).toBeUndefined();
  });

  it('shares the same per-store lane with an external write lease', () => {
    const test = harness();
    const writeLease = test.leases.acquire({
      storeId: 'store-one' as StoreId,
      owner: 'approved-ad-write',
      purpose: 'external_write',
    });

    expect(() => test.guard.start({
      context: test.active!,
      owner: 'lingxing-report-collection',
    })).toThrowError(expect.objectContaining<Partial<BrowserLeaseError>>({ code: 'LEASE_HELD' }));

    test.leases.release(writeLease);
  });

  it('fails closed after a store switch and still releases in finally', async () => {
    const test = harness();

    await expect(test.guard.run({
      context: test.active!,
      owner: 'store-one-collection',
    }, (operation) => {
      const secondGeneration = test.sessions.switchStore('store-two');
      test.active = context('store-two', secondGeneration);
      operation.assertStepCurrent();
    })).rejects.toMatchObject({
      code: 'COLLECTION_CONTEXT_CHANGED',
    });

    expect(test.leases.current('store-one')).toBeUndefined();
  });

  it('rejects a stale session generation before the next browser step or renew', async () => {
    const test = harness();

    await expect(test.guard.run({
      context: test.active!,
      owner: 'stale-generation-collection',
    }, (operation) => {
      test.sessions.reconnect('store-one');
      operation.renew();
    })).rejects.toMatchObject({ code: 'STALE_SESSION_GENERATION' });

    expect(test.leases.current('store-one')).toBeUndefined();
  });

  it.each([
    ['browser profile', { browserProfileId: 'profile-forged' }],
    ['business date', { businessDate: '2026-07-23' }],
  ] as const)('rejects a same-generation %s authority change', async (_label, overrides) => {
    const test = harness();

    await expect(test.guard.run({
      context: test.active!,
      owner: 'changed-context-collection',
    }, (operation) => {
      test.active = context('store-one', test.generation, overrides as Partial<StoreContextEnvelope>);
      operation.assertStepCurrent();
    })).rejects.toMatchObject({
      code: 'COLLECTION_CONTEXT_CHANGED',
    });

    expect(test.leases.current('store-one')).toBeUndefined();
  });

  it('releases the lease when the collection callback throws', async () => {
    const test = harness();

    await expect(test.guard.run({
      context: test.active!,
      owner: 'failed-collection',
    }, () => {
      throw new Error('download failed');
    })).rejects.toThrow('download failed');

    expect(test.leases.current('store-one')).toBeUndefined();
  });

  it('rejects an unavailable active context without acquiring a lease', () => {
    const test = harness();
    const captured = test.active!;
    test.active = null;

    expect(() => test.guard.start({ context: captured, owner: 'no-active-store' }))
      .toThrowError(expect.objectContaining<Partial<CollectionOperationGuardError>>({
        code: 'ACTIVE_CONTEXT_UNAVAILABLE',
      }));
    expect(test.leases.current('store-one')).toBeUndefined();
  });
});
