import { describe, expect, it } from 'vitest';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import { RecommendationGenerator } from './recommendation';
import { DEFAULT_RULE_CONFIG } from './types';

describe('RecommendationGenerator', () => {
  it('builds recommendations from quantified ad metrics', () => {
    const generator = new RecommendationGenerator(DEFAULT_RULE_CONFIG);

    const rec = generator.generateFromMetrics(metric({
      clicks: 36,
      cost: 42.5,
      orders: 0,
      searchTerm: 'irrelevant search',
      cpc: 1.18,
    }), {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      config: DEFAULT_RULE_CONFIG,
      taskId: 'task_1',
    });

    expect(rec).toMatchObject({
      taskId: 'task_1',
      actionType: 'add_negative_exact',
      recommendedValue: 'irrelevant search',
      status: 'needs_review',
    });
    expect(rec?.evidence).toMatchObject({
      quantStatus: 'waste',
      quantLifecycleStage: 'keyword_exploration',
      quantReviewRequired: true,
    });
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
