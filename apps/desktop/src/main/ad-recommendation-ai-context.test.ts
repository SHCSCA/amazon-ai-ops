import { reportIdentityFixture } from './ad-decision-identity.test-support';
import { describe, expect, it } from 'vitest';
import type { ActionRecommendation, AdDailyMetrics, CreateOperationEventInput } from '@amazon-ai-ops/shared-types';
import type { AdStrategyDiagnosisOutput, AiEvidenceItem } from '@amazon-ai-ops/ai-adapter';
import type { MergedAdDecision } from '@amazon-ai-ops/rules-engine';
import {
  annotateRecommendationsWithStrategy,
  buildAdStrategyDiagnosisInput,
  bindRecommendationsToScopeAsin,
  createAiOnlyRecommendationsFromDecisions,
} from './ad-recommendation-ai-context';
import { TEST_EVIDENCE_SUFFICIENCY, recommendation, evidenceItem } from './ad-recommendation-ai.test-support';

describe('ad recommendation AI context', () => {
  it('backfills scope ASIN into rule recommendations before they enter the formal pool', () => {
    const [bound] = bindRecommendationsToScopeAsin([
      recommendation({
        asin: '',
        entityType: 'search_term',
        entityName: 'smart lock outdoor',
        actionType: 'lower_bid',
        reason: 'No-order spend exceeded threshold.',
        confidence: 0.7,
        evidence: {
          ...recommendation({
            entityType: 'search_term',
            entityName: 'smart lock outdoor',
            actionType: 'lower_bid',
            reason: 'No-order spend exceeded threshold.',
            confidence: 0.7,
          }).evidence,
          asin: '',
        },
      }),
    ], 'B0SCOPEASIN');

    expect(bound.asin).toBe('B0SCOPEASIN');
    expect(bound.evidence.asin).toBe('B0SCOPEASIN');
  });

  it('builds diagnosis input from scope, daily metrics, operation events, rule config, and rule recommendations', () => {
    const input = buildAdStrategyDiagnosisInput({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B001',
        batchId: 'batch_1',
      },
      metrics: [
        {
          date: '2026-06-10',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          campaignName: 'SP exact',
          adGroupName: 'Main',
          asin: 'B001',
          searchTerm: 'smart lock outdoor',
          impressions: 1000,
          clicks: 30,
          cost: 42,
          orders: 0,
          sales: 0,
          acos: 0,
          cpc: 1.4,
          cvr: 0,
        } as AdDailyMetrics,
      ],
      operationEvents: [
        {
          eventDate: '2026-06-10',
          eventType: 'coupon',
          title: '10% Coupon started',
          impactExpectation: 'conversion_up',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          campaignName: 'SP exact',
          adGroupName: 'Main',
        } as CreateOperationEventInput,
      ],
      productContexts: [
        {
          asin: 'B001',
          title: 'Smart lock',
          productStage: 'keyword_exploration',
          status: 'active',
          cost: {
            purchaseCost: 13.5,
            firstLegCost: 1.2,
            fbaFee: 4.1,
            referralFeeRate: 0.15,
            minPrice: 29.99,
            targetNetMargin: 0.22,
            targetAcos: 0.35,
            targetTacos: 0.12,
          },
        },
      ],
      ruleConfig: {
        targetAcos: 0.25,
        highAcosThreshold: 0.45,
        noOrderClickThreshold: 25,
        minSpend: 12,
      },
      recommendations: [
        recommendation({
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          actionType: 'lower_bid',
          reason: 'No-order spend exceeded threshold.',
          confidence: 0.7,
        }),
      ],
    });

    expect(input.scope).toEqual({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B001',
      batchId: 'batch_1',
      currency: 'USD',
    });
    expect(input.metrics[0]).toMatchObject({
      searchTerm: 'smart lock outdoor',
      cost: 42,
      orders: 0,
    });
    expect(input.productContexts?.[0]).toMatchObject({
      asin: 'B001',
      productStage: 'keyword_exploration',
      cost: {
        purchaseCost: 13.5,
        targetAcos: 0.35,
        targetTacos: 0.12,
      },
    });
    expect(input.productHistoryLedgers).toEqual([]);
    expect(input.productHistoryQuality).toMatchObject({ status: 'unavailable', coverage: 'unverified', observedRowCount: 0 });
    expect(input.operationEvents[0]).toMatchObject({ title: '10% Coupon started' });
    expect(input.adObjectTimelines[0]).toMatchObject({
      objectType: 'search_term',
      objectName: 'smart lock outdoor',
      lifecycleStage: 'keyword_exploration',
      status: 'waste',
      totals: {
        clicks: 30,
        cost: 42,
        orders: 0,
        sales: 0,
        currency: 'USD',
      },
    });
    expect(input.adObjectTimelines[0].thresholdSuggestion).toEqual(expect.objectContaining({
      targetAcos: 0.25,
      highAcosThreshold: 0.45,
      noOrderClickThreshold: 25,
      minSpend: 12,
    }));
    expect(input.operationEvents[0]).toMatchObject({
      title: '10% Coupon started',
      eventType: 'coupon',
      campaignName: 'SP exact',
      adGroupName: 'Main',
    });
    expect(input.currentRuleConfig).toEqual({
      targetAcos: 0.25,
      highAcosThreshold: 0.45,
      noOrderClickThreshold: 25,
      minSpend: 12,
    });
    expect(input.ruleCandidates[0]).toMatchObject({
      entityType: 'search_term',
      entityName: 'smart lock outdoor',
      actionType: 'lower_bid',
    });
  });

  it('annotates matching recommendations with strategy diagnosis and decision agreement evidence', () => {
    const recommendations = [
      recommendation({
        entityType: 'search_term',
        entityName: 'smart lock outdoor',
        actionType: 'lower_bid',
        currentValue: '1.20',
        recommendedValue: '1.08',
        reason: 'No-order spend exceeded threshold.',
        confidence: 0.7,
      }),
    ];
    const diagnosis: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: TEST_EVIDENCE_SUFFICIENCY,
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: '搜索词仍处于探索期。',
      lifecycleStageEvidenceRefs: ['metric_1'],
      lifecycleStageRequiresReview: true,
      lifecycleStageInvalidReasons: ['AI 阶段判断引用了不可用证据：missing_ref。'],
      summary: 'Keep exploration but tighten no-order spend.',
      mainProblems: ['no_order_spend'],
      thresholdSuggestions: {
        targetAcos: { value: 0.35, reason: 'Exploration tolerance.', evidenceRefs: ['product_1'] },
        highAcosThreshold: { value: 0.55, reason: 'Coupon context.', evidenceRefs: ['event_1'] },
        noOrderClickThreshold: { value: 18, reason: 'Enough clicks.', evidenceRefs: ['metric_1'] },
        minSpend: { value: 15, reason: 'Avoid small samples.', evidenceRefs: ['metric_1'] },
      },
      aiCandidates: [
        {
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          actionType: 'lower_bid',
          recommendedValue: '1.08',
          reason: 'Coupon did not convert.',
          reasoningSteps: ['metric_1 shows no-order spend.', 'event_1 shows coupon context.'],
          evidenceRefs: ['metric_1', 'event_1'],
          riskWarnings: [],
          confidence: 0.85,
        },
      ],
      insightOnlyCandidates: [],
      riskWarnings: ['Do not negate core terms blindly.'],
      source: 'ai',
    };
    const decisions: MergedAdDecision[] = [
      {
        agreement: 'aligned',
        source: 'rule_ai',
        entityType: 'search_term',
        entityName: 'smart lock outdoor',
        actionType: 'lower_bid',
        recommendedValue: '1.08',
        confidence: 0.85,
        reasons: ['Rule: No-order spend exceeded threshold.', 'AI: Coupon did not convert.'],
        riskWarnings: [],
        requiresReview: false,
      },
    ];

    const fixture = reportIdentityFixture(recommendations[0], evidenceItem({ sourceFile: 'C:/reports/search-term.xlsx', sourceRow: 18 }));
    const annotated = annotateRecommendationsWithStrategy({
      identityScope: fixture.scope,
      identityMetrics: [fixture.metric],
      recommendations: [fixture.recommendation],
      diagnosis,
      decisions: decisions.map((decision) => ({ ...decision, identity: fixture.identity, ruleCandidateIndex: 0, aiCandidateIndex: 0 })),
      operationEventCount: 1,
      evidencePack: [
        evidenceItem({
          ...fixture.evidence,
          evidenceId: 'metric_1',
          type: 'metric',
          label: 'smart lock outdoor / 2026-06-10',
          sourceFile: 'C:/reports/search-term.xlsx',
          sourceRow: 18,
          metrics: {
            clicks: 30,
            cost: 42,
            orders: 0,
            sales: 0,
            currency: 'USD',
          },
        }),
        evidenceItem({
          evidenceId: 'event_1',
          type: 'operation_event',
          label: '10% Coupon started',
          event: {
            eventDate: '2026-06-10',
            eventType: 'coupon',
            title: '10% Coupon started',
            impactExpectation: 'conversion_up',
          },
        }),
      ],
      productContexts: [
        {
          asin: 'B001',
          productStage: 'keyword_exploration',
          cost: {
            targetAcos: 0.35,
            targetTacos: 0.12,
            targetNetMargin: 0.22,
            minPrice: 29.99,
          },
        },
      ],
    });

    expect(annotated[0].confidence).toBe(0.85);
    expect(annotated[0].status).toBe('needs_review');
    expect(annotated[0].recommendedValue).toBe('1.08');
    expect(annotated[0].evidence).toMatchObject({
      aiStrategySource: 'ai',
      aiLifecycleStage: 'keyword_exploration',
      aiLifecycleStageReason: '搜索词仍处于探索期。',
      aiLifecycleStageEvidenceRefs: ['metric_1'],
      aiLifecycleStageRequiresReview: true,
      aiLifecycleStageInvalidReasons: ['AI 阶段判断引用了不可用证据：missing_ref。'],
      aiLifecycleStageEvidenceDetails: [
        expect.objectContaining({
          evidenceId: 'metric_1',
          type: 'metric',
          sourceFile: 'C:/reports/search-term.xlsx',
          sourceRow: 18,
        }),
      ],
      aiStrategySummary: 'Keep exploration but tighten no-order spend.',
      aiMainProblems: ['no_order_spend'],
      aiEvidenceRefs: ['metric_1', 'event_1'],
      aiEvidenceDetails: [
        expect.objectContaining({
          evidenceId: 'metric_1',
          type: 'metric',
          metrics: expect.objectContaining({
            cost: 42,
            orders: 0,
            currency: 'USD',
          }),
        }),
        expect.objectContaining({
          evidenceId: 'event_1',
          type: 'operation_event',
          event: expect.objectContaining({
            eventType: 'coupon',
            title: '10% Coupon started',
          }),
        }),
      ],
      aiReasoningSteps: ['metric_1 shows no-order spend.', 'event_1 shows coupon context.'],
      decisionAgreement: 'aligned',
      decisionSource: 'rule_ai',
      decisionRequiresReview: false,
      operationEventCount: 1,
      productContextCount: 1,
      productStage: 'keyword_exploration',
      productTargetAcos: 0.35,
      productTargetTacos: 0.12,
      productTargetNetMargin: 0.22,
      productMinPrice: 29.99,
    });
    expect(annotated[0].evidence.aiThresholdSuggestions?.minSpend).toEqual({
      value: 15,
      reason: 'Avoid small samples.',
      evidenceRefs: ['metric_1'],
    });
    expect(annotated[0].evidence.aiThresholdEvidenceRefs?.targetAcos).toEqual(['product_1']);
  });

  it('rejects an unbound aligned percentage without changing executable rule value', () => {
    const recommendations = [
      recommendation({
        entityType: 'search_term',
        entityName: 'smart lock outdoor',
        actionType: 'lower_bid',
        currentValue: '1.20',
        recommendedValue: '1.08',
        reason: 'No-order spend exceeded threshold.',
        confidence: 0.7,
      }),
    ];
    const diagnosis: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: TEST_EVIDENCE_SUFFICIENCY,
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: '搜索词仍处于探索期。',
      lifecycleStageEvidenceRefs: ['metric_1'],
      summary: 'AI 与规则一致认为应降价，但 AI 给的是相对比例。',
      mainProblems: ['no_order_spend'],
      thresholdSuggestions: {
        targetAcos: { value: 0.35, reason: '产品目标 ACOS。' },
        highAcosThreshold: { value: 0.5, reason: '探索期阈值。' },
        noOrderClickThreshold: { value: 18, reason: '点击样本足够。' },
        minSpend: { value: 12, reason: '最低样本花费。' },
      },
      aiCandidates: [
        {
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          actionType: 'lower_bid',
          recommendedValue: '-12%',
          reason: '应小幅降价。',
          reasoningSteps: ['metric_1 支撑降价。'],
          evidenceRefs: ['metric_1'],
          riskWarnings: [],
          confidence: 0.85,
        },
      ],
      insightOnlyCandidates: [],
      riskWarnings: [],
      source: 'ai',
    };
    const decisions: MergedAdDecision[] = [
      {
        agreement: 'aligned',
        source: 'rule_ai',
        entityType: 'search_term',
        entityName: 'smart lock outdoor',
        actionType: 'lower_bid',
        recommendedValue: '-12%',
        confidence: 0.85,
        reasons: ['Rule: No-order spend exceeded threshold.', 'AI: 应小幅降价。'],
        riskWarnings: [],
        requiresReview: false,
      },
    ];

    const annotated = annotateRecommendationsWithStrategy({
      recommendations,
      diagnosis,
      decisions,
      operationEventCount: 0,
      evidencePack: [evidenceItem({
        evidenceId: 'metric_1',
        type: 'metric',
        label: 'smart lock outdoor / 2026-06-10',
        sourceFile: 'C:/reports/search-term.xlsx',
        sourceRow: 18,
      })],
    });

    expect(annotated[0].recommendedValue).toBe('1.08');
    expect(annotated[0].evidence.decisionReasons).toBeUndefined();
    expect(annotated[0].status).toBe('needs_review');
  });

  it('rejects an unbound aligned excessive bid decrease without changing the rule value', () => {
    const recommendations = [recommendation({
      entityType: 'target',
      entityName: 'back massager',
      actionType: 'lower_bid',
      currentValue: '2.32',
      recommendedValue: '2.09',
      reason: '规则建议在安全上限内小幅降价。',
      confidence: 0.82,
    })];
    const diagnosis: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: TEST_EVIDENCE_SUFFICIENCY,
      lifecycleStage: 'stable_conversion',
      lifecycleStageReason: '已有稳定关键词事实。',
      lifecycleStageEvidenceRefs: ['metric_1'],
      summary: 'AI 与规则方向一致，但 AI 幅度超过单次安全上限。',
      mainProblems: ['high_acos'],
      thresholdSuggestions: {
        targetAcos: { value: 0.3, reason: '产品目标 ACOS。' },
        highAcosThreshold: { value: 0.45, reason: '高 ACOS 阈值。' },
        noOrderClickThreshold: { value: 18, reason: '点击样本足够。' },
        minSpend: { value: 12, reason: '最低样本花费。' },
      },
      aiCandidates: [{
        entityType: 'target',
        entityName: 'back massager',
        actionType: 'lower_bid',
        recommendedValue: '1.85',
        reason: 'AI 建议降低竞价。',
        reasoningSteps: ['metric_1 显示 ACOS 偏高。'],
        evidenceRefs: ['metric_1'],
        riskWarnings: [],
        confidence: 0.89,
      }],
      insightOnlyCandidates: [],
      riskWarnings: [],
      source: 'ai',
    };
    const decisions: MergedAdDecision[] = [{
      agreement: 'aligned',
      source: 'rule_ai',
      entityType: 'target',
      entityName: 'back massager',
      actionType: 'lower_bid',
      recommendedValue: '1.85',
      confidence: 0.89,
      reasons: ['Rule: 安全幅度降价。', 'AI: 降价。'],
      riskWarnings: [],
      requiresReview: false,
    }];

    const [annotated] = annotateRecommendationsWithStrategy({
      recommendations,
      diagnosis,
      decisions,
      operationEventCount: 0,
      evidencePack: [evidenceItem({
        evidenceId: 'metric_1',
        type: 'metric',
        label: 'back massager / 2026-08-23',
        sourceFile: 'C:/reports/keyword.xlsx',
        sourceRow: 432,
      })],
    });

    expect(annotated.recommendedValue).toBe('2.09');
    expect(annotated.evidence.decisionSource).toBeUndefined();
    expect(annotated.status).toBe('needs_review');
  });

  it('moves conflicting or review-required strategy decisions out of the normal approval queue', () => {
    const recommendations = [
      recommendation({
        entityType: 'search_term',
        entityName: 'smart lock outdoor',
        actionType: 'lower_bid',
        reason: 'No-order spend exceeded threshold.',
        confidence: 0.7,
      }),
    ];
    const diagnosis: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: TEST_EVIDENCE_SUFFICIENCY,
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: '促销事件导致信号冲突。',
      lifecycleStageEvidenceRefs: ['event_1'],
      summary: 'AI wants review before action.',
      mainProblems: ['conflicting_signal'],
      thresholdSuggestions: {
        targetAcos: { value: 0.35, reason: 'Exploration stage.' },
        highAcosThreshold: { value: 0.55, reason: 'Promotion context.' },
        noOrderClickThreshold: { value: 18, reason: 'Enough clicks.' },
        minSpend: { value: 12, reason: 'Avoid tiny samples.' },
      },
      aiCandidates: [],
      insightOnlyCandidates: [],
      riskWarnings: [],
      source: 'ai',
    };
    const decisions: MergedAdDecision[] = [
      {
        agreement: 'conflict',
        source: 'rule_ai',
        entityType: 'search_term',
        entityName: 'smart lock outdoor',
        actionType: 'lower_bid',
        recommendedValue: '-5%',
        confidence: 0.5,
        reasons: ['Rule suggests lowering bid.', 'AI sees promotion context and requires review.'],
        riskWarnings: ['Promotion event may explain the spend spike.'],
        requiresReview: true,
      },
    ];

    const annotated = annotateRecommendationsWithStrategy({
      recommendations,
      diagnosis,
      decisions,
      operationEventCount: 1,
    });

    expect(annotated[0].status).toBe('needs_review');
    expect(annotated[0].evidence).toMatchObject({
      decisionAgreement: undefined,
      decisionRequiresReview: true,
    });
  });

  it('does not move rule-only recommendations into review just because batch-level AI lifecycle needs review', () => {
    const recommendations = [
      recommendation({
        entityType: 'search_term',
        entityName: 'smart lock outdoor',
        actionType: 'lower_bid',
        reason: 'No-order spend exceeded deterministic rule threshold.',
        confidence: 0.7,
      }),
    ];
    const diagnosis: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: TEST_EVIDENCE_SUFFICIENCY,
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: 'AI 阶段判断缺少足够证据。',
      lifecycleStageEvidenceRefs: ['missing_ref'],
      lifecycleStageRequiresReview: true,
      lifecycleStageInvalidReasons: ['AI 阶段判断引用了不可用证据：missing_ref。'],
      summary: 'AI lifecycle needs review, but this action is rule-only.',
      mainProblems: ['lifecycle_uncertain'],
      thresholdSuggestions: {
        targetAcos: { value: 0.35, reason: 'AI threshold requires review.' },
        highAcosThreshold: { value: 0.55, reason: 'AI threshold requires review.' },
        noOrderClickThreshold: { value: 18, reason: 'AI threshold requires review.' },
        minSpend: { value: 12, reason: 'AI threshold requires review.' },
      },
      aiCandidates: [],
      insightOnlyCandidates: [],
      riskWarnings: ['AI lifecycle needs review.'],
      source: 'ai',
    };

    const annotated = annotateRecommendationsWithStrategy({
      recommendations,
      diagnosis,
      decisions: [],
      operationEventCount: 0,
    });

    expect(annotated[0].status).toBe('pending');
    expect(annotated[0].evidence).toMatchObject({
      aiStrategySource: 'ai',
      aiLifecycleStageRequiresReview: true,
      decisionAgreement: undefined,
    });
  });

  it('stores strategy fallback reason separately from action explanation fallback', () => {
    const recommendations = [
      recommendation({
        entityType: 'search_term',
        entityName: 'smart lock outdoor',
        actionType: 'lower_bid',
        reason: 'No-order spend exceeded deterministic rule threshold.',
        confidence: 0.7,
      }),
    ];
    const diagnosis: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: TEST_EVIDENCE_SUFFICIENCY,
      lifecycleStage: 'unknown',
      lifecycleStageReason: 'AI 策略诊断 schemaVersion 错误。',
      lifecycleStageEvidenceRefs: [],
      summary: 'AI 策略诊断已回退规则。',
      mainProblems: [],
      thresholdSuggestions: {
        targetAcos: { value: 0.35, reason: '规则 fallback。' },
        highAcosThreshold: { value: 0.55, reason: '规则 fallback。' },
        noOrderClickThreshold: { value: 18, reason: '规则 fallback。' },
        minSpend: { value: 12, reason: '规则 fallback。' },
      },
      aiCandidates: [],
      insightOnlyCandidates: [],
      riskWarnings: ['AI 策略诊断不可用。'],
      source: 'rule',
      aiFallbackReason: 'AI 策略诊断 schemaVersion 错误，已回退规则。',
    };

    const annotated = annotateRecommendationsWithStrategy({
      recommendations,
      diagnosis,
      decisions: [],
      operationEventCount: 0,
    });

    expect(annotated[0].evidence.aiStrategyFallbackReason).toBe('AI 策略诊断 schemaVersion 错误，已回退规则。');
    expect(annotated[0].evidence.aiFallbackReason).toBe('AI 策略诊断 schemaVersion 错误，已回退规则。');
  });
});
