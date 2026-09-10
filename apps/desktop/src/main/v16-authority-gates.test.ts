import { normalizeStoreId, normalizeBusinessDate } from '@amazon-ai-ops/shared-types';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
/**
 * V1.6 Authority Gates Tests
 *
 * Covers:
 *  - All three phase contracts (grant_issuance, just_before_submit, post_submit_readback)
 *  - Primary blocker selection across priority
 *  - All gates AND'd (priority doesn't skip)
 *  - Recovery hint mapping
 */

import { describe, it, expect } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  AUTHORITY_GATE_PRIORITY_ORDER,
  describeRecoveryHint,
  evaluateAuthorityGates,
} from './v16-authority-gates';

const baseCtx: StoreContextEnvelope = normalizeStoreContextEnvelope({browserProfileId: 'profile-store-a', businessTimezone: 'America/Los_Angeles',
  storeId: normalizeStoreId('store-a'),
  marketplace: 'US',
  currency: 'USD',
  businessDate: normalizeBusinessDate('2026-09-03'),
  sessionGeneration: 1,
});

const enabledPolicy = {
  policyVersionId: 'p1',
  storeId: normalizeStoreId('store-a'),
  mode: 'policy_auto',
  status: 'enabled',
  revision: 1,
  scope: { actionTypes: ['adjust_keyword_bid'] },
  limits: { maxChangePercent: 10, maxSlotsPerGrant: 3, maxDailyCount: 50, cooldownMinutes: 5 },
  window: {
    activeFrom: '2026-09-01T00:00:00Z',
    businessHoursOnly: false,
    timezone: 'America/Los_Angeles',
  },
  evidence: {
    requiresBeforeScreenshot: true,
    requiresAfterScreenshot: true,
    requiresReloadScreenshot: true,
    requiresValueReadback: true,
    requiresOperatorNote: false,
  },
  stops: { killSwitchOn: false, circuitBreakerTriggered: false },
  createdAt: '2026-09-01T00:00:00Z',
  enabledBy: 'op',
  reason: 'go',
};

describe('evaluateAuthorityGates — grant_issuance', () => {
  it('passes when all gates ok', () => {
    const r = evaluateAuthorityGates({
      phase: 'grant_issuance',
      expectedBatchCompleteness: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedModeRevision: 1,
      actualModeRevision: 1,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      batchIndividuallyValidated: true,
    });
    expect(r.passed).toBe(true);
    expect(r.primaryBlocker).toBeNull();
  });

  it('P0 when kill switch on', () => {
    const r = evaluateAuthorityGates({
      phase: 'grant_issuance',
      expectedBatchCompleteness: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedModeRevision: 1,
      actualModeRevision: 1,
      policy: { ...enabledPolicy, stops: { killSwitchOn: true, circuitBreakerTriggered: false } } as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      batchIndividuallyValidated: true,
    });
    expect(r.primaryBlocker).toBe('P0_KILL_SWITCH');
  });

  it('P3 when policy revision mismatches', () => {
    const r = evaluateAuthorityGates({
      phase: 'grant_issuance',
      expectedBatchCompleteness: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 2,
      expectedModeRevision: 1,
      actualModeRevision: 1,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      batchIndividuallyValidated: true,
    });
    expect(r.blockedGates).toContain('P3_REVISION_MISMATCH');
  });

  it('P3 when mode revision mismatches', () => {
    const r = evaluateAuthorityGates({
      phase: 'grant_issuance',
      expectedBatchCompleteness: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedModeRevision: 1,
      actualModeRevision: 2,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      batchIndividuallyValidated: true,
    });
    expect(r.blockedGates).toContain('P3_REVISION_MISMATCH');
  });

  it('P4 when no slots remain', () => {
    const r = evaluateAuthorityGates({
      phase: 'grant_issuance',
      expectedBatchCompleteness: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedModeRevision: 1,
      actualModeRevision: 1,
      policy: enabledPolicy as never,
      grantRemainingSlots: 0,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      batchIndividuallyValidated: true,
    });
    expect(r.primaryBlocker).toBe('P4_GRANT_INVALID');
  });

  it('P5 when actionType not in policy scope', () => {
    const r = evaluateAuthorityGates({
      phase: 'grant_issuance',
      expectedBatchCompleteness: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedModeRevision: 1,
      actualModeRevision: 1,
      policy: { ...enabledPolicy, scope: { actionTypes: ['pause_keyword'] } } as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      batchIndividuallyValidated: true,
    });
    expect(r.primaryBlocker).toBe('P5_SCOPE_MISMATCH');
  });

  it('P6 when batch is incomplete', () => {
    const r = evaluateAuthorityGates({
      phase: 'grant_issuance',
      expectedBatchCompleteness: false,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedModeRevision: 1,
      actualModeRevision: 1,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      batchIndividuallyValidated: true,
    });
    expect(r.blockedGates).toContain('P6_EVIDENCE_REQUIRED');
  });

  it('P6 when batch is not individually validated', () => {
    const r = evaluateAuthorityGates({
      phase: 'grant_issuance',
      expectedBatchCompleteness: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedModeRevision: 1,
      actualModeRevision: 1,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      batchIndividuallyValidated: false,
    });
    expect(r.blockedGates).toContain('P6_EVIDENCE_REQUIRED');
  });
});

