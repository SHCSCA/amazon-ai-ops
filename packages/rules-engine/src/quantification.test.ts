import { describe, expect, it } from 'vitest';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import { AdQuantifier, buildAdMetricObjectIdentity } from './quantification';
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

  it('does not escalate an aggregate lower-bid action because one daily sample is only watch-level noise', () => {
    const quantifier = new AdQuantifier(DEFAULT_RULE_CONFIG);

    const [timeline] = quantifier.quantifyTimeline([
      metric({
        date: '2026-06-01',
        targeting: 'broad target',
        clicks: 14,
        cost: 23.04,
        orders: 0,
        sales: 0,
        cpc: 1.65,
        sourceRow: 2,
      }),
      metric({
        date: '2026-06-02',
        targeting: 'broad target',
        clicks: 136,
        cost: 230.52,
        orders: 7,
        sales: 484.92,
        cpc: 1.69,
        sourceRow: 12,
      }),
    ]);

    expect(timeline.recommendedAction).toBe('lower_bid');
    expect(timeline.daily[0]).toMatchObject({
      status: 'watch',
      recommendedAction: undefined,
      reviewRequired: true,
    });
    expect(timeline.reviewRequired).toBe(false);
  });

  it('keeps aggregate lower-bid actions in review when a daily sample recommends a conflicting action', () => {
    const quantifier = new AdQuantifier(DEFAULT_RULE_CONFIG);

    const [timeline] = quantifier.quantifyTimeline([
      metric({
        date: '2026-06-01',
        targeting: 'mixed target',
        clicks: 10,
        cost: 4,
        orders: 1,
        sales: 80,
        cpc: 0.4,
        sourceRow: 2,
      }),
      metric({
        date: '2026-06-02',
        targeting: 'mixed target',
        clicks: 20,
        cost: 50,
        orders: 1,
        sales: 20,
        cpc: 2.5,
        sourceRow: 3,
      }),
    ]);

    expect(timeline.recommendedAction).toBe('lower_bid');
    expect(timeline.daily.map((item) => item.recommendedAction)).toEqual(['raise_bid', 'lower_bid']);
    expect(timeline.reviewRequired).toBe(true);
  });

  it('keeps identical object names from different report types in separate timelines', () => {
    const quantifier = new AdQuantifier(DEFAULT_RULE_CONFIG);
    const timelines = quantifier.quantifyTimeline([
      metric({
        date: '2026-06-01',
        reportType: 'keyword',
        sourceFile: 'D:/reports/01_2026-07-keyword.xlsx',
        searchTerm: '',
        targeting: 'same target',
        clicks: 12,
        cost: 12,
      }),
      metric({
        date: '2026-06-01',
        reportType: 'product_targeting',
        sourceFile: 'D:/reports/02_2026-07-product-targeting.xlsx',
        searchTerm: '',
        targeting: 'same target',
        clicks: 14,
        cost: 14,
      }),
    ]);

    expect(timelines).toHaveLength(2);
    expect(timelines.map((timeline) => timeline.daily[0].metric.reportType).sort())
      .toEqual(['keyword', 'product_targeting']);
    expect(timelines.every((timeline) => timeline.daily.length === 1)).toBe(true);
    expect(timelines.map((timeline) => timeline.objectType)).toEqual(['target', 'target']);
    expect(timelines.every((timeline) => timeline.objectKey.length > 0)).toBe(true);
    expect(new Set(timelines.map((timeline) => timeline.objectKey)).size).toBe(2);
    expect(timelines.map((timeline) => timeline.objectKey)).toEqual(expect.arrayContaining([
      'B001|sp exact|main|keyword|target|same target',
      'B001|sp exact|main|product_targeting|target|same target',
    ]));
  });

  it('builds the same complete identity used by timeline grouping and evidence binding', () => {
    const source = metric({
      asin: 'b0mixed',
      campaignName: 'Campaign A',
      adGroupName: 'Group A',
      reportType: 'USER_SEARCH_TERM',
      searchTerm: 'Door Lock',
    });
    const identity = buildAdMetricObjectIdentity(source);
    const [timeline] = new AdQuantifier(DEFAULT_RULE_CONFIG).quantifyTimeline([source]);

    expect(identity).toEqual({
      key: 'B0MIXED|campaign a|group a|user_search_term|search_term|door lock',
      objectType: 'search_term',
      objectName: 'Door Lock',
    });
    expect(timeline.objectKey).toBe(identity.key);
    expect(timeline.objectType).toBe(identity.objectType);
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
    reportType: 'search_term',
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
