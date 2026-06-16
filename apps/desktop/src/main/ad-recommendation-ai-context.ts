import type { AdStrategyDiagnosisInput, AdStrategyDiagnosisOutput, ProductStrategyContext } from '@amazon-ai-ops/ai-adapter';
import { AdQuantifier, DEFAULT_RULE_CONFIG, type MergedAdDecision, type RuleConfig } from '@amazon-ai-ops/rules-engine';
import type { ActionRecommendation, AdActionType, AdDailyMetrics, CreateOperationEventInput, OperationEvent } from '@amazon-ai-ops/shared-types';

export interface RecommendationDiagnosisScope {
  dateFrom: string;
  dateTo: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  batchId?: string;
}

export interface BuildAdStrategyDiagnosisInputParams {
  scope: RecommendationDiagnosisScope;
  metrics: AdDailyMetrics[];
  operationEvents: Array<CreateOperationEventInput | OperationEvent>;
  productContexts?: ProductStrategyContext[];
  ruleConfig: Partial<RuleConfig> & { minSpend?: number };
  recommendations: ActionRecommendation[];
}

export interface AnnotateRecommendationsWithStrategyParams {
  recommendations: ActionRecommendation[];
  diagnosis: AdStrategyDiagnosisOutput;
  decisions: MergedAdDecision[];
  operationEventCount: number;
  productContexts?: ProductStrategyContext[];
}

export interface CreateAiOnlyRecommendationsParams {
  decisions: MergedAdDecision[];
  diagnosis: AdStrategyDiagnosisOutput;
  metrics: AdDailyMetrics[];
  scope: RecommendationDiagnosisScope;
  taskId: string;
  sourceFiles: string[];
  operationEventCount: number;
  productContexts?: ProductStrategyContext[];
}

export function buildAdStrategyDiagnosisInput(
  params: BuildAdStrategyDiagnosisInputParams,
): AdStrategyDiagnosisInput {
  const ruleConfig: RuleConfig = {
    ...DEFAULT_RULE_CONFIG,
    ...params.ruleConfig,
  };
  const minSpend = numericOrDefault(params.ruleConfig.minSpend, 10);
  const adObjectTimelines = new AdQuantifier(ruleConfig)
    .quantifyTimeline(params.metrics, { minSpend })
    .slice(0, 40)
    .map((timeline) => ({
      objectType: timeline.objectType,
      objectName: timeline.objectName,
      asin: timeline.asin,
      campaignName: timeline.campaignName,
      adGroupName: timeline.adGroupName,
      dateFrom: timeline.dateFrom,
      dateTo: timeline.dateTo,
      daysActive: timeline.daysActive,
      lifecycleStage: timeline.lifecycleStage,
      status: timeline.status,
      totals: {
        clicks: timeline.totals.clicks,
        cost: timeline.totals.cost,
        orders: timeline.totals.orders,
        sales: timeline.totals.sales,
        acos: timeline.totals.acos,
        cvr: timeline.totals.cvr,
        currency: 'USD' as const,
      },
      thresholdSuggestion: {
        targetAcos: timeline.thresholdSuggestion.targetAcos,
        highAcosThreshold: timeline.thresholdSuggestion.highAcosThreshold,
        noOrderClickThreshold: timeline.thresholdSuggestion.noOrderClickThreshold,
        minSpend: timeline.thresholdSuggestion.minSpend,
        scaleAcosThreshold: timeline.thresholdSuggestion.scaleAcosThreshold,
        bidAdjustPercent: timeline.thresholdSuggestion.bidAdjustPercent,
        maxBidDecrement: timeline.thresholdSuggestion.maxBidDecrement,
        maxBidIncrement: timeline.thresholdSuggestion.maxBidIncrement,
      },
      trend: timeline.trend,
      reasons: timeline.reasons,
    }));

  return {
    scope: {
      ...params.scope,
      currency: 'USD',
    },
    metrics: params.metrics.map((metric) => ({
      date: metric.date,
      portfolioName: metric.portfolioName,
      campaignName: metric.campaignName,
      adGroupName: metric.adGroupName,
      asin: metric.asin,
      searchTerm: metric.searchTerm,
      targeting: metric.targeting,
      impressions: metric.impressions,
      clicks: metric.clicks,
      cost: metric.cost,
      orders: metric.orders,
      sales: metric.sales,
      acos: metric.acos,
      cpc: metric.cpc,
      cvr: metric.cvr,
    })),
    productContexts: params.productContexts || [],
    adObjectTimelines,
    operationEvents: params.operationEvents.map((event) => ({
      eventDate: event.eventDate,
      eventType: event.eventType,
      title: event.title,
      impactExpectation: event.impactExpectation,
      asin: event.asin,
      campaignName: event.campaignName,
      adGroupName: event.adGroupName,
      notes: event.notes,
    })),
    currentRuleConfig: {
      targetAcos: numericOrDefault(params.ruleConfig.targetAcos, 0.25),
      highAcosThreshold: numericOrDefault(params.ruleConfig.highAcosThreshold, 0.4),
      noOrderClickThreshold: numericOrDefault(params.ruleConfig.noOrderClickThreshold, 30),
      minSpend,
    },
    ruleCandidates: params.recommendations.map((recommendation) => ({
      entityType: recommendation.entityType,
      entityName: recommendation.entityName,
      actionType: recommendation.actionType,
      reason: recommendation.reason,
      confidence: recommendation.confidence,
    })),
  };
}

