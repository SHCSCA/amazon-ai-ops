import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdDailyMetrics, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { StoreRuntimeAnalysisConfig } from './store-runtime-analysis-config';
import { DEFAULT_RULE_CONFIG } from '@amazon-ai-ops/rules-engine';

const state = vi.hoisted(() => ({
  scope: { storeId: 'isolated-store', storeName: 'isolated', marketplaceCode: 'US', asin: 'B000000001', batchId: 'batch', dateFrom: '2026-10-01', dateTo: '2026-10-02' },
  source: { batchId: 'batch', batchIds: ['batch'], sourceFiles: ['isolated.csv'] },
  metrics: [] as AdDailyMetrics[], quality: {} as any, config: {} as any, payloads: [] as any[],
  load: vi.fn(), record: vi.fn(), approve: vi.fn(),
}));
vi.mock('./main-runtime-access', () => ({ getMainRuntimeContext: () => ({ state: { db: {}, aiDiagnosisRunRepo: { insertForStore: state.record }, recommendationRepo: { approve: state.approve } }, RECOMMENDATION_METRIC_LOAD_LIMIT: 100 }) }));
vi.mock('./ad-product-history-source-runtime', () => ({ loadProductHistoryObservation: (...args: unknown[]) => { state.load(...args); return state.quality; } }));
vi.mock('./main-business-scope-runtime', () => ({ resolveBusinessStoreAuthority: () => ({ store: { displayName: 'isolated' }, context: { storeId: 'isolated-store' } }) }));
vi.mock('./main-business-metrics-runtime', () => ({ getBusinessRecommendationGate: () => ({ scope: state.scope, metricSource: state.source, pipeline: { collection: { fileAudit: { realReportFileCount: 8, importedRowCount: 0 } } } }), loadBusinessRecommendationMetrics: () => state.metrics }));
vi.mock('./main-store-access-runtime', () => ({ currentStoreRuntimeAnalysisConfig: () => state.config }));
vi.mock('./store-runtime-analysis-config', () => ({ assertRuntimeConfigStore: vi.fn(), assertRuntimeAnalysisWindow: vi.fn() }));
vi.mock('./recommendation-generation-gate', () => ({ filterFormalRecommendationMetrics: (value: unknown) => value, assertRecommendationMetricsLoaded: vi.fn() }));
vi.mock('./main-operator-browser-runtime', () => ({ createRecommendationBidReader: () => ({}) }));
vi.mock('./recommendation-live-bid', () => ({ applyCurrentKeywordBids: async (value: unknown) => value }));
vi.mock('@amazon-ai-ops/lingxing-report-collector', () => ({ LINGXING_AD_REPORTS: Array(8).fill('isolated') }));
vi.mock('./runtime-log-adapter', () => ({ runtimeLog: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('./main-ai-settings-runtime', () => ({
  normalizeAiSettings: (value: unknown) => value, readAiSettingsForMain: () => ({ aiApiKey: 'isolated-no-network', aiModel: 'fixture' }), buildAiProviderConfig: () => ({}),
  governedAiProvider: () => ({ async chat(messages: Array<{ role: string; content: string }>) {
    const prompt = messages.find((message) => message.role === 'user')!.content;
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{'))); state.payloads.push(payload);
    return { success: true, content: JSON.stringify({ schemaVersion: 'ad_strategy_diagnosis_v1', lifecycleStage: 'scaling', lifecycleStageReason: 'partial observation', lifecycleStageEvidenceRefs: [], summary: 'partial observation', mainProblems: [], thresholdSuggestions: {}, aiCandidates: [{ entityType: 'search_term', entityName: 'isolated query', actionType: 'lower_bid', recommendedValue: '-10%', reason: 'partial observation', reasoningSteps: ['partial observation'], evidenceRefs: payload.evidencePack.filter((item: any) => item.type === 'metric').map((item: any) => item.evidenceId), riskWarnings: [], confidence: 0.9 }], insightOnlyCandidates: [], riskWarnings: [] }) };
  } }),
}));

import { enrichAdRecommendationsWithStrategyDiagnosis } from './main-ad-strategy-enrichment-runtime';
import { handleRunAdStrategyDiagnosis } from './main-ad-diagnosis-runtime';

beforeEach(() => {
  vi.clearAllMocks(); state.payloads = [];
  state.metrics = [{ date: state.scope.dateFrom, storeName: state.scope.storeName, marketplaceCode: 'US', asin: state.scope.asin, sourceAsin: state.scope.asin, msku: '', campaignName: 'isolated campaign', adGroupName: 'isolated group', targeting: '', searchTerm: 'isolated query', matchType: 'auto', impressions: 10, clicks: 1, cost: 2, orders: 0, sales: 0, acos: 0, cpc: 2, cvr: 0, batchId: 'batch', reportType: 'user_search_term', sourceFile: 'isolated.csv', sourceRow: 2 }];
  state.config = { ruleConfig: DEFAULT_RULE_CONFIG, values: { aiRecommendationsEnabled: true } };
  state.quality = { status: 'unavailable', coverage: 'unverified', reason: 'partial only', dateFrom: state.scope.dateFrom, dateTo: state.scope.dateTo, observedDates: [state.scope.dateFrom], observedRowCount: 1, unboundAsinRowCount: 0, omittedSourceRowCount: 0, sources: [],
    observedLedger: { status: 'partial', coverage: 'unverified', reason: 'partial only', excludedRowCount: 0,
      source: { storeId: state.scope.storeId, batchId: 'batch', runId: 'run', snapshotId: 'snapshot', sourceFile: 'isolated.csv', fileHash: 'a'.repeat(64), dateFrom: state.scope.dateFrom, dateTo: state.scope.dateTo },
      days: [{ asin: state.scope.asin, date: state.scope.dateFrom, status: 'partial', observedRowCount: 1, sourceRows: [2], metrics: { impressions: 10, clicks: 1, cost: 2, orders: 0, sales: 0 }, observedFieldRowCounts: { impressions: 1, clicks: 1, cost: 1, orders: 1, sales: 1 }, explicitZeroFields: ['orders', 'sales'], unknownFields: [] }] } };
});

describe('actual Main product observation entry paths with isolated dependency ports', () => {
  it.each(['diagnosis', 'enrichment'])('%s carries observation through real evidence builder, adapter and validator without approval credit', async (path) => {
    const result = path === 'diagnosis'
      ? await handleRunAdStrategyDiagnosis(state.scope)
      : await enrichAdRecommendationsWithStrategyDiagnosis([], state.metrics, state.scope as Parameters<typeof enrichAdRecommendationsWithStrategyDiagnosis>[2], {
          storeContext: { storeId: state.scope.storeId } as StoreContextEnvelope, taskId: 'isolated-task', sourceFiles: state.source.sourceFiles,
          productHistorySource: state.source as Parameters<typeof enrichAdRecommendationsWithStrategyDiagnosis>[3]['productHistorySource'],
          runtimeConfig: state.config as StoreRuntimeAnalysisConfig, aiSettings: { aiApiKey: 'isolated-no-network', aiModel: 'fixture' },
        });
    expect(state.load).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ storeId: state.scope.storeId, dateFrom: state.scope.dateFrom, dateTo: state.scope.dateTo }), state.source);
    expect(state.payloads).toHaveLength(1);
    const payload = state.payloads[0];
    expect(payload.scope.storeId).toBe(state.scope.storeId);
    expect(payload.productHistoryQuality.observedLedger).toMatchObject({ status: 'partial', days: [{ sourceRows: [2], metrics: { cost: 2, orders: 0 } }] });
    expect(payload.productHistoryQuality.status).toBe('unavailable');
    expect(payload.evidenceSufficiency.metricEvidenceCount).toBeGreaterThan(0);
    expect(payload.productHistoryLedgers).toEqual([]);
    expect(payload.evidencePack.find((item: any) => item.type === 'timeline').timeline.productHistoryQuality.observedLedger.status).toBe('partial');
    expect(result.summary?.evidenceSufficiency?.canUseForFormalActions).toBe(false);
    expect(result.summary?.lifecycleStageRequiresReview).toBe(true);
    expect(result.summary?.aiCandidateCount).toBe(0);
    expect(state.record).toHaveBeenCalledWith(state.scope.storeId, expect.objectContaining({ formalRecommendationCount: 0 }));
    expect(state.approve).not.toHaveBeenCalled();
  });
});
