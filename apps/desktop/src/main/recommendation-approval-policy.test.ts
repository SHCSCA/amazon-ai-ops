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
      sourceRow: 12,
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

  it('blocks recommendations that are not bound to a concrete product ASIN', () => {
    const rec = recommendation({
      asin: '',
      evidence: {
        ...recommendation().evidence,
        asin: '',
      },
    });

    expect(getRecommendationApprovalMissingFields(rec)).toContain('ASIN');
    expect(() => assertRecommendationApprovalPolicy(rec)).toThrow(/ASIN/);
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

  it('blocks recommendations without a source row for original report traceability', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        sourceRow: undefined,
      },
    });

    expect(getRecommendationApprovalMissingFields(rec)).toContain('来源行号');
    expect(() => assertRecommendationApprovalPolicy(rec)).toThrow(/来源行号/);
  });

  it('blocks recommendations whose source row is not a positive original report row number', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        sourceRow: -1,
      },
    });

    expect(getRecommendationApprovalMissingFields(rec)).toContain('来源行号');
    expect(() => assertRecommendationApprovalPolicy(rec)).toThrow(/来源行号/);
  });

  it('blocks recommendations whose source files are only audit or diagnostic artifacts', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        sourceFiles: [
          'C:/reports/acceptance-audit.json',
          'C:/reports/diagnostic-screenshot.png',
        ],
      },
    });

    expect(getRecommendationApprovalMissingFields(rec)).toContain('真实来源报表');
    expect(() => assertRecommendationApprovalPolicy(rec)).toThrow(/真实来源报表/);
  });

  it('blocks recommendations when any source file is an audit artifact even if another source is a real spreadsheet', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        sourceFiles: [
          'C:/reports/user-search-term.xlsx',
          'C:/reports/acceptance-audit.json',
        ],
      },
    });

    expect(getRecommendationApprovalMissingFields(rec)).toContain('真实来源报表');
    expect(() => assertRecommendationApprovalPolicy(rec)).toThrow(/真实来源报表/);
  });

  it('blocks recommendations whose source files are not part of the current real-report gate', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        sourceFiles: ['C:/reports/stale-user-search-term.xlsx'],
      },
    });

    const blockers = getRecommendationApprovalBlockers(rec, {
      allowedSourceFiles: ['C:/reports/current-user-search-term.xlsx'],
    });

    expect(blockers).toContain('来源文件不属于当前数据批次真实报表');
    expect(() => assertRecommendationApprovalPolicy(rec, {
      allowedSourceFiles: ['C:/reports/current-user-search-term.xlsx'],
    })).toThrow(/来源文件不属于当前数据批次真实报表/);
  });

  it('blocks bid recommendations with relative or wrong-direction values before approval', () => {
    expect(getRecommendationApprovalBlockers(recommendation({
      actionType: 'lower_bid',
      currentValue: '1.20',
      recommendedValue: '-10%',
    }))).toContain('出价建议值必须是可执行的正数金额');

    expect(getRecommendationApprovalBlockers(recommendation({
      actionType: 'lower_bid',
      currentValue: '1.20',
      recommendedValue: '1.25',
    }))).toContain('降价动作的建议出价必须低于当前出价');

    expect(getRecommendationApprovalBlockers(recommendation({
      actionType: 'raise_bid',
      currentValue: '1.20',
      recommendedValue: '1.10',
    }))).toContain('提价动作的建议出价必须高于当前出价');
  });

  it('blocks recommendations when any source file is outside the current real-report gate', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        sourceFiles: [
          'C:/reports/current-user-search-term.xlsx',
          'C:/reports/stale-campaign.xlsx',
        ],
      },
    });

    const blockers = getRecommendationApprovalBlockers(rec, {
      allowedSourceFiles: ['C:/reports/current-user-search-term.xlsx'],
    });

    expect(blockers).toContain('来源文件不属于当前数据批次真实报表');
  });

  it('blocks insight-only or AI sourced recommendations without checkable AI evidence refs', () => {
    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: {
        ...recommendation().evidence,
        aiInsightOnly: true,
        decisionAgreement: 'aligned',
      },
    }))).toContain('AI 洞察未进入正式建议池');

    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        aiEvidenceRefs: [],
        decisionAgreement: 'aligned',
      },
    }))).toContain('AI 建议缺少可回查证据引用');
  });

  it('does not block rule-only recommendations that only carry batch-level AI strategy context', () => {
    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        aiStrategySummary: 'AI ran batch-level diagnosis but did not produce this action.',
        decisionAgreement: 'rule_only',
      },
    }))).not.toContain('AI 建议缺少可回查证据引用');
  });

  it('does not block rule-only recommendations when only batch-level AI lifecycle requires review', () => {
    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        decisionAgreement: 'rule_only',
        aiLifecycleStageRequiresReview: true,
        aiLifecycleStageInvalidReasons: ['AI 阶段判断引用了不可用证据：missing_ref。'],
      },
    }))).not.toContain('AI 阶段判断需要人工复核');
  });

  it('blocks AI sourced recommendations whose evidence refs are not resolved into evidence details', () => {
    const blockers = getRecommendationApprovalBlockers(recommendation({
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        aiEvidenceRefs: ['metric:batch_1:search_term:abc'],
        aiEvidenceDetails: [],
        decisionAgreement: 'aligned',
      },
    }));

    expect(blockers).toContain('AI 建议缺少可展示的证据详情');
  });

  it('blocks recommendations whose AI lifecycle stage requires review', () => {
    const blockers = getRecommendationApprovalBlockers(recommendation({
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        aiLifecycleStageRequiresReview: true,
        aiLifecycleStageInvalidReasons: ['AI 阶段判断引用了不可用证据：missing_ref。'],
        decisionAgreement: 'aligned',
      },
    }));

    expect(blockers).toContain('AI 阶段判断需要人工复核');
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
