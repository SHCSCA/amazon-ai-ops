import { recommendationDecisionIdentity, resolveAiDecisionIdentity } from './ad-decision-identity';
import { finiteNumberOrUndefined, parseIntegerSetting } from './main-value-coercion';
import { mergeAdDecisions } from '@amazon-ai-ops/rules-engine';
import { AdActionReasonExplainer, AdStrategyDiagnoser, assessAdEvidenceSufficiency, type AdStrategyDiagnosisOutput, type AiEvidenceItem, type AiReasonedDecision, type ProductStrategyContext } from '@amazon-ai-ops/ai-adapter';
import type { RuleConfig } from '@amazon-ai-ops/rules-engine';
import type { ActionRecommendation, AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { runtimeLog } from './runtime-log-adapter';
import { annotateRecommendationsWithStrategy, buildAdStrategyDiagnosisInput, createAiOnlyRecommendationsFromDecisions } from './ad-recommendation-ai-context';
import { buildAdAiEvidencePack, summarizeAiEvidencePack } from './ad-ai-evidence-pack';
import { validateAiDiagnosisEvidence } from './ad-ai-evidence-validator';
import { loadProductHistoryObservation } from './ad-product-history-source-runtime';
import type { BusinessMetricSource } from './main-runtime-contracts';
import { type AdActionExplanationForLog } from './ad-action-ai-call-log';
import { mergeAdActionExplanationEvidence } from './ad-action-explanation-merge';
import { buildCausalMemorySystemPersona, withCausalMemoryUserContext } from './analysis-causal-memory-prompt';
import { type StoreRuntimeAnalysisConfig } from './store-runtime-analysis-config';
import { buildAiProviderConfig, governedAiProvider, normalizeAiSettings } from './main-ai-settings-runtime';
import { hashAiDiagnosisInput, recordAdActionReasonAiCallLog, recordAdStrategyDiagnosisRun } from './main-ad-diagnosis-runtime';
import type { AdStrategyGenerationSummary, AiEvidencePackSummary, AiInsightSummary } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function summarizeStrategyDiagnosis(
  diagnosis: AdStrategyDiagnosisOutput,
  operationEventCount: number,
  productContextCount = 0,
  aiInsights: AiInsightSummary[] = [],
  evidencePackSummary?: AiEvidencePackSummary,
  evidencePackPreview?: AiEvidenceItem[],
): AdStrategyGenerationSummary {
  return {
    source: diagnosis.source,
    evidenceSufficiency: diagnosis.evidenceSufficiency,
    lifecycleStage: diagnosis.lifecycleStage,
    summary: diagnosis.summary,
    mainProblems: diagnosis.mainProblems,
    riskWarnings: diagnosis.riskWarnings,
    thresholdSuggestions: diagnosis.thresholdSuggestions,
    lifecycleStageReason: diagnosis.lifecycleStageReason,
    lifecycleStageEvidenceRefs: diagnosis.lifecycleStageEvidenceRefs,
    lifecycleStageRequiresReview: diagnosis.lifecycleStageRequiresReview,
    lifecycleStageInvalidReasons: diagnosis.lifecycleStageInvalidReasons,
    aiCandidateCount: diagnosis.aiCandidates.length,
    insightOnlyCandidateCount: aiInsights.length,
    aiInsights,
    evidencePackSummary,
    evidencePackPreview,
    operationEventCount,
    productContextCount,
    decisionCounts: {
      total: 0,
      aligned: 0,
      ruleOnly: 0,
      aiOnly: 0,
      conflict: 0,
      reviewRequired: 0,
    },
    finalCandidateCount: 0,
    filteredAiOnlyCandidateCount: 0,
    filterReasons: [],
    fallbackReason: diagnosis.aiFallbackReason,
  };
}

export function summarizeMergedDecisionDiagnostics(
  decisions: Array<{ agreement: string; requiresReview?: boolean }>,
  acceptedAiOnlyCount: number,
  finalCandidateCount: number,
) {
  const decisionCounts = {
    total: decisions.length,
    aligned: decisions.filter((decision) => decision.agreement === 'aligned').length,
    ruleOnly: decisions.filter((decision) => decision.agreement === 'rule_only').length,
    aiOnly: decisions.filter((decision) => decision.agreement === 'ai_only').length,
    conflict: decisions.filter((decision) => decision.agreement === 'conflict').length,
    reviewRequired: decisions.filter((decision) => decision.requiresReview === true).length,
  };
  const filteredAiOnlyCandidateCount = Math.max(0, decisionCounts.aiOnly - acceptedAiOnlyCount);
  const filterReasons: string[] = [];
  if (decisions.length === 0) {
    filterReasons.push('规则和 AI 都没有返回可合并的候选动作。');
  }
  if (filteredAiOnlyCandidateCount > 0) {
    filterReasons.push(`${filteredAiOnlyCandidateCount} 条 AI-only 候选缺少可映射的真实 keyword/search term/target 指标，未进入待审批。`);
  }
  if (decisionCounts.conflict > 0) {
    filterReasons.push(`${decisionCounts.conflict} 条 AI/规则冲突建议已标记为人工复核，不会直接进入普通审批。`);
  }
  if (decisionCounts.ruleOnly > 0) {
    filterReasons.push(`${decisionCounts.ruleOnly} 条规则-only 建议缺少 AI 确认，仍需按证据完整性审批。`);
  }
  if (acceptedAiOnlyCount > 0) {
    filterReasons.push(`${acceptedAiOnlyCount} 条 AI-only 候选已找到真实指标上下文，只能进入人工复核。`);
  }
  if (finalCandidateCount === 0 && filterReasons.length === 0) {
    filterReasons.push('本次诊断完成，但没有形成可绑定当前广告对象的安全动作。');
  }

  return {
    decisionCounts,
    finalCandidateCount,
    filteredAiOnlyCandidateCount,
    filterReasons,
  };
}

export function loadProductStrategyContexts(scope: {
  storeId: StoreContextEnvelope['storeId'];
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
}): ProductStrategyContext[] {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.productRepo || !scope.storeName || !scope.marketplaceCode) return [];
  const products = mainRuntimeContext.state.productRepo
    .findAllForStore(scope.storeId)
    .filter((product) => product.marketplace_code === scope.marketplaceCode)
    .filter((product) => !scope.asin || product.asin.toLowerCase() === scope.asin.toLowerCase())
    .slice(0, 20);

  return products.map((product) => {
    const cost = mainRuntimeContext.state.productRepo?.getCostForStore(scope.storeId, product.id);
    return {
      asin: product.asin,
      parentAsin: product.parent_asin || undefined,
      msku: product.msku || undefined,
      sku: product.sku || undefined,
      title: product.title || undefined,
      productStage: product.product_stage || undefined,
      status: product.status || undefined,
      cost: cost
        ? {
            purchaseCost: finiteNumberOrUndefined(cost.purchaseCost),
            firstLegCost: finiteNumberOrUndefined(cost.firstLegCost),
            fbaFee: finiteNumberOrUndefined(cost.fbaFee),
            referralFeeRate: finiteNumberOrUndefined(cost.referralFeeRate),
            storageFee: finiteNumberOrUndefined(cost.storageFee),
            otherCost: finiteNumberOrUndefined(cost.otherCost),
            minPrice: finiteNumberOrUndefined(cost.minPrice),
            targetNetMargin: finiteNumberOrUndefined(cost.targetNetMargin),
            targetAcos: finiteNumberOrUndefined(cost.targetAcos),
            targetTacos: finiteNumberOrUndefined(cost.targetTacos),
          }
        : undefined,
    };
  });
}

