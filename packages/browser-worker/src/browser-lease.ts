import { randomUUID } from 'crypto';
import type { StoreContextEnvelope, StoreId } from '@amazon-ai-ops/shared-types';
import {
  assertStoreContextEnvelope,
  normalizeStoreId,
} from '@amazon-ai-ops/shared-types';

export type BrowserLeasePurpose = 'collection' | 'external_write';

export interface BrowserLease {
  storeId: StoreId;
  token: string;
  generation: number;
  purpose: BrowserLeasePurpose;
  owner: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface AcquireBrowserLeaseInput {
  storeId: StoreId;
  purpose: BrowserLeasePurpose;
  owner: string;
  ttlMs?: number;
}

export class BrowserLeaseError extends Error {
  constructor(
    readonly code:
      | 'LEASE_HELD'
      | 'LEASE_NOT_FOUND'
      | 'STALE_LEASE'
      | 'LEASE_EXPIRED'
      | 'LEASE_GENERATION_EXHAUSTED'
      | 'INVALID_LEASE_OWNER'
      | 'INVALID_LEASE_PURPOSE'
      | 'INVALID_LEASE_TOKEN'
      | 'INVALID_LEASE_TTL',
    message: string,
  ) {
    super(message);
    this.name = 'BrowserLeaseError';
  }
}

/**
 * Per-store single-holder lease. Collection and writes share the same lane so
 * a collection can queue above this layer but can never preempt a submit.
 */
export class BrowserLeaseManager {
  private readonly leases = new Map<StoreId, BrowserLease>();
  private readonly generations = new Map<StoreId, number>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly createToken: () => string = () => randomUUID(),
    private readonly defaultTtlMs = 60_000,
  ) {}

  acquire(input: AcquireBrowserLeaseInput): BrowserLease {
    const storeId = normalizeStoreId(input.storeId);
    const owner = normalizeOwner(input.owner);
    if (input.purpose !== 'collection' && input.purpose !== 'external_write') {
      throw new BrowserLeaseError(
        'INVALID_LEASE_PURPOSE',
        'browser lease purpose must be collection or external_write',
      );
    }
    const ttlMs = normalizeTtl(input.ttlMs ?? this.defaultTtlMs);
    const now = this.readNow();
    const held = this.leases.get(storeId);
    if (held && !this.isExpired(held, now)) {
      throw new BrowserLeaseError(
        'LEASE_HELD',
        `store ${storeId} already has an active ${held.purpose} browser lease`,
      );
    }
    if (held) this.leases.delete(storeId);
    const token = this.createToken();
    if (typeof token !== 'string' || token.length < 16 || token.length > 512) {
      throw new BrowserLeaseError(
        'INVALID_LEASE_TOKEN',
        'browser lease token factory returned an invalid token',
      );
    }
    const generation = (this.generations.get(storeId) ?? 0) + 1;
    if (!Number.isSafeInteger(generation)) {
      throw new BrowserLeaseError(
        'LEASE_GENERATION_EXHAUSTED',
        'browser lease generation is exhausted',
      );
    }
    this.generations.set(storeId, generation);
    const lease: BrowserLease = Object.freeze({
      storeId,
      token,
      generation,
      purpose: input.purpose,
      owner,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    });
    this.leases.set(storeId, lease);
    return lease;
  }

  current(storeIdInput: unknown): BrowserLease | undefined {
    const storeId = normalizeStoreId(storeIdInput);
    const lease = this.leases.get(storeId);
    if (!lease) return undefined;
    if (this.isExpired(lease, this.readNow())) {
      this.leases.delete(storeId);
      return undefined;
    }
    return lease;
  }

  assertCurrent(lease: BrowserLease): BrowserLease {
    const current = this.leases.get(normalizeStoreId(lease?.storeId));
    if (!current) throw new BrowserLeaseError('LEASE_NOT_FOUND', 'browser lease was not found');
    if (
      current.token !== lease.token
      || current.generation !== lease.generation
      || current.expiresAt !== lease.expiresAt
    ) {
      throw new BrowserLeaseError(
        'STALE_LEASE',
        'browser lease token, generation, or expiry is stale',
      );
    }
    if (this.isExpired(current, this.readNow())) {
      this.leases.delete(current.storeId);
      throw new BrowserLeaseError('LEASE_EXPIRED', 'browser lease has expired');
    }
    return current;
  }

