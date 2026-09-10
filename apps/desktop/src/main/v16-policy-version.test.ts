import { normalizeStoreId, normalizeBusinessDate } from '@amazon-ai-ops/shared-types';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
/**
 * V1.6 Policy Version Tests
 */

import { describe, it, expect } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  evaluatePolicyGates,
  evaluatePolicyEligibility,
  PolicyError,
  PolicyStore,
  PolicyVersionService,
} from './v16-policy-version';

const ctx: StoreContextEnvelope = normalizeStoreContextEnvelope({browserProfileId: 'profile-store-a', businessTimezone: 'America/Los_Angeles',
  storeId: normalizeStoreId('store-a'),
  marketplace: 'US',
  currency: 'USD',
  businessDate: normalizeBusinessDate('2026-09-03'),
  sessionGeneration: 1,
});

const baseInput = {
  scope: { actionTypes: ['adjust_keyword_bid'] as ('adjust_keyword_bid')[] },
  limits: { maxChangePercent: 10, maxSlotsPerGrant: 3, maxDailyCount: 50, cooldownMinutes: 5 },
  window: { activeFrom: '2026-09-01T00:00:00Z', businessHoursOnly: false, timezone: 'America/Los_Angeles' },
  evidence: {
    requiresBeforeScreenshot: true,
    requiresAfterScreenshot: true,
    requiresReloadScreenshot: true,
    requiresValueReadback: true,
    requiresOperatorNote: false,
  },
  reason: 'plan A',
};

describe('V16PolicyVersionService', () => {
  it('create writes draft policy at revision 1', () => {
    const svc = new PolicyVersionService(ctx);
    const p = svc.create({ ...baseInput, mode: 'manual_approval' });
    expect(p.status).toBe('draft');
    expect(p.revision).toBe(1);
  });

  it('create rejects empty actionTypes', () => {
    const svc = new PolicyVersionService(ctx);
    expect(() =>
      svc.create({ ...baseInput, mode: 'manual_approval', scope: { actionTypes: [] } }),
    ).toThrow(/at least one/);
  });

  it('create rejects invalid maxChangePercent', () => {
    const svc = new PolicyVersionService(ctx);
    expect(() =>
      svc.create({
        ...baseInput,
        mode: 'manual_approval',
        limits: { ...baseInput.limits, maxChangePercent: 0 },
      }),
    ).toThrow(/maxChangePercent/);
    expect(() =>
      svc.create({
        ...baseInput,
        mode: 'manual_approval',
        limits: { ...baseInput.limits, maxChangePercent: 150 },
      }),
    ).toThrow(/maxChangePercent/);
  });

  it('enable requires non-empty reason', () => {
    const svc = new PolicyVersionService(ctx);
    const p = svc.create({ ...baseInput, mode: 'manual_approval' });
    expect(() => svc.enable(p.policyVersionId, 'operator', '')).toThrow(/non-empty/);
  });

  it('enable transitions draft -> enabled and stamps enabledAt', () => {
    const svc = new PolicyVersionService(ctx);
    const p = svc.create({ ...baseInput, mode: 'manual_approval' });
    const e = svc.enable(p.policyVersionId, 'operator', 'go live');
    expect(e.status).toBe('enabled');
    expect(e.enabledAt).toBeTruthy();
  });

  it('supersede produces new draft at next revision and marks source superseded', () => {
    const svc = new PolicyVersionService(ctx);
    const p = svc.create({ ...baseInput, mode: 'manual_approval' });
    const e = svc.enable(p.policyVersionId, 'operator', 'go live');
    const next = svc.supersede({
      sourcePolicyVersionId: e.policyVersionId,
      overrides: { limits: { maxChangePercent: 12 } },
      reason: 'tighten',
    });
    expect(next.revision).toBe(2);
    expect(next.status).toBe('draft');
    const source = svc.get(e.policyVersionId);
    expect(source?.status).toBe('superseded');
  });

  it('supersede requires non-empty reason', () => {
    const svc = new PolicyVersionService(ctx);
    const p = svc.create({ ...baseInput, mode: 'manual_approval' });
    const e = svc.enable(p.policyVersionId, 'operator', 'go live');
    expect(() =>
      svc.supersede({ sourcePolicyVersionId: e.policyVersionId, overrides: {}, reason: '' }),
    ).toThrow(/non-empty/);
  });

  it('cannot supersede draft policy', () => {
    const svc = new PolicyVersionService(ctx);
    const p = svc.create({ ...baseInput, mode: 'manual_approval' });
    expect(() =>
      svc.supersede({ sourcePolicyVersionId: p.policyVersionId, overrides: {}, reason: 'x' }),
    ).toThrow(/Only enabled/);
  });

  it('toggleKillSwitch records stops state', () => {
    const svc = new PolicyVersionService(ctx);
    const p = svc.create({ ...baseInput, mode: 'policy_auto' });
    const killed = svc.toggleKillSwitch(p.policyVersionId, true, 'emergency');
    expect(killed.stops.killSwitchOn).toBe(true);
    expect(killed.stops.reason).toBe('emergency');
  });

  it('cross-store validation rejects operations on wrong store', () => {
    const sharedStore: PolicyStore = {
      policies: new Map(),
      storeIndex: new Map(),
    };
    const svc = new PolicyVersionService(ctx, sharedStore);
    const p = svc.create({ ...baseInput, mode: 'manual_approval' });
    const foreignSvc = new PolicyVersionService({ ...ctx, storeId: normalizeStoreId('store-b') }, sharedStore);
    expect(() => foreignSvc.enable(p.policyVersionId, 'operator', 'x')).toThrow(/mismatch/);
  });
});

