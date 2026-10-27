import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreContextEnvelope, StoreRuntimeConfigProjection } from '@amazon-ai-ops/shared-types';
import type { DeliveryReadinessView, OperationScope } from '../types';
import { loadDeliveryState } from './delivery-state-load';
import { canExportNonReadyDeliveryEvidence } from './delivery-export-policy';

const log = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock('../runtime-log', () => ({ rendererRuntimeLog: log }));

// 隔离端口只描述读取状态，不创建真实配置、批准、费用或生产就绪证明。
const scope = {
  dateFrom: '2026-10-01', dateTo: '2026-10-15', storeName: '隔离新店', marketplaceCode: 'US', currency: 'USD',
  storeContext: { storeId: 'software-only-store', browserProfileId: 'software-only-profile', marketplace: 'US', currency: 'USD',
    businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 1 },
} as OperationScope & { storeContext: StoreContextEnvelope };
const readiness = { available: true, exists: true, path: 'SOFTWARE-ONLY-NON-READY.json',
  verificationProtocol: 'v16.current-publication/1', manifestDriven: true, status: 'APP_NEEDS_WORK', appReady: false,
  gates: [], failures: ['真实环境尚未验收'] } as unknown as DeliveryReadinessView;

function configuredProjection(): StoreRuntimeConfigProjection {
  const current = { configId: 'software-only-config', storeId: scope.storeContext.storeId, marketplace: 'US', currency: 'USD',
    businessTimezone: scope.storeContext.businessTimezone, status: 'active', revision: 1,
    values: { aiRecommendationsEnabled: false, collectionScheduleLocalTime: '06:00', collectionLookbackDays: 7,
      analysisWindowDays: 30, defaultTargetAcosPercent: 30, minimumRecommendationConfidencePercent: 70, evidenceRetentionDays: 30 },
    createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z' } as StoreRuntimeConfigProjection['current'];
  return { current, versions: [{ revision: 1, action: 'create', occurredAt: '2026-10-16T00:00:00.000Z', snapshot: structuredClone(current!) }] };
}

function apiFor(projection: unknown = configuredProjection()) {
  return {
    getStoreRuntimeConfig: vi.fn(async (_context: StoreContextEnvelope) => projection),
    getBusinessUiDataPipeline: vi.fn(async (_scope: OperationScope) => ({ scope, collection: { latestBatch: { id: 'SOFTWARE-ONLY-BATCH' } } })),
    getDeliveryReadiness: vi.fn(async () => readiness), getSettings: vi.fn(async () => ({})),
    listAiDiagnosisRuns: vi.fn(async () => []), getRecommendations: vi.fn(async () => []), getDeliveryEvidenceStatus: vi.fn(async () => null),
    createStoreRuntimeConfig: vi.fn(), updateStoreRuntimeConfig: vi.fn(), runAiDiagnosis: vi.fn(), approveRecommendation: vi.fn(), exportDeliveryBundle: vi.fn(),
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('delivery initial load canonical configuration boundary', () => {
  it('skips business analysis for an authorized empty canonical projection while reading actual NON_READY', async () => {
    const api = apiFor({ current: null, versions: [] });
    api.getBusinessUiDataPipeline.mockRejectedValueOnce(new Error('不得调用缺配置分析'));
    const original = structuredClone(readiness);
    const loaded = await loadDeliveryState(api, scope, () => true);
    expect(api.getStoreRuntimeConfig).toHaveBeenCalledWith(scope.storeContext);
    expect(api.getStoreRuntimeConfig.mock.calls[0][0]).not.toBe(scope.storeContext);
    expect(api.getBusinessUiDataPipeline).not.toHaveBeenCalled();
    expect(loaded?.data).toBeNull();
    expect(loaded?.readiness).toBe(readiness);
    expect(loaded?.readiness).toEqual(original);
    expect(loaded?.readiness?.appReady).toBe(false);
    expect(loaded?.notes.join(' ')).toContain('业务数据状态未知');
    expect(loaded?.notes.join(' ')).toContain('系统设置');
    expect(log.warn).toHaveBeenCalledWith('delivery.business_data_unavailable', {
      reason: 'STORE_RUNTIME_CONFIG_MISSING', storeId: scope.storeContext.storeId,
    });
    expect(canExportNonReadyDeliveryEvidence(loaded?.readiness ?? null)).toBe(true);
    for (const key of ['createStoreRuntimeConfig', 'updateStoreRuntimeConfig', 'runAiDiagnosis', 'approveRecommendation', 'exportDeliveryBundle'] as const) {
      expect(api[key]).not.toHaveBeenCalled();
    }
  });

  it.each([undefined, null, {}, { current: null }, { current: undefined, versions: [] }, { current: null, versions: {} }])(
    'rejects malformed projection before analysis or readiness: %#', async projection => {
      const api = apiFor();
      api.getStoreRuntimeConfig.mockResolvedValueOnce(projection);
      await expect(loadDeliveryState(api, scope, () => true)).rejects.toThrow('店铺配置投影无效');
      expect(api.getBusinessUiDataPipeline).not.toHaveBeenCalled();
      expect(api.getDeliveryReadiness).not.toHaveBeenCalled();
    },
  );

  it.each(['storeId', 'marketplace', 'currency', 'businessTimezone'] as const)(
    'rejects another current or historical %s before downstream IPC', async field => {
      for (const historical of [false, true]) {
        const projection = configuredProjection();
        const row = historical ? projection.versions[0].snapshot : projection.current!;
        (row as unknown as Record<string, unknown>)[field] = 'OTHER';
        const api = apiFor(projection);
        await expect(loadDeliveryState(api, scope, () => true)).rejects.toThrow('其他店铺或业务范围');
        expect(api.getBusinessUiDataPipeline).not.toHaveBeenCalled();
        expect(api.getDeliveryReadiness).not.toHaveBeenCalled();
      }
    },
  );

  it('requires active current configuration and a valid version contract without restoring it', async () => {
    const archived = configuredProjection(); archived.current!.status = 'archived';
    const malformedVersions = configuredProjection(); malformedVersions.versions[0].revision = 2;
    const orphanVersions = configuredProjection(); orphanVersions.current = null;
    for (const projection of [archived, malformedVersions, orphanVersions]) {
      const api = apiFor(projection);
      await expect(loadDeliveryState(api, scope, () => true)).rejects.toThrow();
      expect(api.getBusinessUiDataPipeline).not.toHaveBeenCalled();
      expect(api.getDeliveryReadiness).not.toHaveBeenCalled();
      expect(api.updateStoreRuntimeConfig).not.toHaveBeenCalled();
    }
  });

  it('preserves canonical getter authority rejection without parsing error messages', async () => {
    const api = apiFor(); const error = new Error('STORE_CONTEXT_NOT_CURRENT');
    api.getStoreRuntimeConfig.mockRejectedValueOnce(error);
    await expect(loadDeliveryState(api, scope, () => true)).rejects.toBe(error);
    expect(api.getBusinessUiDataPipeline).not.toHaveBeenCalled();
    expect(api.getDeliveryReadiness).not.toHaveBeenCalled();
  });

  it('does not reinterpret a pipeline failure after an active projection, including a configuration race', async () => {
    const api = apiFor();
    const error = new Error("Error invoking remote method 'v1_5:business-ui:data-pipeline': StoreRuntimeAnalysisConfigError: 当前店铺还没有运行配置；请先在系统设置中创建店铺级配置。");
    api.getBusinessUiDataPipeline.mockRejectedValueOnce(error);
    await expect(loadDeliveryState(api, scope, () => true)).rejects.toBe(error);
    expect(api.getDeliveryReadiness).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('checks the authority epoch after a delayed empty projection before every next IPC', async () => {
    let resolveProjection!: (value: unknown) => void; let current = true;
    const api = apiFor(); api.getStoreRuntimeConfig.mockImplementationOnce(() => new Promise(resolve => { resolveProjection = resolve; }));
    const pending = loadDeliveryState(api, scope, () => current);
    if (api.getStoreRuntimeConfig.mock.calls.length === 0) await pending;
    expect(api.getStoreRuntimeConfig).toHaveBeenCalledTimes(1);
    current = false; resolveProjection({ current: null, versions: [] });
    await expect(pending).resolves.toBeNull();
    expect(api.getBusinessUiDataPipeline).not.toHaveBeenCalled();
    expect(api.getDeliveryReadiness).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('leaves business data unknown when the canonical API is unavailable without guessing defaults', async () => {
    const api: Record<string, any> = apiFor(); delete api.getStoreRuntimeConfig;
    const loaded = await loadDeliveryState(api, scope, () => true);
    expect(api.getBusinessUiDataPipeline).not.toHaveBeenCalled();
    expect(loaded?.data).toBeNull(); expect(loaded?.readiness).toBe(readiness);
    expect(loaded?.notes.join(' ')).toContain('业务数据状态未知');
  });

  it('does not synthesize readiness when strict publication verification rejects after the empty projection', async () => {
    const api = apiFor({ current: null, versions: [] }); const error = new Error('CURRENT_PUBLICATION_ENVELOPE_INVALID');
    api.getDeliveryReadiness.mockRejectedValueOnce(error);
    await expect(loadDeliveryState(api, scope, () => true)).rejects.toBe(error);
    expect(api.getSettings).not.toHaveBeenCalled(); expect(api.getDeliveryEvidenceStatus).not.toHaveBeenCalled();
    expect(canExportNonReadyDeliveryEvidence(null)).toBe(false);
  });

  it('retains source-batch derivation and exact current scope on the configured successful path', async () => {
    const api = apiFor(); const original = structuredClone(scope);
    const loaded = await loadDeliveryState(api, scope, () => true);
    expect(api.getStoreRuntimeConfig).toHaveBeenCalledTimes(1); expect(api.getBusinessUiDataPipeline).toHaveBeenCalledWith(scope);
    expect(loaded?.data).toEqual({ scope, collection: { latestBatch: { id: 'SOFTWARE-ONLY-BATCH' } } });
    expect(api.getDeliveryEvidenceStatus).toHaveBeenCalledWith(scope);
    expect(api.listAiDiagnosisRuns).toHaveBeenCalledWith({ ...scope, batchId: 'SOFTWARE-ONLY-BATCH', limit: 5 });
    for (const status of ['pending', 'needs_review', 'approved']) {
      expect(api.getRecommendations).toHaveBeenCalledWith({ ...scope, batchId: 'SOFTWARE-ONLY-BATCH', limit: 20, status });
    }
    expect(scope).not.toHaveProperty('batchId');
    expect(scope).toEqual(original); expect(loaded?.notes).toEqual([]);
  });

  it('retains an explicitly selected batch for evidence and analysis when the latest source batch differs', async () => {
    const explicitScope = { ...scope, batchId: 'SOFTWARE-ONLY-SELECTED-BATCH' };
    const api = apiFor(); const original = structuredClone(explicitScope);
    api.getBusinessUiDataPipeline.mockResolvedValueOnce({ scope: explicitScope, collection: { latestBatch: { id: 'SOFTWARE-ONLY-NEWER-BATCH' } } });
    const loaded = await loadDeliveryState(api, explicitScope, () => true);
    expect(api.getBusinessUiDataPipeline).toHaveBeenCalledWith(explicitScope);
    expect(api.getDeliveryEvidenceStatus).toHaveBeenCalledTimes(1);
    expect(api.getDeliveryEvidenceStatus).toHaveBeenCalledWith(explicitScope);
    expect(api.listAiDiagnosisRuns).toHaveBeenCalledWith({ ...explicitScope, limit: 5 });
    for (const status of ['pending', 'needs_review', 'approved']) {
      expect(api.getRecommendations).toHaveBeenCalledWith({ ...explicitScope, limit: 20, status });
    }
    expect(explicitScope).toEqual(original); expect(loaded?.notes).toEqual([]);
  });
});
