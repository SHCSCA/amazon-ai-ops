import { describe, expect, it } from 'vitest';
import {
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
    expect(model.timeline.map((item) => productTimelineScopeLabel(item.scope))).toEqual(['全局', '产品']);
    expect(model.emptyReason).toBe('');
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
    });
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
        daily: [],
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
