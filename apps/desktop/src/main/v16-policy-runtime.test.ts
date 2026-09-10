import { normalizeStoreId, normalizeBusinessDate } from '@amazon-ai-ops/shared-types';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
/**
 * V1.6 Policy Runtime Tests
 *
 * Covers:
 *  - initialise/changeMode/supersedeActivePolicy happy paths
 *  - reason required + CAS enforcement
 *  - pending authority invalidation on mode/policy change
 *  - terminal non-resurrection (mode revert does not undo invalidation)
 */

import { describe, it, expect } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  PolicyRuntime,
  PolicyRuntimeError,
  createRuntimeStore,
  isGrantStillLive,
} from './v16-policy-runtime';

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
  reason: 'initial plan',
};

function bootRuntime(): { rt: PolicyRuntime; store: ReturnType<typeof createRuntimeStore> } {
  const store = createRuntimeStore();
  const rt = new PolicyRuntime(ctx, store);
  rt.initialise({ mode: 'manual_approval', actor: 'operator', reason: 'start' });
  return { rt, store };
}

function makeAndEnablePolicy(rt: PolicyRuntime): string {
  const policy = rt.createPolicy({ ...baseInput, mode: 'policy_auto' });
  rt.enablePolicy(policy.policyVersionId, 'operator', 'enable');
  return policy.policyVersionId;
}

describe('V16PolicyRuntime — initialise', () => {
  it('initialise starts at authorityModeRevision 1 and records audit', () => {
    const { rt } = bootRuntime();
    const s = rt.getState();
    expect(s.authorityModeRevision).toBe(1);
    expect(s.mode).toBe('manual_approval');
    expect(rt.getAudit()).toHaveLength(1);
    expect(rt.getAudit()[0].fromMode).toBeNull();
    expect(rt.getAudit()[0].toMode).toBe('manual_approval');
  });

  it('initialise rejects empty reason', () => {
    const store = createRuntimeStore();
    const rt = new PolicyRuntime(ctx, store);
    expect(() => rt.initialise({ mode: 'manual_approval', actor: 'op', reason: '' })).toThrow(/non-empty/);
  });

  it('initialise rejects activePolicyVersionId that is not enabled', () => {
    const store = createRuntimeStore();
    const rt = new PolicyRuntime(ctx, store);
    const draft = rt.createPolicy({ ...baseInput, mode: 'policy_auto' });
    expect(() =>
      rt.initialise({ mode: 'policy_auto', actor: 'op', reason: 'go', activePolicyVersionId: draft.policyVersionId }),
    ).toThrow(/enabled/);
  });

  it('initialise rejects double init (CAS)', () => {
    const { rt } = bootRuntime();
    expect(() => rt.initialise({ mode: 'policy_auto', actor: 'op', reason: 'again' })).toThrow(
      /already initialised/,
    );
  });
});

describe('V16PolicyRuntime — changeMode', () => {
  it('changeMode increments authorityModeRevision and records audit', () => {
    const { rt } = bootRuntime();
    const before = rt.getState();
    const out = rt.changeMode({
      newMode: 'policy_auto',
      expectedAuthorityModeRevision: before.authorityModeRevision,
      actor: 'op',
      reason: 'switch to policy_auto',
    });
    expect(out.after.authorityModeRevision).toBe(before.authorityModeRevision + 1);
    expect(out.after.mode).toBe('policy_auto');
    expect(out.audit.fromMode).toBe('manual_approval');
    expect(out.audit.toMode).toBe('policy_auto');
  });

  it('changeMode rejects empty reason', () => {
    const { rt } = bootRuntime();
    const before = rt.getState();
    expect(() =>
      rt.changeMode({
        newMode: 'policy_auto',
        expectedAuthorityModeRevision: before.authorityModeRevision,
        actor: 'op',
        reason: '',
      }),
    ).toThrow(/non-empty/);
  });

  it('changeMode rejects wrong revision (CAS)', () => {
    const { rt } = bootRuntime();
    expect(() =>
      rt.changeMode({
        newMode: 'policy_auto',
        expectedAuthorityModeRevision: 99,
        actor: 'op',
        reason: 'oops',
      }),
    ).toThrow(PolicyRuntimeError);
  });

  it('changeMode invalidates pending Grants/Batches/Slots', () => {
    const { rt } = bootRuntime();
    rt.registerPendingGrant('grant-1');
    rt.registerPendingBatch('batch-1');
    rt.registerPendingSlot('slot-1');
    const out = rt.changeMode({
      newMode: 'policy_auto',
      expectedAuthorityModeRevision: 1,
      actor: 'op',
      reason: 'flip',
    });
    const inv = rt.getInvalidations();
    expect(inv).toHaveLength(1);
    expect(inv[0].invalidatesGrantIds).toContain('grant-1');
    expect(inv[0].invalidatesBatchIds).toContain('batch-1');
    expect(inv[0].invalidatesSlotIds).toContain('slot-1');
    expect(inv[0].terminal).toBe(true);
    expect(out.after.authorityModeRevision).toBe(2);
  });

  it('revert to manual_approval does not resurrect invalidated Grants', () => {
    const { rt } = bootRuntime();
    const grantRev = rt.registerPendingGrant('grant-X');
    expect(isGrantStillLive(rt, grantRev)).toBe(true);
    rt.changeMode({
      newMode: 'policy_auto',
      expectedAuthorityModeRevision: 1,
      actor: 'op',
      reason: 'flip',
    });
    // The grant was registered under rev 1, runtime is now at rev 2 → not live.
    expect(isGrantStillLive(rt, grantRev)).toBe(false);
    // Revert back to manual_approval.
    rt.changeMode({
      newMode: 'manual_approval',
      expectedAuthorityModeRevision: 2,
      actor: 'op',
      reason: 'revert',
    });
    // Even at the higher rev, the old grant is still NOT live (terminal).
    expect(isGrantStillLive(rt, grantRev)).toBe(false);
  });

  it('grants registered after the latest change are still live', () => {
    const { rt } = bootRuntime();
    rt.changeMode({
      newMode: 'policy_auto',
      expectedAuthorityModeRevision: 1,
      actor: 'op',
      reason: 'flip',
    });
    const newRev = rt.registerPendingGrant('grant-Y');
    expect(newRev).toBe(2);
    expect(isGrantStillLive(rt, newRev)).toBe(true);
  });
});

