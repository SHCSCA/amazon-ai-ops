import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  assertAnalysisProjectionBelongsToContext,
  createPreviewAnalysisAuthorityApi,
  readAnalysisAuthorityWindowApi,
} from './analysis-authority-window-api';

const firstContext = {
  storeId: 'preview-store-shc001',
  browserProfileId: 'preview-profile-shc001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 1,
} as StoreContextEnvelope;

const secondContext = {
  ...firstContext,
  storeId: 'preview-store-shc002',
  browserProfileId: 'preview-profile-shc002',
} as StoreContextEnvelope;

describe('analysis authority window adapter', () => {
  it('accepts only the complete closed analysis surface', () => {
    expect(readAnalysisAuthorityWindowApi({ electronAPI: {} })).toBeNull();
    expect(readAnalysisAuthorityWindowApi({
      electronAPI: { analysisAuthority: { getMissionProjection: async () => ({}) } },
    })).toBeNull();

    const api = createPreviewAnalysisAuthorityApi();
    expect(readAnalysisAuthorityWindowApi({ electronAPI: { analysisAuthority: api } })).toBe(api);
  });

  it('seals all eight report types and isolates projections by store', async () => {
    const api = createPreviewAnalysisAuthorityApi();
    const first = await api.getMissionProjection(firstContext, 'MISSION-1');
    const second = await api.getMissionProjection(secondContext, 'MISSION-1');

    expect(first.evidencePackages[0]).toMatchObject({
      storeId: firstContext.storeId,
      marketplace: 'US',
      currency: 'USD',
      reportTypes: expect.arrayContaining([...ANALYSIS_REQUIRED_REPORT_TYPES]),
    });
    expect(first.evidencePackages[0].reportTypes).toHaveLength(8);
    expect(first.proposals.every((proposal) => proposal.storeId === firstContext.storeId)).toBe(true);
    expect(second.proposals.every((proposal) => proposal.storeId === secondContext.storeId)).toBe(true);
    expect(first.proposals.map((proposal) => proposal.id))
      .not.toEqual(second.proposals.map((proposal) => proposal.id));
  });

  it('authorizes only the exact immutable action batch', async () => {
    const api = createPreviewAnalysisAuthorityApi();
    const projection = await api.getMissionProjection(firstContext, 'MISSION-1');
    const proposalIds = projection.proposals.map((proposal) => proposal.id);

    await expect(api.authorizeProposalBatch({
      context: firstContext,
      missionId: 'MISSION-1',
      proposalIds: proposalIds.slice(0, 1),
    })).resolves.toMatchObject({ authorized: false });

    const result = await api.authorizeProposalBatch({
      context: firstContext,
      missionId: 'MISSION-1',
      proposalIds,
    });
    expect(result).toMatchObject({
      authorized: true,
      mode: 'manual_approval',
      grant: {
        storeId: firstContext.storeId,
        marketplace: 'US',
        currency: 'USD',
        allowedAdEntityIds: expect.arrayContaining(['opaque-keyword-1', 'opaque-keyword-2']),
      },
    });
  });

  it('fails closed outside the US and USD context contract', async () => {
    const api = createPreviewAnalysisAuthorityApi();
    await expect(api.getMissionProjection({ ...firstContext, marketplace: 'CA' } as unknown as StoreContextEnvelope, 'MISSION-1'))
      .rejects.toThrow();
    await expect(api.getMissionProjection({ ...firstContext, currency: 'CAD' } as unknown as StoreContextEnvelope, 'MISSION-1'))
      .rejects.toThrow();
  });

  it('rejects a foreign action batch or broken projection lineage in Renderer', async () => {
    const projection = await createPreviewAnalysisAuthorityApi().getMissionProjection(firstContext, 'MISSION-1');
    expect(() => assertAnalysisProjectionBelongsToContext(firstContext, 'MISSION-1', {
      ...projection,
      actionBatches: projection.actionBatches.map((batch, index) => index === 0
        ? { ...batch, storeId: secondContext.storeId }
        : batch),
    })).toThrow(/跨店铺|lineage/);
    expect(() => assertAnalysisProjectionBelongsToContext(firstContext, 'MISSION-1', {
      ...projection,
      proposals: projection.proposals.map((proposal, index) => index === 0
        ? { ...proposal, actionBatchId: 'missing-action-batch' }
        : proposal),
    })).toThrow(/lineage/);
  });
});
