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
      batchId: 'batch_1',
      sourceFiles: ['C:/reports/search-term.xlsx'],
      sourceRow: 18,
    });
  });

  it('builds timeline recommendations from aggregated daily object metrics', () => {
    const generator = new RecommendationGenerator(DEFAULT_RULE_CONFIG);

    const recommendations = generator.generateTimelineBatch([
      metric({
        date: '2026-06-01',
        targeting: '宽泛匹配',
        clicks: 14,
        cost: 23.04,
        orders: 0,
        sales: 0,
        cpc: 1.65,
        sourceRow: 2,
      }),
      metric({
        date: '2026-06-02',
        targeting: '宽泛匹配',
        clicks: 136,
        cost: 230.52,
        orders: 7,
        sales: 484.92,
        cpc: 1.69,
        sourceRow: 12,
      }),
    ], {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      config: DEFAULT_RULE_CONFIG,
      taskId: 'task_timeline',
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      taskId: 'task_timeline',
      entityType: 'target',
      entityName: '宽泛匹配',
      actionType: 'lower_bid',
      currentValue: '1.69',
      recommendedValue: '1.52',
    });
    expect(recommendations[0].reason).toContain('ACOS 52.3%');
    expect(recommendations[0].evidence).toMatchObject({
      date: '2026-06-01 ~ 2026-06-02',
      clicks: 150,
      cost: 253.56,
      orders: 7,
      sales: 484.92,
      acos: 0.52289,
      cpc: 1.6904,
      batchId: 'batch_1',
      sourceFiles: ['C:/reports/search-term.xlsx'],
      sourceRow: 12,
      quantStatus: 'waste',
      quantLifecycleStage: 'declining_repair',
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
    batchId: 'batch_1',
    sourceFile: 'C:/reports/search-term.xlsx',
    sourceRow: 18,
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
