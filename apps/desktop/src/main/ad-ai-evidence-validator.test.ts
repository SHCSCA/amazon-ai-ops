import { describe, expect, it } from 'vitest';
import type { AdStrategyDiagnosisOutput, AiEvidenceItem } from '@amazon-ai-ops/ai-adapter';
import { validateAiDiagnosisEvidence } from './ad-ai-evidence-validator';

describe('validateAiDiagnosisEvidence', () => {
  const scope = {
    dateFrom: '2026-06-01',
    dateTo: '2026-06-12',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    batchId: 'batch_1',
  };

  it('accepts AI candidates when all evidence refs are valid and bind a real ad object', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        aiCandidates: [
          candidate({
            entityName: 'smart lock outdoor',
            evidenceRefs: ['metric_1', 'rule_1'],
          }),
        ],
      }),
      evidencePack: [
        metricEvidence({ evidenceId: 'metric_1', entityName: 'smart lock outdoor' }),
        ruleEvidence({ evidenceId: 'rule_1', entityName: 'smart lock outdoor' }),
      ],
      scope,
    });

    expect(result.validCandidateIndexes).toEqual([0]);
    expect(result.insightOnlyCandidateIndexes).toEqual([]);
    expect(result.invalidReasons).toEqual([]);
  });

  it('moves AI candidates without refs into insight-only', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        aiCandidates: [candidate({ evidenceRefs: [] })],
      }),
      evidencePack: [metricEvidence({ evidenceId: 'metric_1' })],
      scope,
    });

    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0].reason).toContain('缺少 evidenceRefs');
  });

  it('moves AI candidates without a visible reason into insight-only', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        aiCandidates: [candidate({ reason: '   ' })],
      }),
      evidencePack: [metricEvidence({ evidenceId: 'metric_1', entityName: 'smart lock outdoor' })],
      scope,
    });

    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0].reason).toContain('缺少可展示的判断理由');
  });

  it('moves AI candidates without reasoning steps into insight-only', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        aiCandidates: [candidate({ reasoningSteps: [' ', ''] })],
      }),
      evidencePack: [metricEvidence({ evidenceId: 'metric_1', entityName: 'smart lock outdoor' })],
      scope,
    });

    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0].reason).toContain('缺少 reasoningSteps');
  });

  it('moves AI candidates with non-executable action types into insight-only', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        aiCandidates: [candidate({ actionType: 'observe' })],
      }),
      evidencePack: [metricEvidence({ evidenceId: 'metric_1', entityName: 'smart lock outdoor' })],
      scope,
    });

    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0].reason).toContain('动作类型不属于系统可审批广告动作');
  });

  it('moves low-confidence AI candidates into insight-only even when evidence is valid', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        aiCandidates: [candidate({ confidence: 0.42 })],
      }),
      evidencePack: [metricEvidence({ evidenceId: 'metric_1', entityName: 'smart lock outdoor' })],
      scope,
    });

    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0].reason).toContain('AI 候选动作置信度低于正式建议门槛');
  });

  it('moves AI candidates with unavailable refs into insight-only', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        aiCandidates: [candidate({ evidenceRefs: ['missing_ref'] })],
      }),
      evidencePack: [metricEvidence({ evidenceId: 'metric_1' })],
      scope,
    });

    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0]).toMatchObject({
      candidateIndex: 0,
      missingRefs: ['missing_ref'],
    });
    expect(result.invalidReasons[0].reason).toContain('不可用证据');
  });

  it('moves candidates with wrong schemaVersion into insight-only fallback path', () => {
    const invalidDiagnosis = {
      ...diagnosis({
        aiCandidates: [candidate({ evidenceRefs: ['metric_1'] })],
      }),
      schemaVersion: 'wrong_schema',
    } as unknown as AdStrategyDiagnosisOutput;

    const result = validateAiDiagnosisEvidence({
      diagnosis: invalidDiagnosis,
      evidencePack: [metricEvidence({ evidenceId: 'metric_1' })],
      scope,
    });

    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0].reason).toContain('schemaVersion 错误');
  });

  it('moves candidates to insight-only when metric refs do not bind the candidate entity', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        aiCandidates: [
          candidate({
            entityName: 'missing term',
            evidenceRefs: ['metric_1'],
          }),
        ],
      }),
      evidencePack: [metricEvidence({ evidenceId: 'metric_1', entityName: 'smart lock outdoor' })],
      scope,
    });

    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0].reason).toContain('无法绑定当前范围内的真实广告对象');
  });

  it('moves candidates to insight-only when binding metric evidence lacks source file or source row traceability', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        aiCandidates: [
          candidate({
            entityName: 'smart lock outdoor',
            evidenceRefs: ['metric_1'],
          }),
        ],
      }),
      evidencePack: [
        metricEvidence({
          evidenceId: 'metric_1',
          entityName: 'smart lock outdoor',
          sourceFile: '',
          sourceRow: undefined,
        }),
      ],
      scope,
    });

    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0].reason).toContain('缺少原始报表 source_file/source_row');
  });

  it('moves candidates to insight-only when binding metric evidence points to audit evidence instead of a real report file', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        aiCandidates: [
          candidate({
            entityName: 'smart lock outdoor',
            evidenceRefs: ['metric_1'],
          }),
        ],
      }),
      evidencePack: [
        metricEvidence({
          evidenceId: 'metric_1',
          entityName: 'smart lock outdoor',
          sourceFile: 'C:/reports/acceptance-audit.json',
          sourceRow: 12,
        }),
      ],
      scope,
    });

    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0].reason).toContain('source_file 不是真实广告报表 xlsx/xls/csv');
  });

  it('moves candidates to insight-only when metric evidence has no product ASIN in a non-ASIN scope', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        aiCandidates: [
          candidate({
            entityName: 'smart lock outdoor',
            evidenceRefs: ['metric_1'],
          }),
        ],
      }),
      evidencePack: [
        metricEvidence({
          evidenceId: 'metric_1',
          entityName: 'smart lock outdoor',
          asin: undefined,
        }),
      ],
      scope: {
        ...scope,
        asin: undefined,
      },
    });

    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0].reason).toContain('缺少产品 ASIN');
  });

  it('moves candidates to insight-only when only rule evidence binds the object but no metric evidence supports the action', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        aiCandidates: [
          candidate({
            entityName: 'smart lock outdoor',
            evidenceRefs: ['rule_1'],
          }),
        ],
      }),
      evidencePack: [
        ruleEvidence({
          evidenceId: 'rule_1',
          entityName: 'smart lock outdoor',
        }),
      ],
      scope,
    });

    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0].reason).toContain('缺少可追溯的真实报表指标证据');
  });

  it('moves candidates to insight-only when the current evidence sample is too weak for formal AI actions', () => {
    const result = validateAiDiagnosisEvidence({
      diagnosis: diagnosis({
        evidenceSufficiency: {
          level: 'low',
          metricEvidenceCount: 1,
          sampleDays: 1,
          totalClicks: 3,
          totalCost: 2.5,
          totalOrders: 0,
          canUseForFormalActions: false,
          blockers: ['点击样本不足，AI 动作只能作为洞察。'],
          warnings: [],
        },
        aiCandidates: [
          candidate({
            entityName: 'smart lock outdoor',
            evidenceRefs: ['metric_1'],
          }),
        ],
      }),
      evidencePack: [metricEvidence({ evidenceId: 'metric_1', entityName: 'smart lock outdoor', metrics: {
        clicks: 3,
        cost: 2.5,
        orders: 0,
        sales: 0,
        currency: 'USD',
      } })],
      scope,
    });

    expect(result.validCandidateIndexes).toEqual([]);
    expect(result.insightOnlyCandidateIndexes).toEqual([0]);
    expect(result.invalidReasons[0].reason).toContain('证据充分性不足');
    expect(result.invalidReasons[0].reason).toContain('点击样本不足');
  });

  it('marks threshold suggestions as review-required when evidence is missing or out of scope', () => {
    const currentDiagnosis = diagnosis({
      thresholdSuggestions: {
        targetAcos: { value: 0.35, reason: '有证据', evidenceRefs: ['metric_1'] },
        highAcosThreshold: { value: 0.5, reason: '缺证据', evidenceRefs: [] },
        noOrderClickThreshold: { value: 20, reason: '引用不存在', evidenceRefs: ['missing_ref'] },
        minSpend: { value: 10, reason: '跨范围', evidenceRefs: ['metric_2'] },
      },
    });

    validateAiDiagnosisEvidence({
      diagnosis: currentDiagnosis,
      evidencePack: [
        metricEvidence({ evidenceId: 'metric_1' }),
        metricEvidence({ evidenceId: 'metric_2', storeName: 'OTHER' }),
      ],
      scope,
    });

    expect(currentDiagnosis.thresholdSuggestions.targetAcos.requiresReview).toBeUndefined();
    expect(currentDiagnosis.thresholdSuggestions.highAcosThreshold.requiresReview).toBe(true);
    expect(currentDiagnosis.thresholdSuggestions.noOrderClickThreshold.requiresReview).toBe(true);
    expect(currentDiagnosis.thresholdSuggestions.minSpend.requiresReview).toBe(true);
    expect(currentDiagnosis.thresholdSuggestions.highAcosThreshold.reviewReasons).toContain('AI 阈值建议缺少 evidenceRefs。');
    expect(currentDiagnosis.thresholdSuggestions.noOrderClickThreshold.reviewReasons).toContain('AI 阈值建议引用了不可用证据：missing_ref。');
    expect(currentDiagnosis.thresholdSuggestions.minSpend.reviewReasons).toContain('AI 阈值建议引用了当前运营范围之外的证据：metric_2。');
  });

  it('marks metric-based threshold suggestions as review-required when metric evidence has no product ASIN in a non-ASIN scope', () => {
    const currentDiagnosis = diagnosis({
      thresholdSuggestions: {
        targetAcos: { value: 0.35, reason: '引用指标证据', evidenceRefs: ['metric_1'] },
        highAcosThreshold: { value: 0.5, reason: '引用指标证据', evidenceRefs: ['metric_1'] },
        noOrderClickThreshold: { value: 20, reason: '引用指标证据', evidenceRefs: ['metric_1'] },
        minSpend: { value: 10, reason: '引用指标证据', evidenceRefs: ['metric_1'] },
      },
    });

    validateAiDiagnosisEvidence({
      diagnosis: currentDiagnosis,
      evidencePack: [metricEvidence({ evidenceId: 'metric_1', asin: undefined })],
      scope: {
        ...scope,
        asin: undefined,
      },
    });

    expect(currentDiagnosis.thresholdSuggestions.targetAcos.requiresReview).toBe(true);
    expect(currentDiagnosis.thresholdSuggestions.highAcosThreshold.requiresReview).toBe(true);
    expect(currentDiagnosis.thresholdSuggestions.noOrderClickThreshold.requiresReview).toBe(true);
    expect(currentDiagnosis.thresholdSuggestions.minSpend.requiresReview).toBe(true);
    expect(currentDiagnosis.thresholdSuggestions.targetAcos.reviewReasons).toContain('AI 阈值建议引用的指标证据缺少产品 ASIN。');
  });

  it('marks metric-based threshold suggestions as review-required when they only cite operation events', () => {
    const currentDiagnosis = diagnosis({
      thresholdSuggestions: {
        targetAcos: { value: 0.35, reason: '产品目标可由产品配置支撑', evidenceRefs: ['product_1'] },
        highAcosThreshold: { value: 0.5, reason: '只引用了运营事件', evidenceRefs: ['event_1'] },
        noOrderClickThreshold: { value: 20, reason: '只引用了运营事件', evidenceRefs: ['event_1'] },
        minSpend: { value: 10, reason: '只引用了运营事件', evidenceRefs: ['event_1'] },
      },
    });

    validateAiDiagnosisEvidence({
      diagnosis: currentDiagnosis,
      evidencePack: [
        productEvidence({ evidenceId: 'product_1' }),
        eventEvidence({ evidenceId: 'event_1' }),
      ],
      scope,
    });

    expect(currentDiagnosis.thresholdSuggestions.targetAcos.requiresReview).toBeUndefined();
    expect(currentDiagnosis.thresholdSuggestions.highAcosThreshold.requiresReview).toBe(true);
    expect(currentDiagnosis.thresholdSuggestions.noOrderClickThreshold.requiresReview).toBe(true);
    expect(currentDiagnosis.thresholdSuggestions.minSpend.requiresReview).toBe(true);
    expect(currentDiagnosis.thresholdSuggestions.highAcosThreshold.reviewReasons).toContain('AI 阈值建议缺少指标或对象时间线证据。');
  });

  it('marks lifecycle stage as review-required when stage evidence is missing or out of scope', () => {
    const currentDiagnosis = diagnosis({
      lifecycleStageReason: 'AI 判断当前仍处于测词期。',
      lifecycleStageEvidenceRefs: ['missing_ref', 'metric_2'],
    });

    validateAiDiagnosisEvidence({
      diagnosis: currentDiagnosis,
      evidencePack: [
        metricEvidence({ evidenceId: 'metric_1' }),
        metricEvidence({ evidenceId: 'metric_2', storeName: 'OTHER' }),
      ],
      scope,
    });

    expect(currentDiagnosis.lifecycleStageRequiresReview).toBe(true);
    expect(currentDiagnosis.lifecycleStageInvalidReasons).toEqual([
      'AI 阶段判断引用了不可用证据：missing_ref。',
      'AI 阶段判断引用了当前运营范围之外的证据：metric_2。',
    ]);
    expect(currentDiagnosis.riskWarnings).toContain('AI 阶段判断证据不足或跨范围，需要人工复核后再采用。');
  });

  it('marks lifecycle stage as review-required when it only cites operation events without metric or timeline evidence', () => {
    const currentDiagnosis = diagnosis({
      lifecycleStageReason: 'AI 判断当前仍处于测词期。',
      lifecycleStageEvidenceRefs: ['event_1'],
    });

    validateAiDiagnosisEvidence({
      diagnosis: currentDiagnosis,
      evidencePack: [eventEvidence({ evidenceId: 'event_1' })],
      scope,
    });

    expect(currentDiagnosis.lifecycleStageRequiresReview).toBe(true);
    expect(currentDiagnosis.lifecycleStageInvalidReasons).toContain('AI 阶段判断缺少指标或对象时间线证据。');
  });

  it('marks lifecycle stage as review-required when metric evidence has no product ASIN in a non-ASIN scope', () => {
    const currentDiagnosis = diagnosis({
      lifecycleStageReason: 'AI 判断当前仍处于测词期。',
      lifecycleStageEvidenceRefs: ['metric_1'],
    });

    validateAiDiagnosisEvidence({
      diagnosis: currentDiagnosis,
      evidencePack: [metricEvidence({ evidenceId: 'metric_1', asin: undefined })],
      scope: {
        ...scope,
        asin: undefined,
      },
    });

    expect(currentDiagnosis.lifecycleStageRequiresReview).toBe(true);
    expect(currentDiagnosis.lifecycleStageInvalidReasons).toContain('AI 阶段判断引用的指标证据缺少产品 ASIN。');
  });
});

