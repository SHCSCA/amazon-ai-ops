import { describe, expect, it } from 'vitest';
import type { ActionRecommendation, AdDailyMetrics, CreateOperationEventInput } from '@amazon-ai-ops/shared-types';
import { buildAdAiEvidencePack, summarizeAiEvidencePack } from './ad-ai-evidence-pack';

describe('buildAdAiEvidencePack', () => {
  const scope = {
    dateFrom: '2026-06-01',
    dateTo: '2026-06-12',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    batchId: 'batch_1',
  };

  it('builds metric evidence with batch, source file, row, report type, date range and USD', () => {
    const evidencePack = buildAdAiEvidencePack({
      scope,
      metrics: [
        metric({
          date: '2026-06-10',
          batchId: 'batch_1',
          reportType: 'search_term',
          sourceFile: 'C:/reports/search-term.xlsx',
          sourceRow: 18,
          searchTerm: 'smart lock outdoor',
          cost: 42.5,
          sales: 0,
          orders: 0,
        }),
      ],
      operationEvents: [],
      productContexts: [],
      ruleRecommendations: [],
    });

    expect(evidencePack).toHaveLength(1);
    expect(evidencePack[0]).toMatchObject({
      type: 'metric',
      batchId: 'batch_1',
      reportType: 'search_term',
      sourceFile: 'C:/reports/search-term.xlsx',
      sourceRow: 18,
      dateRange: '2026-06-10~2026-06-10',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B001',
      entityType: 'search_term',
      entityName: 'smart lock outdoor',
      metrics: {
        cost: 42.5,
        sales: 0,
        orders: 0,
        currency: 'USD',
      },
    });
    expect(evidencePack[0].evidenceId).toMatch(/^metric:batch_1:search_term:2026-06-10:search_term:/);
  });

  it('builds operation event evidence for Coupon, BD, and Listing change context', () => {
    const evidencePack = buildAdAiEvidencePack({
      scope,
      metrics: [],
      operationEvents: [
        event({ eventType: 'coupon', title: '10% Coupon started', impactExpectation: 'conversion_up' }),
        event({ eventType: 'bd', title: 'Best Deal campaign', impactExpectation: 'traffic_up' }),
        event({ eventType: 'listing_change', title: 'A+ revised', impactExpectation: 'conversion_unknown' }),
      ],
      productContexts: [],
      ruleRecommendations: [],
    });

    expect(evidencePack.map((item) => item.event?.eventType)).toEqual(['coupon', 'bd', 'listing_change']);
    expect(evidencePack[0]).toMatchObject({
      type: 'operation_event',
      event: {
        title: '10% Coupon started',
        impactExpectation: 'conversion_up',
      },
    });
  });

  it('builds product context evidence with product stage and target ACOS/TACOS', () => {
    const evidencePack = buildAdAiEvidencePack({
      scope,
      metrics: [],
      operationEvents: [],
      productContexts: [
        {
          asin: 'B001',
          productStage: 'keyword_exploration',
          cost: {
            targetAcos: 0.35,
            targetTacos: 0.12,
            targetNetMargin: 0.22,
            minPrice: 29.99,
          },
        },
      ],
      ruleRecommendations: [],
    });

    expect(evidencePack[0]).toMatchObject({
      evidenceId: 'product:FT-US-US:US:B001',
      type: 'product_context',
      product: {
        productStage: 'keyword_exploration',
        targetAcos: 0.35,
        targetTacos: 0.12,
        targetNetMargin: 0.22,
        minPrice: 29.99,
      },
    });
  });

  it('builds product daily timeline evidence with stage, active days and recent daily metrics', () => {
    const evidencePack = buildAdAiEvidencePack({
      scope,
      metrics: [],
      operationEvents: [],
      productContexts: [],
      ruleRecommendations: [],
      productHistoryLedgers: [{
        asin: 'B001',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        activeDays: 3,
        firstMetricDate: '2026-06-01',
        lastMetricDate: '2026-06-12',
        inferredStage: 'keyword_exploration',
        stageReasons: ['连续多日有花费，仍处于测词。'],
        totals: {
          impressions: 1000,
          clicks: 88,
          cost: 170.25,
          orders: 3,
          sales: 300.5,
          acos: 0.566,
          cpc: 1.93,
          cvr: 0.034,
          currency: 'USD',
        },
        events: [event({ title: '10% Coupon started' })],
        product: {
          productStage: 'keyword_exploration',
          targetAcos: 0.35,
          targetTacos: 0.12,
          targetNetMargin: 0.22,
          minPrice: 29.99,
        },
        daily: [
          {
            date: '2026-06-01',
            impressions: 180,
            clicks: 12,
            cost: 22.5,
            orders: 0,
            sales: 0,
            acos: 0,
            cpc: 1.88,
            cvr: 0,
            currency: 'USD',
          },
          {
            date: '2026-06-12',
            impressions: 460,
            clicks: 42,
            cost: 84.55,
            orders: 2,
            sales: 200.51,
            acos: 0.422,
            cpc: 2.01,
            cvr: 0.048,
            currency: 'USD',
          },
        ],
      }],
    });

    expect(evidencePack).toHaveLength(1);
    expect(evidencePack[0]).toMatchObject({
      evidenceId: 'timeline:batch_1:product:B001',
      type: 'timeline',
      label: 'product B001 / keyword_exploration / 3 days',
      dateRange: '2026-06-01~2026-06-12',
      batchId: 'batch_1',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B001',
      entityType: 'product',
      entityName: 'B001',
      metrics: {
        cost: 170.25,
        sales: 300.5,
        orders: 3,
        clicks: 88,
        currency: 'USD',
      },
      timeline: {
        activeDays: 3,
        firstMetricDate: '2026-06-01',
        lastMetricDate: '2026-06-12',
        inferredStage: 'keyword_exploration',
        recentDaily: [
          { date: '2026-06-01', cost: 22.5, orders: 0, sales: 0, acos: 0 },
          { date: '2026-06-12', cost: 84.55, orders: 2, sales: 200.51, acos: 0.422 },
        ],
      },
      product: {
        productStage: 'keyword_exploration',
        targetAcos: 0.35,
      },
    });
    expect(summarizeAiEvidencePack(evidencePack)).toMatchObject({
      total: 1,
      timeline: 1,
    });
  });

  it('excludes data outside the current scope', () => {
    const evidencePack = buildAdAiEvidencePack({
      scope,
      metrics: [
        metric({ date: '2026-06-10', asin: 'B001', searchTerm: 'inside' }),
        metric({ date: '2026-05-31', asin: 'B001', searchTerm: 'outside date' }),
        metric({ date: '2026-06-10', asin: 'B002', searchTerm: 'outside asin' }),
      ],
      operationEvents: [
        event({ eventDate: '2026-06-10', asin: 'B001', title: 'inside event' }),
        event({ eventDate: '2026-06-13', asin: 'B001', title: 'outside event' }),
      ],
      productContexts: [
        { asin: 'B001', productStage: 'keyword_exploration' },
        { asin: 'B002', productStage: 'scaling' },
      ],
      ruleRecommendations: [
        recommendation({ entityName: 'inside rule' }),
        recommendation({ storeName: 'OTHER', entityName: 'outside store rule' }),
        recommendation({ marketplaceCode: 'CA', entityName: 'outside marketplace rule' }),
        recommendation({ asin: 'B002', entityName: 'outside asin rule' }),
        recommendation({ evidence: { ...recommendation().evidence, batchId: 'batch_2' }, entityName: 'outside batch rule' }),
      ],
    });

    expect(evidencePack.map((item) => item.entityName)).toEqual(['inside', 'inside event', 'B001', 'inside rule']);
  });

  it('excludes metric and rule evidence without the current explicit batch', () => {
    const evidencePack = buildAdAiEvidencePack({
      scope,
      metrics: [
        metric({ batchId: 'batch_1', searchTerm: 'current batch metric' }),
        metric({ batchId: 'batch_2', searchTerm: 'wrong batch metric' }),
        metric({ batchId: undefined, searchTerm: 'missing batch metric' }),
      ],
      operationEvents: [],
      productContexts: [],
      ruleRecommendations: [
        recommendation({ entityName: 'current batch rule' }),
        recommendation({
          entityName: 'wrong batch rule',
          evidence: { ...recommendation().evidence, batchId: 'batch_2' },
        }),
        recommendation({
          entityName: 'missing batch rule',
          evidence: { ...recommendation().evidence, batchId: undefined },
        }),
      ],
    });

    expect(evidencePack.map((item) => item.entityName)).toEqual([
      'current batch metric',
      'current batch rule',
    ]);
  });

  it('generates stable evidence ids and summaries', () => {
    const input = {
      scope,
      metrics: [metric({ date: '2026-06-10', searchTerm: 'stable term' })],
      operationEvents: [event({ title: 'Stable Coupon' })],
      productContexts: [{ asin: 'B001', productStage: 'keyword_exploration' }],
      ruleRecommendations: [recommendation()],
    };

    const first = buildAdAiEvidencePack(input);
    const second = buildAdAiEvidencePack(input);

    expect(first.map((item) => item.evidenceId)).toEqual(second.map((item) => item.evidenceId));
    expect(summarizeAiEvidencePack(first)).toEqual({
      total: 4,
      metric: 1,
      timeline: 0,
      operationEvent: 1,
      productContext: 1,
      ruleCandidate: 1,
    });
  });
});

