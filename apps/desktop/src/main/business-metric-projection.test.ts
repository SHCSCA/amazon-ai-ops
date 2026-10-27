import { describe, expect, it } from 'vitest';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import {
  countMetricsWithAsin, countMetricsWithSourceFileAndRow, countMetricsWithSourceRow,
  mapBusinessAdMetricRow, normalizeAdMetricMatchType, roundMoney,
} from './business-metric-projection';

describe('business metric projection', () => {
  it('preserves physical row identity and does not infer missing source rows', () => {
    const input = { id: 'metric-1', batch_id: 'batch-1', report_type: 'keyword',
      match_type: 'phrase', source_file: 'report.xlsx', source_row: 7, cost: 12.3, orders: 2 };
    expect(mapBusinessAdMetricRow(input)).toMatchObject({ id: 'metric-1', batchId: 'batch-1',
      reportType: 'keyword', matchType: 'phrase', sourceFile: 'report.xlsx', sourceRow: 7, cost: 12.3, orders: 2, currency: 'USD' });
    expect(mapBusinessAdMetricRow({ ...input, source_row: null, currency: 'USD' }).sourceRow).toBeUndefined();
  });

  it('counts only available provenance and ASIN values', () => {
    const metrics = [
      { sourceRow: 7, sourceFile: 'report.xlsx', asin: 'B000000001' },
      { sourceRow: 0, sourceFile: 'report.xlsx', asin: ' ' },
      { sourceRow: 3, sourceFile: ' ', asin: 'B000000002' },
      { sourceRow: undefined, sourceFile: 'report.xlsx' },
    ] as AdDailyMetrics[];
    expect(countMetricsWithSourceRow(metrics)).toBe(2);
    expect(countMetricsWithSourceFileAndRow(metrics)).toBe(1);
    expect(countMetricsWithAsin(metrics)).toBe(2);
  });

  it('preserves money rounding and the existing match-type fallback', () => {
    expect(roundMoney('12.345')).toBe(12.35);
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeAdMetricMatchType('EXACT')).toBe('exact');
    expect(normalizeAdMetricMatchType('invalid')).toBe('auto');
  });
});
