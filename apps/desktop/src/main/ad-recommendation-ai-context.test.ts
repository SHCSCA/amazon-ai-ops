import { describe, expect, it } from 'vitest';
import type { ActionRecommendation, AdDailyMetrics, CreateOperationEventInput } from '@amazon-ai-ops/shared-types';
import type { AdStrategyDiagnosisOutput } from '@amazon-ai-ops/ai-adapter';
import type { MergedAdDecision } from '@amazon-ai-ops/rules-engine';
import {
  annotateRecommendationsWithStrategy,
  buildAdStrategyDiagnosisInput,
  createAiOnlyRecommendationsFromDecisions,
} from './ad-recommendation-ai-context';

describe('ad recommendation AI context', () => {
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
        reason: 'No-order spend exceeded threshold.',
        confidence: 0.7,
      }),
    ];
    const diagnosis: AdStrategyDiagnosisOutput = {
      lifecycleStage: 'keyword_exploration',
      summary: 'Keep exploration but tighten no-order spend.',
      mainProblems: ['no_order_spend'],
      thresholdSuggestions: {
        targetAcos: { value: 0.35, reason: 'Exploration tolerance.' },
        highAcosThreshold: { value: 0.55, reason: 'Coupon context.' },
        noOrderClickThreshold: { value: 18, reason: 'Enough clicks.' },
        minSpend: { value: 15, reason: 'Avoid small samples.' },
      },
      aiCandidates: [],
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
    expect(annotated[0].recommendedValue).toBe('-12%');
    expect(annotated[0].evidence).toMatchObject({
      aiStrategySource: 'ai',
      aiLifecycleStage: 'keyword_exploration',
      aiStrategySummary: 'Keep exploration but tighten no-order spend.',
      aiMainProblems: ['no_order_spend'],
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
    });
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
      lifecycleStage: 'keyword_exploration',
      summary: 'AI wants review before action.',
      mainProblems: ['conflicting_signal'],
      thresholdSuggestions: {
        targetAcos: { value: 0.35, reason: 'Exploration stage.' },
        highAcosThreshold: { value: 0.55, reason: 'Promotion context.' },
        noOrderClickThreshold: { value: 18, reason: 'Enough clicks.' },
        minSpend: { value: 12, reason: 'Avoid tiny samples.' },
      },
      aiCandidates: [],
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

  it('creates pending review recommendations for AI-only decisions only when current metrics identify the target', () => {
    const diagnosis: AdStrategyDiagnosisOutput = {
      lifecycleStage: 'keyword_exploration',
      summary: 'AI found a wasteful search term not triggered by deterministic thresholds.',
      mainProblems: ['waste_query'],
      thresholdSuggestions: {
        targetAcos: { value: 0.3, reason: 'Exploration stage.' },
        highAcosThreshold: { value: 0.5, reason: 'Exploration stage.' },
        noOrderClickThreshold: { value: 18, reason: 'Enough clicks for this product.' },
        minSpend: { value: 12, reason: 'Avoid tiny samples.' },
      },
      aiCandidates: [],
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
        recommendedValue: '-10%',
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
        recommendedValue: '-10%',
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
      operationEventCount: 2,
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
      recommendedValue: '-10%',
      riskLevel: 'APPROVAL',
      status: 'needs_review',
    });
    expect(recommendations[0].evidence).toMatchObject({
      batchId: 'batch_1',
      sourceFiles: ['C:/reports/user-search-term.xlsx'],
      portfolioName: 'D6 Portfolio',
      campaignName: 'SP exact',
      adGroupName: 'Main',
      searchTerm: 'smart lock outdoor',
      aiStrategySource: 'ai',
      aiLifecycleStage: 'keyword_exploration',
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