export async function enrichAdRecommendationsWithAiExplanations(
  recommendations: ActionRecommendation[],
  runtimeConfig: StoreRuntimeAnalysisConfig,
  settings: Record<string, string>,
  capturedContext: StoreContextEnvelope,
  causalMemoryPrompt?: string,
  signal?: AbortSignal,
): Promise<ActionRecommendation[]> {
  const capturedStoreId = capturedContext.storeId;
  signal?.throwIfAborted();
  if (recommendations.length === 0) return recommendations;

  const aiApiKey = settings.aiApiKey;
  if (!runtimeConfig.values.aiRecommendationsEnabled || !aiApiKey) {
    const fallbackReason = runtimeConfig.values.aiRecommendationsEnabled
      ? '未配置 AI Key，广告建议解释使用规则引擎'
      : '当前店铺已关闭 AI 建议，广告建议解释使用规则引擎';
    return recommendations.map((rec) => mergeAdActionExplanationEvidence({
      recommendation: rec,
      explanation: {
        source: 'rule',
        explanation: rec.reason,
        riskWarnings: [`${fallbackReason}。`],
        aiFallbackReason: fallbackReason,
      },
      model: settings.aiModel,
    }));
  }

  const provider = withCausalMemoryUserContext(
    governedAiProvider(buildAiProviderConfig(settings), capturedContext, 'action_explanation'),
    causalMemoryPrompt,
  );
  const explainer = new AdActionReasonExplainer(provider, {
    persona: buildCausalMemorySystemPersona(settings.aiPersona, Boolean(causalMemoryPrompt)),
    outputLanguage: settings.aiOutputLanguage,
  });
  const enhanced: ActionRecommendation[] = [];
  for (const rec of recommendations) {
    signal?.throwIfAborted();
    try {
      const explanation = await explainer.explain({
        actionType: rec.actionType,
        entityName: rec.entityName,
        currentMetrics: {
          impressions: rec.evidence.impressions,
          clicks: rec.evidence.clicks,
          cost: rec.evidence.cost,
          orders: rec.evidence.orders,
          sales: rec.evidence.sales,
          acos: rec.evidence.acos,
        },
        recommendedAction: rec.evidence.currentValueSource === 'ads_ui'
          ? `当前 Ads 已核验竞价 USD ${rec.currentValue}；建议竞价 USD ${rec.recommendedValue}；历史平均 CPC 为 USD ${rec.evidence.cpc}，不得用历史 CPC 计算竞价降幅。`
          : rec.recommendedValue || rec.actionType,
      }, { signal });
      signal?.throwIfAborted();
      recordAdActionReasonAiCallLog({
        recommendation: rec,
        explanation,
        model: settings.aiModel,
      }, capturedStoreId);
      enhanced.push(mergeAdActionExplanationEvidence({
        recommendation: rec,
        explanation,
        model: settings.aiModel,
      }));
    } catch (error) {
      signal?.throwIfAborted();
      const fallbackReason = `AI 广告解释异常：${error instanceof Error ? error.message : String(error)}，使用规则解释`;
      const fallbackExplanation: AdActionExplanationForLog = {
        source: 'rule',
        explanation: rec.reason,
        riskWarnings: ['AI 广告解释异常，使用规则解释。'],
        aiFallbackReason: fallbackReason,
      };
      recordAdActionReasonAiCallLog({
        recommendation: rec,
        explanation: fallbackExplanation,
        model: settings.aiModel,
      }, capturedStoreId);
      enhanced.push(mergeAdActionExplanationEvidence({
        recommendation: rec,
        explanation: fallbackExplanation,
        model: settings.aiModel,
      }));
    }
  }
  return enhanced;
}

