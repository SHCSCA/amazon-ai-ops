import { describe, expect, it } from 'vitest';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import {
  assertRecommendationApprovalPolicy,
  getRecommendationApprovalBlockers,
  getRecommendationApprovalMissingFields,
} from './recommendation-approval-policy';

function recommendation(overrides: Partial<ActionRecommendation> = {}): ActionRecommendation {
  return {
    taskId: 'task_1',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B0TESTASIN',
    msku: 'MSKU-1',
    entityType: 'target',
    entityId: 'target_1',
    entityName: 'tight match target',
    actionType: 'lower_bid',
    currentValue: '1.20',
    recommendedValue: '1.08',
    reason: 'High ACOS',
    evidence: {
      impressions: 1000,
      clicks: 30,
      cost: 40,
      orders: 1,
      sales: 60,
      acos: 0.67,
      cpc: 1.33,
      cvr: 0.03,
      date: '2026-06-12',
      campaignName: 'SP exact',
      adGroupName: 'Main',
      targeting: 'tight match target',
      batchId: 'batch_1',
      sourceFiles: ['C:/reports/user-search-term.xlsx'],
      decisionAgreement: 'aligned',
      decisionRequiresReview: false,
      quantReviewRequired: false,
    },
    confidence: 0.8,
    riskLevel: 'APPROVAL',
    status: 'pending',
    ...overrides,
  };
}

describe('recommendation approval policy', () => {
  it('allows normal approval-required recommendations after human approval', () => {
    const rec = recommendation();

    expect(getRecommendationApprovalMissingFields(rec)).toEqual([]);
    expect(getRecommendationApprovalBlockers(rec)).toEqual([]);
    expect(() => assertRecommendationApprovalPolicy(rec)).not.toThrow();
  });

  it('blocks recommendations that cannot be bound to a concrete ads UI action', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        adGroupName: '',
        sourceFiles: [],
      },
      currentValue: '',
    });

    expect(getRecommendationApprovalMissingFields(rec)).toEqual([
      '广告组',
      '当前值',
      '来源文件',
    ]);
    expect(() => assertRecommendationApprovalPolicy(rec)).toThrow(/缺少审批字段：广告组、当前值、来源文件/);
  });

  it('blocks AI-only, conflict, and explicit strategy review recommendations', () => {
    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: { ...recommendation().evidence, decisionAgreement: 'ai_only' },
    }))).toContain('AI-only 建议');

    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: { ...recommendation().evidence, decisionAgreement: 'conflict' },
    }))).toContain('AI/规则冲突');

    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: { ...recommendation().evidence, decisionRequiresReview: true },
    }))).toContain('AI/规则合并标记需复核');
  });

  it('blocks rule quantification review and forbidden/high risk recommendations', () => {
    expect(() => assertRecommendationApprovalPolicy(recommendation({
      evidence: { ...recommendation().evidence, quantReviewRequired: true },
    }))).toThrow(/规则量化要求人工复核/);

    expect(() => assertRecommendationApprovalPolicy(recommendation({
      riskLevel: 'FORBIDDEN',
    }))).toThrow(/高风险或禁止执行风险等级/);
  });
});
