import { describe, expect, it } from 'vitest';
import {
  authorizeMissionGrant,
  normalizeOpaqueEvidenceRef,
  normalizeStoreContextEnvelope,
  type MissionGrantRecord,
} from './index';

const context = normalizeStoreContextEnvelope({
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 4,
});

const grant: MissionGrantRecord = {
  id: 'grant-1',
  storeId: context.storeId,
  marketplace: 'US',
  currency: 'USD',
  missionId: 'mission-1',
  missionRevision: 3,
  decisionIds: ['decision-keyword-1'],
  actionRevision: 2,
  allowedActionTypes: ['set_keyword_bid'],
  allowedAdEntityIds: ['keyword-1'],
  maxChangePct: 10,
  totalImpactBudget: 25,
  expiresAt: '2026-07-23T00:00:00.000Z',
  policyVersionId: 'policy-version-2',
  policyRevision: 2,
  requiredEvidence: [
    'before_screenshot',
    'after_screenshot',
    'reload_screenshot',
    'page_identity',
    'readback_value',
  ],
  stopConditions: [
    { code: 'identity_drift', detail: 'Stop on account or object identity drift.' },
    { code: 'expected_before_mismatch', detail: 'Stop when the before value changed.' },
    { code: 'unknown_result', detail: 'Stop when submission outcome is unknown.' },
    { code: 'data_stale', detail: 'Stop when the decision data is stale.' },
    { code: 'impact_budget_exhausted', detail: 'Stop when the batch budget is exhausted.' },
    { code: 'kill_switch', detail: 'Stop when the store kill switch is active.' },
  ],
  issuer: { type: 'policy', actorId: 'policy-engine' },
  issuedAt: '2026-07-22T00:00:00.000Z',
  createdSessionGeneration: 4,
};

function request(overrides: Record<string, unknown> = {}) {
  const authorityOverrides = overrides.authority && typeof overrides.authority === 'object'
    ? overrides.authority as Record<string, unknown>
    : {};
  const { authority: _authority, ...requestOverrides } = overrides;
  return {
    phase: 'completion' as const,
    context,
    grant,
    missionId: 'mission-1',
    missionRevision: 3,
    actionRevision: 2,
    actionType: 'set_keyword_bid' as const,
    adEntityId: 'keyword-1',
    changePct: -8,
    policyVersionId: 'policy-version-2',
    policyRevision: 2,
    availableEvidence: [
      'before_screenshot',
      'after_screenshot',
      'reload_screenshot',
      'page_identity',
      'readback_value',
    ] as const,
    authority: {
      terminalEventType: null,
      cumulativeImpact: 20,
      activeStopConditions: [] as const,
      ...authorityOverrides,
    },
    now: '2026-07-22T10:00:00.000Z',
    ...requestOverrides,
  };
}

