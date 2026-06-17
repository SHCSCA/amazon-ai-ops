import { describe, expect, it } from 'vitest';
import type { AdDailyMetrics, CreateOperationEventInput } from '@amazon-ai-ops/shared-types';
import type { ProductStrategyContext } from '@amazon-ai-ops/ai-adapter';
import { buildAdProductHistoryLedger } from './ad-product-history-ledger';

describe('buildAdProductHistoryLedger', () => {
  const scope = {
    dateFrom: '2026-06-01',
    dateTo: '2026-06-12',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    batchId: 'batch_1',
  };

  it('builds an ASIN daily history from real imported daily ad metrics', () => {
    const ledger = buildAdProductHistoryLedger({
      scope,
      metrics: [
        metric({ date: '2026-06-01', cost: 10, sales: 0, orders: 0, clicks: 10 }),
        metric({ date: '2026-06-02', cost: 20, sales: 80, orders: 2, clicks: 20 }),
        metric({ date: '2026-06-02', campaignName: 'SP phrase', cost: 5, sales: 0, orders: 0, clicks: 5 }),
      ],
      operationEvents: [event({ eventDate: '2026-06-02', title: 'Coupon started' })],
      productContexts: [productContext()],
    });

    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      asin: 'B001',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      activeDays: 2,
      firstMetricDate: '2026-06-01',
      lastMetricDate: '2026-06-02',
      totals: {
        cost: 35,
        sales: 80,
        orders: 2,
        clicks: 35,
        currency: 'USD',
      },
      product: {
        productStage: 'keyword_exploration',
        targetAcos: 0.35,
        targetTacos: 0.12,
      },
    });
    expect(ledger[0].daily).toEqual([
      expect.objectContaining({ date: '2026-06-01', cost: 10, sales: 0, orders: 0, clicks: 10 }),
      expect.objectContaining({ date: '2026-06-02', cost: 25, sales: 80, orders: 2, clicks: 25 }),
    ]);
    expect(ledger[0].events).toHaveLength(1);
    expect(ledger[0].events[0]).toMatchObject({ eventDate: '2026-06-02', title: 'Coupon started' });
  });

  it('classifies product promotion stage from history when product context is absent', () => {
    const ledger = buildAdProductHistoryLedger({
      scope: { ...scope, asin: 'B002' },
      metrics: [
        metric({ asin: 'B002', date: '2026-06-01', cost: 8, sales: 0, orders: 0, clicks: 8 }),
        metric({ asin: 'B002', date: '2026-06-02', cost: 12, sales: 0, orders: 0, clicks: 10 }),
      ],
      operationEvents: [],
      productContexts: [],
    });

    expect(ledger[0].inferredStage).toBe('keyword_exploration');
    expect(ledger[0].stageReasons).toContain('有点击和花费但订单不足，仍处于关键词/投放探索。');
  });

  it('filters out metrics and events outside current scope', () => {
    const ledger = buildAdProductHistoryLedger({
      scope,
      metrics: [
        metric({ date: '2026-06-01', asin: 'B001', cost: 10 }),
        metric({ date: '2026-05-31', asin: 'B001', cost: 999 }),
        metric({ date: '2026-06-01', asin: 'B999', cost: 999 }),
        metric({ date: '2026-06-01', storeName: 'OTHER', cost: 999 }),
      ],
      operationEvents: [
        event({ eventDate: '2026-06-01', asin: 'B001', title: 'inside' }),
        event({ eventDate: '2026-06-13', asin: 'B001', title: 'outside date' }),
        event({ eventDate: '2026-06-01', asin: 'B999', title: 'outside asin' }),
      ],
      productContexts: [productContext(), { asin: 'B999', productStage: 'scaling' }],
    });

    expect(ledger).toHaveLength(1);
    expect(ledger[0].totals.cost).toBe(10);
    expect(ledger[0].events.map((item) => item.title)).toEqual(['inside']);
    expect(ledger[0].product?.productStage).toBe('keyword_exploration');
  });
});

function metric(patch: Partial<AdDailyMetrics>): AdDailyMetrics {
  return {
    date: '2026-06-01',
    batchId: 'batch_1',
    reportType: 'search_term',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    msku: '',
    campaignName: 'SP exact',
    adGroupName: 'Main',
    targeting: '',
    searchTerm: 'smart lock',
    matchType: 'exact',
    impressions: 100,
    clicks: 10,
    cost: 10,
    orders: 0,
    sales: 0,
    acos: 0,
    cpc: 1,
    cvr: 0,
    currency: 'USD',
    sourceFile: 'C:/reports/search-term.xlsx',
    sourceRow: 2,
    ...patch,
  };
}

function event(patch: Partial<CreateOperationEventInput>): CreateOperationEventInput {
  return {
    eventDate: '2026-06-01',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    eventType: 'coupon',
    title: 'Coupon started',
    impactExpectation: 'conversion_up',
    ...patch,
  };
}

function productContext(): ProductStrategyContext {
  return {
    asin: 'B001',
    productStage: 'keyword_exploration',
    cost: {
      targetAcos: 0.35,
      targetTacos: 0.12,
      targetNetMargin: 0.22,
      minPrice: 29.99,
    },
  };
}
