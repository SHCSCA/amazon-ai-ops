import { describe, expect, it } from 'vitest';
import {
  buildProductManagementSummaries,
  buildProductTimeline,
  classifyOperationEventScope,
  formatScopeProductLabel,
  mergeProductStrategyContexts,
  normalizeProductPortfolioRows,
} from './product-management';
import type {
  BusinessQuantDiagnostic,
  OperationEventView,
  ProductHistoryLedgerView,
  ProductStrategyContextView,
} from './types';

describe('product management renderer model', () => {
  it('normalizes configured products for the active store and marketplace only', () => {
    const products = normalizeProductPortfolioRows([
      {
        id: 1,
        asin: ' b001 ',
        store_name: 'FT-US-US',
        marketplace_code: 'us',
        parent_asin: ' parent-1 ',
        msku: 'D6-MSKU',
        sku: 'D6-SKU',
        title: ' D6 Smart Lock ',
        product_stage: 'keyword_exploration',
        status: 'active',
        cost: { purchaseCost: 103, currentPrice: 49.99, targetAcos: 0.35 },
      },
      {
        id: 2,
        asin: 'B002',
        store_name: 'OTHER-STORE',
        marketplace_code: 'US',
        title: 'Other store product',
      },
      { id: 3, asin: ' ', store_name: 'FT-US-US', marketplace_code: 'US' },
    ], {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    });

    expect(products).toEqual([{
      asin: 'B001',
      parentAsin: 'parent-1',
      msku: 'D6-MSKU',
      sku: 'D6-SKU',
      title: 'D6 Smart Lock',
      productStage: 'keyword_exploration',
      status: 'active',
      cost: { purchaseCost: 103, currentPrice: 49.99, targetAcos: 0.35 },
    }]);
  });

  it('fails closed when the product portfolio scope is incomplete', () => {
    const rows = [{
      asin: 'B001',
      store_name: 'FT-US-US',
      marketplace_code: 'US',
      title: 'D6 Smart Lock',
    }];

    expect(normalizeProductPortfolioRows(rows, {
      storeName: '',
      marketplaceCode: 'US',
    })).toEqual([]);
    expect(normalizeProductPortfolioRows(rows, {
      storeName: 'FT-US-US',
      marketplaceCode: '',
    })).toEqual([]);
  });

  it('supplements portfolio contexts without duplicating normalized ASINs', () => {
    expect(mergeProductStrategyContexts(
      [{ asin: 'b001', title: 'Metric title', sku: 'D6-SKU' }],
      [
        { asin: ' B001 ', title: 'Configured title', productStage: 'scaling', cost: { targetAcos: 0.3 } },
        { asin: 'B002', title: 'Configured only' },
      ],
    )).toEqual([
      {
        asin: 'B001',
        title: 'Configured title',
        sku: 'D6-SKU',
        productStage: 'scaling',
        cost: { targetAcos: 0.3 },
      },
      { asin: 'B002', title: 'Configured only' },
    ]);
  });

  it('combines product identity, ad metrics, ledgers, and event counts by ASIN', () => {
    const products: ProductStrategyContextView[] = [
      {
        asin: 'B001',
        title: 'D6 Smart Lock',
        sku: 'D6-SKU',
        productStage: 'keyword_exploration',
        status: 'active',
        cost: { targetAcos: 0.35 },
      },
    ];
    const diagnostics: BusinessQuantDiagnostic[] = [
      diagnostic({ asin: 'B001', spend: 12, sales: 30, orders: 1, clicks: 10, severity: 'high' }),
      diagnostic({ asin: 'B002', spend: 8, sales: 0, orders: 0, clicks: 6 }),
    ];
    const ledgers: ProductHistoryLedgerView[] = [
      ledger({ asin: 'B001', cost: 80, sales: 160, orders: 4, clicks: 40, inferredStage: 'keyword_exploration' }),
    ];
    const events = [
      event({ id: 1, eventDate: '2026-06-10', asin: 'B001', title: 'D6 Coupon' }),
      event({ id: 2, eventDate: '2026-06-09', asin: undefined, title: 'Prime event' }),
      event({ id: 3, eventDate: '2026-06-08', asin: 'B002', title: 'Other product coupon' }),
    ];

    const result = buildProductManagementSummaries({ products, diagnostics, ledgers, events });

    expect(result.map((item) => item.asin)).toEqual(['B001', 'B002']);
    expect(result[0]).toMatchObject({
      asin: 'B001',
      title: 'D6 Smart Lock',
      skuLine: 'D6-SKU',
      stage: 'keyword_exploration',
      status: 'active',
      cost: 80,
      sales: 160,
      orders: 4,
      clicks: 40,
      activeDays: 2,
      lastMetricDate: '2026-06-12',
      targetAcos: 0.35,
      highRiskCount: 1,
      productEventCount: 1,
      globalEventCount: 1,
      eventCount: 2,
      configured: true,
    });
    expect(result[1]).toMatchObject({
      asin: 'B002',
      title: 'B002',
      configured: false,
      productEventCount: 1,
      globalEventCount: 1,
    });
  });

  it('classifies global, product, and ad object events for the selected ASIN', () => {
    expect(classifyOperationEventScope(event({ asin: undefined, campaignName: undefined, adGroupName: undefined }), 'B001')).toBe('global');
    expect(classifyOperationEventScope(event({ asin: 'b001', campaignName: undefined, adGroupName: undefined }), 'B001')).toBe('product');
    expect(classifyOperationEventScope(event({ asin: 'B001', campaignName: 'SP exact', adGroupName: 'Main' }), 'B001')).toBe('ad_object');
    expect(classifyOperationEventScope(event({ asin: 'B002', campaignName: undefined, adGroupName: undefined }), 'B001')).toBe('other_product');
  });

  it('builds a product timeline with selected product events and global events sorted by date', () => {
    const timeline = buildProductTimeline({
      selectedAsin: 'B001',
      events: [
        event({ id: 1, eventDate: '2026-06-01', asin: 'B001', title: 'Listing changed' }),
        event({ id: 2, eventDate: '2026-06-03', asin: undefined, title: 'Prime event' }),
        event({ id: 3, eventDate: '2026-06-02', asin: 'B002', title: 'Other product event' }),
        event({ id: 4, eventDate: '2026-06-03', asin: 'B001', campaignName: 'SP exact', title: 'Campaign bid changed' }),
      ],
    });

    expect(timeline.map((item) => `${item.event.eventDate}:${item.scope}:${item.event.title}`)).toEqual([
      '2026-06-03:ad_object:Campaign bid changed',
      '2026-06-03:global:Prime event',
      '2026-06-01:product:Listing changed',
    ]);
  });

  it('formats scope product labels with title plus ASIN', () => {
    expect(formatScopeProductLabel('B001', [{ asin: 'B001', title: 'D6 Smart Lock' }])).toBe('D6 Smart Lock / B001');
    expect(formatScopeProductLabel('B002', [{ asin: 'B001', title: 'D6 Smart Lock' }])).toBe('B002');
    expect(formatScopeProductLabel(undefined, [{ asin: 'B001', title: 'D6 Smart Lock' }])).toBe('全部产品');
  });
});