  renew(lease: BrowserLease, ttlMs = this.defaultTtlMs): BrowserLease {
    const current = this.assertCurrent(lease);
    const normalizedTtl = normalizeTtl(ttlMs);
    const now = this.readNow();
    const currentExpiry = Date.parse(current.expiresAt);
    const nextExpiry = Math.max(now + normalizedTtl, currentExpiry + 1);
    const renewed: BrowserLease = Object.freeze({
      ...current,
      expiresAt: new Date(nextExpiry).toISOString(),
    });
    this.leases.set(current.storeId, renewed);
    return renewed;
  }

  release(lease: BrowserLease): void {
    const current = this.assertCurrent(lease);
    this.leases.delete(current.storeId);
  }

  private isExpired(lease: BrowserLease, now: number): boolean {
    return Date.parse(lease.expiresAt) <= now;
  }

  private readNow(): number {
    const value = this.now();
    if (!Number.isFinite(value)) {
      throw new BrowserLeaseError('INVALID_LEASE_TTL', 'browser lease clock is invalid');
    }
    return value;
  }
}

export class SessionGenerationError extends Error {
  constructor(
    readonly code:
      | 'STALE_SESSION_GENERATION'
      | 'INVALID_INITIAL_GENERATION'
      | 'SESSION_NOT_TRACKED'
      | 'SESSION_GENERATION_EXHAUSTED'
      | 'STORE_NOT_ACTIVE',
    message: string,
  ) {
    super(message);
    this.name = 'SessionGenerationError';
  }
}

export class SessionGenerationRegistry {
  private readonly generations = new Map<StoreId, number>();
  private activeStoreId: StoreId | undefined;

  seed(storeIdInput: unknown, generation: number): void {
    const storeId = normalizeStoreId(storeIdInput);
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new SessionGenerationError(
        'INVALID_INITIAL_GENERATION',
        'initial session generation must be a non-negative safe integer',
      );
    }
    const current = this.generations.get(storeId) ?? 0;
    this.generations.set(storeId, Math.max(current, generation));
  }

  current(storeIdInput: unknown): number {
    return this.generations.get(normalizeStoreId(storeIdInput)) ?? 0;
  }

  advance(storeIdInput: unknown): number {
    const storeId = normalizeStoreId(storeIdInput);
    const next = this.current(storeId) + 1;
    if (!Number.isSafeInteger(next)) {
      throw new SessionGenerationError(
        'SESSION_GENERATION_EXHAUSTED',
        'session generation is exhausted',
      );
    }
    this.generations.set(storeId, next);
    return next;
  }

  reconnect(storeIdInput: unknown): number {
    const storeId = normalizeStoreId(storeIdInput);
    if (this.activeStoreId && this.activeStoreId !== storeId) {
      throw new SessionGenerationError(
        'STORE_NOT_ACTIVE',
        `cannot reconnect inactive store ${storeId}`,
      );
    }
    if (!this.activeStoreId) this.activeStoreId = storeId;
    return this.advance(storeId);
  }

  switchStore(storeIdInput: unknown): number {
    const nextStoreId = normalizeStoreId(storeIdInput);
    const previousStoreId = this.activeStoreId;
    if (previousStoreId && previousStoreId !== nextStoreId) {
      // Invalidate requests issued for the UI store being left as well as any
      // requests issued for the store being entered during an earlier visit.
      this.advance(previousStoreId);
    }
    this.activeStoreId = nextStoreId;
    return this.advance(nextStoreId);
  }

  assertCurrent(context: StoreContextEnvelope): void {
    assertStoreContextEnvelope(context);
    const storeId = normalizeStoreId(context.storeId);
    if (!this.generations.has(storeId)) {
      throw new SessionGenerationError(
        'SESSION_NOT_TRACKED',
        `session generation for store ${storeId} is not registered`,
      );
    }
    if (this.generations.get(storeId) !== context.sessionGeneration) {
      throw new SessionGenerationError(
        'STALE_SESSION_GENERATION',
        `session generation for store ${storeId} is stale`,
      );
    }
  }

  assertActive(context: StoreContextEnvelope): void {
    this.assertCurrent(context);
    if (!this.activeStoreId || context.storeId !== this.activeStoreId) {
      throw new SessionGenerationError(
        'STORE_NOT_ACTIVE',
        'store context does not belong to the active store session',
      );
    }
  }
}

function normalizeOwner(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 160) {
    throw new BrowserLeaseError('INVALID_LEASE_OWNER', 'lease owner must contain 1-160 characters');
  }
  return value.trim();
}

function normalizeTtl(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1_000 || value > 3_600_000) {
    throw new BrowserLeaseError('INVALID_LEASE_TTL', 'lease ttl must be between 1 second and 1 hour');
  }
  return value;
}
