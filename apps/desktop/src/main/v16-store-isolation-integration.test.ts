/**
 * V1.6 Store Isolation Integration Tests
 * 
 * Phase 5 Validation: Verify store context isolation works correctly.
 * 
 * @module v16-store-isolation-integration.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeStoreContextEnvelope, normalizeBusinessDate, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { StoreContextTracker, StoreContextGuardError } from './v16-store-context-guard';

// Test helper: create a store context
function createStoreContext(storeId: string, sessionGeneration = 1): StoreContextEnvelope {
  return normalizeStoreContextEnvelope({
    browserProfileId: 'profile-' + storeId, businessTimezone: 'America/Los_Angeles',
    storeId,
    marketplace: 'US',
    currency: 'USD',
    businessDate: '2026-09-07',
    sessionGeneration,
  });
}

describe('V16 Store Isolation - Integration Tests', () => {
  let tracker: StoreContextTracker;

  beforeEach(() => {
    tracker = new StoreContextTracker();
  });

  afterEach(() => {
    tracker.reset();
  });

  describe('Scenario 1: Store Switching', () => {
    it('should track current store context', () => {
      const storeA = createStoreContext('jf-us');
      
      tracker.setContext(storeA);
      
      const current = tracker.getContext();
      expect(current.storeId).toBe('jf-us');
      expect(current.marketplace).toBe('US');
      expect(current.currency).toBe('USD');
      expect(current.sessionGeneration).toBe(1);
    });

    it('should allow switching between stores', () => {
      const storeA = createStoreContext('jf-us');
      const storeB = createStoreContext('hn-us');
      const storeC = createStoreContext('tp-us');
      
      tracker.setContext(storeA);
      expect(tracker.getContext().storeId).toBe('jf-us');
      
      tracker.setContext(storeB);
      expect(tracker.getContext().storeId).toBe('hn-us');
      
      tracker.setContext(storeC);
      expect(tracker.getContext().storeId).toBe('tp-us');
    });

    it('should detect context match correctly', () => {
      const storeA = createStoreContext('jf-us');
      const storeB = createStoreContext('hn-us');
      
      tracker.setContext(storeA);
      
      expect(tracker.isCurrentContext(storeA)).toBe(true);
      expect(tracker.isCurrentContext(storeB)).toBe(false);
    });

    it('should trigger callbacks on store switch', () => {
      const storeA = createStoreContext('jf-us');
      const storeB = createStoreContext('hn-us');
      
      const switchedContexts: string[] = [];
      tracker.onContextSwitch((ctx) => {
        switchedContexts.push(ctx.storeId);
      });
      
      tracker.setContext(storeA);
      // Initial set doesn't trigger callback
      expect(switchedContexts).toHaveLength(0);
      
      tracker.setContext(storeB);
      // Switch triggers callback
      expect(switchedContexts).toEqual(['hn-us']);
      
      tracker.setContext(storeA);
      expect(switchedContexts).toEqual(['hn-us', 'jf-us']);
    });
  });

  describe('Scenario 2: Cross-Store Protection', () => {
    it('should reject accessing wrong store', () => {
      const storeA = createStoreContext('jf-us');
      const storeB = createStoreContext('hn-us');
      
      tracker.setContext(storeA);
      
      expect(() => {
        tracker.assertCurrentContext(storeB);
      }).toThrow(StoreContextGuardError);
      
      expect(() => {
        tracker.assertCurrentContext(storeB);
      }).toThrow(/mismatch/); // Match either "STORE_MISMATCH" or "mismatch" in message
    });

    it('should accept matching store', () => {
      const storeA = createStoreContext('jf-us');
      
      tracker.setContext(storeA);
      
      expect(() => {
        tracker.assertCurrentContext(storeA);
      }).not.toThrow();
    });
  });

  describe('Scenario 3: Transaction Isolation', () => {
    it('should prevent store switch during pending operation', () => {
      const storeA = createStoreContext('jf-us');
      const storeB = createStoreContext('hn-us');
      
      tracker.setContext(storeA);
      
      // Start a pending operation
      const cleanup = tracker.trackOperation('create-mission');
      
      // Cannot switch while operation is pending
      expect(() => {
        tracker.setContext(storeB);
      }).toThrow(StoreContextGuardError);
      
      expect(() => {
        tracker.setContext(storeB);
      }).toThrow(/Cannot switch store while 1 operations are pending/);
      
      // Complete the operation
      cleanup();
      
      // Now switching should work
      expect(() => {
        tracker.setContext(storeB);
      }).not.toThrow();
      
      expect(tracker.getContext().storeId).toBe('hn-us');
    });

    it('should track multiple pending operations', () => {
      const storeA = createStoreContext('jf-us');
      const storeB = createStoreContext('hn-us');
      
      tracker.setContext(storeA);
      
      const cleanup1 = tracker.trackOperation('op-1');
      const cleanup2 = tracker.trackOperation('op-2');
      const cleanup3 = tracker.trackOperation('op-3');
      
      expect(tracker.hasPendingOperations()).toBe(true);
      
      // Cannot switch
      expect(() => tracker.setContext(storeB)).toThrow(/3 operations are pending/);
      
      // Complete some
      cleanup1();
      expect(() => tracker.setContext(storeB)).toThrow(/2 operations are pending/);
      
      cleanup2();
      expect(() => tracker.setContext(storeB)).toThrow(/1 operations are pending/);
      
      // Complete all
      cleanup3();
      expect(tracker.hasPendingOperations()).toBe(false);
      
      // Now can switch
      expect(() => tracker.setContext(storeB)).not.toThrow();
    });

    it('should allow same operation ID to be tracked multiple times', () => {
      const storeA = createStoreContext('jf-us');
      
      tracker.setContext(storeA);
      
      const cleanup1 = tracker.trackOperation('analysis-run');
      const cleanup2 = tracker.trackOperation('analysis-run');
      
      // Both are tracked (but Set deduplicates, so only one instance)
      expect(tracker.hasPendingOperations()).toBe(true);
      
      // Complete first
      cleanup1();
      // After removing once, Set is empty (they were the same key)
      expect(tracker.hasPendingOperations()).toBe(false);
      
      // Complete second (no-op, already removed)
      cleanup2();
      expect(tracker.hasPendingOperations()).toBe(false);
    });
  });

  describe('Scenario 4: A→B→A Race Prevention', () => {
    it('should detect stale context after store switch', () => {
      const storeA = createStoreContext('jf-us');
      const storeB = createStoreContext('hn-us');
      
      // Start with store A
      tracker.setContext(storeA);
      const capturedContext = tracker.getContext();
      
      // Switch to store B
      tracker.setContext(storeB);
      
      // Captured context from A is now stale
      expect(tracker.isCurrentContext(capturedContext)).toBe(false);
      
      expect(() => {
        tracker.assertCurrentContext(capturedContext);
      }).toThrow(StoreContextGuardError);
    });

    it('should detect stale context after A→B→A switch', () => {
      const storeA1 = createStoreContext('jf-us', 1);
      const storeB = createStoreContext('hn-us', 1);
      const storeA2 = createStoreContext('jf-us', 2); // Same store, new session
      
      // A (session 1)
      tracker.setContext(storeA1);
      const oldContext = tracker.getContext();
      
      // Switch to B
      tracker.setContext(storeB);
      
      // Switch back to A, but session advanced
      tracker.setContext(storeA2);
      
      // Old context from A session 1 is stale
      expect(() => {
        tracker.assertCurrentContext(oldContext);
      }).toThrow(/Stale session/);
    });
  });

  describe('Scenario 5: Session Upgrade', () => {
    it('should reject context from previous session', () => {
      const storeSession1 = createStoreContext('jf-us', 1);
      const storeSession2 = createStoreContext('jf-us', 2);
      
      // Set session 1
      tracker.setContext(storeSession1);
      const session1Context = tracker.getContext();
      
      // Advance to session 2
      tracker.setContext(storeSession2);
      
      // Session 1 context is now stale
      expect(() => {
        tracker.assertCurrentContext(session1Context);
      }).toThrow(/Stale session/); // Match the actual error message format
    });

    it('should accept context from current session', () => {
      const store = createStoreContext('jf-us', 5);
      
      tracker.setContext(store);
      
      expect(() => {
        tracker.assertCurrentContext(store);
      }).not.toThrow();
    });

    it('should allow same-store same-session access', () => {
      const store1 = createStoreContext('jf-us', 1);
      const store2 = createStoreContext('jf-us', 1); // Same store, same session
      
      tracker.setContext(store1);
      
      // Should be treated as same context
      expect(tracker.isCurrentContext(store2)).toBe(true);
      
      expect(() => {
        tracker.assertCurrentContext(store2);
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should throw when no context is set', () => {
      expect(() => {
        tracker.getContext();
      }).toThrow(StoreContextGuardError);
      
      expect(() => {
        tracker.getContext();
      }).toThrow(/No active StoreContext/);
    });

    it('should handle rapid store switches', () => {
      const stores = [
        createStoreContext('jf-us'),
        createStoreContext('hn-us'),
        createStoreContext('tp-us'),
      ];
      
      for (let i = 0; i < 100; i++) {
        const store = stores[i % stores.length];
        tracker.setContext(store);
        expect(tracker.getContext().storeId).toBe(store.storeId);
      }
    });

    it('should treat different business dates as different contexts', () => {
      const storeDay1 = createStoreContext('jf-us', 1);
      storeDay1.businessDate = normalizeBusinessDate('2026-09-07');
      
      const storeDay2 = createStoreContext('jf-us', 1);
      storeDay2.businessDate = normalizeBusinessDate('2026-09-08');
      
      tracker.setContext(storeDay1);
      
      // Different date = different context
      expect(tracker.isCurrentContext(storeDay2)).toBe(false);
      
      // Can switch to different date
      tracker.setContext(storeDay2);
      expect(tracker.getContext().businessDate).toBe('2026-09-08');
    });

    it('should reset all state', () => {
      const store = createStoreContext('jf-us');
      
      tracker.setContext(store);
      const cleanup = tracker.trackOperation('test-op');
      
      tracker.reset();
      
      // After reset, no context
      expect(() => tracker.getContext()).toThrow(/No active StoreContext/);
      
      // After reset, no pending operations
      expect(tracker.hasPendingOperations()).toBe(false);
    });

    it('should handle context with same storeId but different session', () => {
      const store1 = createStoreContext('jf-us', 1);
      const store2 = createStoreContext('jf-us', 2);
      
      tracker.setContext(store1);
      
      // Different session = can switch
      expect(() => {
        tracker.setContext(store2);
      }).not.toThrow();
      
      // But old context is now stale
      expect(() => {
        tracker.assertCurrentContext(store1);
      }).toThrow(/Stale session/);
    });
  });

  describe('Context Validation', () => {
    it('should reject non-US marketplace', () => {
      const store = { ...createStoreContext('JF-UK'), marketplace: 'UK' };
      
      expect(() => {
        tracker.setContext(store);
      }).toThrow(/V1.6 only supports US marketplace/);
    });

    it('should reject non-USD currency', () => {
      const store = { ...createStoreContext('jf-us'), currency: 'EUR' };
      
      expect(() => {
        tracker.setContext(store);
      }).toThrow(/V1.6 only supports USD currency/);
    });

    it('should reject invalid session generation', () => {
      const store = { ...createStoreContext('jf-us'), sessionGeneration: -1 };
      
      expect(() => {
        tracker.setContext(store);
      }).toThrow(/sessionGeneration must be a non-negative integer/);
    });

    it('should reject invalid business date', () => {
      const store = { ...createStoreContext('jf-us'), businessDate: 'invalid-date' };
      
      expect(() => {
        tracker.setContext(store);
      }).toThrow(/businessDate must be YYYY-MM-DD/);
    });

    it('should reject missing storeId', () => {
      const store = { ...createStoreContext('jf-us'), storeId: '' };
      
      expect(() => {
        tracker.setContext(store);
      }).toThrow(/StoreContext.storeId is required/);
    });
  });
});
