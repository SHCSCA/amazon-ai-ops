import { describe, expect, it } from 'vitest';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import type { AdStrategyDiagnosisOutput } from '@amazon-ai-ops/ai-adapter';
import { assessAdEvidenceSufficiency } from '@amazon-ai-ops/ai-adapter';
import { buildAdProductHistoryQuality } from './ad-product-history-quality';
import { buildAdProductHistoryLedger } from './ad-product-history-ledger';
import { buildAdStrategyDiagnosisInput } from './ad-recommendation-ai-context';
import { buildAdAiEvidencePack } from './ad-ai-evidence-pack';
import { validateAiDiagnosisEvidence } from './ad-ai-evidence-validator';

const scope = { dateFrom: '2026-10-01', dateTo: '2026-10-03', storeName: 'ISOLATED_FIXTURE', marketplaceCode: 'US', asin: 'B0FIXTURE1' };
function metric(patch: Partial<AdDailyMetrics> = {}): AdDailyMetrics {
  return {
    ...scope, date: '2026-10-01', asin: 'B0FIXTURE1', msku: '', campaignName: 'Fixture campaign',
    adGroupName: 'Fixture group', targeting: 'fixture keyword', searchTerm: '', matchType: 'exact',
    impressions: 1000, clicks: 100, cost: 100, orders: 4, sales: 400, acos: 0.25, cpc: 1, cvr: 0.04,
    reportType: 'keyword', sourceFile: 'ISOLATED_FIXTURE/keyword.xlsx', sourceRow: 2, batchId: 'fixture-batch-1', ...patch,
  };
}
function context(metrics: AdDailyMetrics[]) {
  const input = { scope, metrics, operationEvents: [], productContexts: [], recommendations: [], ruleConfig: {} };
  const evidencePack = buildAdAiEvidencePack({ ...input, ruleRecommendations: [] });
  return { evidencePack, diagnosisInput: buildAdStrategyDiagnosisInput({ ...input, evidencePack }) };
}

