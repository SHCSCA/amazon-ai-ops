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

const TEST_EVIDENCE_SUFFICIENCY: AdStrategyDiagnosisOutput['evidenceSufficiency'] = {
  level: 'high',
  metricEvidenceCount: 1,
  sampleDays: 1,
  totalClicks: 30,
  totalCost: 42,
  totalOrders: 0,
  canUseForFormalActions: true,
  blockers: [],
  warnings: [],
};

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
    expect(input.productHistoryLedgers?.[0]).toMatchObject({
      asin: 'B001',
      activeDays: 1,
      totals: {
        cost: 42,
        clicks: 30,
        orders: 0,
        currency: 'USD',
      },
      events: [
        expect.objectContaining({ title: '10% Coupon started' }),
      ],
    });
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
          recommendedValue: '-12%',
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
        recommendedValue: '-12%',
        confidence: 0.85,
        reasons: ['Rule: No-order spend exceeded threshold.', 'AI: Coupon did not convert.'],
        riskWarnings: [],
        requiresReview: false,
      },
    ];

    const annotated = annotateRecommendationsWithStrategy({
      recommendations,
      diagnosis,
      decisions,
      operationEventCount: 1,
      evidencePack: [
        evidenceItem({
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

  it('keeps executable rule values when aligned AI returns only a relative bid percentage', () => {
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
    expect(annotated[0].evidence.decisionReasons).toContain('AI: 应小幅降价。');
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
      decisionAgreement: 'conflict',
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

  it('creates pending review recommendations for AI-only decisions only when current metrics identify the target', () => {
    const diagnosis: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: TEST_EVIDENCE_SUFFICIENCY,
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: '搜索词仍在探索。',
      lifecycleStageEvidenceRefs: ['metric_1'],
      summary: 'AI found a wasteful search term not triggered by deterministic thresholds.',
      mainProblems: ['waste_query'],
      thresholdSuggestions: {
        targetAcos: { value: 0.3, reason: 'Exploration stage.' },
        highAcosThreshold: { value: 0.5, reason: 'Exploration stage.' },
        noOrderClickThreshold: { value: 18, reason: 'Enough clicks for this product.' },
        minSpend: { value: 12, reason: 'Avoid tiny samples.' },
      },
      aiCandidates: [
        {
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          actionType: 'lower_bid',
          recommendedValue: '1.26',
          reason: 'Spend is rising without conversion after coupon.',
          reasoningSteps: ['metric_1 shows no-order spend.'],
          evidenceRefs: ['metric_1'],
          riskWarnings: ['AI-only candidate; rule confirmation is missing.'],
          confidence: 0.66,
        },
      ],
      insightOnlyCandidates: [],
      riskWarnings: ['AI-only suggestions require human review.'],
      source: 'ai',
    };
    const decisions: MergedAdDecision[] = [
      {
        agreement: 'ai_only',
        source: 'ai',
        entityType: 'search_term',
        entityName: 'smart lock outdoor',
        actionType: 'lower_bid',
        recommendedValue: '1.26',
        confidence: 0.66,
        reasons: ['AI: Spend is rising without conversion after coupon.'],
        riskWarnings: ['AI-only candidate; rule confirmation is missing.'],
        requiresReview: true,
      },
      {
        agreement: 'ai_only',
        source: 'ai',
        entityType: 'search_term',
        entityName: 'missing term',
        actionType: 'lower_bid',
        recommendedValue: '1.26',
        confidence: 0.7,
        reasons: ['AI: Missing context.'],
        riskWarnings: [],
        requiresReview: true,
      },
    ];

    const recommendations = createAiOnlyRecommendationsFromDecisions({
      decisions,
      diagnosis,
      metrics: [
        {
          date: '2026-06-10',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          portfolioName: 'D6 Portfolio',
          campaignName: 'SP exact',
          adGroupName: 'Main',
          asin: 'B001',
          msku: 'SKU-1',
          searchTerm: 'smart lock outdoor',
          impressions: 1000,
          clicks: 30,
          cost: 42,
          orders: 0,
          sales: 0,
          acos: 0,
          cpc: 1.4,
          cvr: 0,
          sourceFile: 'C:/reports/user-search-term.xlsx',
          sourceRow: 21,
        } as AdDailyMetrics,
      ],
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        batchId: 'batch_1',
      },
      taskId: 'task_ai_only',
      sourceFiles: ['C:/reports/user-search-term.xlsx', 'C:/reports/campaign.xlsx'],
      operationEventCount: 2,
      evidencePack: [
        evidenceItem({
          evidenceId: 'metric_1',
          type: 'metric',
          label: 'smart lock outdoor / 2026-06-10',
          sourceFile: 'C:/reports/user-search-term.xlsx',
          sourceRow: 21,
          metrics: {
            clicks: 30,
            cost: 42,
            orders: 0,
            sales: 0,
            currency: 'USD',
          },
        }),
      ],
      productContexts: [
        {
          asin: 'B001',
          productStage: 'keyword_exploration',
          cost: {
            targetAcos: 0.3,
            targetTacos: 0.1,
          },
        },
      ],
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      taskId: 'task_ai_only',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B001',
      entityType: 'search_term',
      entityName: 'smart lock outdoor',
      actionType: 'lower_bid',
      recommendedValue: '1.26',
      riskLevel: 'APPROVAL',
      status: 'needs_review',
    });
    expect(recommendations[0].evidence).toMatchObject({
      batchId: 'batch_1',
      sourceFiles: ['C:/reports/user-search-term.xlsx'],
      sourceRow: 21,
      portfolioName: 'D6 Portfolio',
      campaignName: 'SP exact',
      adGroupName: 'Main',
      searchTerm: 'smart lock outdoor',
      aiStrategySource: 'ai',
      aiLifecycleStage: 'keyword_exploration',
      aiEvidenceRefs: ['metric_1'],
      aiEvidenceDetails: [
        expect.objectContaining({
          evidenceId: 'metric_1',
          type: 'metric',
          sourceFile: 'C:/reports/user-search-term.xlsx',
          sourceRow: 21,
          metrics: expect.objectContaining({
            cost: 42,
            orders: 0,
            currency: 'USD',
          }),
        }),
      ],
      aiReasoningSteps: ['metric_1 shows no-order spend.'],
      decisionAgreement: 'ai_only',
      decisionSource: 'ai',
      decisionRequiresReview: true,
      operationEventCount: 2,
      productContextCount: 1,
      productStage: 'keyword_exploration',
      productTargetAcos: 0.3,
      productTargetTacos: 0.1,
    });
  });

  it('binds AI-only recommendations to the metric row referenced by AI evidence when the same term appears in multiple ad groups', () => {
    const diagnosis: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: TEST_EVIDENCE_SUFFICIENCY,
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: '搜索词仍在探索。',
      lifecycleStageEvidenceRefs: ['metric_target'],
      summary: 'AI 发现同名搜索词在不同广告组中表现分化。',
      mainProblems: ['same_term_different_ad_group'],
      thresholdSuggestions: {
        targetAcos: { value: 0.3, reason: '产品目标 ACOS。' },
        highAcosThreshold: { value: 0.5, reason: '探索期容忍阈值。' },
        noOrderClickThreshold: { value: 18, reason: '点击样本足够。' },
        minSpend: { value: 12, reason: '避免小样本。' },
      },
      aiCandidates: [
        {
          entityType: 'search_term',
          entityName: 'door lock',
          actionType: 'lower_bid',
          recommendedValue: '1.10',
          reason: 'D6 Exact 的 door lock 花费高且订单不足。',
          reasoningSteps: ['metric_target 指向 D6 Exact / Main B 的原始报表行。'],
          evidenceRefs: ['metric_target'],
          riskWarnings: ['同名词存在多个广告组，必须按证据行绑定。'],
          confidence: 0.7,
        },
      ],
      insightOnlyCandidates: [],
      riskWarnings: [],
      source: 'ai',
    };
    const decisions: MergedAdDecision[] = [
      {
        agreement: 'ai_only',
        source: 'ai',
        entityType: 'search_term',
        entityName: 'door lock',
        actionType: 'lower_bid',
        recommendedValue: '1.10',
        confidence: 0.7,
        reasons: ['AI: D6 Exact 的 door lock 花费高且订单不足。'],
        riskWarnings: ['同名词存在多个广告组，必须按证据行绑定。'],
        requiresReview: true,
      },
    ];

    const recommendations = createAiOnlyRecommendationsFromDecisions({
      decisions,
      diagnosis,
      metrics: [
        {
          date: '2026-06-10',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          campaignName: 'D9 Auto',
          adGroupName: 'Main A',
          asin: 'B001',
          searchTerm: 'door lock',
          impressions: 500,
          clicks: 8,
          cost: 9,
          orders: 1,
          sales: 39.99,
          acos: 0.23,
          cpc: 1.12,
          cvr: 0.125,
          sourceFile: 'C:/reports/user-search-term.xlsx',
          sourceRow: 31,
        } as AdDailyMetrics,
        {
          date: '2026-06-10',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          campaignName: 'D6 Exact',
          adGroupName: 'Main B',
          asin: 'B002',
          searchTerm: 'door lock',
          impressions: 1800,
          clicks: 36,
          cost: 58,
          orders: 0,
          sales: 0,
          acos: 0,
          cpc: 1.61,
          cvr: 0,
          sourceFile: 'C:/reports/user-search-term.xlsx',
          sourceRow: 88,
        } as AdDailyMetrics,
      ],
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        batchId: 'batch_1',
      },
      taskId: 'task_ai_only',
      sourceFiles: ['C:/reports/user-search-term.xlsx'],
      operationEventCount: 0,
      evidencePack: [
        evidenceItem({
          evidenceId: 'metric_target',
          type: 'metric',
          label: 'door lock / D6 Exact / Main B',
          campaignName: 'D6 Exact',
          adGroupName: 'Main B',
          asin: 'B002',
          entityType: 'search_term',
          entityName: 'door lock',
          sourceFile: 'C:/reports/user-search-term.xlsx',
          sourceRow: 88,
          metrics: {
            clicks: 36,
            cost: 58,
            orders: 0,
            sales: 0,
            currency: 'USD',
          },
        }),
      ],
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      asin: 'B002',
      currentValue: '1.61',
    });
    expect(recommendations[0].evidence).toMatchObject({
      campaignName: 'D6 Exact',
      adGroupName: 'Main B',
      sourceRow: 88,
      cost: 58,
      orders: 0,
    });
  });

  it('does not create formal AI-only recommendations when the matched metric and scope lack product ASIN binding', () => {
    const diagnosis: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: TEST_EVIDENCE_SUFFICIENCY,
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: '搜索词仍在探索。',
      lifecycleStageEvidenceRefs: ['metric_without_asin'],
      summary: 'AI 找到一个缺少产品绑定的动作。',
      mainProblems: ['missing_asin'],
      thresholdSuggestions: {
        targetAcos: { value: 0.3, reason: '产品目标 ACOS。' },
        highAcosThreshold: { value: 0.5, reason: '探索期容忍阈值。' },
        noOrderClickThreshold: { value: 18, reason: '点击样本足够。' },
        minSpend: { value: 12, reason: '避免小样本。' },
      },
      aiCandidates: [{
        entityType: 'search_term',
        entityName: 'door lock',
        actionType: 'lower_bid',
        recommendedValue: '1.10',
        reason: '缺少订单且花费较高。',
        reasoningSteps: ['metric_without_asin 指向原始报表行，但没有 ASIN。'],
        evidenceRefs: ['metric_without_asin'],
        riskWarnings: ['缺少产品绑定，不能正式入池。'],
        confidence: 0.7,
      }],
      insightOnlyCandidates: [],
      riskWarnings: [],
      source: 'ai',
    };
    const decisions: MergedAdDecision[] = [{
      agreement: 'ai_only',
      source: 'ai',
      entityType: 'search_term',
      entityName: 'door lock',
      actionType: 'lower_bid',
      recommendedValue: '1.10',
      confidence: 0.7,
      reasons: ['AI: 缺少订单且花费较高。'],
      riskWarnings: ['缺少产品绑定，不能正式入池。'],
      requiresReview: true,
    }];

    const recommendations = createAiOnlyRecommendationsFromDecisions({
      decisions,
      diagnosis,
      metrics: [{
        date: '2026-06-10',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        campaignName: 'D6 Exact',
        adGroupName: 'Main B',
        searchTerm: 'door lock',
        clicks: 36,
        cost: 58,
        orders: 0,
        sales: 0,
        cpc: 1.61,
        sourceFile: 'C:/reports/user-search-term.xlsx',
        sourceRow: 88,
      } as AdDailyMetrics],
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        batchId: 'batch_1',
      },
      taskId: 'task_ai_only',
      sourceFiles: ['C:/reports/user-search-term.xlsx'],
      operationEventCount: 0,
      evidencePack: [
        evidenceItem({
          evidenceId: 'metric_without_asin',
          type: 'metric',
          label: 'door lock / D6 Exact / Main B',
          campaignName: 'D6 Exact',
          adGroupName: 'Main B',
          entityType: 'search_term',
          entityName: 'door lock',
          sourceFile: 'C:/reports/user-search-term.xlsx',
          sourceRow: 88,
          metrics: {
            clicks: 36,
            cost: 58,
            orders: 0,
            sales: 0,
            currency: 'USD',
          },
        }),
      ],
    });

    expect(recommendations).toEqual([]);
  });

  it('does not create formal AI-only bid recommendations with relative non-executable values', () => {
    const diagnosis: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: TEST_EVIDENCE_SUFFICIENCY,
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: '搜索词仍在探索。',
      lifecycleStageEvidenceRefs: ['metric_1'],
      summary: 'AI 给出相对降幅，但没有可执行出价。',
      mainProblems: ['relative_value_only'],
      thresholdSuggestions: {
        targetAcos: { value: 0.3, reason: '产品目标 ACOS。' },
        highAcosThreshold: { value: 0.5, reason: '探索期容忍阈值。' },
        noOrderClickThreshold: { value: 18, reason: '点击样本足够。' },
        minSpend: { value: 12, reason: '避免小样本。' },
      },
      aiCandidates: [{
        entityType: 'search_term',
        entityName: 'smart lock outdoor',
        actionType: 'lower_bid',
        recommendedValue: '-10%',
        reason: 'AI 建议相对降价。',
        reasoningSteps: ['metric_1 指向原始报表行。'],
        evidenceRefs: ['metric_1'],
        riskWarnings: ['相对值不能直接执行。'],
        confidence: 0.7,
      }],
      insightOnlyCandidates: [],
      riskWarnings: [],
      source: 'ai',
    };
    const decisions: MergedAdDecision[] = [{
      agreement: 'ai_only',
      source: 'ai',
      entityType: 'search_term',
      entityName: 'smart lock outdoor',
      actionType: 'lower_bid',
      recommendedValue: '-10%',
      confidence: 0.7,
      reasons: ['AI: AI 建议相对降价。'],
      riskWarnings: ['相对值不能直接执行。'],
      requiresReview: true,
    }];

    const recommendations = createAiOnlyRecommendationsFromDecisions({
      decisions,
      diagnosis,
      metrics: [{
        date: '2026-06-10',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        campaignName: 'SP exact',
        adGroupName: 'Main',
        asin: 'B001',
        searchTerm: 'smart lock outdoor',
        clicks: 30,
        cost: 42,
        orders: 0,
        sales: 0,
        cpc: 1.4,
        sourceFile: 'C:/reports/user-search-term.xlsx',
        sourceRow: 21,
      } as AdDailyMetrics],
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        batchId: 'batch_1',
      },
      taskId: 'task_ai_only',
      sourceFiles: ['C:/reports/user-search-term.xlsx'],
      operationEventCount: 0,
      evidencePack: [evidenceItem({
        evidenceId: 'metric_1',
        type: 'metric',
        label: 'smart lock outdoor / 2026-06-10',
        entityType: 'search_term',
        entityName: 'smart lock outdoor',
        sourceFile: 'C:/reports/user-search-term.xlsx',
        sourceRow: 21,
      })],
    });

    expect(recommendations).toEqual([]);
  });

  it('does not create formal AI-only recommendations without a validated AI candidate and evidence refs', () => {
    const baseDecision: MergedAdDecision = {
      agreement: 'ai_only',
      source: 'ai',
      entityType: 'search_term',
      entityName: 'smart lock outdoor',
      actionType: 'lower_bid',
        recommendedValue: '1.26',
      confidence: 0.66,
      reasons: ['AI: Spend is rising without conversion after coupon.'],
      riskWarnings: [],
      requiresReview: true,
    };
    const metric = {
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
    } as AdDailyMetrics;
    const baseDiagnosis: AdStrategyDiagnosisOutput = {
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidenceSufficiency: TEST_EVIDENCE_SUFFICIENCY,
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: '搜索词仍在探索。',
      lifecycleStageEvidenceRefs: ['metric_1'],
      summary: 'AI found a wasteful search term.',
      mainProblems: [],
      thresholdSuggestions: {
        targetAcos: { value: 0.3, reason: 'Exploration stage.' },
        highAcosThreshold: { value: 0.5, reason: 'Exploration stage.' },
        noOrderClickThreshold: { value: 18, reason: 'Enough clicks.' },
        minSpend: { value: 12, reason: 'Avoid tiny samples.' },
      },
      aiCandidates: [],
      insightOnlyCandidates: [],
      riskWarnings: [],
      source: 'ai',
    };
    const commonParams = {
      decisions: [baseDecision],
      metrics: [metric],
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        batchId: 'batch_1',
      },
      taskId: 'task_ai_only',
      sourceFiles: ['C:/reports/user-search-term.xlsx'],
      operationEventCount: 0,
    };

    expect(createAiOnlyRecommendationsFromDecisions({
      ...commonParams,
      diagnosis: baseDiagnosis,
    })).toEqual([]);

    expect(createAiOnlyRecommendationsFromDecisions({
      ...commonParams,
      diagnosis: {
        ...baseDiagnosis,
        aiCandidates: [{
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          actionType: 'lower_bid',
      recommendedValue: '1.26',
          reason: 'AI-only but missing refs.',
          reasoningSteps: ['Missing evidence refs.'],
          evidenceRefs: [],
          riskWarnings: [],
          confidence: 0.66,
        }],
      },
    })).toEqual([]);
  });
});

