import type {
  ActionRecommendation,
  WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import { describe, expect, it } from 'vitest';
import { getRecommendationWritableTargetOwnershipBlockers } from './recommendation-writable-target-policy';

const target: WritableAdTargetEvidence = {
  entityType: 'keyword',
  entityId: 'keyword-opaque-1',
  entityName: 'door lock',
  campaignName: 'Campaign A',
  adGroupName: 'Ad Group A',
  metricDate: '2026-06-23',
  sourceFile: 'C:/reports/keyword.xlsx',
  sourceRow: 611,
  identitySource: 'ads_ui',
  verifiedBy: 'Alice',
  verifiedAt: '2026-07-16T03:00:00.000Z',
  verificationNote: 'Matched the current editable keyword row.',
  identityProofPath: 'C:/evidence/keyword-identity.png',
};

const sourceAuthority = {
  reportType: 'keyword',
  entityName: 'door lock',
  campaignName: 'Campaign A',
  adGroupName: 'Ad Group A',
  metricDate: '2026-06-23',
  sourceFile: 'C:/reports/keyword.xlsx',
  sourceRow: 611,
};

function recommendation(overrides: Partial<ActionRecommendation> = {}): ActionRecommendation {
  return {
    taskId: 'task_1',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B0TESTASIN',
    msku: 'MSKU-1',
    entityType: 'search_term',
    entityId: 'Campaign A_Ad Group A_door lock',
    entityName: 'door lock',
    actionType: 'lower_bid',
    currentValue: '1.49',
    recommendedValue: '1.00',
    reason: 'Bounded bid reduction.',
    evidence: {
      impressions: 1000,
      clicks: 30,
      cost: 40,
      orders: 1,
      sales: 60,
      acos: 0.67,
      cpc: 1.33,
      cvr: 0.03,
      date: '2026-06-23',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      searchTerm: 'door lock',
      batchId: 'batch_current',
      sourceFiles: ['C:/reports/keyword.xlsx'],
      sourceRow: 611,
    },
    confidence: 0.8,
    riskLevel: 'APPROVAL',
    status: 'pending',
    ...overrides,
  };
}

describe('recommendation writable-target ownership policy', () => {
  it('accepts a canonical target for the same recommendation object', () => {
    expect(getRecommendationWritableTargetOwnershipBlockers(recommendation(), target, sourceAuthority)).toEqual([]);
  });

  it.each([
    ['campaign', { campaignName: 'Campaign B' }, /campaign \/ ad group/],
    ['ad group', { adGroupName: 'Ad Group B' }, /campaign \/ ad group/],
    ['entity name', { entityName: 'another target' }, /名称/],
    ['entity type inferred from report', { entityType: 'product_targeting' }, /类型/],
  ] as const)('blocks a canonical target with mismatched %s', (_label, override, expected) => {
    const blockers = getRecommendationWritableTargetOwnershipBlockers(
      recommendation(),
      { ...target, ...override } as WritableAdTargetEvidence,
      sourceAuthority,
    );
    expect(blockers.join('、')).toMatch(expected);
  });

  it('uses a canonical report type instead of depending on a localized or prefixed file name', () => {
    const localizedAuthority = {
      ...sourceAuthority,
      sourceFile: 'D:/reports/01_2026-07-关键词广告报表.xlsx',
    };

    expect(getRecommendationWritableTargetOwnershipBlockers(recommendation(), {
      ...target,
      sourceFile: 'D:/reports/01_2026-07-关键词广告报表.xlsx',
    }, localizedAuthority)).toEqual([]);
    expect(getRecommendationWritableTargetOwnershipBlockers(recommendation(), {
      ...target,
      entityType: 'product_targeting',
      sourceFile: 'D:/reports/01_2026-07-关键词广告报表.xlsx',
    }, localizedAuthority).join('、')).toMatch(/类型/);
  });

  it('never treats recommendation JSON or a report basename as source authority', () => {
    expect(getRecommendationWritableTargetOwnershipBlockers(recommendation(), target).join('、'))
      .toMatch(/缺少当前数据库来源权威/);
  });

  it.each([
    'user_search_term',
    'search_term',
    'unknown',
  ])('fails closed for unsupported canonical source type %s', (reportType) => {
    expect(getRecommendationWritableTargetOwnershipBlockers(
      recommendation(),
      target,
      { ...sourceAuthority, reportType },
    ).join('、')).toMatch(/不能唯一映射/);
  });

  it('uses canonical source authority instead of trusting a spoofed recommendation type', () => {
    const rec = {
      ...recommendation(),
      entityType: 'product_targeting',
    } as unknown as ActionRecommendation;
    expect(getRecommendationWritableTargetOwnershipBlockers(rec, target, sourceAuthority)).toEqual([]);
  });
});
