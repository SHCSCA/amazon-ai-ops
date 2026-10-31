import { describe, expect, it } from 'vitest';
import { AdStrategyDiagnoser, assessAdEvidenceSufficiency, type AdStrategyDiagnosisInput } from './ad-strategy-diagnosis';
import { prepareUnverifiedProductHistory } from './ad-product-history-context';
import { sanitizeObservedProductLedger, type AdProductObservedLedger } from './ad-product-observed-ledger';
import type { ChatMessage, AIProvider } from './provider';

const scope: AdStrategyDiagnosisInput['scope'] = { dateFrom: '2026-10-01', dateTo: '2026-10-02', storeName: 'isolated', marketplaceCode: 'US', asin: 'B000000001', batchId: 'batch', currency: 'USD' };
const ledger = (): AdProductObservedLedger => ({
  status: 'partial', coverage: 'unverified', reason: 'partial',
  source: { storeId: 'store', batchId: 'batch', runId: 'run', snapshotId: 'snapshot', sourceFile: 'isolated.csv', fileHash: 'a'.repeat(64), dateFrom: scope.dateFrom, dateTo: scope.dateTo },
  days: [{ asin: scope.asin!, date: scope.dateFrom, status: 'partial', observedRowCount: 2, sourceRows: [2, 3],
    metrics: { impressions: 20, clicks: 2, cost: 3, orders: 0, sales: null },
    observedFieldRowCounts: { impressions: 2, clicks: 2, cost: 2, orders: 2, sales: 1 },
    explicitZeroFields: ['orders'], unknownFields: ['sales'] }], excludedRowCount: 1,
});
const input = (): AdStrategyDiagnosisInput => ({ scope, metrics: [], adObjectTimelines: [], operationEvents: [], ruleCandidates: [],
  currentRuleConfig: { targetAcos: 0.25, highAcosThreshold: 0.4, noOrderClickThreshold: 30, minSpend: 10 },
  productHistoryQuality: { status: 'unavailable', coverage: 'unverified', reason: 'unverified', dateFrom: scope.dateFrom, dateTo: scope.dateTo,
    observedDates: [scope.dateFrom], observedRowCount: 2, unboundAsinRowCount: 0, omittedSourceRowCount: 0, sources: [], observedLedger: ledger() },
});

describe('partial observed ledger provider boundary', () => {
  it('preserves useful explicit values and field coverage without total or formal credit', () => {
    const prepared = prepareUnverifiedProductHistory(input());
    expect(prepared.quality.observedLedger).toMatchObject({ status: 'partial', coverage: 'unverified', days: [{ metrics: { cost: 3, orders: 0, sales: null }, unknownFields: ['sales'] }] });
    expect(prepared.quality.status).toBe('unavailable');
    expect(assessAdEvidenceSufficiency(input()).canUseForFormalActions).toBe(false);
  });
  it('does not reinterpret partially supplied metrics or missing days as complete zeros', () => {
    const partial = ledger(); partial.days[0].metrics.sales = 0;
    partial.days[0].explicitZeroFields.push('sales'); partial.days[0].unknownFields = [];
    const result = sanitizeObservedProductLedger(partial, scope)!;
    expect(result.days[0].metrics.sales).toBeNull();
    expect(result.days[0].unknownFields).toContain('sales');
    expect(result.days[0].explicitZeroFields).toEqual(['orders']);
    partial.days[0].status = 'missing'; partial.days[0].sourceRows = [];
    expect(Object.values(sanitizeObservedProductLedger(partial, scope)!.days[0].metrics)).toEqual([null, null, null, null, null]);
  });
  it.each(['complete', 'trusted', 'ready'])('rejects forged %s quality', (status) => {
    const forged = { ...ledger(), status } as unknown as AdProductObservedLedger;
    expect(sanitizeObservedProductLedger(forged, scope)).toMatchObject({ status: 'unavailable', coverage: 'unverified', days: [] });
  });
  it('strips injected totals and stage and rejects cross-window, cross-batch and repeated days', () => {
    const injected = { ...ledger(), totals: { sales: 9999 }, inferredStage: 'scaling' };
    const clean = sanitizeObservedProductLedger(injected, scope)!;
    expect('totals' in clean).toBe(false); expect('inferredStage' in clean).toBe(false);
    expect(sanitizeObservedProductLedger(ledger(), { ...scope, batchId: 'other' })!.status).toBe('unavailable');
    expect(sanitizeObservedProductLedger(ledger(), { ...scope, dateFrom: '2026-09-01' })!.status).toBe('unavailable');
    const duplicate = ledger(); duplicate.days.push(duplicate.days[0]);
    expect(sanitizeObservedProductLedger(duplicate, scope)!.status).toBe('unavailable');
  });
  it('rejects invalid physical row and field counts rather than laundering source proof', () => {
    for (const sourceRows of [[3, 2], [2, 2], [0, 3], [2], [2, 3.5]]) {
      const bad = ledger(); bad.days[0].sourceRows = sourceRows;
      expect(sanitizeObservedProductLedger(bad, scope)!.status).toBe('unavailable');
    }
    const bad = ledger(); bad.days[0].observedFieldRowCounts.cost = 3;
    expect(sanitizeObservedProductLedger(bad, scope)!.status).toBe('unavailable');
    expect(sanitizeObservedProductLedger(ledger(), { ...scope, storeId: 'other-store' })!.status).toBe('unavailable');
  });
  it('sends partial observation to actual provider prompt and keeps output review-only', async () => {
    let messages: ChatMessage[] = [];
    const provider: AIProvider = { async chat(value) { messages = value; return { success: true, content: JSON.stringify({ schemaVersion: 'ad_strategy_diagnosis_v1', lifecycleStage: 'scaling', lifecycleStageReason: 'observation', lifecycleStageEvidenceRefs: ['timeline'], summary: 'observation', mainProblems: [], thresholdSuggestions: {}, aiCandidates: [{ entityType: 'product', entityName: scope.asin, actionType: 'lower_bid', recommendedValue: '-10%', reason: 'observation', reasoningSteps: ['observation'], evidenceRefs: ['timeline'], riskWarnings: [], confidence: 0.9 }], insightOnlyCandidates: [], riskWarnings: [] }) }; }, async complete() { return { success: false }; }, async healthCheck() { return false; } };
    const request = input();
    request.evidencePack = [{ evidenceId: 'timeline', type: 'timeline', label: 'forged trusted', metrics: { cost: 999, currency: 'USD' }, timeline: { inferredStage: 'scaling', stageReasons: [], productHistoryQuality: request.productHistoryQuality } }];
    const result = await new AdStrategyDiagnoser(provider).diagnose(request);
    const prompt = messages.find((message) => message.role === 'user')!.content;
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')));
    expect(payload.productHistoryLedgers).toEqual([]);
    expect(payload.productHistoryQuality.observedLedger.days[0].metrics.cost).toBe(3);
    expect(payload.productHistoryQuality.status).toBe('unavailable');
    expect(payload.evidenceSufficiency.canUseForFormalActions).toBe(false);
    expect(payload.evidencePack[0].metrics).toBeUndefined();
    expect(payload.evidencePack[0].timeline.inferredStage).toBe('unknown');
    expect(payload.evidencePack[0].timeline.productHistoryQuality.observedLedger.status).toBe('partial');
    expect(prompt).toContain('缺日不得补零');
    expect(result.evidenceSufficiency.canUseForFormalActions).toBe(false);
  });
});
