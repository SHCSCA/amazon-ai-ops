import { describe, expect, it } from 'vitest';
import type { ParseResult } from '@amazon-ai-ops/report-parser';
import { assertLingxingParsedReportImportable } from './lingxing-report-import-validation';

function parsed(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    success: true,
    schemaValid: true,
    data: [{
      date: '2026-07-21',
      storeName: 'Store A',
      marketplaceCode: 'US',
      asin: 'B0ABC12345',
      msku: 'MSKU-A',
      campaignName: 'Campaign A',
      adGroupName: 'Ad group A',
      targeting: 'keyword-a',
      searchTerm: 'search term a',
      matchType: 'exact',
      impressions: 10,
      clicks: 1,
      cost: 1,
      orders: 0,
      sales: 0,
      currency: 'USD',
      acos: 0,
      cpc: 1,
      cvr: 0,
      sourceFile: 'private-path.xlsx',
    }],
    validation: { valid: true, errors: [], validCount: 1, invalidCount: 0 },
    sourceFile: 'private-path.xlsx',
    parsedAt: '2026-07-22T00:00:00.000Z',
    totalRows: 1,
    headers: ['日期', '广告活动', '花费'],
    ...overrides,
  };
}

const window = {
  dateStart: '2026-07-21',
  dateEnd: '2026-07-21',
  sourceName: 'campaign.xlsx',
};

describe('assertLingxingParsedReportImportable', () => {
  it('accepts a schema-valid zero-row receipt', () => {
    expect(() => assertLingxingParsedReportImportable(parsed({
      data: [],
      totalRows: 0,
      validation: { valid: true, errors: [], validCount: 0, invalidCount: 0 },
    }), window)).not.toThrow();
  });

  it('rejects any invalid source value even when other rows parsed', () => {
    expect(() => assertLingxingParsedReportImportable(parsed({
      validation: {
        valid: false,
        errors: [{ field: 'cost', message: 'Invalid numeric value: abc', row: 0, value: 'abc' }],
        validCount: 1,
        invalidCount: 1,
      },
    }), window)).toThrow(/无效数据.*cost/);
  });

  it.each(['2026-07-20', '2026-07-22', 'not-a-date'])('rejects metric date outside the exact batch window: %s', (date) => {
    const value = parsed();
    value.data = [{ ...value.data[0], date }];
    expect(() => assertLingxingParsedReportImportable(value, window)).toThrow(/不在采集日期窗/);
  });
});
