/**
 * V1.6 MissionGrant Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StoreContextEnvelope, MissionGrantRecord } from '@amazon-ai-ops/shared-types';
import type { MissionGrantRepository, MissionGrantRow } from '@amazon-ai-ops/local-db/src/sqlite/repositories/v16-domain-repositories';
import { MissionGrantService, MissionGrantServiceError } from './v16-mission-grant-service';

type MockRepo = Pick<
  MissionGrantRepository,
  'create' | 'findById' | 'findByStoreId' | 'findActiveByStore' | 'update' | 'appendLifecycleEvent' | 'getLifecycleEvents'
>;

const storeA: StoreContextEnvelope = {
  storeId: 'store-a',
  marketplace: 'US',
  currency: 'USD',
  businessDate: '2026-09-03',
  sessionGeneration: 1,
};

const storeB: StoreContextEnvelope = {
  storeId: 'store-b',
  marketplace: 'US',
  currency: 'USD',
  businessDate: '2026-09-03',
  sessionGeneration: 1,
};

const baseRow: MissionGrantRow = {
  grant_id: 'grant-1',
  store_id: 'store-a',
  mission_id: 'mission-1',
  mission_revision: 1,
  decision_ids: '["dec-1","dec-2"]',
  issuer: 'human_operator',
  issued_at: '2026-09-03T10:00:00Z',
  expires_at: null,
  issued_by: 'operator',
  scope_json: JSON.stringify({
    entityIds: ['kw-1'],
    actionType: 'adjust_keyword_bid',
    maxChangePercent: 10,
    currency: 'USD',
  }),
  limits_json: JSON.stringify({ maxSlots: 3 }),
  evidence_json: JSON.stringify({
    requiresBeforeScreenshot: true,
    requiresAfterScreenshot: true,
    requiresReloadScreenshot: true,
    requiresValueReadback: true,
  }),
  session_generation: 1,
  ads_account_id: 'acc-1',
  status: 'active',
  used_slots: 0,
  consumed_at: null,
  revoked_at: null,
  revoked_by: null,
  revocation_reason: null,
  created_at: '2026-09-03T10:00:00Z',
  updated_at: '2026-09-03T10:00:00Z',
  reason: 'approve bid plan',
  metadata: null,
};

describe('V16MissionGrantService', () => {
  let service: MissionGrantService;
  let repo: MockRepo;

  beforeEach(() => {
    repo = {
      create: vi.fn(),
      findById: vi.fn(),
      findByStoreId: vi.fn(),
      findActiveByStore: vi.fn(),
      update: vi.fn(),
      appendLifecycleEvent: vi.fn(),
      getLifecycleEvents: vi.fn(),
    };
    (repo.create as ReturnType<typeof vi.fn>).mockImplementation((g: MissionGrantRow) => g);
    (repo.findById as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
      id === 'grant-1' ? { ...baseRow } : null,
    );
    (repo.update as ReturnType<typeof vi.fn>).mockImplementation((id: string, u: Partial<MissionGrantRow>) => {
      const current = id === 'grant-1' ? { ...baseRow } : null;
      return current ? { ...current, ...u, grant_id: id } : null;
    });
    service = new MissionGrantService(repo as unknown as MissionGrantRepository);
  });

  it('issue requires non-empty reason', () => {
    expect(() =>
      service.issue({
        storeContext: storeA,
        missionId: 'mission-1',
        missionRevision: 1,
        decisionIds: ['dec-1'],
        issuer: 'human_operator',
        issuedBy: 'operator',
        scope: { entityIds: ['kw-1'], actionType: 'adjust_keyword_bid', currency: 'USD' },
        limits: { maxSlots: 3 },
        evidenceRequirement: {
          requiresBeforeScreenshot: true,
          requiresAfterScreenshot: true,
          requiresReloadScreenshot: true,
          requiresValueReadback: true,
        },
        reason: '   ',
      }),
    ).toThrow(/non-empty/);
  });

  it('issue rejects empty decision list', () => {
    expect(() =>
      service.issue({
        storeContext: storeA,
        missionId: 'mission-1',
        missionRevision: 1,
        decisionIds: [],
        issuer: 'human_operator',
        issuedBy: 'operator',
        scope: { entityIds: ['kw-1'], actionType: 'adjust_keyword_bid', currency: 'USD' },
        limits: { maxSlots: 3 },
        evidenceRequirement: {
          requiresBeforeScreenshot: true,
          requiresAfterScreenshot: true,
          requiresReloadScreenshot: true,
          requiresValueReadback: true,
        },
        reason: 'plan',
      }),
    ).toThrow(/at least one/);
  });

  it('issue rejects maxSlots <= 0', () => {
    expect(() =>
      service.issue({
        storeContext: storeA,
        missionId: 'mission-1',
        missionRevision: 1,
        decisionIds: ['dec-1'],
        issuer: 'human_operator',
        issuedBy: 'operator',
        scope: { entityIds: ['kw-1'], actionType: 'adjust_keyword_bid', currency: 'USD' },
        limits: { maxSlots: 0 },
        evidenceRequirement: {
          requiresBeforeScreenshot: true,
          requiresAfterScreenshot: true,
          requiresReloadScreenshot: true,
          requiresValueReadback: true,
        },
        reason: 'plan',
      }),
    ).toThrow(/maxSlots/);
  });

  it('issue creates active grant and appends issued event', () => {
    const grant = service.issue({
      storeContext: storeA,
      missionId: 'mission-1',
      missionRevision: 1,
      decisionIds: ['dec-1'],
      issuer: 'human_operator',
      issuedBy: 'operator',
      scope: { entityIds: ['kw-1'], actionType: 'adjust_keyword_bid', currency: 'USD' },
      limits: { maxSlots: 3 },
      evidenceRequirement: {
        requiresBeforeScreenshot: true,
        requiresAfterScreenshot: true,
        requiresReloadScreenshot: true,
        requiresValueReadback: true,
      },
      reason: 'approve plan',
    });
    expect(grant.status).toBe('active');
    expect(grant.usedSlots).toBe(0);
    expect(repo.appendLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'issued' }),
    );
  });

  it('getGrant rejects cross-store access', () => {
    expect(() =>
      service.getGrant({ storeContext: storeB, grantId: 'grant-1' }),
    ).toThrow(MissionGrantServiceError);
  });

  it('reserveSlot increments used and flips to partially_consumed', () => {
    const grant = service.reserveSlot({
      storeContext: storeA,
      grantId: 'grant-1',
      decisionId: 'dec-1',
      slotIndex: 0,
    });
    expect(grant?.usedSlots).toBe(1);
    expect(grant?.status).toBe('partially_consumed');
  });

  it('reserveSlot fully consumed when at limit', () => {
    (repo.findById as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
      id === 'grant-1' ? { ...baseRow, used_slots: 2 } : null,
    );
    const grant = service.reserveSlot({
      storeContext: storeA,
      grantId: 'grant-1',
      decisionId: 'dec-3',
      slotIndex: 2,
    });
    expect(grant?.status).toBe('fully_consumed');
    expect(repo.appendLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'consumed' }),
    );
  });

  it('reserveSlot enforces maxSlots', () => {
    (repo.findById as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
      id === 'grant-1' ? { ...baseRow, used_slots: 3 } : null,
    );
    expect(() =>
      service.reserveSlot({
        storeContext: storeA,
        grantId: 'grant-1',
        decisionId: 'dec-4',
        slotIndex: 3,
      }),
    ).toThrow(/limit/);
  });

  it('revoke requires non-empty reason', () => {
    expect(() =>
      service.revoke({
        storeContext: storeA,
        grantId: 'grant-1',
        revokedBy: 'operator',
        reason: '',
      }),
    ).toThrow(/non-empty/);
  });

  it('revoke marks grant revoked and appends event', () => {
    const grant = service.revoke({
      storeContext: storeA,
      grantId: 'grant-1',
      revokedBy: 'operator',
      reason: 'cancel batch',
    });
    expect(grant?.status).toBe('revoked');
    expect(grant?.revocationReason).toBe('cancel batch');
  });

  it('deriveResidualAuthority computes remaining slots', () => {
    const residual = service.deriveResidualAuthority({ storeContext: storeA, grantId: 'grant-1' });
    expect(residual?.isUsable).toBe(true);
    expect(residual?.remainingSlots).toBe(3);
  });

  it('deriveResidualAuthority marks revoked grant as not usable', () => {
    (repo.findById as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
      id === 'grant-1' ? { ...baseRow, status: 'revoked' } : null,
    );
    const residual = service.deriveResidualAuthority({ storeContext: storeA, grantId: 'grant-1' });
    expect(residual?.isUsable).toBe(false);
  });

  it('invalidate transitions to invalidated terminal', () => {
    const grant = service.invalidate({
      storeContext: storeA,
      grantId: 'grant-1',
      reason: 'context changed',
    });
    expect(grant?.status).toBe('invalidated');
  });
});
