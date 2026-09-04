/**
 * V1.6 StoreContext Strict Isolation Guard
 *
 * Phase 5: Every cross-store access must be validated at the trust boundary.
 * This module centralises the rules:
 *  - marketplace must be US
 *  - currency must be USD
 *  - storeId must be a non-empty string
 *  - sessionGeneration must be a positive integer
 *  - businessDate must be YYYY-MM-DD
 *
 * @module v16-store-context-guard
 */

import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

export class StoreContextGuardError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'MISSING_STORE_ID'
      | 'NON_US_MARKETPLACE'
      | 'NON_USD_CURRENCY'
      | 'INVALID_SESSION_GENERATION'
      | 'INVALID_BUSINESS_DATE'
      | 'STALE_SESSION'
      | 'STORE_MISMATCH',
  ) {
    super(message);
    this.name = 'StoreContextGuardError';
  }
}

const BUSINESS_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate that an envelope is shape-conformant and US/USD only.
 * Throws on any violation; returns the normalised envelope otherwise.
 */
export function assertValidStoreContext(ctx: StoreContextEnvelope): StoreContextEnvelope {
  if (!ctx || typeof ctx !== 'object') {
    throw new StoreContextGuardError('StoreContext is required', 'MISSING_STORE_ID');
  }
  if (!ctx.storeId || typeof ctx.storeId !== 'string' || !ctx.storeId.trim()) {
    throw new StoreContextGuardError('StoreContext.storeId is required', 'MISSING_STORE_ID');
  }
  if (ctx.marketplace !== 'US') {
    throw new StoreContextGuardError(
      `V1.6 only supports US marketplace (got "${ctx.marketplace}")`,
      'NON_US_MARKETPLACE',
    );
  }
  if (ctx.currency !== 'USD') {
    throw new StoreContextGuardError(
      `V1.6 only supports USD currency (got "${ctx.currency}")`,
      'NON_US_CURRENCY',
    );
  }
  if (!Number.isInteger(ctx.sessionGeneration) || ctx.sessionGeneration < 1) {
    throw new StoreContextGuardError(
      `sessionGeneration must be a positive integer (got ${ctx.sessionGeneration})`,
      'INVALID_SESSION_GENERATION',
    );
  }
  if (!ctx.businessDate || !BUSINESS_DATE_REGEX.test(ctx.businessDate)) {
    throw new StoreContextGuardError(
      `businessDate must be YYYY-MM-DD (got "${ctx.businessDate}")`,
      'INVALID_BUSINESS_DATE',
    );
  }
  return ctx;
}

/**
 * Compare two envelopes for store equality. Strict comparison on storeId,
 * sessionGeneration, and businessDate.
 */
export function sameStoreContext(a: StoreContextEnvelope, b: StoreContextEnvelope): boolean {
  return (
    String(a.storeId) === String(b.storeId) &&
    a.sessionGeneration === b.sessionGeneration &&
    a.businessDate === b.businessDate
  );
}

/**
 * Decide if `incoming` is acceptable against an `expected` envelope.
 * Returns one of: 'match' | 'mismatch' | 'stale_session' | 'mismatched_date'.
 */
export function classifyStoreSwitch(
  expected: StoreContextEnvelope,
  incoming: StoreContextEnvelope,
): 'match' | 'mismatch' | 'stale_session' | 'mismatched_date' {
  if (String(expected.storeId) !== String(incoming.storeId)) return 'mismatch';
  if (expected.businessDate !== incoming.businessDate) return 'mismatched_date';
  if (incoming.sessionGeneration < expected.sessionGeneration) return 'stale_session';
  return 'match';
}

/**
 * Throws when two envelopes refer to different stores.
 */
export function assertSameStore(a: StoreContextEnvelope, b: StoreContextEnvelope): void {
  if (String(a.storeId) !== String(b.storeId)) {
    throw new StoreContextGuardError(
      `StoreContext mismatch: ${a.storeId} vs ${b.storeId}`,
      'STORE_MISMATCH',
    );
  }
  if (a.sessionGeneration < b.sessionGeneration) {
    throw new StoreContextGuardError(
      `Stale session: incoming session ${a.sessionGeneration} < expected ${b.sessionGeneration}`,
      'STALE_SESSION',
    );
  }
}

/**
 * StoreContextTracker: tracks the current active context and pending operations.
 * 
 * This singleton prevents:
 * - A→B→A race conditions (stale async results)
 * - Store switching with pending operations
 * - Context mismatches across services
 */
export class StoreContextTracker {
  private current: StoreContextEnvelope | null = null;
  private pendingOperations = new Set<string>();
  private switchCallbacks = new Set<(ctx: StoreContextEnvelope) => void>();

  /**
   * Set the current active store context.
   * Throws if there are pending operations.
   */
  setContext(ctx: StoreContextEnvelope): void {
    assertValidStoreContext(ctx);

    if (this.pendingOperations.size > 0) {
      throw new StoreContextGuardError(
        `Cannot switch store while ${this.pendingOperations.size} operations are pending: ${Array.from(this.pendingOperations).join(', ')}`,
        'STORE_MISMATCH',
      );
    }

    const prev = this.current;
    this.current = ctx;

    // Notify all listeners
    if (prev && !sameStoreContext(prev, ctx)) {
      for (const cb of this.switchCallbacks) {
        cb(ctx);
      }
    }
  }

  /**
   * Get the current active context.
   * Throws if no context has been set.
   */
  getContext(): StoreContextEnvelope {
    if (!this.current) {
      throw new StoreContextGuardError('No active StoreContext', 'MISSING_STORE_ID');
    }
    return this.current;
  }

  /**
   * Check if a given context matches the current active context.
   * Returns true if they match, false otherwise.
   */
  isCurrentContext(ctx: StoreContextEnvelope): boolean {
    if (!this.current) return false;
    return sameStoreContext(this.current, ctx);
  }

  /**
   * Assert that the given context matches the current active context.
   * Throws if they don't match or if the session is stale.
   */
  assertCurrentContext(ctx: StoreContextEnvelope): void {
    const current = this.getContext();
    assertSameStore(ctx, current);
  }

  /**
   * Register a pending operation.
   * Returns a cleanup function to call when the operation completes.
   */
  trackOperation(operationId: string): () => void {
    this.pendingOperations.add(operationId);
    return () => {
      this.pendingOperations.delete(operationId);
    };
  }

  /**
   * Check if there are any pending operations.
   */
  hasPendingOperations(): boolean {
    return this.pendingOperations.size > 0;
  }

  /**
   * Get the list of pending operation IDs.
   */
  getPendingOperations(): string[] {
    return Array.from(this.pendingOperations);
  }

  /**
   * Register a callback to be invoked when the store context changes.
   */
  onContextSwitch(callback: (ctx: StoreContextEnvelope) => void): () => void {
    this.switchCallbacks.add(callback);
    return () => {
      this.switchCallbacks.delete(callback);
    };
  }

  /**
   * Clear all state (for testing only).
   */
  reset(): void {
    this.current = null;
    this.pendingOperations.clear();
    this.switchCallbacks.clear();
  }
}

// Singleton instance
export const storeContextTracker = new StoreContextTracker();
