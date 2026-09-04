/**
 * MissionGrant Domain Model Tests
 */

import { describe, it, expect } from 'vitest';
import {
  calculateResidualAuthority,
  GRANT_STATUS_LABELS,
  type MissionGrantRecord,
} from './mission-grant-domain';

function makeGrant(overrides: Partial<MissionGrantRecord> = {}): MissionGrantRecord {
  return {
    grantId: 'grant_1',
    storeId: 'store-a',
    missionId: 'mission-1',
    missionRevision: 1,
    decisionIds: ['dec-1'],
    issuer: 'human_operator',
    issuedAt: '2026-09-03T10:00:00Z',
    issuedBy: 'operator-1',
    scope: {
      entityIds: ['kw-1', 'kw-2'],
      actionType: 'adjust_keyword_bid',
      maxChangePercent: 10,
      currency: 'USD',
    },
    limits: {
      maxSlots: 5,
      maxBudget: 50,
    },
    evidenceRequirement: {
      requiresBeforeScreenshot: true,
      requiresAfterScreenshot: true,
      requiresReloadScreenshot: true,
      requiresValueReadback: true,
    },
    status: 'active',
    usedSlots: 0,
    createdAt: '2026-09-03T10:00:00Z',
    updatedAt: '2026-09-03T10:00:00Z',
    reason: 'approve keyword bid adjustments',
    ...overrides,
  };
}