export async function enrichAdRecommendationsWithStrategyDiagnosis(
  recommendations: ActionRecommendation[],
  metrics: AdDailyMetrics[],
  scope: {
    storeId: StoreContextEnvelope['storeId'];
    dateFrom?: string;
    dateTo?: string;
    storeName?: string;
    marketplaceCode?: string;
    asin?: string;
    batchId?: string;
  },
  options: {
    storeContext: StoreContextEnvelope;
    taskId: string;
    sourceFiles: string[];
    productHistorySource?: BusinessMetricSource;
    runtimeConfig: StoreRuntimeAnalysisConfig;
    aiSettings: Record<string, string>;
    causalMemoryPrompt?: string;
    signal?: AbortSignal | undefined;
  },
): Promise<{ recommendations: ActionRecommendation[]; summary?: AdStrategyGenerationSummary }> {
  const mainRuntimeContext = getMainRuntimeContext();
  options.signal?.throwIfAborted();
  if (!scope.dateFrom || !scope.dateTo || !scope.storeName || !scope.marketplaceCode) {
    return { recommendations };
  }

  const operationEvents = mainRuntimeContext.state.operationEventRepo?.findByScopeForStore(scope.storeId, {
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    limit: 100,
  }) || [];
  const productContexts = loadProductStrategyContexts(scope);
  const productHistoryQuality = loadProductHistoryObservation(mainRuntimeContext.state.db, {
    storeId: scope.storeId,
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
  }, options.productHistorySource);
  const evidencePack = buildAdAiEvidencePack({
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
    },
    metrics,
    operationEvents,
    productContexts,
    ruleRecommendations: recommendations,
    productHistoryQuality,
  });
  const evidencePackSummary = summarizeAiEvidencePack(evidencePack);
  const diagnosisInput = buildAdStrategyDiagnosisInput({
    scope: {
      storeId: scope.storeId,
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
    },
    metrics,
    operationEvents,
    productContexts,
    ruleConfig: options.runtimeConfig.ruleConfig as RuleConfig & { minSpend?: number },
    recommendations,
    evidencePack,
    productHistoryQuality,
  });
  const settings = options.aiSettings;
  const diagnosis = options.runtimeConfig.values.aiRecommendationsEnabled && settings.aiApiKey
    ? await new AdStrategyDiagnoser(withCausalMemoryUserContext(
        governedAiProvider(buildAiProviderConfig(settings), options.storeContext, 'strategy_analysis'),
        options.causalMemoryPrompt,
      ), {
        persona: buildCausalMemorySystemPersona(settings.aiPersona, Boolean(options.causalMemoryPrompt)),
        outputLanguage: settings.aiOutputLanguage,
        maxTokens: parseIntegerSetting(settings.aiMaxTokens || settings.ai_max_tokens, 8192),
      }).diagnose(diagnosisInput, { signal: options.signal })
    : {
        schemaVersion: 'ad_strategy_diagnosis_v1' as const,
        evidenceSufficiency: assessAdEvidenceSufficiency(diagnosisInput),
        lifecycleStage: 'unknown' as const,
        lifecycleStageReason: options.runtimeConfig.values.aiRecommendationsEnabled
          ? '未配置 AI Key，不能执行 AI 阶段判断。'
          : '当前店铺已关闭 AI 建议，不能执行 AI 阶段判断。',
        lifecycleStageEvidenceRefs: [],
        summary: options.runtimeConfig.values.aiRecommendationsEnabled
          ? '未配置 AI Key，广告阶段诊断使用规则 fallback。'
          : '当前店铺已关闭 AI 建议，广告阶段诊断使用规则 fallback。',
        mainProblems: [],
        thresholdSuggestions: {
          targetAcos: {
            value: diagnosisInput.currentRuleConfig.targetAcos,
            reason: '当前规则配置 fallback。',
          },
          highAcosThreshold: {
            value: diagnosisInput.currentRuleConfig.highAcosThreshold,
            reason: '当前规则配置 fallback。',
          },
          noOrderClickThreshold: {
            value: diagnosisInput.currentRuleConfig.noOrderClickThreshold,
            reason: '当前规则配置 fallback。',
          },
          minSpend: {
            value: diagnosisInput.currentRuleConfig.minSpend,
            reason: '当前规则配置 fallback。',
          },
        },
        aiCandidates: [],
        insightOnlyCandidates: [],
        riskWarnings: ['AI 不可用，必须人工复核规则建议。'],
        source: 'rule' as const,
        aiFallbackReason: options.runtimeConfig.values.aiRecommendationsEnabled
          ? '未配置 AI Key，广告阶段诊断使用规则 fallback'
          : '当前店铺已关闭 AI 建议，广告阶段诊断使用规则 fallback',
      };
  options.signal?.throwIfAborted();
  recordAdStrategyAiCallLog(scope.storeId, diagnosisInput, diagnosis, settings, evidencePackSummary);
  const validation = validateAiDiagnosisEvidence({
    diagnosis,
    evidencePack,
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
    },
  });
  const aiInsights = buildAiInsightsFromValidation(diagnosis, validation.invalidReasons);
  const mergeDiagnosis: AdStrategyDiagnosisOutput = {
    ...diagnosis,
    aiCandidates: diagnosis.aiCandidates.filter((_, index) => validation.validCandidateIndexes.includes(index)),
  };
  const identityScope = { storeContext: options.storeContext, dateFrom: scope.dateFrom, dateTo: scope.dateTo, storeId: scope.storeId, storeName: scope.storeName, marketplaceCode: scope.marketplaceCode, asin: scope.asin, batchId: scope.batchId };
  const decisions = mergeAdDecisions({
    ruleCandidates: recommendations.map((recommendation) => ({
      identity: recommendationDecisionIdentity(recommendation, identityScope),
      entityType: recommendation.entityType,
      entityName: recommendation.entityName,
      actionType: recommendation.actionType,
      recommendedValue: recommendation.recommendedValue,
      reason: recommendation.reason,
      confidence: recommendation.confidence,
    })),
    aiCandidates: mergeDiagnosis.aiCandidates.map((candidate) => ({
      identity: resolveAiDecisionIdentity(candidate, recommendations, metrics, evidencePack, identityScope),
      entityType: candidate.entityType,
      entityName: candidate.entityName,
      actionType: candidate.actionType,
      recommendedValue: candidate.recommendedValue,
      reason: candidate.reason,
      confidence: candidate.confidence,
    })),
  });

  const annotated = annotateRecommendationsWithStrategy({
    identityScope,
    identityMetrics: metrics,
    recommendations,
    diagnosis: mergeDiagnosis,
    decisions,
    operationEventCount: operationEvents.length,
    productContexts,
    evidencePack,
  });
  const aiOnlyRecommendations = createAiOnlyRecommendationsFromDecisions({
    decisions,
    diagnosis: mergeDiagnosis,
    metrics,
    scope: {
      storeId: scope.storeId,
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
    },
    taskId: options.taskId,
    sourceFiles: options.sourceFiles,
    operationEventCount: operationEvents.length,
    productContexts,
    evidencePack,
  });
  const decisionDiagnostics = summarizeMergedDecisionDiagnostics(
    decisions,
    aiOnlyRecommendations.length,
    annotated.length + aiOnlyRecommendations.length,
  );
  const evidencePackPreview = selectStrategyEvidencePreview(mergeDiagnosis, aiInsights, evidencePack);
  const summary = {
    ...summarizeStrategyDiagnosis(mergeDiagnosis, operationEvents.length, productContexts.length, aiInsights, evidencePackSummary, evidencePackPreview),
    ...decisionDiagnostics,
  };
  recordAdStrategyDiagnosisRun(scope.storeId, {
    diagnosis: mergeDiagnosis,
    settings,
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
    },
    evidencePackSummary,
    evidencePackPreview,
    aiInsights,
    formalRecommendationCount: annotated.length + aiOnlyRecommendations.length,
  });

  return {
    recommendations: [...annotated, ...aiOnlyRecommendations],
    summary,
  };
}

