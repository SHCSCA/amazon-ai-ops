import { describe, expect, it } from 'vitest';
import {
  PRODUCT_QUICK_COST_FIELDS,
  PRODUCT_QUICK_TARGET_FIELDS,
  buildProductManagementPageModel,
  productManagementActionRoutes,
  productTimelineScopeLabel,
} from './product-management-page';
import type { BusinessDataPipeline } from '../types';

describe('ProductManagementPage model', () => {
  it('selects the scoped product and exposes product identity, ad summary, and timeline tags', () => {
    const model = buildProductManagementPageModel({
      data: pipeline(),
      scopeAsin: 'B001',
    });

    expect(model.selectedProduct?.title).toBe('D6 Smart Lock');
    expect(model.selectedProduct?.asin).toBe('B001');
    expect(model.selectedProduct?.cost).toBe(80);
    expect(model.selectedDailyRows).toEqual([
      expect.objectContaining({ date: '2026-06-10', cost: 20, orders: 1 }),
      expect.objectContaining({ date: '2026-06-11', cost: 60, orders: 3 }),
    ]);
    expect(model.timeline.map((item) => productTimelineScopeLabel(item.scope))).toEqual(['全局', '产品']);
    expect(model.emptyReason).toBe('');
  });

  it('uses canonical product totals instead of summing diagnostic detail rows', () => {
    const data = {
      ...pipeline(),
      productHistory: { ledgers: [], ledgerCount: 0, notes: [] },
      quant: {
        ...pipeline().quant,
        totalSpend: 784.31,
        totalSales: 1289.68,
        totalOrders: 25,
        totalClicks: 495,
        diagnostics: [
          {
            asin: 'B001',
            spend: 478.48,
            sales: 769.81,
            orders: 17,
            clicks: 296,
            acos: 0.62,
            cvr: 0.057,
            cpc: 1.62,
            severity: 'medium',
            diagnosis: '复核',
            suggestedDirection: '观察',
          },
          {
            asin: 'B001',
            spend: 456.77,
            sales: 689.83,
            orders: 16,
            clicks: 279,
            acos: 0.66,
            cvr: 0.057,
            cpc: 1.64,
            severity: 'medium',
            diagnosis: '复核',
            suggestedDirection: '观察',
          },
          {
            asin: 'B001',
            spend: 225.79,
            sales: 399.9,
            orders: 6,
            clicks: 146,
            acos: 0.56,
            cvr: 0.041,
            cpc: 1.55,
            severity: 'high',
            diagnosis: '高风险',
            suggestedDirection: '复核',
          },
        ],
      },
    } as BusinessDataPipeline;

    const model = buildProductManagementPageModel({ data, scopeAsin: 'B001' });

    expect(model.selectedProduct).toMatchObject({
      asin: 'B001',
      cost: 784.31,
      sales: 1289.68,
      orders: 25,
      clicks: 495,
      highRiskCount: 1,
    });
  });

  it('uses clear empty copy when no products or ASIN metrics exist', () => {
    const model = buildProductManagementPageModel({
      data: {
        ...pipeline(),
        productContext: { products: [], productCount: 0, notes: [] },
        productHistory: { ledgers: [], ledgerCount: 0, notes: [] },
        quant: { ...pipeline().quant, diagnostics: [] },
        operations: { events: [], eventCount: 0, notes: [] },
      },
      scopeAsin: '',
    });

    expect(model.products).toHaveLength(0);
    expect(model.emptyReason).toBe('当前范围还没有产品配置或可识别 ASIN 的广告数据。');
  });

  it('defines product-context action routes', () => {
    expect(productManagementActionRoutes()).toEqual({
      adQuant: 'ad-quant',
      recommendations: 'recommendations',
      keywordOpportunities: 'keyword-opportunities',
      listingOptimization: 'listing-optimization',
      operationEvents: 'operation-events',
      productConfig: 'product-config',
    });
  });

  it('names quick product cost and target fields explicitly', () => {
    expect(PRODUCT_QUICK_COST_FIELDS.map((field) => field.label)).toEqual(['采购成本', 'FBA 费用', '最低售价']);
    expect(PRODUCT_QUICK_TARGET_FIELDS.map((field) => field.label)).toEqual(['目标 ACOS', '目标 TACOS', '目标净利率']);
  });
});

function pipeline(): BusinessDataPipeline {
  return {
    scope: {
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B001',
      currency: 'USD',
    },
    generatedAt: '2026-06-12T00:00:00.000Z',
    collection: {} as BusinessDataPipeline['collection'],
    quant: {
      hasImportedMetrics: true,
      importedRows: 10,
      totalSpend: 80,
      totalSales: 160,
      totalOrders: 4,
      totalClicks: 40,
      totalImpressions: 1000,
      acos: 0.5,
      cvr: 0.1,
      cpc: 2,
      wastedSpend: 0,
      highRiskCount: 1,
      blockers: [],
      diagnostics: [{
        asin: 'B001',
        spend: 20,
        sales: 40,
        orders: 1,
        clicks: 10,
        acos: 0.5,
        cvr: 0.1,
        cpc: 2,
        severity: 'high',
        diagnosis: '高 ACOS',
        suggestedDirection: '复核',
      }],
      adObjectTimelines: [],
    },
    operations: {
      events: [
        event({ id: 1, eventDate: '2026-06-10', asin: 'B001', title: 'Coupon started' }),
        event({ id: 2, eventDate: '2026-06-11', asin: undefined, title: 'Prime event' }),
      ],
      eventCount: 2,
      notes: [],
    },
    productContext: {
      products: [{ asin: 'B001', title: 'D6 Smart Lock', sku: 'D6-SKU', productStage: 'keyword_exploration', status: 'active' }],
      productCount: 1,
      notes: [],
    },
    productHistory: {
      ledgers: [{
        asin: 'B001',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        activeDays: 2,
        inferredStage: 'keyword_exploration',
        stageReasons: [],
        daily: [
          {
            date: '2026-06-10',
            impressions: 200,
            clicks: 10,
            cost: 20,
            orders: 1,
            sales: 40,
            acos: 0.5,
            cpc: 2,
            cvr: 0.1,
            currency: 'USD',
          },
          {
            date: '2026-06-11',
            impressions: 800,
            clicks: 30,
            cost: 60,
            orders: 3,
            sales: 120,
            acos: 0.5,
            cpc: 2,
            cvr: 0.1,
            currency: 'USD',
          },
        ],
        totals: {
          impressions: 1000,
          clicks: 40,
          cost: 80,
          orders: 4,
          sales: 160,
          acos: 0.5,
          cpc: 2,
          cvr: 0.1,
          currency: 'USD',
        },
        events: [],
      }],
      ledgerCount: 1,
      notes: [],
    },
  };
}

function event(patch: any) {
  return {
    id: patch.id,
    eventDate: patch.eventDate,
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: patch.asin,
    campaignName: patch.campaignName,
    adGroupName: patch.adGroupName,
    eventType: 'coupon',
    title: patch.title,
    impactExpectation: 'unknown',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
