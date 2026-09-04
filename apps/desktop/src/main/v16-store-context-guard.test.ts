/**
 * V1.6 StoreContext Guard Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  assertSameStore,
  assertValidStoreContext,
  classifyStoreSwitch,
  sameStoreContext,
  StoreContextGuardError,
  StoreContextTracker,
  storeContextTracker,
} from './v16-store-context-guard';

const base: StoreContextEnvelope = {
  storeId: 'store-a',
  marketplace: 'US',
  currency: 'USD',
  businessDate: '2026-09-03',
  sessionGeneration: 1,
};

describe('V16StoreContextGuard', () => {
  describe('assertValidStoreContext', () => {
    it('accepts a well-formed US/USD envelope', () => {
      expect(() => assertValidStoreContext(base)).not.toThrow();
    });

    it('rejects non-US marketplace', () => {
      expect(() =>
        assertValidStoreContext({ ...base, marketplace: 'DE' }),
      ).toThrow(/only supports US/);
    });

    it('rejects non-USD currency', () => {
      expect(() =>
        assertValidStoreContext({ ...base, currency: 'EUR' }),
      ).toThrow(/only supports USD/);
    });

    it('rejects missing storeId', () => {
      expect(() =>
        assertValidStoreContext({ ...base, storeId: '' }),
      ).toThrow(StoreContextGuardError);
    });

    it('rejects non-positive sessionGeneration', () => {
      expect(() =>
        assertValidStoreContext({ ...base, sessionGeneration: 0 }),
      ).toThrow(/positive integer/);
    });

    it('rejects malformed businessDate', () => {
      expect(() =>
        assertValidStoreContext({ ...base, businessDate: '2026/09/03' }),
      ).toThrow(/YYYY-MM-DD/);
    });
  });

  describe('sameStoreContext', () => {
    it('true when all three fields match', () => {
      expect(sameStoreContext(base, { ...base })).toBe(true);
    });
    it('false when storeId differs', () => {
      expect(sameStoreContext(base, { ...base, storeId: 'b' })).toBe(false);
    });
    it('false when sessionGeneration differs', () => {
      expect(sameStoreContext(base, { ...base, sessionGeneration: 2 })).toBe(false);
    });
  });

  describe('classifyStoreSwitch', () => {
    it('match returns match', () => {
      expect(classifyStoreSwitch(base, { ...base })).toBe('match');
    });
    it('different storeId -> mismatch', () => {
      expect(classifyStoreSwitch(base, { ...base, storeId: 'b' })).toBe('mismatch');
    });
    it('different businessDate -> mismatched_date', () => {
      expect(classifyStoreSwitch(base, { ...base, businessDate: '2026-09-04' })).toBe('mismatched_date');
    });
    it('lower sessionGeneration -> stale_session', () => {
      expect(classifyStoreSwitch(base, { ...base, sessionGeneration: 0 })).toBe('stale_session');
    });
  });

  describe('assertSameStore', () => {
    it('passes for matching envelopes', () => {
      expect(() => assertSameStore(base, base)).not.toThrow();
    });
    it('throws STORE_MISMATCH for different stores', () => {
      expect(() => assertSameStore(base, { ...base, storeId: 'b' })).toThrow(/StoreContext mismatch/);
    });
    it('throws STALE_SESSION for stale incoming', () => {
      expect(() =>
        assertSameStore({ ...base, sessionGeneration: 0 }, base),
      ).toThrow(/Stale session/);
    });
  });

  describe('StoreContextTracker', () => {
    let tracker: StoreContextTracker;

    beforeEach(() => {
      tracker = new StoreContextTracker();
    });

    describe('setContext & getContext', () => {
      it('sets and retrieves the current context', () => {
        tracker.setContext(base);
        expect(tracker.getContext()).toEqual(base);
      });

      it('throws when getting context before setting', () => {
        expect(() => tracker.getContext()).toThrow(/No active StoreContext/);
      });

      it('validates the context on set', () => {
        expect(() =>
          tracker.setContext({ ...base, marketplace: 'DE' }),
        ).toThrow(/only supports US/);
      });

      it('blocks switching when operations are pending', () => {
        tracker.setContext(base);
        const cleanup = tracker.trackOperation('op-1');
        
        expect(() =>
          tracker.setContext({ ...base, storeId: 'store-b' }),
        ).toThrow(/Cannot switch store while 1 operations are pending/);

        cleanup();
        expect(() =>
          tracker.setContext({ ...base, storeId: 'store-b' }),
        ).not.toThrow();
      });
    });

    describe('isCurrentContext', () => {
      it('returns true for matching context', () => {
        tracker.setContext(base);
        expect(tracker.isCurrentContext(base)).toBe(true);
      });

      it('returns false for different context', () => {
        tracker.setContext(base);
        expect(tracker.isCurrentContext({ ...base, storeId: 'store-b' })).toBe(false);
      });

      it('returns false when no context is set', () => {
        expect(tracker.isCurrentContext(base)).toBe(false);
      });
    });

    describe('assertCurrentContext', () => {
      it('passes for matching context', () => {
        tracker.setContext(base);
        expect(() => tracker.assertCurrentContext(base)).not.toThrow();
      });

      it('throws for mismatched store', () => {
        tracker.setContext(base);
        expect(() =>
          tracker.assertCurrentContext({ ...base, storeId: 'store-b' }),
        ).toThrow(/StoreContext mismatch/);
      });

      it('throws for stale session', () => {
        tracker.setContext({ ...base, sessionGeneration: 2 });
        expect(() =>
          tracker.assertCurrentContext({ ...base, sessionGeneration: 1 }),
        ).toThrow(/Stale session/);
      });
    });

    describe('trackOperation', () => {
      it('adds and removes pending operations', () => {
        expect(tracker.hasPendingOperations()).toBe(false);
        
        const cleanup = tracker.trackOperation('op-1');
        expect(tracker.hasPendingOperations()).toBe(true);
        expect(tracker.getPendingOperations()).toEqual(['op-1']);
        
        cleanup();
        expect(tracker.hasPendingOperations()).toBe(false);
      });

      it('tracks multiple operations', () => {
        const cleanup1 = tracker.trackOperation('op-1');
        const cleanup2 = tracker.trackOperation('op-2');
        
        expect(tracker.getPendingOperations()).toHaveLength(2);
        expect(tracker.getPendingOperations()).toContain('op-1');
        expect(tracker.getPendingOperations()).toContain('op-2');
        
        cleanup1();
        expect(tracker.getPendingOperations()).toEqual(['op-2']);
        
        cleanup2();
        expect(tracker.hasPendingOperations()).toBe(false);
      });
    });

    describe('onContextSwitch', () => {
      it('invokes callbacks when context changes', () => {
        const callback = vi.fn();
        tracker.onContextSwitch(callback);
        
        tracker.setContext(base);
        expect(callback).not.toHaveBeenCalled(); // First set doesn't trigger
        
        const newCtx = { ...base, storeId: 'store-b' };
        tracker.setContext(newCtx);
        expect(callback).toHaveBeenCalledWith(newCtx);
      });

      it('does not invoke callback for same context', () => {
        const callback = vi.fn();
        tracker.setContext(base);
        tracker.onContextSwitch(callback);
        
        tracker.setContext({ ...base }); // Same context
        expect(callback).not.toHaveBeenCalled();
      });

      it('unsubscribes callbacks', () => {
        const callback = vi.fn();
        const unsubscribe = tracker.onContextSwitch(callback);
        
        tracker.setContext(base);
        unsubscribe();
        
        tracker.setContext({ ...base, storeId: 'store-b' });
        expect(callback).not.toHaveBeenCalled();
      });
    });

    describe('reset', () => {
      it('clears all state', () => {
        tracker.setContext(base);
        tracker.trackOperation('op-1');
        const callback = vi.fn();
        tracker.onContextSwitch(callback);
        
        tracker.reset();
        
        expect(() => tracker.getContext()).toThrow(/No active StoreContext/);
        expect(tracker.hasPendingOperations()).toBe(false);
        
        tracker.setContext(base);
        tracker.setContext({ ...base, storeId: 'store-b' });
        expect(callback).not.toHaveBeenCalled();
      });
    });
  });

  describe('Global storeContextTracker singleton', () => {
    beforeEach(() => {
      storeContextTracker.reset();
    });

    it('is a shared singleton instance', () => {
      storeContextTracker.setContext(base);
      expect(storeContextTracker.getContext()).toEqual(base);
    });

    it('prevents A→B→A race conditions', () => {
      // Set store A
      storeContextTracker.setContext({ ...base, storeId: 'store-a' });
      
      // Start async operation for A
      const cleanup = storeContextTracker.trackOperation('async-op-a');
      
      // Switch to store B (blocked by pending operation)
      expect(() =>
        storeContextTracker.setContext({ ...base, storeId: 'store-b' }),
      ).toThrow(/Cannot switch store/);
      
      // Complete operation
      cleanup();
      
      // Now switch to B is allowed
      storeContextTracker.setContext({ ...base, storeId: 'store-b' });
      
      // Verify stale result from A would be rejected
      expect(storeContextTracker.isCurrentContext({ ...base, storeId: 'store-a' })).toBe(false);
    });
  });
});