export function buildAiInsightsFromValidation(
  diagnosis: AdStrategyDiagnosisOutput,
  invalidReasons: Array<{ candidateIndex: number; reason: string; missingRefs: string[] }>,
): AiInsightSummary[] {
  const invalidReasonByIndex = new Map(invalidReasons.map((item) => [item.candidateIndex, item]));
  const invalidCandidateInsights = diagnosis.aiCandidates
    .map((candidate, index) => ({ candidate, invalid: invalidReasonByIndex.get(index) }))
    .filter((item): item is { candidate: AiReasonedDecision; invalid: { candidateIndex: number; reason: string; missingRefs: string[] } } => Boolean(item.invalid))
    .map(({ candidate, invalid }) => candidateToInsight(candidate, [invalid.reason]));

  const explicitInsightCandidates = diagnosis.insightOnlyCandidates.map((candidate) => candidateToInsight(candidate, [
    'AI 返回了判断，但缺少可回查证据引用，因此只作为洞察展示，未进入优化建议池。',
  ]));

  return [...invalidCandidateInsights, ...explicitInsightCandidates];
}

export function candidateToInsight(candidate: AiReasonedDecision, invalidReasons: string[]): AiInsightSummary {
  return {
    entityType: candidate.entityType,
    entityName: candidate.entityName,
    actionType: candidate.actionType,
    reason: candidate.reason,
    reasoningSteps: candidate.reasoningSteps,
    evidenceRefs: candidate.evidenceRefs,
    invalidReasons,
    riskWarnings: candidate.riskWarnings,
    confidence: candidate.confidence,
  };
}

