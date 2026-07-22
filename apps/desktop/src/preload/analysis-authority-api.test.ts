import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createAnalysisAuthorityPreloadApi } from './analysis-authority-api';

const context = normalizeStoreContextEnvelope({
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 4,
});

describe('analysis authority preload API', () => {
  it('is frozen and maps only the three fixed authority calls', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const api = createAnalysisAuthorityPreloadApi({ invoke });
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.keys(api)).toEqual([
      'runMissionAnalysis', 'getMissionProjection', 'authorizeProposalBatch',
    ]);
    await api.getMissionProjection(context, 'mission-1');
    expect(invoke).toHaveBeenLastCalledWith(
      'analysis-authority:get-mission-projection',
      { context, missionId: 'mission-1' },
    );
    await api.authorizeProposalBatch({ context, missionId: 'mission-1', proposalIds: ['proposal-1'] });
    expect(invoke).toHaveBeenLastCalledWith(
      'analysis-authority:authorize-proposal-batch',
      { context, missionId: 'mission-1', proposalIds: ['proposal-1'] },
    );
  });
});