describe('MissionGrant authorization contract', () => {
  it('authorizes only an exact store, mission, revision, policy, object, and evidence match', () => {
    expect(authorizeMissionGrant(request())).toEqual({ authorized: true, grantId: 'grant-1' });
  });

  it.each([
    [{ context: { ...context, storeId: 'store-two' } }, 'STORE_MISMATCH'],
    [{ missionRevision: 4 }, 'MISSION_REVISION_MISMATCH'],
    [{ actionRevision: 3 }, 'ACTION_REVISION_MISMATCH'],
    [{ policyVersionId: 'policy-version-3' }, 'POLICY_VERSION_MISMATCH'],
    [{ context: { ...context, sessionGeneration: 5 } }, 'SESSION_GENERATION_MISMATCH'],
    [{ adEntityId: 'keyword-2' }, 'ENTITY_NOT_ALLOWED'],
    [{ changePct: -11 }, 'CHANGE_LIMIT_EXCEEDED'],
    [{ authority: { cumulativeImpact: 26 } }, 'IMPACT_BUDGET_EXCEEDED'],
    [{ availableEvidence: ['before_screenshot'] }, 'REQUIRED_EVIDENCE_MISSING'],
    [{ authority: { activeStopConditions: ['unknown_result'] } }, 'STOP_CONDITION_ACTIVE'],
    [{ authority: { terminalEventType: 'revoked' } }, 'GRANT_TERMINATED'],
    [{ now: '2026-07-23T00:00:00.000Z' }, 'GRANT_EXPIRED'],
  ])('fails closed for %j', (overrides, expectedCode) => {
    expect(authorizeMissionGrant(request(overrides))).toMatchObject({
      authorized: false,
      code: expectedCode,
    });
  });

  it('rejects unsupported marketplace or currency in the authoritative context', () => {
    expect(authorizeMissionGrant(request({ context: { ...context, marketplace: 'CA' } })))
      .toMatchObject({ authorized: false, code: 'INVALID_GRANT' });
    expect(authorizeMissionGrant(request({ context: { ...context, currency: 'CAD' } })))
      .toMatchObject({ authorized: false, code: 'INVALID_GRANT' });
  });

  it('allows execution preflight before after/reload evidence but requires it for completion', () => {
    const preflightEvidence = ['page_identity', 'before_screenshot'] as const;
    expect(authorizeMissionGrant(request({
      phase: 'preflight',
      availableEvidence: preflightEvidence,
    }))).toEqual({ authorized: true, grantId: 'grant-1' });
    expect(authorizeMissionGrant(request({
      phase: 'completion',
      availableEvidence: preflightEvidence,
    }))).toMatchObject({ authorized: false, code: 'REQUIRED_EVIDENCE_MISSING' });
  });

  it('rejects an invalid persisted session generation before authorization', () => {
    expect(authorizeMissionGrant(request({
      grant: { ...grant, createdSessionGeneration: -1 },
    }))).toMatchObject({ authorized: false, code: 'INVALID_GRANT' });
  });

  it('requires a non-empty unique approved-decision batch identity', () => {
    expect(authorizeMissionGrant(request({ grant: { ...grant, decisionIds: [] } })))
      .toMatchObject({ authorized: false, code: 'INVALID_GRANT' });
    expect(authorizeMissionGrant(request({
      grant: { ...grant, decisionIds: ['decision-keyword-1', 'decision-keyword-1'] },
    }))).toMatchObject({ authorized: false, code: 'INVALID_GRANT' });
  });

  it('does not allow a policy or grant to weaken mandatory V1 proof and stop gates', () => {
    expect(authorizeMissionGrant(request({
      grant: { ...grant, requiredEvidence: grant.requiredEvidence.slice(0, -1) },
    }))).toMatchObject({ authorized: false, code: 'INVALID_GRANT' });
    expect(authorizeMissionGrant(request({
      grant: { ...grant, stopConditions: grant.stopConditions.slice(0, -1) },
    }))).toMatchObject({ authorized: false, code: 'INVALID_GRANT' });
  });

  it('returns a fail-closed result instead of throwing for malformed action input', () => {
    expect(() => authorizeMissionGrant(request({ missionId: '../mission-1' })))
      .not.toThrow();
    expect(authorizeMissionGrant(request({ missionId: '../mission-1' })))
      .toMatchObject({ authorized: false, code: 'INVALID_GRANT' });
  });

  it('fails closed when the indivisible execution authority snapshot is omitted or malformed', () => {
    expect(authorizeMissionGrant({ ...request(), authority: null } as never))
      .toMatchObject({ authorized: false, code: 'INVALID_GRANT' });
    expect(authorizeMissionGrant(request({ authority: { activeStopConditions: null } })))
      .toMatchObject({ authorized: false, code: 'INVALID_GRANT' });
    expect(authorizeMissionGrant(request({ authority: { activeStopConditions: ['invented-stop'] } })))
      .toMatchObject({ authorized: false, code: 'INVALID_GRANT' });
  });
});

describe('opaque evidence references', () => {
  it('accepts durable logical ids and rejects local or network paths', () => {
    expect(normalizeOpaqueEvidenceRef('artifact:readback:sha256:abc123'))
      .toBe('artifact:readback:sha256:abc123');
    for (const path of [
      'C:\\evidence\\before.png',
      '\\\\server\\share\\before.png',
      'file:///C:/evidence/before.png',
      'evidence/before.png',
      'evidence\\before.png',
    ]) {
      expect(() => normalizeOpaqueEvidenceRef(path)).toThrow(/opaque logical id/);
    }
  });
});