export function selectStrategyEvidencePreview(
  diagnosis: AdStrategyDiagnosisOutput,
  aiInsights: AiInsightSummary[],
  evidencePack: AiEvidenceItem[],
  maxItems = 12,
): AiEvidenceItem[] {
  const referencedIds = new Set<string>();
  for (const ref of diagnosis.lifecycleStageEvidenceRefs || []) referencedIds.add(ref);
  for (const suggestion of Object.values(diagnosis.thresholdSuggestions || {})) {
    for (const ref of suggestion.evidenceRefs || []) referencedIds.add(ref);
  }
  for (const candidate of [...(diagnosis.aiCandidates || []), ...(diagnosis.insightOnlyCandidates || [])]) {
    for (const ref of candidate.evidenceRefs || []) referencedIds.add(ref);
  }
  for (const insight of aiInsights) {
    for (const ref of insight.evidenceRefs || []) referencedIds.add(ref);
  }

  const referenced = evidencePack.filter((item) => referencedIds.has(item.evidenceId));
  if (referenced.length) return referenced.slice(0, maxItems);
  return evidencePack.slice(0, Math.min(maxItems, 6));
}

export function recordAdStrategyAiCallLog(
  capturedStoreId: StoreContextEnvelope['storeId'],
  input: ReturnType<typeof buildAdStrategyDiagnosisInput>,
  diagnosis: AdStrategyDiagnosisOutput,
  settings: ReturnType<typeof normalizeAiSettings>,
  evidencePackSummary?: AiEvidencePackSummary,
): void {
  const mainRuntimeContext = getMainRuntimeContext();
  try {
    mainRuntimeContext.state.aiCallLogRepo?.insertForStore(capturedStoreId, {
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: settings.aiModel,
      inputHash: hashAiDiagnosisInput(input, evidencePackSummary),
      outputJson: JSON.stringify(diagnosis),
      success: diagnosis.source === 'ai' && !diagnosis.aiFallbackReason,
      errorMessage: diagnosis.aiFallbackReason,
      schemaVersion: diagnosis.schemaVersion,
      evidencePackSummary,
    });
  } catch (error) {
    runtimeLog.warn('[AI] Failed to write ad strategy diagnosis log', error);
  }
}