function diagnostic(patch: Partial<BusinessQuantDiagnostic>): BusinessQuantDiagnostic {
  return {
    portfolioName: '',
    campaignName: '',
    adGroupName: '',
    asin: 'B001',
    objectType: 'search_term',
    objectName: 'smart lock',
    spend: 0,
    sales: 0,
    orders: 0,
    clicks: 0,
    acos: 0,
    cvr: 0,
    cpc: 0,
    diagnosis: '观察',
    suggestedDirection: '复核',
    ...patch,
  };
}

function ledger(patch: Partial<ProductHistoryLedgerView> & { asin: string; cost?: number; sales?: number; orders?: number; clicks?: number }): ProductHistoryLedgerView {
  return {
    asin: patch.asin,
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-12',
    activeDays: 2,
    lastMetricDate: '2026-06-12',
    inferredStage: patch.inferredStage || 'unknown',
    stageReasons: [],
    daily: [],
    totals: {
      impressions: 100,
      clicks: patch.clicks || 0,
      cost: patch.cost || 0,
      orders: patch.orders || 0,
      sales: patch.sales || 0,
      acos: patch.sales ? (patch.cost || 0) / patch.sales : 0,
      cpc: patch.clicks ? (patch.cost || 0) / patch.clicks : 0,
      cvr: patch.clicks ? (patch.orders || 0) / patch.clicks : 0,
      currency: 'USD',
    },
    events: [],
  };
}

function event(patch: Partial<OperationEventView>): OperationEventView {
  return {
    id: patch.id || 1,
    eventDate: patch.eventDate || '2026-06-01',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: patch.asin,
    campaignName: patch.campaignName,
    adGroupName: patch.adGroupName,
    eventType: patch.eventType || 'coupon',
    title: patch.title || 'Event',
    impactExpectation: patch.impactExpectation || 'unknown',
    notes: patch.notes,
    evidencePath: patch.evidencePath,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