function metric(patch: Partial<AdDailyMetrics>): AdDailyMetrics {
  return {
    date: '2026-06-10',
    batchId: 'batch_1',
    reportType: 'search_term',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    campaignName: 'SP exact',
    adGroupName: 'Main',
    searchTerm: 'smart lock outdoor',
    impressions: 1000,
    clicks: 30,
    cost: 42,
    orders: 0,
    sales: 0,
    acos: 0,
    cpc: 1.4,
    cvr: 0,
    currency: 'USD',
    ...patch,
  } as AdDailyMetrics;
}

function event(patch: Partial<CreateOperationEventInput>): CreateOperationEventInput {
  return {
    eventDate: '2026-06-10',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    eventType: 'coupon',
    title: '10% Coupon started',
    impactExpectation: 'conversion_up',
    ...patch,
  };
}

function recommendation(patch: Partial<ActionRecommendation> = {}): ActionRecommendation {
  return {
    taskId: 'task_1',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    msku: '',
    entityType: 'search_term',
    entityId: 'search_term_stable term',
    entityName: 'stable term',
    actionType: 'lower_bid',
    currentValue: '1.40',
    recommendedValue: '-10%',
    reason: 'No-order spend exceeded threshold.',
    evidence: {
      batchId: 'batch_1',
      sourceFiles: ['C:/reports/search-term.xlsx'],
      sourceRow: 18,
      campaignName: 'SP exact',
      adGroupName: 'Main',
      searchTerm: 'stable term',
      impressions: 1000,
      clicks: 30,
      cost: 42,
      orders: 0,
      sales: 0,
      acos: 0,
      cpc: 1.4,
      cvr: 0,
      currency: 'USD',
    },
    confidence: 0.7,
    riskLevel: 'APPROVAL',
    status: 'pending',
    ...patch,
  };
}
