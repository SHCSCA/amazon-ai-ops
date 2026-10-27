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