describe('evaluateAuthorityGates — just_before_submit', () => {
  it('passes when all checks ok', () => {
    const r = evaluateAuthorityGates({
      phase: 'just_before_submit',
      ctx: baseCtx,
      currentCtx: baseCtx,
      adsIdentityMatches: true,
      adsSessionLive: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedActionRevision: 1,
      actualActionRevision: 1,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      evidenceFresh: true,
      expectedBeforeMatches: true,
      uniqueIntent: true,
    });
    expect(r.passed).toBe(true);
  });

  it('P2 when context drifts', () => {
    const r = evaluateAuthorityGates({
      phase: 'just_before_submit',
      ctx: baseCtx,
      currentCtx: { ...baseCtx, sessionGeneration: 2 },
      adsIdentityMatches: true,
      adsSessionLive: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedActionRevision: 1,
      actualActionRevision: 1,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      evidenceFresh: true,
      expectedBeforeMatches: true,
      uniqueIntent: true,
    });
    expect(r.primaryBlocker).toBe('P2_CONTEXT_MISMATCH');
  });

  it('P2 when Ads session dropped', () => {
    const r = evaluateAuthorityGates({
      phase: 'just_before_submit',
      ctx: baseCtx,
      currentCtx: baseCtx,
      adsIdentityMatches: true,
      adsSessionLive: false,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedActionRevision: 1,
      actualActionRevision: 1,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      evidenceFresh: true,
      expectedBeforeMatches: true,
      uniqueIntent: true,
    });
    expect(r.primaryBlocker).toBe('P2_CONTEXT_MISMATCH');
  });

  it('P2 when Ads identity mismatches', () => {
    const r = evaluateAuthorityGates({
      phase: 'just_before_submit',
      ctx: baseCtx,
      currentCtx: baseCtx,
      adsIdentityMatches: false,
      adsSessionLive: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedActionRevision: 1,
      actualActionRevision: 1,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      evidenceFresh: true,
      expectedBeforeMatches: true,
      uniqueIntent: true,
    });
    expect(r.primaryBlocker).toBe('P2_CONTEXT_MISMATCH');
  });

  it('P3 when action revision mismatches', () => {
    const r = evaluateAuthorityGates({
      phase: 'just_before_submit',
      ctx: baseCtx,
      currentCtx: baseCtx,
      adsIdentityMatches: true,
      adsSessionLive: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedActionRevision: 1,
      actualActionRevision: 2,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      evidenceFresh: true,
      expectedBeforeMatches: true,
      uniqueIntent: true,
    });
    expect(r.blockedGates).toContain('P3_REVISION_MISMATCH');
  });

  it('P6 when evidence not fresh', () => {
    const r = evaluateAuthorityGates({
      phase: 'just_before_submit',
      ctx: baseCtx,
      currentCtx: baseCtx,
      adsIdentityMatches: true,
      adsSessionLive: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedActionRevision: 1,
      actualActionRevision: 1,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      evidenceFresh: false,
      expectedBeforeMatches: true,
      uniqueIntent: true,
    });
    expect(r.blockedGates).toContain('P6_EVIDENCE_REQUIRED');
  });

  it('P6 when expected-before value mismatches', () => {
    const r = evaluateAuthorityGates({
      phase: 'just_before_submit',
      ctx: baseCtx,
      currentCtx: baseCtx,
      adsIdentityMatches: true,
      adsSessionLive: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedActionRevision: 1,
      actualActionRevision: 1,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      evidenceFresh: true,
      expectedBeforeMatches: false,
      uniqueIntent: true,
    });
    expect(r.blockedGates).toContain('P6_EVIDENCE_REQUIRED');
  });

  it('P6 when intent is duplicate', () => {
    const r = evaluateAuthorityGates({
      phase: 'just_before_submit',
      ctx: baseCtx,
      currentCtx: baseCtx,
      adsIdentityMatches: true,
      adsSessionLive: true,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedActionRevision: 1,
      actualActionRevision: 1,
      policy: enabledPolicy as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      evidenceFresh: true,
      expectedBeforeMatches: true,
      uniqueIntent: false,
    });
    expect(r.blockedGates).toContain('P6_EVIDENCE_REQUIRED');
  });

  it('primaryBlocker priority: P0 over P2 over P6', () => {
    const r = evaluateAuthorityGates({
      phase: 'just_before_submit',
      ctx: baseCtx,
      currentCtx: { ...baseCtx, sessionGeneration: 2 },
      adsIdentityMatches: false,
      adsSessionLive: false,
      expectedPolicyAuthorityRevision: 1,
      actualPolicyAuthorityRevision: 1,
      expectedActionRevision: 1,
      actualActionRevision: 1,
      policy: { ...enabledPolicy, stops: { killSwitchOn: true, circuitBreakerTriggered: false } } as never,
      grantRemainingSlots: 3,
      entityId: 'kw-1',
      actionType: 'adjust_keyword_bid',
      evidenceFresh: false,
      expectedBeforeMatches: false,
      uniqueIntent: false,
    });
    expect(r.primaryBlocker).toBe('P0_KILL_SWITCH');
    expect(r.blockedGates).toContain('P2_CONTEXT_MISMATCH');
    expect(r.blockedGates).toContain('P6_EVIDENCE_REQUIRED');
  });
});