describe('V16PolicyRuntime — supersedeActivePolicy', () => {
  it('supersedeActivePolicy swaps active policy and bumps revision', () => {
    const { rt } = bootRuntime();
    const p1 = makeAndEnablePolicy(rt);
    rt.supersedeActivePolicy({
      newPolicyVersionId: p1,
      expectedAuthorityModeRevision: 1,
      actor: 'op',
      reason: 'first policy',
    });
    const before = rt.getState();
    expect(before.activePolicyVersionId).toBe(p1);

    const nextPolicy = rt.supersedePolicy({
      sourcePolicyVersionId: p1,
      overrides: { limits: { maxChangePercent: 12 } },
      reason: 'tighten',
    });
    rt.enablePolicy(nextPolicy.policyVersionId, 'op', 'enable next');

    const out = rt.supersedeActivePolicy({
      newPolicyVersionId: nextPolicy.policyVersionId,
      expectedAuthorityModeRevision: before.authorityModeRevision,
      actor: 'op',
      reason: 'swap to tighter',
    });
    expect(out.after.activePolicyVersionId).toBe(nextPolicy.policyVersionId);
    expect(out.after.authorityModeRevision).toBe(before.authorityModeRevision + 1);
  });

  it('supersedeActivePolicy rejects non-enabled new policy', () => {
    const { rt } = bootRuntime();
    const draft = rt.createPolicy({ ...baseInput, mode: 'policy_auto' });
    expect(() =>
      rt.supersedeActivePolicy({
        newPolicyVersionId: draft.policyVersionId,
        expectedAuthorityModeRevision: 1,
        actor: 'op',
        reason: 'oops',
      }),
    ).toThrow(/enabled/);
  });

  it('supersedeActivePolicy invalidates pending authority', () => {
    const { rt } = bootRuntime();
    const p1 = makeAndEnablePolicy(rt);
    rt.supersedeActivePolicy({
      newPolicyVersionId: p1,
      expectedAuthorityModeRevision: 1,
      actor: 'op',
      reason: 'first',
    });
    rt.registerPendingGrant('grant-A');
    const nextPolicy = rt.supersedePolicy({
      sourcePolicyVersionId: p1,
      overrides: {},
      reason: 'tighten',
    });
    rt.enablePolicy(nextPolicy.policyVersionId, 'op', 'enable next');
    rt.supersedeActivePolicy({
      newPolicyVersionId: nextPolicy.policyVersionId,
      expectedAuthorityModeRevision: 2,
      actor: 'op',
      reason: 'swap',
    });
    expect(rt.getInvalidations().length).toBeGreaterThan(0);
    expect(rt.getInvalidations().some((i) => i.invalidatesGrantIds.includes('grant-A'))).toBe(true);
  });
});

describe('V16PolicyRuntime — pending authority', () => {
  it('registerPendingGrant returns the current revision', () => {
    const { rt } = bootRuntime();
    const rev = rt.registerPendingGrant('g-1');
    expect(rev).toBe(1);
  });

  it('registerPending* throws when runtime not initialised', () => {
    const store = createRuntimeStore();
    const rt = new PolicyRuntime(ctx, store);
    expect(() => rt.registerPendingGrant('g-1')).toThrow(/not initialised/);
  });
});

describe('V16PolicyRuntime — cross-store', () => {
  it('cross-store validate rejects operations on wrong store', () => {
    const store = createRuntimeStore();
    const rtA = new PolicyRuntime(ctx, store);
    rtA.initialise({ mode: 'manual_approval', actor: 'op', reason: 'a' });
    const policy = rtA.createPolicy({ ...baseInput, mode: 'policy_auto' });
    rtA.enablePolicy(policy.policyVersionId, 'op', 'en');
    const rtB = new PolicyRuntime({ ...ctx, storeId: normalizeStoreId('store-b') }, store);
    expect(() =>
      rtB.supersedeActivePolicy({
        newPolicyVersionId: policy.policyVersionId,
        expectedAuthorityModeRevision: 1,
        actor: 'op',
        reason: 'cross',
      }),
    ).toThrow(/mismatch/);
  });
});