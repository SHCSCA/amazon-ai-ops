import { describe, expect, it } from 'vitest';
import type { KeywordMetric } from '@amazon-ai-ops/shared-types';
import { aggregateKeywordMetrics, buildKeywordOpportunities } from './engine';

function metric(overrides: Partial<KeywordMetric>): KeywordMetric {
  return {
    normalizedKeyword: '',
    rawKeyword: 'Insulated Mug',
    source: 'search_term',
    asin: 'B001',
    clicks: 0,
    impressions: 0,
    cost: 0,
    orders: 0,
    sales: 0,
    acos: 0,
    cvr: 0,
    ...overrides,
  };
}

describe('aggregateKeywordMetrics', () => {
  it('aggregates multi-row metrics for the same asin and normalized keyword', () => {
    const result = aggregateKeywordMetrics([
      metric({
        rawKeyword: 'Insulated Mug',
        clicks: 10,
        impressions: 100,
        cost: 20,
        orders: 2,
        sales: 100,
      }),
      metric({
        rawKeyword: ' insulated   mug ',
        clicks: 5,
        impressions: 50,
        cost: 10,
        orders: 1,
        sales: 50,
      }),
      metric({
        asin: 'B002',
        rawKeyword: 'Insulated Mug',
        clicks: 7,
        impressions: 70,
        cost: 14,
        orders: 1,
        sales: 70,
      }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      asin: 'B001',
      normalizedKeyword: 'insulated mug',
      clicks: 15,
      impressions: 150,
      cost: 30,
      orders: 3,
      sales: 150,
      acos: 0.2,
      cvr: 0.2,
    });
  });

  it('keeps opportunities separated by ASIN when keywords match', () => {
    const result = aggregateKeywordMetrics([
      metric({ asin: 'B001', rawKeyword: 'Insulated Mug', clicks: 10 }),
      metric({ asin: 'B002', rawKeyword: 'Insulated Mug', clicks: 8 }),
    ]);

    expect(result.map((item) => item.asin).sort()).toEqual(['B001', 'B002']);
  });

  it('builds distinct opportunities for the same keyword on different ASINs', () => {
    const result = buildKeywordOpportunities([
      metric({ asin: 'B001', rawKeyword: 'Insulated Mug', clicks: 20, orders: 3, sales: 120, cost: 24 }),
      metric({ asin: 'B002', rawKeyword: 'Insulated Mug', clicks: 18, orders: 2, sales: 80, cost: 16 }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.asin).sort()).toEqual(['B001', 'B002']);
    expect(result.every((item) => item.normalizedKeyword === 'insulated mug')).toBe(true);
  });

  it('keeps cost, traffic, and source trace in opportunity evidence', () => {
    const [opportunity] = buildKeywordOpportunities([
      metric({
        rawKeyword: 'Insulated Mug',
        clicks: 20,
        impressions: 1000,
        cost: 24,
        orders: 3,
        sales: 120,
        source: 'keyword_report',
        sourceFile: 'C:/reports/keyword.xlsx',
        sourceRow: 12,
      }),
    ]);

    expect(opportunity.evidence).toContain('cost=24');
    expect(opportunity.evidence).toContain('impressions=1000');
    expect(opportunity.evidence).toContain('cvr=0.15');
    expect(opportunity.evidence).toContain('source=keyword_report');
    expect(opportunity.evidence).toContain('source_file=C:/reports/keyword.xlsx');
    expect(opportunity.evidence).toContain('source_row=12');
  });
});