describe('evaluateAuthorityGates — post_submit_readback', () => {
  it('passes when readback proofs all present and context holds', () => {
    const r = evaluateAuthorityGates({
      phase: 'post_submit_readback',
      ctx: baseCtx,
      currentCtx: baseCtx,
      adsIdentityMatches: true,
      adsSessionLive: true,
      hasBeforeProof: true,
      hasAfterProof: true,
      hasReloadProof: true,
      readbackValueVerifiable: true,
    });
    expect(r.passed).toBe(true);
  });

  it('P2 when identity mismatch at readback', () => {
    const r = evaluateAuthorityGates({
      phase: 'post_submit_readback',
      ctx: baseCtx,
      currentCtx: { ...baseCtx, storeId: normalizeStoreId('store-b') },
      adsIdentityMatches: true,
      adsSessionLive: true,
      hasBeforeProof: true,
      hasAfterProof: true,
      hasReloadProof: true,
      readbackValueVerifiable: true,
    });
    expect(r.primaryBlocker).toBe('P2_CONTEXT_MISMATCH');
  });

  it('P6 when any proof missing', () => {
    const r = evaluateAuthorityGates({
      phase: 'post_submit_readback',
      ctx: baseCtx,
      currentCtx: baseCtx,
      adsIdentityMatches: true,
      adsSessionLive: true,
      hasBeforeProof: true,
      hasAfterProof: false,
      hasReloadProof: true,
      readbackValueVerifiable: true,
    });
    expect(r.primaryBlocker).toBe('P6_EVIDENCE_REQUIRED');
  });

  it('P6 when readback value not verifiable', () => {
    const r = evaluateAuthorityGates({
      phase: 'post_submit_readback',
      ctx: baseCtx,
      currentCtx: baseCtx,
      adsIdentityMatches: true,
      adsSessionLive: true,
      hasBeforeProof: true,
      hasAfterProof: true,
      hasReloadProof: true,
      readbackValueVerifiable: false,
    });
    expect(r.primaryBlocker).toBe('P6_EVIDENCE_REQUIRED');
  });
});

describe('priority order invariants', () => {
  it('AUTHORITY_GATE_PRIORITY_ORDER lists P0 through P6', () => {
    expect(AUTHORITY_GATE_PRIORITY_ORDER).toEqual([
      'P0_KILL_SWITCH',
      'P1_CIRCUIT_BREAKER',
      'P2_CONTEXT_MISMATCH',
      'P3_REVISION_MISMATCH',
      'P4_GRANT_INVALID',
      'P5_SCOPE_MISMATCH',
      'P6_EVIDENCE_REQUIRED',
    ]);
  });
});

describe('describeRecoveryHint', () => {
  it('returns a hint for each gate code', () => {
    for (const code of AUTHORITY_GATE_PRIORITY_ORDER) {
      const hint = describeRecoveryHint({
        passed: false,
        blockedGates: [code],
        primaryBlocker: code,
        phase: 'just_before_submit',
      });
      expect(hint.length).toBeGreaterThan(0);
    }
  });

  it('returns success message when all gates pass', () => {
    const hint = describeRecoveryHint({
      passed: true,
      blockedGates: [],
      primaryBlocker: null,
      phase: 'just_before_submit',
    });
    expect(hint).toMatch(/passed/);
  });
});