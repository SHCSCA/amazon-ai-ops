import { describe, expect, it } from 'vitest';
import { buildProductHistoryObservation, type ProductHistoryObservedMetric } from './ad-product-history-observation';

const scope = { storeId: 'isolated-store', storeName: 'isolated', marketplaceCode: 'US', asin: 'B000000001', dateFrom: '2026-10-01', dateTo: '2026-10-02' };
const metric = (patch: Partial<ProductHistoryObservedMetric> = {}): ProductHistoryObservedMetric => ({
  ...scope, date: scope.dateFrom, msku: '', campaignName: 'isolated', adGroupName: 'isolated', targeting: '', searchTerm: '', matchType: 'auto',
  impressions: 100, clicks: 10, cost: 20, orders: 2, sales: 80, acos: 0.25, cpc: 2, cvr: 0.2,
  batchId: 'isolated-batch', reportType: 'advertised_product', sourceFile: 'isolated.csv', sourceRow: 2, ...patch,
});
const observe = (rows: ProductHistoryObservedMetric[]) => buildProductHistoryObservation(scope, rows, { truncated: false, sourceBound: true });

describe('canonical product history observation stays unverified', () => {
  it('retains search-only days without summing report families or exposing totals', () => {
    const result = observe([metric(), metric({ date: scope.dateTo, reportType: 'search_term' })]);
    expect(result.status).toBe('unavailable');
    expect(result.canonicalObservation?.days.map((day) => day.status)).toEqual(['partial', 'partial']);
    expect(result.canonicalObservation?.days[1]?.reportTypes).toEqual(['search_term']);
    expect('totals' in result).toBe(false);
  });
  it('distinguishes observed zeros from unobserved days without certifying either', () => {
    const result = observe([metric({ impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 })]);
    expect(result.canonicalObservation?.days[0]?.observedZeroRowCount).toBe(1);
    expect(result.canonicalObservation?.days.map((day) => day.status)).toEqual(['partial', 'missing']);
    expect(result.canonicalObservation?.coverageProof).toBe('absent');
  });
  it('requires authoritative store and explicit ASIN rather than matching names', () => {
    const result = observe([metric(), metric({ storeId: 'other-store' }), metric({ asin: '' }), metric({ asin: 'B000000002' })]);
    expect(result.observedRowCount).toBe(1);
    expect(result.canonicalObservation?.nativeAsinProvenance).toBe('unknown');
  });
  it('does not infer supersession for duplicate sources or different batches', () => {
    expect(observe([metric(), metric()]).canonicalObservation?.days[0]?.status).toBe('ambiguous');
    const result = observe([metric(), metric({ batchId: 'other-batch' })]);
    expect(result.canonicalObservation?.days[0]?.status).toBe('ambiguous');
    expect(result.canonicalObservation?.replacementProof).toBe('absent');
  });
  it('records missing source positions and excludes filename-inferred report families', () => {
    const result = observe([metric({ sourceRow: undefined }), metric({ reportType: undefined, sourceFile: 'advertised_product.csv' })]);
    expect(result.canonicalObservation?.days[0]?.missingSourceIdentityRowCount).toBe(1);
    expect(result.canonicalObservation?.excludedReportRowCount).toBe(1);
  });
  it('exposes bounded projections and source truncation without changing trust', () => {
    const result = buildProductHistoryObservation({ ...scope, dateFrom: '2026-01-01', dateTo: '2026-12-31' }, [metric()], { truncated: true, sourceBound: true });
    expect(result.canonicalObservation?.days.length).toBe(120);
    expect(result.canonicalObservation?.omittedProductDayCount).toBe(245);
    expect(result.canonicalObservation?.rowLimitExceeded).toBe(true);
    expect(result.status).toBe('unavailable');
  });
});
