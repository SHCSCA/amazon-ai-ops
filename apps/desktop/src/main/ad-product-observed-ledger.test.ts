import { describe, expect, it } from 'vitest';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import { buildAdProductObservedLedger } from './ad-product-observed-ledger';

const scope = { storeId: 'isolated-store', storeName: 'isolated', marketplaceCode: 'US', asin: 'B000000001', dateFrom: '2026-10-01', dateTo: '2026-10-02' };
const source = { storeId: scope.storeId, batchId: 'batch', runId: 'run', snapshotId: 'snapshot', sourceFile: 'isolated/product.csv', fileHash: 'a'.repeat(64), dateFrom: scope.dateFrom, dateTo: scope.dateTo };
const metric = (patch: Partial<AdDailyMetrics> = {}): AdDailyMetrics => ({
  date: scope.dateFrom, storeName: scope.storeName, marketplaceCode: 'US', currency: 'USD', asin: scope.asin, sourceAsin: scope.asin, sourceMetricMask: 31,
  msku: '', campaignName: 'isolated', adGroupName: 'isolated', targeting: '', searchTerm: '', matchType: 'auto',
  impressions: 100, clicks: 10, cost: 20, orders: 2, sales: 80, acos: 0.25, cpc: 2, cvr: 0.2,
  batchId: source.batchId, reportType: 'advertised_product', sourceFile: source.sourceFile, sourceRow: 2, ...patch,
});
const build = (metrics: AdDailyMetrics[]) => buildAdProductObservedLedger(scope, { status: 'verified', reason: 'snapshot only', source, metrics });

describe('partial native product-day observation', () => {
  it('exposes useful single-file daily values, never totals or ratios', () => {
    const result = build([metric(), metric({ sourceRow: 3, cost: 5, orders: 0, sales: 0 })]);
    expect(result).toMatchObject({ status: 'partial', coverage: 'unverified', source });
    expect(result.days[0]).toMatchObject({ status: 'partial', sourceRows: [2, 3], metrics: { cost: 25, sales: 80, orders: 2 }, observedFieldRowCounts: { cost: 2 } });
    expect(result.days[1]).toMatchObject({ status: 'missing', sourceRows: [], metrics: { cost: null, sales: null, orders: null } });
    expect('totals' in result).toBe(false);
    expect('acos' in result.days[0].metrics).toBe(false);
  });
  it('distinguishes explicit observation zero from missing day and unknown cell', () => {
    const result = build([metric({ cost: 0, orders: 0, sourceMetricMask: 15 })]);
    expect(result.days[0].explicitZeroFields).toEqual(['cost', 'orders']);
    expect(result.days[0].metrics.sales).toBeNull();
    expect(result.days[0].unknownFields).toEqual(['sales']);
    expect(result.days[1].explicitZeroFields).toEqual([]);
  });
  it.each([undefined, 0, -1, 32, 1.5, NaN])('does not promote unknown or invalid mask %s', mask => {
    const result = build([metric({ sourceMetricMask: mask })]);
    expect(Object.values(result.days[0].metrics)).toEqual([null, null, null, null, null]);
  });
  it('returns unknown for a field missing in one row, not a misleading subtotal', () => {
    const result = build([metric(), metric({ sourceRow: 3, sourceMetricMask: 27 })]);
    expect(result.days[0].metrics.cost).toBeNull();
    expect(result.days[0].observedFieldRowCounts.cost).toBe(1);
    expect(result.days[0].metrics.sales).toBe(160);
  });
  it.each([undefined, '', 'B1', 'b000000001'])('excludes unknown/inferred/invalid native ASIN %s', sourceAsin => {
    const result = build([metric({ sourceAsin })]);
    expect(result.excludedRowCount).toBe(1);
    expect(result.days.every(day => day.status === 'missing')).toBe(true);
  });
  it('uses native ASIN rather than effective inferred ASIN', () => {
    const result = build([metric({ asin: 'B000000002' })]);
    expect(result.days[0].metrics.cost).toBe(20);
  });
  it.each([
    { reportType: 'keyword' }, { reportType: 'search_term' }, { batchId: 'other' }, { sourceFile: 'other.csv' },
    { marketplaceCode: 'CA' }, { currency: 'CAD' }, { date: '2026-09-30' }, { sourceAsin: 'B000000002' },
  ])('excludes other report/source/scope %j', patch => {
    expect(build([metric(patch)]).days[0].metrics.cost).toBeNull();
  });
  it('refuses duplicate or absent physical rows', () => {
    expect(build([metric(), metric()]).days[0]).toMatchObject({ status: 'ambiguous', metrics: { cost: null } });
    expect(build([metric({ sourceRow: undefined })]).days[0].status).toBe('ambiguous');
  });
  it.each([NaN, Infinity, -1])('keeps malformed numeric field unknown %s', cost => {
    expect(build([metric({ cost })]).days[0].metrics.cost).toBeNull();
  });
  it('does not round overflow or fractional counts into valid evidence', () => {
    expect(build([metric({ clicks: 1.5 })]).days[0].metrics.clicks).toBeNull();
    expect(build([metric({ cost: Number.MAX_VALUE }), metric({ sourceRow: 3, cost: Number.MAX_VALUE })]).days[0].metrics.cost).toBeNull();
  });
  it('does not emit values from an unverified or oversized snapshot window', () => {
    expect(buildAdProductObservedLedger(scope, { status: 'unavailable', reason: 'hash mismatch', metrics: [metric()] }).status).toBe('unavailable');
    expect(buildAdProductObservedLedger({ ...scope, dateFrom: '2026-01-01', dateTo: '2026-12-31' }, { status: 'verified', reason: '', source: { ...source, dateFrom: '2026-01-01', dateTo: '2026-12-31' }, metrics: [metric()] }).days).toEqual([]);
  });
});