function diagnosis(patch: Partial<AdStrategyDiagnosisOutput> = {}): AdStrategyDiagnosisOutput {
  return {
    schemaVersion: 'ad_strategy_diagnosis_v1',
    evidenceSufficiency: {
      level: 'high',
      metricEvidenceCount: 1,
      sampleDays: 1,
      totalClicks: 30,
      totalCost: 42,
      totalOrders: 0,
      canUseForFormalActions: true,
      blockers: [],
      warnings: [],
    },
    lifecycleStage: 'keyword_exploration',
    lifecycleStageReason: '搜索词仍处于探索期。',
    lifecycleStageEvidenceRefs: ['metric_1'],
    summary: '需要观察并小幅调整。',
    mainProblems: ['HIGH_ACOS'],
    thresholdSuggestions: {
      targetAcos: { value: 0.35, reason: '产品目标 ACOS。', evidenceRefs: ['metric_1'] },
      highAcosThreshold: { value: 0.5, reason: '探索期容忍度。', evidenceRefs: ['metric_1'] },
      noOrderClickThreshold: { value: 30, reason: '样本门槛。', evidenceRefs: ['metric_1'] },
      minSpend: { value: 10, reason: '最低花费样本。', evidenceRefs: ['metric_1'] },
    },
    aiCandidates: [],
    insightOnlyCandidates: [],
    riskWarnings: [],
    source: 'ai',
    ...patch,
  };
}