describe('evaluatePolicyGates', () => {
  it('passes when no gate is blocked', () => {
    const r = evaluatePolicyGates({
      policy: null,
      grantRemainingSlots: 3,
      expectedRevision: 1,
      actualRevision: 1,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
    });
    expect(r.passed).toBe(true);
    expect(r.blockedGates).toEqual([]);
  });

  it('P0 when kill switch on', () => {
    const r = evaluatePolicyGates({
      policy: {
        stops: { killSwitchOn: true, circuitBreakerTriggered: false },
      } as never,
      grantRemainingSlots: 3,
      expectedRevision: 1,
      actualRevision: 1,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
    });
    expect(r.blockedGates).toContain('P0_KILL_SWITCH');
  });

  it('P3 when revision mismatches', () => {
    const r = evaluatePolicyGates({
      policy: null,
      grantRemainingSlots: 3,
      expectedRevision: 1,
      actualRevision: 2,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
    });
    expect(r.blockedGates).toContain('P3_REVISION_MISMATCH');
  });

  it('P4 when no slots remain', () => {
    const r = evaluatePolicyGates({
      policy: null,
      grantRemainingSlots: 0,
      expectedRevision: 1,
      actualRevision: 1,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
    });
    expect(r.blockedGates).toContain('P4_GRANT_INVALID');
  });

  it('P5 when actionType not in policy scope', () => {
    const r = evaluatePolicyGates({
      policy: { scope: { actionTypes: ['pause_keyword'] } } as never,
      grantRemainingSlots: 3,
      expectedRevision: 1,
      actualRevision: 1,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
    });
    expect(r.blockedGates).toContain('P5_SCOPE_MISMATCH');
  });

  it('P5 when entityId not in entity allowlist', () => {
    const r = evaluatePolicyGates({
      policy: { scope: { actionTypes: ['adjust_keyword_bid'], entityIds: ['kw-2'] } } as never,
      grantRemainingSlots: 3,
      expectedRevision: 1,
      actualRevision: 1,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
    });
    expect(r.blockedGates).toContain('P5_SCOPE_MISMATCH');
  });

  it('P2 when context mismatch flag is true', () => {
    const r = evaluatePolicyGates({
      policy: null,
      grantRemainingSlots: 3,
      expectedRevision: 1,
      actualRevision: 1,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      contextMismatch: true,
    });
    expect(r.blockedGates).toContain('P2_CONTEXT_MISMATCH');
    expect(r.primaryBlocker).toBe('P2_CONTEXT_MISMATCH');
  });

  it('P6 when evidence missing flag is true', () => {
    const r = evaluatePolicyGates({
      policy: null,
      grantRemainingSlots: 3,
      expectedRevision: 1,
      actualRevision: 1,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      evidenceMissing: true,
    });
    expect(r.blockedGates).toContain('P6_EVIDENCE_REQUIRED');
  });

  it('primaryBlocker picks highest-priority failing gate (P0 before P3)', () => {
    const r = evaluatePolicyGates({
      policy: { stops: { killSwitchOn: true, circuitBreakerTriggered: false } } as never,
      grantRemainingSlots: 3,
      expectedRevision: 1,
      actualRevision: 2,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
    });
    expect(r.blockedGates).toContain('P0_KILL_SWITCH');
    expect(r.blockedGates).toContain('P3_REVISION_MISMATCH');
    expect(r.primaryBlocker).toBe('P0_KILL_SWITCH');
  });

  it('primaryBlocker is null when all gates pass', () => {
    const r = evaluatePolicyGates({
      policy: null,
      grantRemainingSlots: 3,
      expectedRevision: 1,
      actualRevision: 1,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
    });
    expect(r.primaryBlocker).toBeNull();
  });

  it('primaryBlocker picks P5 over P6 when both fail', () => {
    const r = evaluatePolicyGates({
      policy: { scope: { actionTypes: ['pause_keyword'] } } as never,
      grantRemainingSlots: 3,
      expectedRevision: 1,
      actualRevision: 1,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      evidenceMissing: true,
    });
    expect(r.primaryBlocker).toBe('P5_SCOPE_MISMATCH');
  });

  it('evaluatePolicyGates survives policy mock without scope (defensive)', () => {
    // If the runtime passes only the bits it knows, we should not crash.
    const r = evaluatePolicyGates({
      policy: { stops: { killSwitchOn: true, circuitBreakerTriggered: true } } as never,
      grantRemainingSlots: 0,
      expectedRevision: 1,
      actualRevision: 9,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
    });
    expect(r.blockedGates.length).toBeGreaterThan(0);
    expect(r.primaryBlocker).toBe('P0_KILL_SWITCH');
  });
});

