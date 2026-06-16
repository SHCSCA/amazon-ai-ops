import { describe, expect, it } from 'vitest';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import { AdQuantifier } from './quantification';
import { DEFAULT_RULE_CONFIG } from './types';

describe('AdQuantifier', () => {
  it('classifies no-order spend as waste with USD evidence and an actionable candidate', () => {
    const quantifier = new AdQuantifier(DEFAULT_RULE_CONFIG);

    const result = quantifier.quantify(metric({
      clicks: 36,
      cost: 42.5,
      orders: 0,
      sales: 0,
      searchTerm: 'irrelevant search',
      cpc: 1.18,
    }));

    expect(result.status).toBe('waste');
    expect(result.lifecycleStage).toBe('keyword_exploration');
    expect(result.recommendedAction).toBe('add_negative_exact');
    expect(result.recommendedValue).toBe('irrelevant search');
    expect(result.reasons.join('\n')).toContain('USD 42.50');
    expect(result.reasons.join('\n')).not.toMatch(/¥|RMB|CNY|人民币|元/);
  });

  it('marks efficient converting traffic as scale with human review', () => {
    const quantifier = new AdQuantifier(DEFAULT_RULE_CONFIG);

    const result = quantifier.quantify(metric({
      clicks: 30,
      cost: 12,
      orders: 4,
      sales: 200,
      acos: 0.06,
      cvr: 0.13,
      cpc: 0.4,
      searchTerm: 'profitable exact term',
    }));

    expect(result.status).toBe('scale');
    expect(result.lifecycleStage).toBe('scaling');
    expect(result.recommendedAction).toBe('raise_bid');
    expect(result.reviewRequired).toBe(true);
  });

  it('does not generate executable actions for whitelisted core terms', () => {
    const quantifier = new AdQuantifier({
      ...DEFAULT_RULE_CONFIG,
      coreWordWhitelist: ['brandlock'],
    });

    const result = quantifier.quantify(metric({
      clicks: 60,
      cost: 80,
      orders: 0,
      searchTerm: 'brandlock smart lock',
    }));

    expect(result.status).toBe('watch');
    expect(result.recommendedAction).toBeUndefined();
    expect(result.reviewRequired).toBe(true);
  });

  it('builds a daily advertising timeline per ad object with USD thresholds', () => {
    const quantifier = new AdQuantifier(DEFAULT_RULE_CONFIG);

    const timelines = quantifier.quantifyTimeline([
      metric({
        date: '2026-06-01',
        searchTerm: 'keypad lock',
        clicks: 12,
        cost: 12,
        orders: 0,
        sales: 0,
        sourceRow: 2,
      }),
      metric({
        date: '2026-06-02',
        searchTerm: 'keypad lock',
        clicks: 14,
        cost: 14,
        orders: 0,
        sales: 0,
        sourceRow: 3,
      }),
      metric({
        date: '2026-06-03',
        searchTerm: 'keypad lock',
        clicks: 15,
        cost: 18,
        orders: 0,
        sales: 0,
        sourceRow: 4,
      }),
      metric({
        date: '2026-06-01',
        searchTerm: 'profitable term',
        clicks: 10,
        cost: 4,
        orders: 1,
        sales: 80,
        sourceRow: 5,
      }),
    ]);

    expect(timelines).toHaveLength(2);
    expect(timelines[0]).toMatchObject({
      objectType: 'search_term',
      objectName: 'keypad lock',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-03',
      daysActive: 3,
      lifecycleStage: 'keyword_exploration',
      status: 'waste',
      recommendedAction: 'add_negative_exact',
      totals: {
        clicks: 41,
        cost: 44,
        orders: 0,
        sales: 0,
        currency: 'USD',
      },
    });
    expect(timelines[0].daily).toHaveLength(3);
    expect(timelines[0].thresholdSuggestion).toEqual(expect.objectContaining({
      targetAcos: DEFAULT_RULE_CONFIG.targetAcos,
      noOrderClickThreshold: DEFAULT_RULE_CONFIG.noOrderClickThreshold,
      bidAdjustPercent: DEFAULT_RULE_CONFIG.bidAdjustPercent,
    }));
    expect(timelines[0].reasons.join('\n')).toContain('USD 44.00');
  });
});

function metric(patch: Partial<AdDailyMetrics>): AdDailyMetrics {
  return {
    date: '2026-06-12',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    msku: 'SKU-1',
    campaignName: 'SP exact',
    adGroupName: 'Main',
    targeting: '',
    searchTerm: '',
    matchType: 'exact',
    sourceFile: 'C:/reports/search-term.xlsx',
    currency: 'USD',
    impressions: 1000,
    clicks: 0,
    cost: 0,
    orders: 0,
    sales: 0,
    acos: 0,
    cpc: 0,
    cvr: 0,
    ...patch,
  };
}
