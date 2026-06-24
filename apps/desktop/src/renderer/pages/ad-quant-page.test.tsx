import { describe, expect, it } from 'vitest';
import type { AiDiagnosisRunView } from '../types';
import { buildAdQuantDecisionStatus, buildAiDiagnosisRunsRequest, diagnosisRunEvidenceLabel, diagnosisRunInsightPreview, diagnosisRunSummaryText, strategyDiagnosisSourceLabel, strategyThresholdTitle, thresholdEvidenceReviewLine } from './ad-quant-page';

describe('strategyDiagnosisSourceLabel', () => {
  it('uses Chinese fallback copy for rule-based strategy diagnosis', () => {
    expect(strategyDiagnosisSourceLabel('rule')).toBe('规则兜底');
    expect(strategyThresholdTitle('rule')).toBe('规则兜底阈值建议');
  });
});

describe('buildAiDiagnosisRunsRequest', () => {
  it('carries ASIN scope when loading recent AI diagnosis runs', () => {
    expect(buildAiDiagnosisRunsRequest({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0AAA',
        batchId: '',
        currency: 'USD',
      },
      latestBatchId: 'batch_1',
    })).toMatchObject({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0AAA',
      batchId: 'batch_1',
      limit: 5,
    });
  });
});

describe('diagnosisRunEvidenceLabel', () => {
  it('labels historical AI diagnosis evidence as evidence-pack count', () => {
    expect(diagnosisRunEvidenceLabel({
      evidencePackSummary: { total: 5 },
    } as AiDiagnosisRunView)).toBe('证据包 5 条');
  });

  it('keeps empty evidence packs explicit', () => {
    expect(diagnosisRunEvidenceLabel({} as AiDiagnosisRunView)).toBe('证据包 0 条');
  });
});

describe('diagnosisRunSummaryText', () => {
  it('explains insight-only AI runs instead of showing no diagnosis output', () => {
    const text = diagnosisRunSummaryText({
      id: 1,
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'v1',
      model: 'deepseek-v4-flash',
      scope: {},
      insights: [{
        entityType: 'search_term',
        entityName: 'door lock',
        actionType: 'lower_bid',
        reason: 'AI 判断 ACOS 偏高，但缺少可回查来源行。',
        reasoningSteps: [],
        evidenceRefs: [],
        invalidReasons: ['缺少 source row'],
        riskWarnings: [],
        confidence: 0.71,
      }],
      formalRecommendationCount: 0,
      createdAt: '2026-06-17T10:00:00.000Z',
    } as AiDiagnosisRunView);

    expect(text).toContain('AI 已完成诊断');
    expect(text).toContain('1 条洞察');
    expect(text).toContain('未形成可审批建议');
    expect(text).toContain('先补齐证据引用');
  });
});

describe('diagnosisRunInsightPreview', () => {
  it('summarizes the insight object and invalid reason for review', () => {
    const lines = diagnosisRunInsightPreview({
      id: 1,
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'v1',
      model: 'deepseek-v4-flash',
      scope: {},
      insights: [{
        entityType: 'search_term',
        entityName: 'door lock',
        actionType: 'lower_bid',
        reason: 'ACOS 偏高。',
        reasoningSteps: [],
        evidenceRefs: ['metric:1'],
        invalidReasons: ['无法绑定当前广告组'],
        riskWarnings: [],
        confidence: 0.71,
      }],
      formalRecommendationCount: 0,
      createdAt: '2026-06-17T10:00:00.000Z',
    } as AiDiagnosisRunView);

    expect(lines).toEqual([
      'search_term / lower_bid / door lock：无法绑定当前广告组',
    ]);
  });
});