describe('MissionGrant', () => {
  describe('calculateResidualAuthority', () => {
    it('returns remaining slots for active grant', () => {
      const grant = makeGrant({ status: 'active', usedSlots: 2 });
      const result = calculateResidualAuthority(grant);

      expect(result.isValid).toBe(true);
      expect(result.remainingSlots).toBe(3);
      expect(result.remainingBudget).toBe(50);
    });

    it('returns 0 slots when fully consumed', () => {
      const grant = makeGrant({ status: 'fully_consumed', usedSlots: 5 });
      const result = calculateResidualAuthority(grant);

      expect(result.isValid).toBe(false);
      expect(result.remainingSlots).toBe(0);
      expect(result.invalidReason).toBe('已用尽');
    });

    it('returns 0 slots when revoked', () => {
      const grant = makeGrant({ status: 'revoked' });
      const result = calculateResidualAuthority(grant);

      expect(result.isValid).toBe(false);
      expect(result.remainingSlots).toBe(0);
      expect(result.invalidReason).toBe('已撤销');
    });

    it('returns 0 slots when invalidated', () => {
      const grant = makeGrant({ status: 'invalidated' });
      const result = calculateResidualAuthority(grant);

      expect(result.isValid).toBe(false);
      expect(result.remainingSlots).toBe(0);
      expect(result.invalidReason).toBe('已失效');
    });

    it('returns 0 slots when expired', () => {
      const pastExpiry = new Date(Date.now() - 60000).toISOString();
      const grant = makeGrant({ expiresAt: pastExpiry });
      const result = calculateResidualAuthority(grant);

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('已过期');
    });

    it('treats usedSlots >= maxSlots as fully consumed', () => {
      const grant = makeGrant({ usedSlots: 5 });
      const result = calculateResidualAuthority(grant);

      expect(result.isValid).toBe(false);
      expect(result.remainingSlots).toBe(0);
      expect(result.invalidReason).toBe('无可用配额');
    });

    it('handles future expiry correctly', () => {
      const futureExpiry = new Date(Date.now() + 3600000).toISOString();
      const grant = makeGrant({ expiresAt: futureExpiry, status: 'active' });
      const result = calculateResidualAuthority(grant);

      expect(result.isValid).toBe(true);
      expect(result.remainingSlots).toBe(5);
    });

    it('handles partially_consumed status', () => {
      const grant = makeGrant({ status: 'partially_consumed', usedSlots: 1 });
      const result = calculateResidualAuthority(grant);

      expect(result.isValid).toBe(true);
      expect(result.remainingSlots).toBe(4);
    });
  });

  describe('GRANT_STATUS_LABELS', () => {
    it('provides Chinese label for each status', () => {
      expect(GRANT_STATUS_LABELS.issued).toBe('已签发');
      expect(GRANT_STATUS_LABELS.active).toBe('有效');
      expect(GRANT_STATUS_LABELS.partially_consumed).toBe('部分使用');
      expect(GRANT_STATUS_LABELS.fully_consumed).toBe('已用尽');
      expect(GRANT_STATUS_LABELS.expired).toBe('已过期');
      expect(GRANT_STATUS_LABELS.revoked).toBe('已撤销');
      expect(GRANT_STATUS_LABELS.invalidated).toBe('已失效');
    });
  });

  describe('validateMissionGrantRecord', () => {
    it('accepts valid grant', async () => {
      const { validateMissionGrantRecord } = await import('./mission-grant-domain');

      const grant = makeGrant();
      expect(() => validateMissionGrantRecord(grant)).not.toThrow();
    });

    it('rejects missing required fields', async () => {
      const { validateMissionGrantRecord } = await import('./mission-grant-domain');

      const grant = makeGrant({ grantId: '' });
      expect(() => validateMissionGrantRecord(grant)).toThrow('Grant ID is required');
    });

    it('rejects non-USD currency', async () => {
      const { validateMissionGrantRecord } = await import('./mission-grant-domain');

      const grant = makeGrant({ scope: { ...makeGrant().scope, currency: 'CNY' } });
      expect(() => validateMissionGrantRecord(grant)).toThrow('Only USD currency is supported');
    });

    it('rejects invalid timestamps', async () => {
      const { validateMissionGrantRecord } = await import('./mission-grant-domain');

      const grant = makeGrant({ issuedAt: 'invalid-date' });
      expect(() => validateMissionGrantRecord(grant)).toThrow('Invalid issued timestamp');
    });

    it('rejects expires before issued', async () => {
      const { validateMissionGrantRecord } = await import('./mission-grant-domain');

      const grant = makeGrant({
        issuedAt: '2026-09-03T12:00:00Z',
        expiresAt: '2026-09-03T10:00:00Z',
      });
      expect(() => validateMissionGrantRecord(grant)).toThrow('Expires timestamp must be after issued timestamp');
    });

    it('rejects invalid used slots', async () => {
      const { validateMissionGrantRecord } = await import('./mission-grant-domain');

      const grant = makeGrant({ usedSlots: -1 });
      expect(() => validateMissionGrantRecord(grant)).toThrow('Used slots must be between 0 and max slots');
    });
  });

  describe('validateCreateGrantInput', () => {
    it('accepts valid input', async () => {
      const { validateCreateGrantInput } = await import('./mission-grant-domain');
      const { CreateGrantInput } = await import('./mission-grant-domain');

      const input = {
        storeId: 'jf-us',
        missionId: 'mission-001',
        missionRevision: 1,
        decisionIds: ['dec-001'],
        issuer: 'human_operator' as const,
        issuedBy: 'operator-1',
        scope: {
          entityIds: ['kw-001'],
          actionType: 'adjust_keyword_bid',
          maxChangePercent: 10,
          currency: 'USD',
        },
        limits: {
          maxSlots: 5,
        },
        evidenceRequirement: {
          requiresBeforeScreenshot: true,
          requiresAfterScreenshot: true,
          requiresReloadScreenshot: true,
          requiresValueReadback: true,
        },
        reason: 'Test grant',
      };

      expect(() => validateCreateGrantInput(input)).not.toThrow();
    });

    it('rejects non-USD currency', async () => {
      const { validateCreateGrantInput } = await import('./mission-grant-domain');

      const input = {
        storeId: 'jf-us',
        missionId: 'mission-001',
        missionRevision: 1,
        decisionIds: [],
        issuer: 'human_operator' as const,
        issuedBy: 'op-1',
        scope: { entityIds: [], actionType: 'test', currency: 'EUR' },
        limits: { maxSlots: 1 },
        evidenceRequirement: {
          requiresBeforeScreenshot: true,
          requiresAfterScreenshot: true,
          requiresReloadScreenshot: true,
          requiresValueReadback: true,
        },
        reason: 'Test',
      };

      expect(() => validateCreateGrantInput(input)).toThrow('Only USD currency is supported');
    });
  });

  describe('buildMissionGrantRecord', () => {
    it('builds grant with issued status', async () => {
      const { buildMissionGrantRecord } = await import('./mission-grant-domain');

      const input = {
        storeId: 'jf-us',
        missionId: 'mission-001',
        missionRevision: 1,
        decisionIds: ['dec-001'],
        issuer: 'policy_runtime' as const,
        issuedBy: 'policy-v1',
        scope: {
          entityIds: ['kw-001'],
          actionType: 'adjust_keyword_bid',
          maxChangePercent: 15,
          currency: 'USD',
        },
        limits: {
          maxSlots: 10,
          maxBudget: 100,
        },
        evidenceRequirement: {
          requiresBeforeScreenshot: true,
          requiresAfterScreenshot: true,
          requiresReloadScreenshot: true,
          requiresValueReadback: true,
        },
        reason: 'Policy-bounded automation',
      };

      const grant = buildMissionGrantRecord('grant-001', input);

      expect(grant.grantId).toBe('grant-001');
      expect(grant.status).toBe('issued');
      expect(grant.usedSlots).toBe(0);
      expect(grant.createdAt).toBeDefined();
    });
  });

  describe('buildGrantLifecycleEvent', () => {
    it('builds lifecycle event', async () => {
      const { buildGrantLifecycleEvent } = await import('./mission-grant-domain');

      const event = buildGrantLifecycleEvent({
        eventId: 'evt-001',
        grantId: 'grant-001',
        eventType: 'slot_reserved',
        slotIndex: 0,
        executionId: 'exec-001',
      });

      expect(event.eventType).toBe('slot_reserved');
      expect(event.slotIndex).toBe(0);
      expect(event.timestamp).toBeDefined();
    });
  });

  describe('isGrantTerminal', () => {
    it('identifies terminal statuses', async () => {
      const { isGrantTerminal } = await import('./mission-grant-domain');

      expect(isGrantTerminal('fully_consumed')).toBe(true);
      expect(isGrantTerminal('expired')).toBe(true);
      expect(isGrantTerminal('revoked')).toBe(true);
      expect(isGrantTerminal('invalidated')).toBe(true);
    });

    it('identifies non-terminal statuses', async () => {
      const { isGrantTerminal } = await import('./mission-grant-domain');

      expect(isGrantTerminal('issued')).toBe(false);
      expect(isGrantTerminal('active')).toBe(false);
      expect(isGrantTerminal('partially_consumed')).toBe(false);
    });
  });

  describe('canReserveSlot', () => {
    it('returns true for active grant with remaining slots', async () => {
      const { canReserveSlot } = await import('./mission-grant-domain');

      const grant = makeGrant({ status: 'active', usedSlots: 2 });
      expect(canReserveSlot(grant)).toBe(true);
    });

    it('returns false for fully consumed grant', async () => {
      const { canReserveSlot } = await import('./mission-grant-domain');

      const grant = makeGrant({ status: 'fully_consumed', usedSlots: 5 });
      expect(canReserveSlot(grant)).toBe(false);
    });

    it('returns false for revoked grant', async () => {
      const { canReserveSlot } = await import('./mission-grant-domain');

      const grant = makeGrant({ status: 'revoked' });
      expect(canReserveSlot(grant)).toBe(false);
    });

    it('returns false when no slots remain', async () => {
      const { canReserveSlot } = await import('./mission-grant-domain');

      const grant = makeGrant({ status: 'active', usedSlots: 5 });
      expect(canReserveSlot(grant)).toBe(false);
    });
  });
});
