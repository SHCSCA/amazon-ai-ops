import { describe, expect, it } from 'vitest';
import type { AiDiagnosisRunView } from '../types';
import { buildAiDiagnosisRunsRequest, diagnosisRunEvidenceLabel, diagnosisRunInsightPreview, diagnosisRunSummaryText, strategyDiagnosisSourceLabel, strategyThresholdTitle, thresholdEvidenceReviewLine } from './ad-quant-page';

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
});