describe('thresholdEvidenceReviewLine', () => {
  it('requires review when threshold evidence refs have no displayable details', () => {
    const result = thresholdEvidenceReviewLine({
      item: {
        value: 0.35,
        reason: 'AI 建议目标 ACOS。',
        evidenceRefs: ['metric_missing'],
      },
      evidencePackPreview: [],
    });

    expect(result.tone).toBe('warning');
    expect(result.text).toContain('缺少证据明细：metric_missing');
    expect(result.text).toContain('需要人工复核后才能覆盖规则阈值');
  });

  it('uses operator-facing wording for technical evidence ref errors', () => {
    const result = thresholdEvidenceReviewLine({
      item: {
        value: 0.35,
        reason: 'AI 建议目标 ACOS。',
        evidenceRefs: [],
        requiresReview: true,
        reviewReasons: ['AI 阈值建议缺少 evidenceRefs。'],
      },
      evidencePackPreview: [],
    });

    expect(result.text).toContain('AI 阈值建议没有正确引用当前证据');
    expect(result.text).not.toContain('evidenceRefs');
  });
});

describe('buildAdQuantDecisionStatus', () => {
  it('labels accepted AI diagnosis as AI plus rule recommendation generation', () => {
    const status = buildAdQuantDecisionStatus({
      canDiagnose: true,
      canGenerateFormalRecommendations: true,
      diagnosticCount: 3,
      diagnosis: {
        source: 'ai',
        lifecycleStage: 'keyword_exploration',
        summary: '',
        lifecycleStageReason: '',
        lifecycleStageEvidenceRefs: ['metric_1'],
        mainProblems: [],
        riskWarnings: [],
        thresholdSuggestions: {
          targetAcos: { value: 0.25, reason: '', evidenceRefs: ['metric_1'] },
          highAcosThreshold: { value: 0.4, reason: '', evidenceRefs: ['metric_1'] },
          noOrderClickThreshold: { value: 30, reason: '', evidenceRefs: ['metric_1'] },
          minSpend: { value: 10, reason: '', evidenceRefs: ['metric_1'] },
        },
        aiCandidateCount: 1,
        operationEventCount: 0,
        productContextCount: 0,
        evidenceSufficiency: {
          level: 'high',
          metricEvidenceCount: 4,
          sampleDays: 7,
          totalClicks: 80,
          totalCost: 100,
          totalOrders: 3,
          canUseForFormalActions: true,
          blockers: [],
          warnings: [],
        },
      },
    });

    expect(status.aiLabel).toBe('已采纳');
    expect(status.actionLabel).toBe('可生成 AI+规则建议');
    expect(status.primaryActionLabel).toBe('生成 AI+规则建议');
  });

  it('does not label fallback diagnosis as AI plus rule generation', () => {
    const status = buildAdQuantDecisionStatus({
      canDiagnose: true,
      canGenerateFormalRecommendations: true,
      diagnosticCount: 3,
      diagnosis: {
        source: 'rule',
        lifecycleStage: 'unknown',
        summary: '',
        lifecycleStageReason: '',
        lifecycleStageEvidenceRefs: [],
        mainProblems: [],
        riskWarnings: [],
        thresholdSuggestions: {
          targetAcos: { value: 0.25, reason: '', evidenceRefs: [] },
          highAcosThreshold: { value: 0.4, reason: '', evidenceRefs: [] },
          noOrderClickThreshold: { value: 30, reason: '', evidenceRefs: [] },
          minSpend: { value: 10, reason: '', evidenceRefs: [] },
        },
        aiCandidateCount: 0,
        operationEventCount: 0,
        productContextCount: 0,
        fallbackReason: 'AI 阶段判断缺少 evidenceRefs。',
      },
    });

    expect(status.aiLabel).toBe('未采纳');
    expect(status.actionLabel).toBe('可生成规则建议');
    expect(status.primaryActionLabel).toBe('生成规则建议');
  });

  it('blocks recommendation generation when real quant data is not closed', () => {
    const status = buildAdQuantDecisionStatus({
      canDiagnose: false,
      canGenerateFormalRecommendations: false,
      diagnosticCount: 0,
    });

    expect(status.aiLabel).toBe('未调用');
    expect(status.ruleLabel).toBe('待数据');
    expect(status.primaryActionLabel).toBe('补齐数据后再生成');
  });
});