describe('evaluatePolicyEligibility', () => {
  const policy = {
    policyVersionId: 'p1',
    storeId: normalizeStoreId('store-a'),
    mode: 'policy_auto' as const,
    status: 'enabled' as const,
    revision: 1,
    scope: { actionTypes: ['adjust_keyword_bid'] as ('adjust_keyword_bid')[] },
    limits: { maxChangePercent: 10, maxSlotsPerGrant: 3, maxDailyCount: 50, cooldownMinutes: 5 },
    window: { activeFrom: '2026-09-01T00:00:00Z', businessHoursOnly: false, timezone: 'America/Los_Angeles' },
    evidence: {
      requiresBeforeScreenshot: true,
      requiresAfterScreenshot: true,
      requiresReloadScreenshot: true,
      requiresValueReadback: true,
      requiresOperatorNote: false,
    },
    stops: { killSwitchOn: false, circuitBreakerTriggered: false },
    createdAt: '2026-09-01T00:00:00Z',
    enabledBy: 'operator',
    reason: 'plan A',
  };

  const baseProposal = {
    actionType: 'adjust_keyword_bid' as const,
    entityId: 'kw-1',
    currentValue: 1.0,
    proposedValue: 1.05,
    businessDate: normalizeBusinessDate('2026-09-03'),
    businessHourLocal: '10:00',
    localTimezone: 'America/Los_Angeles',
  };

  it('eligible when all checks pass', () => {
    const r = evaluatePolicyEligibility({
      policy: policy as never,
      proposal: baseProposal,
      dailyActionCount: 0,
      lastActionAt: null,
      grantBudgetUsed: 0,
      proposalImpact: 0.05,
    });
    expect(r.eligible).toBe(true);
    expect(r.failureCodes).toEqual([]);
  });

  it('rejects when policy not enabled', () => {
    const r = evaluatePolicyEligibility({
      policy: { ...policy, status: 'draft' } as never,
      proposal: baseProposal,
      dailyActionCount: 0,
      lastActionAt: null,
      grantBudgetUsed: 0,
      proposalImpact: 0.05,
    });
    expect(r.failureCodes).toContain('POLICY_NOT_ENABLED');
  });

  it('rejects when actionType out of scope', () => {
    const r = evaluatePolicyEligibility({
      policy: policy as never,
      proposal: { ...baseProposal, actionType: 'pause_campaign' },
      dailyActionCount: 0,
      lastActionAt: null,
      grantBudgetUsed: 0,
      proposalImpact: 0,
    });
    expect(r.failureCodes).toContain('POLICY_ACTION_OUT_OF_SCOPE');
  });

  it('rejects when entityId not in allowlist', () => {
    const r = evaluatePolicyEligibility({
      policy: { ...policy, scope: { actionTypes: ['adjust_keyword_bid'], entityIds: ['kw-2'] } } as never,
      proposal: baseProposal,
      dailyActionCount: 0,
      lastActionAt: null,
      grantBudgetUsed: 0,
      proposalImpact: 0,
    });
    expect(r.failureCodes).toContain('POLICY_ENTITY_OUT_OF_SCOPE');
  });

  it('rejects when change pct exceeds limit', () => {
    const r = evaluatePolicyEligibility({
      policy: policy as never,
      proposal: { ...baseProposal, currentValue: 1.0, proposedValue: 1.5 },
      dailyActionCount: 0,
      lastActionAt: null,
      grantBudgetUsed: 0,
      proposalImpact: 0.5,
    });
    expect(r.failureCodes).toContain('POLICY_CHANGE_PCT_EXCEEDED');
  });

  it('rejects when daily action count exceeded', () => {
    const r = evaluatePolicyEligibility({
      policy: policy as never,
      proposal: baseProposal,
      dailyActionCount: 51,
      lastActionAt: null,
      grantBudgetUsed: 0,
      proposalImpact: 0.05,
    });
    expect(r.failureCodes).toContain('POLICY_DAILY_COUNT_EXCEEDED');
  });

  it('rejects when cooldown still active', () => {
    const r = evaluatePolicyEligibility({
      policy: policy as never,
      proposal: baseProposal,
      dailyActionCount: 0,
      lastActionAt: new Date().toISOString(),
      grantBudgetUsed: 0,
      proposalImpact: 0.05,
    });
    expect(r.failureCodes).toContain('POLICY_COOLDOWN_ACTIVE');
  });

  it('rejects when budget exceeded', () => {
    const r = evaluatePolicyEligibility({
      policy: { ...policy, limits: { ...policy.limits, budgetCapPerGrant: 0.1 } } as never,
      proposal: baseProposal,
      dailyActionCount: 0,
      lastActionAt: null,
      grantBudgetUsed: 0.5,
      proposalImpact: 0.5,
    });
    expect(r.failureCodes).toContain('POLICY_BUDGET_EXCEEDED');
  });

  it('rejects when businessHoursOnly window inactive', () => {
    const bizPolicy = {
      ...policy,
      window: {
        activeFrom: '2026-09-01T00:00:00Z',
        businessHoursOnly: true,
        activeFromLocal: '09:00',
        activeUntilLocal: '18:00',
        timezone: 'America/Los_Angeles',
      },
    } as never;
    const r = evaluatePolicyEligibility({
      policy: bizPolicy,
      proposal: { ...baseProposal, businessHourLocal: '20:00' },
      dailyActionCount: 0,
      lastActionAt: null,
      grantBudgetUsed: 0,
      proposalImpact: 0.05,
    });
    expect(r.failureCodes).toContain('POLICY_WINDOW_INACTIVE');
  });
});