function recommendation(
  patch: Partial<ActionRecommendation> & Pick<ActionRecommendation, 'entityType' | 'entityName' | 'actionType' | 'reason' | 'confidence'>,
): ActionRecommendation {
  return {
    taskId: 'task_1',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    msku: '',
    entityId: `${patch.entityType}_${patch.entityName}`,
    currentValue: '1.40',
    recommendedValue: '',
    riskLevel: 'APPROVAL',
    status: 'pending',
    evidence: {
      impressions: 1000,
      clicks: 30,
      cost: 42,
      orders: 0,
      sales: 0,
      acos: 0,
      cpc: 1.4,
      cvr: 0,
      campaignName: 'SP exact',
      adGroupName: 'Main',
      searchTerm: patch.entityName,
    },
    ...patch,
  };
}

function evidenceItem(patch: Partial<AiEvidenceItem>): AiEvidenceItem {
  return {
    evidenceId: 'metric_1',
    type: 'metric',
    label: 'smart lock outdoor',
    dateRange: '2026-06-10~2026-06-10',
    batchId: 'batch_1',
    reportType: 'search_term',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    campaignName: 'SP exact',
    adGroupName: 'Main',
    entityType: 'search_term',
    entityName: 'smart lock outdoor',
    ...patch,
  };
}