function candidate(patch: Partial<AdStrategyDiagnosisOutput['aiCandidates'][number]> = {}) {
  return {
    entityType: 'search_term',
    entityName: 'smart lock outdoor',
    actionType: 'lower_bid',
    recommendedValue: '-10%',
    reason: '花费高且订单不足。',
    reasoningSteps: ['搜索词花费达到样本门槛。'],
    evidenceRefs: ['metric_1'],
    riskWarnings: [],
    confidence: 0.7,
    ...patch,
  };
}

function metricEvidence(patch: Partial<AiEvidenceItem> = {}): AiEvidenceItem {
  return {
    evidenceId: 'metric_1',
    type: 'metric',
    label: 'smart lock outdoor / 2026-06-10',
    dateRange: '2026-06-10~2026-06-10',
    batchId: 'batch_1',
    reportType: 'search_term',
    sourceFile: 'C:/reports/user-search-term.xlsx',
    sourceRow: 12,
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    campaignName: 'SP exact',
    adGroupName: 'Main',
    entityType: 'search_term',
    entityName: 'smart lock outdoor',
    metrics: {
      clicks: 30,
      cost: 42,
      orders: 0,
      sales: 0,
      currency: 'USD',
    },
    ...patch,
  };
}

function ruleEvidence(patch: Partial<AiEvidenceItem> = {}): AiEvidenceItem {
  return {
    ...metricEvidence(),
    evidenceId: 'rule_1',
    type: 'rule_candidate',
    ...patch,
  };
}

function eventEvidence(patch: Partial<AiEvidenceItem> = {}): AiEvidenceItem {
  return {
    evidenceId: 'event_1',
    type: 'operation_event',
    label: '2026-06-05 / Coupon',
    dateRange: '2026-06-05~2026-06-05',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    entityType: 'operation_event',
    entityName: 'Coupon',
    event: {
      eventDate: '2026-06-05',
      eventType: 'coupon',
      title: 'Coupon',
      impactExpectation: '短期提高转化率',
    },
    ...patch,
  };
}

function productEvidence(patch: Partial<AiEvidenceItem> = {}): AiEvidenceItem {
  return {
    evidenceId: 'product_1',
    type: 'product_context',
    label: 'B001 / keyword_exploration',
    dateRange: '2026-06-01~2026-06-12',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    entityType: 'product',
    entityName: 'B001',
    product: {
      productStage: 'keyword_exploration',
      targetAcos: 0.35,
      targetTacos: 0.12,
      targetNetMargin: 0.22,
      minPrice: 29.99,
    },
    ...patch,
  };
}
