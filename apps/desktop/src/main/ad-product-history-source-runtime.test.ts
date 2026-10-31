import { describe, expect, it } from 'vitest';
import { AdStrategyDiagnoser, type AIProvider, type ChatMessage } from '@amazon-ai-ops/ai-adapter';
import { AD_SOURCE_METRIC_BITS } from '@amazon-ai-ops/shared-types';
import { createHarness, fullAuthorityTerminal, fullAuthorityImportInput } from '@amazon-ai-ops/local-db/src/sqlite/repositories/lingxing-import-test-fixture';
import { loadProductHistoryObservation } from './ad-product-history-source-runtime';
import { buildAdAiEvidencePack } from './ad-ai-evidence-pack';
import { buildAdStrategyDiagnosisInput } from './ad-recommendation-ai-context';

const asin = 'B000000001';
function fixture(sourceAsin: string | null = asin) {
  const h = createHarness();
  const terminal = fullAuthorityTerminal(h.storeA, 'profile-a', 'observed-runtime');
  terminal.batch.dateStart = '2026-07-20';
  terminal.job.request.dateStart = '2026-07-20';
  for (const checkpoint of terminal.job.reports) {
    if (checkpoint.createdReportIdentity) checkpoint.createdReportIdentity.dateStart = '2026-07-20';
  }
  h.repository.commitCollectionTerminalForStore(h.storeA, terminal);
  const input = fullAuthorityImportInput(terminal, '2026-07-22T00:06:00.000Z', '2026-07-22T00:07:00.000Z');
  for (const metric of input.metrics) metric.asin = asin;
  const advertised = input.metrics.find(row => row.reportType === 'advertised_product')!;
  advertised.sourceAsin = sourceAsin ?? undefined;
  advertised.sourceMetricMask = AD_SOURCE_METRIC_BITS.impressions | AD_SOURCE_METRIC_BITS.clicks
    | AD_SOURCE_METRIC_BITS.cost | AD_SOURCE_METRIC_BITS.orders;
  advertised.cost = 0;
  advertised.sales = 0;
  input.reconciliations.find(row => row.reportType === 'advertised_product')!.expectedCost = 0;
  h.repository.commitImportForStore(h.storeA, input);
  const scope = { storeId: h.storeA, storeName: 'Shop Alpha', marketplaceCode: 'US', asin,
    dateFrom: '2026-07-20', dateTo: '2026-07-21', batchId: terminal.batch.id };
  const source = { batchId: terminal.batch.id, sourceFiles: input.files.map(file => file.filePath) };
  return { ...h, scope, source, input, advertised };
}

async function providerPayload(h: ReturnType<typeof fixture>) {
  const quality = loadProductHistoryObservation(h.database, h.scope, h.source);
  const evidencePack = buildAdAiEvidencePack({ scope: h.scope, metrics: [...h.input.metrics], operationEvents: [],
    productContexts: [], ruleRecommendations: [], productHistoryQuality: quality });
  const input = buildAdStrategyDiagnosisInput({ scope: h.scope, metrics: [...h.input.metrics], operationEvents: [],
    recommendations: [], productContexts: [], ruleConfig: {}, evidencePack, productHistoryQuality: quality });
  let captured: ChatMessage[] = [];
  const provider: AIProvider = {
    async chat(messages) { captured = messages; return { success: false, error: 'ISOLATED_CAPTURE_ONLY' }; },
    async complete() { return { success: false, error: 'ISOLATED_CAPTURE_ONLY' }; },
    async healthCheck() { return true; },
  };
  const result = await new AdStrategyDiagnoser(provider).diagnose(input);
  const prompt = captured.find(message => message.role === 'user')!.content;
  return { quality, evidencePack, input, result, payload: JSON.parse(prompt.slice(prompt.indexOf('{'))) };
}

describe('observed product history SQL to real provider input', () => {
  it('preserves partial values, exact source rows and unknown days/cells without granting formal authority', async () => {
    const h = fixture();
    const { quality, evidencePack, input, result, payload } = await providerPayload(h);
    expect(quality).toMatchObject({ status: 'unavailable', coverage: 'unverified' });
    const ledger = quality.observedLedger!;
    expect(ledger).toMatchObject({ status: 'partial', coverage: 'unverified', source: {
      batchId: h.scope.batchId, runId: h.input.runId, sourceFile: h.advertised.sourceFile,
      fileHash: 'a'.repeat(64), dateFrom: '2026-07-20', dateTo: '2026-07-21',
    } });
    expect(ledger.days[0]).toMatchObject({ date: '2026-07-20', status: 'missing', sourceRows: [],
      metrics: { cost: null, sales: null, orders: null } });
    expect(ledger.days[1]).toMatchObject({ date: '2026-07-21', status: 'partial', sourceRows: [h.advertised.sourceRow],
      metrics: { impressions: 100, clicks: 10, cost: 0, sales: null, orders: 1 },
      explicitZeroFields: ['cost'], unknownFields: ['sales'] });
    expect(input.productHistoryLedgers).toEqual([]);
    expect(evidencePack.find(item => item.type === 'timeline')?.timeline?.productHistoryQuality?.observedLedger).toEqual(ledger);
    expect(payload.productHistoryQuality.observedLedger.days).toEqual(ledger.days);
    expect(payload.evidencePack.find((item: { type: string }) => item.type === 'timeline').timeline.productHistoryQuality.observedLedger.days).toEqual(ledger.days);
    expect(payload.productHistoryLedgers).toEqual([]);
    expect(payload.evidenceSufficiency.canUseForFormalActions).toBe(false);
    expect(result.evidenceSufficiency?.canUseForFormalActions).toBe(false);
  });
  it('withholds observations after a persisted metric presence mask changes', async () => {
    const h = fixture();
    h.database.prepare("UPDATE ad_daily_metrics SET source_metric_mask = 31 WHERE report_type = 'advertised_product'").run();
    const { quality, payload } = await providerPayload(h);
    expect(quality.observedLedger).toMatchObject({ status: 'unavailable', reason: 'metric_evidence_mismatch', days: [] });
    expect(payload.productHistoryQuality.observedLedger).toMatchObject({ status: 'unavailable', days: [] });
    expect(payload.evidenceSufficiency.canUseForFormalActions).toBe(false);
  });
  it.each(['', null])('keeps source-native missing or legacy unknown ASIN excluded (%s)', async sourceAsin => {
    const h = fixture(sourceAsin);
    const { quality, payload } = await providerPayload(h);
    expect(quality.observedLedger?.days.every(day => day.status === 'missing')).toBe(true);
    expect(payload.productHistoryQuality.observedLedger.days.every((day: { status: string }) => day.status === 'missing')).toBe(true);
    expect(payload.evidenceSufficiency.canUseForFormalActions).toBe(false);
  });
});