describe('unverified product history safety', () => {
  it('retains native 100/400 rows but does not emit their overlapping 200/800 as product totals', () => {
    const rows = [metric(), metric({ reportType: 'user_search_term', sourceFile: 'ISOLATED_FIXTURE/search.xlsx', searchTerm: 'fixture keyword' })];
    const { diagnosisInput, evidencePack } = context(rows);
    expect(diagnosisInput.metrics.map((row) => [row.cost, row.sales])).toEqual([[100, 400], [100, 400]]);
    expect(diagnosisInput.productHistoryLedgers).toEqual([]);
    expect(diagnosisInput.productHistoryQuality).toMatchObject({ status: 'unavailable', coverage: 'unverified', observedRowCount: 2 });
    expect(evidencePack.filter((item) => item.type === 'metric')).toHaveLength(2);
    expect(evidencePack[0].metrics).toBeUndefined();
    expect(evidencePack[0].timeline?.productHistoryQuality).toEqual(diagnosisInput.productHistoryQuality);
  });

  it('does not silently fill or discard days with partial coverage', () => {
    const quality = buildAdProductHistoryQuality(scope, [metric(), metric({ date: '2026-10-02', reportType: 'user_search_term' })]);
    expect(quality).toMatchObject({ dateFrom: '2026-10-01', dateTo: '2026-10-03', coverage: 'unverified', observedDates: ['2026-10-01', '2026-10-02'] });
    expect(context([metric()]).diagnosisInput.productHistoryLedgers).toEqual([]);
  });

  it('never assigns scope ASIN to an unbound ad-group source row', () => {
    const quality = buildAdProductHistoryQuality(scope, [metric({ asin: '', reportType: 'ad_group' })]);
    expect(quality.unboundAsinRowCount).toBe(1);
    expect(quality.sources[0].asin).toBeUndefined();
  });

  it('does not infer replacement from duplicate arrays or different files', () => {
    const row = metric();
    const quality = buildAdProductHistoryQuality(scope, [row, row, metric({ sourceFile: 'ISOLATED_FIXTURE/reimport.xlsx', cost: 60, sales: 180 })]);
    expect(quality.observedRowCount).toBe(3);
    expect(quality.sources.map((source) => source.sourceFile)).toEqual([row.sourceFile, row.sourceFile, 'ISOLATED_FIXTURE/reimport.xlsx']);
    expect(quality.coverage).toBe('unverified');
  });

  it('keeps canonical 100/400 utility totals distinct from unavailable AI aggregate credit', () => {
    const rows = [metric({ reportType: 'advertised_product' })];
    const ledgers = buildAdProductHistoryLedger({ scope, metrics: rows, operationEvents: [], productContexts: [] });
    expect(ledgers[0].totals).toMatchObject({ cost: 100, sales: 400 });
    const evidence = buildAdAiEvidencePack({ scope, metrics: rows, operationEvents: [], productContexts: [], ruleRecommendations: [], productHistoryLedgers: ledgers });
    expect(evidence[0].metrics).toBeUndefined();
    expect(evidence[0].timeline?.productHistoryQuality?.status).toBe('unavailable');
  });

  it('excludes cross-batch and out-of-scope rows from quality provenance', () => {
    const quality = buildAdProductHistoryQuality({ ...scope, batchId: 'fixture-batch-1' }, [metric(), metric({ batchId: 'fixture-batch-2' }), metric({ storeName: 'OTHER' }), metric({ date: '2026-09-30' })]);
    expect(quality.observedRowCount).toBe(1);
    expect(quality.sources).toHaveLength(1);
  });

  it('makes provenance truncation explicit without claiming full coverage', () => {
    const quality = buildAdProductHistoryQuality(scope, Array.from({ length: 121 }, (_, index) => metric({ sourceRow: index + 2 })));
    expect(quality.sources).toHaveLength(120);
    expect(quality.omittedSourceRowCount).toBe(1);
    expect(quality.coverage).toBe('unverified');
  });

  it('blocks AI formal eligibility despite sufficient actionable samples and forged high sufficiency', () => {
    const { diagnosisInput, evidencePack } = context([metric({ searchTerm: 'fixture keyword', reportType: 'user_search_term' })]);
    expect(assessAdEvidenceSufficiency(diagnosisInput)).toMatchObject({ canUseForFormalActions: false, metricAggregation: 'source_rows_may_overlap' });
    const ref = evidencePack.find((item) => item.type === 'metric')!.evidenceId;
    const diagnosis: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1', source: 'ai', lifecycleStage: 'stable_conversion', lifecycleStageReason: 'Fixture reason', lifecycleStageEvidenceRefs: [ref],
      summary: 'Fixture summary', mainProblems: [], riskWarnings: [], insightOnlyCandidates: [],
      thresholdSuggestions: {
        targetAcos: { value: 0.25, reason: 'Fixture', evidenceRefs: [ref] }, highAcosThreshold: { value: 0.4, reason: 'Fixture', evidenceRefs: [ref] },
        noOrderClickThreshold: { value: 30, reason: 'Fixture', evidenceRefs: [ref] }, minSpend: { value: 10, reason: 'Fixture', evidenceRefs: [ref] },
      },
      evidenceSufficiency: { level: 'high', metricEvidenceCount: 1, sampleDays: 10, totalCost: 100, totalClicks: 100, totalOrders: 4, canUseForFormalActions: true, blockers: [], warnings: [] },
      aiCandidates: [{ entityType: 'search_term', entityName: 'fixture keyword', actionType: 'lower_bid', recommendedValue: '0.9', reason: 'Fixture', reasoningSteps: ['Fixture'], evidenceRefs: [ref], confidence: 0.9, riskWarnings: [] }],
    };
    const result = validateAiDiagnosisEvidence({ diagnosis, evidencePack, scope });
    expect(diagnosis.evidenceSufficiency).toMatchObject({ canUseForFormalActions: false, level: 'low', metricAggregation: 'source_rows_may_overlap' });
    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(diagnosis.lifecycleStageRequiresReview).toBe(true);
    for (const threshold of Object.values(diagnosis.thresholdSuggestions)) expect(threshold.requiresReview).toBe(true);
    expect(result.invalidReasons[0].reason).toContain('产品汇总不可用');
  });
});
