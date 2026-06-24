import { describe, expect, it } from 'vitest';
import { buildAdQuantDiagnosisSummary, buildDecisionEvidenceSummary, formatEvidenceRefSummary } from './evidence-display';
import type { AdStrategyDiagnosisView, AiEvidenceDisplayItemView, RecommendationEvidence } from './types';

describe('formatEvidenceRefSummary', () => {
  it('renders referenced metric evidence as operator-readable facts instead of raw ids', () => {
    const summary = formatEvidenceRefSummary(['metric_1'], [
      evidence({
        evidenceId: 'metric_1',
        type: 'metric',
        label: 'smart lock / 2026-06-12',
        batchId: 'batch_20260612',
        reportType: 'user_search_term',
        campaignName: 'D9-自动-关键词',
        adGroupName: '关键词-20260519',
        entityType: 'search_term',
        entityName: 'smart lock',
        sourceRow: 19,
        metrics: { cost: 170.25, sales: 300.5, orders: 3, clicks: 88, currency: 'USD' },
      }),
    ]);

    expect(summary).toContain('报表指标');
    expect(summary).toContain('smart lock / 2026-06-12');
    expect(summary).toContain('批次 batch_20260612');
    expect(summary).toContain('广告活动 D9-自动-关键词');
    expect(summary).toContain('广告组 关键词-20260519');
    expect(summary).toContain('search_term smart lock');
    expect(summary).toContain('user_search_term');
    expect(summary).toContain('行 19');
    expect(summary).toContain('$170.25 / $300.50 / 3 单 / 88 点击');
    expect(summary).not.toBe('metric_1');
  });

  it('keeps missing refs visible but labels them as missing evidence details', () => {
    expect(formatEvidenceRefSummary(['missing_ref'], [])).toBe('缺少证据明细：missing_ref');
  });

  it('summarizes why an aligned recommendation can enter the formal recommendation pool', () => {
    const summary = buildDecisionEvidenceSummary(recommendationEvidence({
      decisionAgreement: 'aligned',
      decisionSource: 'rule_ai',
      aiEvidenceRefs: ['metric_1'],
      aiReasoningSteps: ['metric_1 显示高花费且订单不足。'],
      aiEvidenceDetails: [
        evidence({
          evidenceId: 'metric_1',
          type: 'metric',
          label: 'smart lock / 2026-06-12',
          reportType: 'user_search_term',
          sourceRow: 19,
          metrics: { cost: 170.25, sales: 300.5, orders: 3, clicks: 88, currency: 'USD' },
        }),
      ],
    }));

    expect(summary.statusLabel).toBe('正式建议');
    expect(summary.tone).toBe('ready');
    expect(summary.headline).toContain('规则与 AI 一致');
    expect(summary.reasons).toContain('metric_1 显示高花费且订单不足。');
    expect(summary.evidenceSummary).toContain('报表指标');
    expect(summary.evidenceSummary).toContain('行 19');
    expect(summary.nextAction).toBe('可进入审批，但仍需人工确认和执行回读。');
  });

  it('does not mark aligned AI recommendations as ready when evidence refs have no displayable details', () => {
    const summary = buildDecisionEvidenceSummary(recommendationEvidence({
      decisionAgreement: 'aligned',
      decisionSource: 'rule_ai',
      aiEvidenceRefs: ['metric_1'],
      aiEvidenceDetails: [],
      aiReasoningSteps: ['AI 判断花费高且订单不足。'],
    }));

    expect(summary.statusLabel).toBe('证据缺失');
    expect(summary.tone).toBe('blocked');
    expect(summary.headline).toContain('缺少可展示的证据详情');
    expect(summary.reasons).toContain('缺少证据明细：metric_1');
    expect(summary.nextAction).toBe('重新生成建议或补齐 AI 证据详情后再审批。');
  });

  it('summarizes insight-only AI output as not approvable', () => {
    const summary = buildDecisionEvidenceSummary(recommendationEvidence({
      aiInsightOnly: true,
      aiInsightInvalidReasons: ['AI 候选动作缺少可追溯的真实报表指标证据。'],
      aiEvidenceRefs: ['event_1'],
      aiEvidenceDetails: [
        evidence({
          evidenceId: 'event_1',
          type: 'operation_event',
          label: '10% Coupon started',
        }),
      ],
    }));

    expect(summary.statusLabel).toBe('洞察未采纳');
    expect(summary.tone).toBe('blocked');
    expect(summary.headline).toContain('不能审批');
    expect(summary.reasons).toContain('AI 候选动作缺少可追溯的真实报表指标证据。');
    expect(summary.nextAction).toBe('补齐真实报表指标证据后重新生成建议。');
  });

  it('summarizes rule and AI conflicts as review-required', () => {
    const summary = buildDecisionEvidenceSummary(recommendationEvidence({
      decisionAgreement: 'conflict',
      decisionRequiresReview: true,
      decisionReasons: ['规则建议降价。', 'AI 认为促销期信号需要观察。'],
      decisionRiskWarnings: ['Coupon 期间不要一次性大幅降价。'],
    }));

    expect(summary.statusLabel).toBe('需要复核');
    expect(summary.tone).toBe('warning');
    expect(summary.headline).toContain('规则与 AI 存在分歧');
    expect(summary.reasons).toEqual(['规则建议降价。', 'AI 认为促销期信号需要观察。']);
    expect(summary.riskWarnings).toContain('Coupon 期间不要一次性大幅降价。');
  });

  it('describes AI-only decisions as operator-facing AI insight copy', () => {
    const summary = buildDecisionEvidenceSummary(recommendationEvidence({
      decisionAgreement: 'ai_only',
      aiEvidenceRefs: ['event_1'],
      aiEvidenceDetails: [
        evidence({
          evidenceId: 'event_1',
          type: 'operation_event',
          label: '10% Coupon started',
        }),
      ],
    }));

    expect(summary.reasons).toContain('AI 独立洞察不直接执行。');
    expect(summary.reasons.join('\n')).not.toContain('AI-only');
  });

  it('summarizes an AI ad quant diagnosis as a stage, evidence and next-step decision', () => {
    const summary = buildAdQuantDiagnosisSummary(adDiagnosis({
      source: 'ai',
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: '搜索词花费、低订单和 Coupon 事件显示仍处于测词阶段。',
      lifecycleStageEvidenceRefs: ['timeline_1', 'event_1'],
      evidenceSufficiency: {
        level: 'medium',
        metricEvidenceCount: 12,
        sampleDays: 7,
        totalClicks: 88,
        totalCost: 170.25,
        totalOrders: 3,
        canUseForFormalActions: true,
        blockers: [],
        warnings: ['样本仍偏少。'],
      },
      evidencePackPreview: [
        evidence({
          evidenceId: 'timeline_1',
          type: 'timeline',
          label: 'smart lock 时间线',
          timeline: {
            activeDays: 7,
            firstMetricDate: '2026-06-01',
            lastMetricDate: '2026-06-07',
            inferredStage: 'keyword_exploration',
          },
        }),
        evidence({
          evidenceId: 'event_1',
          type: 'operation_event',
          label: '10% Coupon started',
        }),
      ],
    }));

    expect(summary.statusLabel).toBe('AI 阶段诊断');
    expect(summary.tone).toBe('ready');
    expect(summary.headline).toContain('测词');
    expect(summary.reasons).toContain('搜索词花费、低订单和 Coupon 事件显示仍处于测词阶段。');
    expect(summary.evidenceSummary).toContain('对象时间线');
    expect(summary.evidenceSummary).toContain('运营事件');
    expect(summary.evidenceStats).toContain('12 条指标证据');
    expect(summary.nextAction).toBe('可以进入优化建议，但正式动作仍需审批和执行回读。');
  });

  it('does not mark an AI ad quant diagnosis as ready when lifecycle evidence refs have no displayable details', () => {
    const summary = buildAdQuantDiagnosisSummary(adDiagnosis({
      source: 'ai',
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: 'AI 判断仍处于测词期。',
      lifecycleStageEvidenceRefs: ['metric_missing'],
      evidenceSufficiency: {
        level: 'high',
        metricEvidenceCount: 10,
        sampleDays: 7,
        totalClicks: 120,
        totalCost: 220,
        totalOrders: 4,
        canUseForFormalActions: true,
        blockers: [],
        warnings: [],
      },
      evidencePackPreview: [],
    }));

    expect(summary.statusLabel).toBe('AI 未采纳');
    expect(summary.tone).toBe('blocked');
    expect(summary.headline).toContain('AI 未采纳');
    expect(summary.reasons).toContain('缺少证据明细：metric_missing');
    expect(summary.nextAction).toBe('可先生成规则建议；需要 AI 参与时重新运行阶段分析。');
  });

  it('uses operator-facing Chinese copy for rule fallback warnings', () => {
    const summary = buildAdQuantDiagnosisSummary(adDiagnosis({
      source: 'rule',
      lifecycleStage: 'unknown',
      fallbackReason: 'AI 阶段判断缺少 evidenceRefs。',
      riskWarnings: ['AI unavailable'],
    }));

    expect(summary.statusLabel).toBe('AI 未采纳');
    expect(summary.reasons).toContain('AI 阶段判断没有正确引用当前证据。');
    expect(summary.riskWarnings).toContain('AI 当前不可用');
    expect(summary.reasons.join('\n')).not.toContain('evidenceRefs');
  });

  it('marks an ad quant diagnosis as review-required when lifecycle evidence is weak', () => {
    const summary = buildAdQuantDiagnosisSummary(adDiagnosis({
      source: 'ai',
      lifecycleStage: 'stable_conversion',
      lifecycleStageReason: '只看到促销事件，缺少日级指标支撑。',
      lifecycleStageEvidenceRefs: ['event_1'],
      lifecycleStageRequiresReview: true,
      lifecycleStageInvalidReasons: ['阶段判断不能只引用运营事件。'],
      evidenceSufficiency: {
        level: 'low',
        metricEvidenceCount: 0,
        sampleDays: 0,
        totalClicks: 0,
        totalCost: 0,
        totalOrders: 0,
        canUseForFormalActions: false,
        blockers: ['缺少真实指标证据。'],
        warnings: [],
      },
      evidencePackPreview: [
        evidence({
          evidenceId: 'event_1',
          type: 'operation_event',
          label: '10% Coupon started',
        }),
      ],
    }));

    expect(summary.statusLabel).toBe('AI 需复核');
    expect(summary.tone).toBe('warning');
    expect(summary.headline).toContain('稳定转化');
    expect(summary.reasons).toContain('阶段判断不能只引用运营事件。');
    expect(summary.nextAction).toBe('可先生成规则建议；补齐证据后再让 AI 参与。');
  });

  it('prioritizes evidence sufficiency blockers over generic lifecycle text when formal actions are blocked', () => {
    const summary = buildAdQuantDiagnosisSummary(adDiagnosis({
      source: 'ai',
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: 'AI 认为当前仍处于测词阶段。',
      lifecycleStageEvidenceRefs: ['metric_1'],
      evidenceSufficiency: {
        level: 'low',
        metricEvidenceCount: 1,
        sampleDays: 1,
        totalClicks: 80,
        totalCost: 120,
        totalOrders: 0,
        canUseForFormalActions: false,
        blockers: [
          '当前范围指标证据缺少真实广告报表 sourceFile/sourceRow，不能用于正式 AI 动作。',
          '当前范围指标证据缺少产品 ASIN，不能用于正式 AI 动作。',
        ],
        warnings: [],
      },
      evidencePackPreview: [
        evidence({
          evidenceId: 'metric_1',
          type: 'metric',
          label: 'smart lock / 2026-06-12',
          metrics: { cost: 120, sales: 0, orders: 0, clicks: 80, currency: 'USD' },
        }),
      ],
    }));

    expect(summary.statusLabel).toBe('AI 需复核');
    expect(summary.reasons).toContain('当前范围指标证据缺少真实广告报表 报表来源文件和行号，不能用于正式 AI 动作。');
    expect(summary.reasons).toContain('当前范围指标证据缺少产品 ASIN，不能用于正式 AI 动作。');
    expect(summary.reasons).not.toEqual(['AI 认为当前仍处于测词阶段。']);
  });
});