export function annotateRecommendationsWithStrategy(
  params: AnnotateRecommendationsWithStrategyParams,
): ActionRecommendation[] {
  return params.recommendations.map((recommendation) => {
    const decision = params.decisions.find((item) => matchesRecommendation(item, recommendation));
    const productContext = findProductContext(params.productContexts || [], recommendation.asin || recommendation.evidence?.asin);
    const needsStrategyReview = Boolean(
      decision && (decision.agreement === 'conflict' || decision.requiresReview),
    );

    return {
      ...recommendation,
      status: needsStrategyReview ? 'needs_review' : recommendation.status,
      recommendedValue: decision?.recommendedValue ?? recommendation.recommendedValue,
      confidence: decision?.confidence ?? recommendation.confidence,
      evidence: {
        ...recommendation.evidence,
        aiStrategySource: params.diagnosis.source,
        aiLifecycleStage: params.diagnosis.lifecycleStage,
        aiStrategySummary: params.diagnosis.summary,
        aiMainProblems: params.diagnosis.mainProblems,
        aiThresholdSuggestions: params.diagnosis.thresholdSuggestions,
        aiStrategyRiskWarnings: params.diagnosis.riskWarnings,
        aiFallbackReason: params.diagnosis.aiFallbackReason ?? recommendation.evidence.aiFallbackReason,
        decisionAgreement: decision?.agreement,
        decisionSource: decision?.source,
        decisionReasons: decision?.reasons,
        decisionRiskWarnings: decision?.riskWarnings,
        decisionRequiresReview: decision?.requiresReview,
        operationEventCount: params.operationEventCount,
        productContextCount: params.productContexts?.length || 0,
        productStage: productContext?.productStage,
        productTargetAcos: productContext?.cost?.targetAcos,
        productTargetTacos: productContext?.cost?.targetTacos,
        productTargetNetMargin: productContext?.cost?.targetNetMargin,
        productMinPrice: productContext?.cost?.minPrice,
      },
    };
  });
}

export function createAiOnlyRecommendationsFromDecisions(
  params: CreateAiOnlyRecommendationsParams,
): ActionRecommendation[] {
  const recommendations: ActionRecommendation[] = [];
  for (const decision of params.decisions) {
    if (decision.agreement !== 'ai_only') continue;
    const entityType = toRecommendationEntityType(decision.entityType);
    const actionType = toRecommendationActionType(decision.actionType);
    if (!entityType || !actionType) continue;

    const metric = findMetricForDecision(params.metrics, decision, entityType);
    if (!metric) continue;
    const productContext = findProductContext(params.productContexts || [], metric.asin || params.scope.asin);

    recommendations.push({
      taskId: params.taskId,
      storeName: metric.storeName || params.scope.storeName,
      marketplaceCode: metric.marketplaceCode || params.scope.marketplaceCode,
      asin: metric.asin || params.scope.asin || '',
      msku: metric.msku || '',
      entityType,
      entityId: `${metric.campaignName || ''}_${metric.adGroupName || ''}_${decision.entityName}`,
      entityName: decision.entityName,
      actionType,
      currentValue: currentMetricValue(metric, actionType),
      recommendedValue: decision.recommendedValue || '',
      reason: decision.reasons.join('；') || params.diagnosis.summary,
      evidence: {
        date: metric.date,
        portfolioName: metric.portfolioName,
        campaignName: metric.campaignName,
        adGroupName: metric.adGroupName,
        asin: metric.asin,
        targeting: metric.targeting,
        searchTerm: metric.searchTerm,
        matchType: metric.matchType,
        impressions: metric.impressions,
        clicks: metric.clicks,
        cost: metric.cost,
        orders: metric.orders,
        sales: metric.sales,
        acos: metric.acos,
        cpc: metric.cpc,
        cvr: metric.cvr,
        batchId: params.scope.batchId,
        sourceFiles: params.sourceFiles,
        aiStrategySource: params.diagnosis.source,
        aiLifecycleStage: params.diagnosis.lifecycleStage,
        aiStrategySummary: params.diagnosis.summary,
        aiMainProblems: params.diagnosis.mainProblems,
        aiThresholdSuggestions: params.diagnosis.thresholdSuggestions,
        aiStrategyRiskWarnings: params.diagnosis.riskWarnings,
        aiFallbackReason: params.diagnosis.aiFallbackReason,
        decisionAgreement: decision.agreement,
        decisionSource: decision.source,
        decisionReasons: decision.reasons,
        decisionRiskWarnings: decision.riskWarnings,
        decisionRequiresReview: true,
        operationEventCount: params.operationEventCount,
        productContextCount: params.productContexts?.length || 0,
        productStage: productContext?.productStage,
        productTargetAcos: productContext?.cost?.targetAcos,
        productTargetTacos: productContext?.cost?.targetTacos,
        productTargetNetMargin: productContext?.cost?.targetNetMargin,
        productMinPrice: productContext?.cost?.minPrice,
      },
      confidence: decision.confidence,
      riskLevel: 'APPROVAL',
      status: 'needs_review',
    });
  }
  return recommendations;
}

