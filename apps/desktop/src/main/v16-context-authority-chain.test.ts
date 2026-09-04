/**
 * V1.6 Context Authority Chain Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { MissionRecord } from '@amazon-ai-ops/shared-types/src/mission-domain';
import type { MissionGrantRecord } from '@amazon-ai-ops/shared-types/src/mission-grant-domain';
import {
  assertMissionContextValid,
  assertGrantContextValid,
  assertExecutionContextValid,
  createContextBoundOperation,
  ContextAuthorityError,
} from './v16-context-authority-chain';
import { storeContextTracker } from './v16-store-context-guard';

const baseContext: StoreContextEnvelope = {
  storeId: 'store-a',
  marketplace: 'US',
  currency: 'USD',
  businessDate: '2026-09-04',
  sessionGeneration: 1,
};

const baseMission: MissionRecord = {
  missionId: 'mission-1',
  storeId: 'store-a',
  marketplace: 'US',
  currency: 'USD',
  businessDate: '2026-09-04',
  name: 'Test Mission',
  productIds: ['prod-1'],
  sessionGeneration: 1,
  contextSnapshot: baseContext,
  stage: 'analysis',
  status: 'active',
  revision: 1,
  createdAt: '2026-09-04T09:00:00Z',
  updatedAt: '2026-09-04T09:00:00Z',
};

const baseGrant: MissionGrantRecord = {
  grantId: 'grant-1',
  storeId: 'store-a',
  missionId: 'mission-1',
  missionRevision: 1,
  decisionIds: ['decision-1'],
  issuer: 'human_operator',
  issuedAt: '2026-09-04T09:00:00Z',
  issuedBy: 'operator-1',
  sessionGeneration: 1,
  contextSnapshot: {
    storeId: 'store-a',
    marketplace: 'US',
    currency: 'USD',
    businessDate: '2026-09-04',
    sessionGeneration: 1,
  },
  scope: {
    entityIds: ['kw-1'],
    actionType: 'adjust_keyword_bid',
    currency: 'USD',
  },
  limits: {
    maxSlots: 1,
  },
  evidenceRequirement: {
    requiresBeforeScreenshot: true,
    requiresAfterScreenshot: true,
    requiresReloadScreenshot: true,
    requiresValueReadback: true,
  },
  status: 'active',
  usedSlots: 0,
  createdAt: '2026-09-04T09:00:00Z',
  updatedAt: '2026-09-04T09:00:00Z',
  reason: 'Test grant',
};

describe('V16ContextAuthorityChain', () => {
  beforeEach(() => {
    storeContextTracker.reset();
    storeContextTracker.setContext(baseContext);
  });

  describe('assertMissionContextValid', () => {
    it('passes for mission in current context', () => {
      expect(() => assertMissionContextValid(baseMission)).not.toThrow();
    });

    it('throws MISSION_CONTEXT_MISMATCH for different store', () => {
      const wrongStoreMission = { ...baseMission, storeId: 'store-b' };
      expect(() => assertMissionContextValid(wrongStoreMission)).toThrow(
        /belongs to store store-b/,
      );
    });

    it('throws STALE_MISSION for old session', () => {
      storeContextTracker.setContext({ ...baseContext, sessionGeneration: 2 });
      expect(() => assertMissionContextValid(baseMission)).toThrow(/was created in session 1/);
    });

    it('throws MISSION_CONTEXT_MISMATCH for different context snapshot', () => {
      const mismatchMission = {
        ...baseMission,
        contextSnapshot: { ...baseContext, businessDate: '2026-09-03' },
      };
      expect(() => assertMissionContextValid(mismatchMission)).toThrow(/does not match current context/);
    });
  });

  describe('assertGrantContextValid', () => {
    it('passes for grant in current context', () => {
      expect(() => assertGrantContextValid(baseGrant)).not.toThrow();
    });

    it('throws GRANT_CONTEXT_MISMATCH for different store', () => {
      const wrongStoreGrant = { ...baseGrant, storeId: 'store-b' };
      expect(() => assertGrantContextValid(wrongStoreGrant)).toThrow(/belongs to store store-b/);
    });

    it('throws STALE_GRANT for old session', () => {
      storeContextTracker.setContext({ ...baseContext, sessionGeneration: 2 });
      expect(() => assertGrantContextValid(baseGrant)).toThrow(/was issued in session 1/);
    });

    it('throws CONTEXT_INVALIDATED for invalidated grant', () => {
      const invalidatedGrant = { ...baseGrant, status: 'invalidated' as const };
      expect(() => assertGrantContextValid(invalidatedGrant)).toThrow(/has been invalidated/);
    });

    it('throws GRANT_CONTEXT_MISMATCH for different context snapshot', () => {
      const mismatchGrant = {
        ...baseGrant,
        contextSnapshot: { ...baseGrant.contextSnapshot, businessDate: '2026-09-03' },
      };
      expect(() => assertGrantContextValid(mismatchGrant)).toThrow(/does not match current context/);
    });
  });

  describe('assertExecutionContextValid', () => {
    it('passes for execution in current context', () => {
      expect(() =>
        assertExecutionContextValid(baseContext, 'exec-1'),
      ).not.toThrow();
    });

    it('throws EXECUTION_CONTEXT_MISMATCH for different context', () => {
      const wrongContext = { ...baseContext, storeId: 'store-b' };
      expect(() =>
        assertExecutionContextValid(wrongContext, 'exec-1'),
      ).toThrow(/does not match current context/);
    });

    it('throws for invalid context envelope', () => {
      const invalidContext = { ...baseContext, marketplace: 'DE' as const };
      expect(() =>
        assertExecutionContextValid(invalidContext, 'exec-1'),
      ).toThrow(/only supports US/);
    });
  });

  describe('createContextBoundOperation', () => {
    it('creates operation and validates current context', () => {
      const { cleanup, validate } = createContextBoundOperation('op-1');
      
      expect(storeContextTracker.hasPendingOperations()).toBe(true);
      expect(() => validate()).not.toThrow();
      
      cleanup();
      expect(storeContextTracker.hasPendingOperations()).toBe(false);
    });

    it('detects context change during operation', () => {
      const { cleanup, validate } = createContextBoundOperation('op-1');
      
      // Complete the operation so we can switch
      cleanup();
      
      // Switch context
      storeContextTracker.setContext({ ...baseContext, storeId: 'store-b' });
      
      // Validation now fails
      expect(() => validate()).toThrow(/started in a different context/);
    });

    it('prevents store switch while operation is pending', () => {
      const { cleanup } = createContextBoundOperation('op-1');
      
      expect(() =>
        storeContextTracker.setContext({ ...baseContext, storeId: 'store-b' }),
      ).toThrow(/Cannot switch store/);
      
      cleanup();
    });
  });

  describe('A→B→A race condition prevention', () => {
    it('rejects stale mission from previous context', () => {
      // Start in store A
      storeContextTracker.setContext({ ...baseContext, storeId: 'store-a' });
      const missionA = { ...baseMission, storeId: 'store-a' };
      
      // Switch to store B
      storeContextTracker.setContext({ ...baseContext, storeId: 'store-b' });
      
      // Mission from A is now invalid
      expect(() => assertMissionContextValid(missionA)).toThrow(ContextAuthorityError);
    });

    it('rejects stale grant from previous session', () => {
      // Start in session 1
      storeContextTracker.setContext({ ...baseContext, sessionGeneration: 1 });
      const grant1 = { ...baseGrant, sessionGeneration: 1 };
      
      // Advance to session 2
      storeContextTracker.setContext({ ...baseContext, sessionGeneration: 2 });
      
      // Grant from session 1 is now stale
      expect(() => assertGrantContextValid(grant1)).toThrow(/was issued in session 1/);
    });

    it('accepts newer session grants', () => {
      storeContextTracker.setContext({ ...baseContext, sessionGeneration: 2 });
      const grant2 = {
        ...baseGrant,
        sessionGeneration: 2,
        contextSnapshot: { ...baseGrant.contextSnapshot, sessionGeneration: 2 },
      };
      
      expect(() => assertGrantContextValid(grant2)).not.toThrow();
    });
  });
});
