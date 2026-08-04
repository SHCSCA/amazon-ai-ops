import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  ANALYSIS_AUTHORITY_IPC_CHANNELS,
  registerAnalysisAuthorityIpcHandlers,
} from './analysis-authority-ipc';

const context = normalizeStoreContextEnvelope({
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 4,
});

describe('analysis authority fixed IPC surface', () => {
  it('registers three closed routes and forwards authoritative requests', async () => {
    const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
    const service = {
      runMissionAnalysis: vi.fn(async () => ({ proposals: [] })),
      getMissionAnalysisProjection: vi.fn(() => ({ evidencePackages: [], actionBatches: [], proposals: [], decisionLinks: [] })),
      authorizeProposalBatch: vi.fn(() => ({ authorized: false, blockers: ['blocked'] })),
    };
    registerAnalysisAuthorityIpcHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      service as never,
    );
    expect([...handlers.keys()]).toEqual(ANALYSIS_AUTHORITY_IPC_CHANNELS);
    await handlers.get('analysis-authority:run-mission-analysis')?.({}, {
      context,
      missionId: 'mission-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-22',
    });
    expect(service.runMissionAnalysis).toHaveBeenCalledWith({
      context,
      missionId: 'mission-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-22',
    });
    await handlers.get('analysis-authority:get-mission-projection')?.({}, { context, missionId: 'mission-1' });
    expect(service.getMissionAnalysisProjection).toHaveBeenCalledWith(context, 'mission-1');
    await handlers.get('analysis-authority:authorize-proposal-batch')?.({}, {
      context,
      missionId: 'mission-1',
      proposalIds: ['proposal-1'],
    });
    expect(service.authorizeProposalBatch).toHaveBeenCalledWith({
      context,
      missionId: 'mission-1',
      proposalIds: ['proposal-1'],
    });
  });

  it('rejects extra authority fields and any path-bearing response', async () => {
    const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
    registerAnalysisAuthorityIpcHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        runMissionAnalysis: vi.fn(async () => ({ filePath: 'D:\\secret.xlsx' })),
        getMissionAnalysisProjection: vi.fn(() => ({ evidencePackages: [], actionBatches: [], proposals: [], decisionLinks: [] })),
        authorizeProposalBatch: vi.fn(() => ({ authorized: false, blockers: [] })),
      } as never,
    );
    expect(() => handlers.get('analysis-authority:get-mission-projection')?.({}, {
      context,
      missionId: 'mission-1',
      arbitraryChannel: 'unsafe',
    })).toThrow(/unsupported field/);
    await expect(handlers.get('analysis-authority:run-mission-analysis')?.({}, {
      context,
      missionId: 'mission-1',
      asin: 'B0FORGED',
      freshnessWindowHours: 720,
    })).rejects.toThrow(/unsupported field/);
    await expect(handlers.get('analysis-authority:run-mission-analysis')?.({}, {
      context,
      missionId: 'mission-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-22',
    })).rejects.toThrow(/禁止字段|绝对路径/);
  });
});
