import { describe, expect, it } from 'vitest';
import { buildAdQuantProductGroups, filterAdQuantByProduct, productGroupScopePatch, UNBOUND_PRODUCT_KEY } from './ad-quant-product-groups';

describe('ad quant product groups', () => {
  it('groups diagnostics by ASIN and selects scoped ASIN first', () => {
    const result = buildAdQuantProductGroups({
      scopeAsin: 'B002',
      diagnostics: [
        { asin: 'B001', cost: 10, spend: 10, sales: 20, orders: 1, clicks: 5, riskLevel: 'medium' },
        { asin: 'B002', cost: 40, spend: 40, sales: 80, orders: 2, clicks: 10, riskLevel: 'high' },
      ],
      timelines: [],
      ledgers: [],
    });

    expect(result.selectedProductKey).toBe('B002');
    expect(result.groups.map((item) => item.productKey)).toEqual(['B002', 'B001']);
    expect(result.groups[0]).toMatchObject({ asin: 'B002', cost: 40, orders: 2, highRiskCount: 1 });
  });

  it('selects highest-spend product when scope ASIN is empty', () => {
    const result = buildAdQuantProductGroups({
      diagnostics: [
        { asin: 'B001', cost: 10, spend: 10, sales: 0, orders: 0, clicks: 4, riskLevel: 'low' },
        { asin: 'B003', cost: 99, spend: 99, sales: 120, orders: 3, clicks: 20, riskLevel: 'medium' },
      ],
      timelines: [],
      ledgers: [],
    });

    expect(result.selectedProductKey).toBe('B003');
  });

  it('keeps rows without ASIN in an explicit unbound group', () => {
    const result = buildAdQuantProductGroups({
      diagnostics: [{ cost: 7, spend: 7, sales: 0, orders: 0, clicks: 3, riskLevel: 'high' }],
      timelines: [],
      ledgers: [],
    });

    expect(result.selectedProductKey).toBe(UNBOUND_PRODUCT_KEY);
    expect(result.groups[0].label).toBe('未绑定 ASIN');
  });

  it('uses product ledger totals and stage when diagnostics are lighter', () => {
    const result = buildAdQuantProductGroups({
      diagnostics: [{ asin: 'B001', spend: 3, sales: 0, orders: 0, clicks: 1, riskLevel: 'low' }],
      timelines: [],
      ledgers: [{
        asin: 'B001',
        inferredStage: 'keyword_exploration',
        totals: { cost: 88, sales: 160, orders: 4, clicks: 40 },
      }],
    });

    expect(result.groups[0]).toMatchObject({
      productKey: 'B001',
      cost: 88,
      sales: 160,
      orders: 4,
      clicks: 40,
      stage: 'keyword_exploration',
    });
  });

  it('uses canonical product summary for primary KPI totals instead of diagnostics detail sums', () => {
    const result = buildAdQuantProductGroups({
      scopeAsin: 'B001',
      canonicalSummary: { asin: 'B001', cost: 784.31, sales: 1289.68, orders: 25, clicks: 495 },
      diagnostics: [
        { asin: 'B001', spend: 478.48, sales: 769.81, orders: 17, clicks: 296, riskLevel: 'medium' },
        { asin: 'B001', spend: 456.77, sales: 689.83, orders: 16, clicks: 279, riskLevel: 'medium' },
        { asin: 'B001', spend: 225.79, sales: 399.9, orders: 6, clicks: 146, riskLevel: 'high' },
      ],
      timelines: [],
      ledgers: [],
    });

    expect(result.groups[0]).toMatchObject({
      productKey: 'B001',
      cost: 784.31,
      sales: 1289.68,
      orders: 25,
      clicks: 495,
      highRiskCount: 1,
    });
  });

  it('filters diagnostics, timelines, and ledgers by selected product', () => {
    const filtered = filterAdQuantByProduct({
      productKey: 'B001',
      diagnostics: [{ asin: 'B001' }, { asin: 'B002' }],
      timelines: [{ asin: 'B001' }, { asin: 'B002' }],
      ledgers: [{ asin: 'B001' }, { asin: 'B002' }],
    });

    expect(filtered.diagnostics).toHaveLength(1);
    expect(filtered.timelines).toHaveLength(1);
    expect(filtered.ledgers).toHaveLength(1);
  });

  it('creates a scope patch when selecting a product group', () => {
    expect(productGroupScopePatch('B001')).toEqual({ asin: 'B001', currency: 'USD' });
    expect(productGroupScopePatch(UNBOUND_PRODUCT_KEY)).toEqual({ asin: undefined, currency: 'USD' });
    expect(productGroupScopePatch('')).toEqual({ asin: undefined, currency: 'USD' });
  });
});