function findProductContext(
  productContexts: ProductStrategyContext[],
  asin?: string,
): ProductStrategyContext | undefined {
  const normalizedAsin = normalize(asin || '');
  if (!normalizedAsin) return productContexts.length === 1 ? productContexts[0] : undefined;
  return productContexts.find((product) => normalize(product.asin) === normalizedAsin)
    || (productContexts.length === 1 ? productContexts[0] : undefined);
}

function matchesRecommendation(decision: MergedAdDecision, recommendation: ActionRecommendation): boolean {
  return (
    normalize(decision.entityType) === normalize(recommendation.entityType) &&
    normalize(decision.entityName) === normalize(recommendation.entityName) &&
    normalize(decision.actionType) === normalize(recommendation.actionType)
  );
}

function findMetricForDecision(
  metrics: AdDailyMetrics[],
  decision: MergedAdDecision,
  entityType: ActionRecommendation['entityType'],
): AdDailyMetrics | undefined {
  const entityName = normalize(decision.entityName);
  return metrics.find((metric) => {
    if (entityType === 'search_term') return normalize(metric.searchTerm || '') === entityName;
    if (entityType === 'target') return normalize(metric.targeting || metric.searchTerm || '') === entityName;
    if (entityType === 'campaign') return normalize(metric.campaignName || '') === entityName;
    if (entityType === 'ad_group') return normalize(metric.adGroupName || '') === entityName;
    return false;
  });
}

function toRecommendationEntityType(value: string): ActionRecommendation['entityType'] | undefined {
  const normalized = normalize(value);
  if (normalized === 'search_term') return 'search_term';
  if (normalized === 'target' || normalized === 'keyword') return 'target';
  if (normalized === 'campaign') return 'campaign';
  if (normalized === 'ad_group' || normalized === 'adgroup') return 'ad_group';
  return undefined;
}

function toRecommendationActionType(value: string): AdActionType | undefined {
  const normalized = normalize(value);
  if (normalized === 'lower_bid') return 'lower_bid';
  if (normalized === 'raise_bid') return 'raise_bid';
  if (normalized === 'pause' || normalized === 'pause_target') return 'pause_target';
  if (normalized === 'resume' || normalized === 'resume_target') return 'resume_target';
  if (normalized === 'add_negative' || normalized === 'add_negative_exact') return 'add_negative_exact';
  if (normalized === 'add_negative_phrase') return 'add_negative_phrase';
  if (normalized === 'add_negative_broad') return 'add_negative_broad';
  if (normalized === 'raise_budget' || normalized === 'adjust_campaign_budget') return 'adjust_campaign_budget';
  if (normalized === 'create_campaign') return 'create_campaign';
  if (normalized === 'archive_campaign') return 'archive_campaign';
  return undefined;
}

function currentMetricValue(metric: AdDailyMetrics, actionType: AdActionType): string {
  if (actionType === 'lower_bid' || actionType === 'raise_bid') {
    return Number(metric.cpc || 0).toFixed(2);
  }
  return `cost ${Number(metric.cost || 0).toFixed(2)} / orders ${Number(metric.orders || 0)}`;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function numericOrDefault(value: unknown, fallbackValue: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallbackValue;
}