function evidence(patch: Partial<AiEvidenceDisplayItemView>): AiEvidenceDisplayItemView {
  return {
    evidenceId: 'metric_1',
    type: 'metric',
    label: 'metric evidence',
    dateRange: '2026-06-12~2026-06-12',
    batchId: 'batch_1',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    ...patch,
  };
}

function recommendationEvidence(patch: Partial<RecommendationEvidence>): RecommendationEvidence {
  return {
    impressions: 1000,
    clicks: 88,
    cost: 170.25,
    orders: 3,
    sales: 300.5,
    acos: 0.56,
    ...patch,
  };
}

function adDiagnosis(patch: Partial<AdStrategyDiagnosisView['summary']>): AdStrategyDiagnosisView['summary'] {
  return {
    source: 'ai',
    lifecycleStage: 'unknown',
    summary: 'AI 诊断摘要',
    lifecycleStageReason: '',
    lifecycleStageEvidenceRefs: [],
    mainProblems: [],
    riskWarnings: [],
    thresholdSuggestions: {
      targetAcos: { value: 0.35, reason: '目标 ACOS。', evidenceRefs: [] },
      highAcosThreshold: { value: 0.5, reason: '高风险边界。', evidenceRefs: [] },
      noOrderClickThreshold: { value: 30, reason: '样本门槛。', evidenceRefs: [] },
      minSpend: { value: 10, reason: '最低花费。', evidenceRefs: [] },
    },
    aiCandidateCount: 0,
    operationEventCount: 0,
    productContextCount: 0,
    ...patch,
  };
}
