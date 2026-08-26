import type {
  AdStrategyDiagnosisInput,
  AdStrategyDiagnosisOutput,
  AiEvidenceItem,
  AiReasonedDecision,
  ProductStrategyContext,
} from '@amazon-ai-ops/ai-adapter';
import { AdQuantifier, DEFAULT_RULE_CONFIG, type MergedAdDecision, type RuleConfig } from '@amazon-ai-ops/rules-engine';
import type { ActionRecommendation, AdActionType, AdDailyMetrics, CreateOperationEventInput, OperationEvent } from '@amazon-ai-ops/shared-types';
import { buildAdProductHistoryLedger } from './ad-product-history-ledger';

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
  evidencePack?: AiEvidenceItem[];
}

export interface AnnotateRecommendationsWithStrategyParams {
  recommendations: ActionRecommendation[];
  diagnosis: AdStrategyDiagnosisOutput;
  decisions: MergedAdDecision[];
  operationEventCount: number;
  productContexts?: ProductStrategyContext[];
  evidencePack?: AiEvidenceItem[];
  candidateInvalidReasons?: Array<{ candidateIndex: number; reason: string; missingRefs: string[] }>;
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
  evidencePack?: AiEvidenceItem[];
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
    productHistoryLedgers: buildAdProductHistoryLedger({
      scope: params.scope,
      metrics: params.metrics,
      operationEvents: params.operationEvents,
      productContexts: params.productContexts || [],
    }).map((ledger) => ({
      asin: ledger.asin,
      storeName: ledger.storeName,
      marketplaceCode: ledger.marketplaceCode,
      dateFrom: ledger.dateFrom,
      dateTo: ledger.dateTo,
      activeDays: ledger.activeDays,
      firstMetricDate: ledger.firstMetricDate,
      lastMetricDate: ledger.lastMetricDate,
      inferredStage: ledger.inferredStage,
      stageReasons: ledger.stageReasons,
      totals: ledger.totals,
      recentDaily: ledger.daily.slice(-14).map((day) => ({
        date: day.date,
        clicks: day.clicks,
        cost: day.cost,
        orders: day.orders,
        sales: day.sales,
        acos: day.acos,
        cvr: day.cvr,
        currency: day.currency,
      })),
      events: ledger.events.map((event) => ({
        eventDate: event.eventDate,
        eventType: event.eventType,
        title: event.title,
        impactExpectation: event.impactExpectation,
      })),
      product: ledger.product,
    })),
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
    evidencePack: params.evidencePack || [],
  };
}

export function bindRecommendationsToScopeAsin(
  recommendations: ActionRecommendation[],
  scopeAsin?: string,
): ActionRecommendation[] {
  const normalizedScopeAsin = String(scopeAsin || '').trim();
  if (!normalizedScopeAsin) return recommendations;
  return recommendations.map((recommendation) => {
    const asin = String(recommendation.asin || recommendation.evidence?.asin || normalizedScopeAsin).trim();
    return {
      ...recommendation,
      asin,
      evidence: {
        ...recommendation.evidence,
        asin: String(recommendation.evidence?.asin || asin).trim(),
      },
    };
  });
}

export function annotateRecommendationsWithStrategy(
  params: AnnotateRecommendationsWithStrategyParams,
): ActionRecommendation[] {
  return params.recommendations.map((recommendation) => {
    const decision = params.decisions.find((item) => matchesRecommendation(item, recommendation));
    const aiDecision = decision ? findAiDecision(params.diagnosis.aiCandidates, decision) : undefined;
    const aiEvidenceDetails = resolveEvidenceDetails(params.evidencePack || [], aiDecision?.evidenceRefs || []);
    const lifecycleEvidenceDetails = resolveEvidenceDetails(
      params.evidencePack || [],
      params.diagnosis.lifecycleStageEvidenceRefs,
    );
    const productContext = findProductContext(params.productContexts || [], recommendation.asin || recommendation.evidence?.asin);
    const aiActionParticipated = Boolean(decision && (decision.agreement === 'aligned' || decision.agreement === 'ai_only'));
    const needsStrategyReview = Boolean(
      (aiActionParticipated && params.diagnosis.lifecycleStageRequiresReview)
      || (decision && (decision.agreement === 'conflict' || decision.requiresReview)),
    );

    return {
      ...recommendation,
      status: needsStrategyReview ? 'needs_review' : recommendation.status,
      recommendedValue: chooseExecutableRecommendedValue(recommendation, decision),
      confidence: decision?.confidence ?? recommendation.confidence,
      evidence: {
        ...recommendation.evidence,
        aiStrategySource: params.diagnosis.source,
        aiEvidenceSufficiency: params.diagnosis.evidenceSufficiency,
        aiLifecycleStage: params.diagnosis.lifecycleStage,
        aiLifecycleStageReason: params.diagnosis.lifecycleStageReason,
        aiLifecycleStageEvidenceRefs: params.diagnosis.lifecycleStageEvidenceRefs,
        aiLifecycleStageRequiresReview: params.diagnosis.lifecycleStageRequiresReview,
        aiLifecycleStageInvalidReasons: params.diagnosis.lifecycleStageInvalidReasons,
        aiLifecycleStageEvidenceDetails: lifecycleEvidenceDetails,
        aiStrategySummary: params.diagnosis.summary,
        aiMainProblems: params.diagnosis.mainProblems,
        aiThresholdSuggestions: params.diagnosis.thresholdSuggestions,
        aiThresholdEvidenceRefs: thresholdEvidenceRefs(params.diagnosis),
        aiStrategyRiskWarnings: params.diagnosis.riskWarnings,
        aiStrategyFallbackReason: params.diagnosis.aiFallbackReason,
        aiFallbackReason: params.diagnosis.aiFallbackReason ?? recommendation.evidence.aiFallbackReason,
        aiEvidenceRefs: aiDecision?.evidenceRefs,
        aiEvidenceDetails,
        aiReasoningSteps: aiDecision?.reasoningSteps,
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

function chooseExecutableRecommendedValue(
  recommendation: ActionRecommendation,
  decision?: MergedAdDecision,
): string {
  const decisionValue = decision?.recommendedValue;
  if (!decisionValue) return recommendation.recommendedValue;
  if (isExecutableActionValue(recommendation.actionType, recommendation.currentValue, decisionValue)
    && isSafeAlignedBidOverride(recommendation, decisionValue)) {
    return decisionValue;
  }
  return recommendation.recommendedValue;
}

function isSafeAlignedBidOverride(
  recommendation: ActionRecommendation,
  decisionValue: unknown,
): boolean {
  if (normalize(recommendation.actionType) !== 'lower_bid') return true;
  const current = parseExecutableNumber(recommendation.currentValue);
  const recommended = parseExecutableNumber(decisionValue);
  if (current === undefined || recommended === undefined || recommended >= current) return false;
  return ((current - recommended) / current) * 100 <= 10.000001;
}

function isExecutableActionValue(actionType: string, currentValue: unknown, recommendedValue: unknown): boolean {
  const action = normalize(actionType);
  const recommended = parseExecutableNumber(recommendedValue);
  if (action === 'lower_bid' || action === 'raise_bid') {
    const current = parseExecutableNumber(currentValue);
    if (recommended === undefined || current === undefined) return false;
    if (action === 'lower_bid') return recommended < current;
    if (action === 'raise_bid') return recommended > current;
  }
  if (action === 'adjust_campaign_budget') return recommended !== undefined;
  return true;
}

function parseExecutableNumber(value: unknown): number | undefined {
  const text = String(value || '').trim();
  if (!text || /[%％]/.test(text)) return undefined;
  const parsed = Number(text.replace(/^\$/, '').replace(/\s*usd$/i, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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

    const aiDecision = findAiDecision(params.diagnosis.aiCandidates, decision);
    if (!aiDecision || aiDecision.evidenceRefs.length === 0) continue;
    const metric = findMetricForDecision(params.metrics, decision, entityType, params.evidencePack || [], aiDecision);
    if (!metric) continue;
    const metricSourceFile = String(metric.sourceFile || '').trim();
    const metricSourceRow = Number(metric.sourceRow);
    if (!metricSourceFile || !Number.isFinite(metricSourceRow) || metricSourceRow <= 0) continue;
    const productAsin = String(metric.asin || params.scope.asin || '').trim();
    if (!productAsin) continue;
    const currentValue = currentMetricValue(metric, actionType);
    const recommendedValue = decision.recommendedValue || '';
    if (!isExecutableActionValue(actionType, currentValue, recommendedValue)) continue;
    const productContext = findProductContext(params.productContexts || [], productAsin);
    const aiEvidenceDetails = resolveEvidenceDetails(params.evidencePack || [], aiDecision.evidenceRefs);

    recommendations.push({
      taskId: params.taskId,
      storeName: metric.storeName || params.scope.storeName,
      marketplaceCode: metric.marketplaceCode || params.scope.marketplaceCode,
      asin: productAsin,
      msku: metric.msku || '',
      entityType,
      entityId: `${metric.campaignName || ''}_${metric.adGroupName || ''}_${decision.entityName}`,
      entityName: decision.entityName,
      actionType,
      currentValue,
      recommendedValue,
      reason: decision.reasons.join('；') || params.diagnosis.summary,
      evidence: {
        date: metric.date,
        portfolioName: metric.portfolioName,
        campaignName: metric.campaignName,
        adGroupName: metric.adGroupName,
        asin: productAsin,
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
        sourceFiles: [metricSourceFile],
        sourceRow: metricSourceRow,
        aiStrategySource: params.diagnosis.source,
        aiEvidenceSufficiency: params.diagnosis.evidenceSufficiency,
        aiLifecycleStage: params.diagnosis.lifecycleStage,
        aiLifecycleStageReason: params.diagnosis.lifecycleStageReason,
        aiLifecycleStageEvidenceRefs: params.diagnosis.lifecycleStageEvidenceRefs,
        aiLifecycleStageRequiresReview: params.diagnosis.lifecycleStageRequiresReview,
        aiLifecycleStageInvalidReasons: params.diagnosis.lifecycleStageInvalidReasons,
        aiStrategySummary: params.diagnosis.summary,
        aiMainProblems: params.diagnosis.mainProblems,
        aiThresholdSuggestions: params.diagnosis.thresholdSuggestions,
        aiThresholdEvidenceRefs: thresholdEvidenceRefs(params.diagnosis),
        aiStrategyRiskWarnings: params.diagnosis.riskWarnings,
        aiStrategyFallbackReason: params.diagnosis.aiFallbackReason,
        aiFallbackReason: params.diagnosis.aiFallbackReason,
        aiEvidenceRefs: aiDecision?.evidenceRefs,
        aiEvidenceDetails,
        aiReasoningSteps: aiDecision?.reasoningSteps,
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

function resolveEvidenceDetails(
  evidencePack: AiEvidenceItem[],
  refs: string[],
): ActionRecommendation['evidence']['aiEvidenceDetails'] {
  if (!refs.length || !evidencePack.length) return [];
  const byId = new Map(evidencePack.map((item) => [item.evidenceId, item]));
  return refs
    .map((ref) => byId.get(ref))
    .filter((item): item is AiEvidenceItem => Boolean(item))
    .map((item) => ({
      evidenceId: item.evidenceId,
      type: item.type,
      label: item.label,
      dateRange: item.dateRange,
      batchId: item.batchId,
      reportType: item.reportType,
      sourceFile: item.sourceFile,
      sourceRow: item.sourceRow,
      storeName: item.storeName,
      marketplaceCode: item.marketplaceCode,
      asin: item.asin,
      portfolioName: item.portfolioName,
      campaignName: item.campaignName,
      adGroupName: item.adGroupName,
      entityType: item.entityType,
      entityName: item.entityName,
      metrics: item.metrics,
      event: item.event,
      product: item.product,
    }));
}

function findAiDecision(
  aiCandidates: AiReasonedDecision[],
  decision: Pick<MergedAdDecision, 'entityType' | 'entityName' | 'actionType'>,
): AiReasonedDecision | undefined {
  return aiCandidates.find((candidate) => (
    normalize(candidate.entityType) === normalize(decision.entityType)
    && normalize(candidate.entityName) === normalize(decision.entityName)
    && normalize(candidate.actionType) === normalize(decision.actionType)
  ));
}

function thresholdEvidenceRefs(diagnosis: AdStrategyDiagnosisOutput): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(diagnosis.thresholdSuggestions).map(([key, suggestion]) => [
      key,
      suggestion.evidenceRefs || [],
    ]),
  );
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
  evidencePack: AiEvidenceItem[] = [],
  aiDecision?: AiReasonedDecision,
): AdDailyMetrics | undefined {
  const entityName = normalize(decision.entityName);
  const evidenceById = new Map(evidencePack.map((item) => [item.evidenceId, item]));
  const metricEvidence = (aiDecision?.evidenceRefs || [])
    .map((ref) => evidenceById.get(ref))
    .filter((item): item is AiEvidenceItem => item !== undefined && item.type === 'metric');
  for (const evidence of metricEvidence) {
    const sourceFile = normalizeSourcePath(evidence.sourceFile || '');
    const sourceRow = Number(evidence.sourceRow);
    const bySource = metrics.find((metric) => (
      sourceFile.length > 0
      && Number.isFinite(sourceRow)
      && sourceRow > 0
      && normalizeSourcePath(metric.sourceFile || '') === sourceFile
      && Number(metric.sourceRow) === sourceRow
    ));
    if (bySource) return bySource;

    const byAdContext = metrics.find((metric) => (
      evidenceMatchesMetricContext(evidence, metric)
      && metricEntityMatches(metric, entityType, entityName)
    ));
    if (byAdContext) return byAdContext;
  }

  return metrics.find((metric) => {
    return metricEntityMatches(metric, entityType, entityName);
  });
}

function metricEntityMatches(
  metric: AdDailyMetrics,
  entityType: ActionRecommendation['entityType'],
  entityName: string,
): boolean {
  if (entityType === 'search_term') return normalize(metric.searchTerm || '') === entityName;
  if (entityType === 'target') return normalize(metric.targeting || metric.searchTerm || '') === entityName;
  if (entityType === 'campaign') return normalize(metric.campaignName || '') === entityName;
  if (entityType === 'ad_group') return normalize(metric.adGroupName || '') === entityName;
  return false;
}

function evidenceMatchesMetricContext(evidence: AiEvidenceItem, metric: AdDailyMetrics): boolean {
  if (evidence.storeName && metric.storeName && evidence.storeName !== metric.storeName) return false;
  if (evidence.marketplaceCode && metric.marketplaceCode && evidence.marketplaceCode !== metric.marketplaceCode) return false;
  if (evidence.asin && metric.asin && normalize(evidence.asin) !== normalize(metric.asin)) return false;
  if (evidence.campaignName && normalize(evidence.campaignName) !== normalize(metric.campaignName || '')) return false;
  if (evidence.adGroupName && normalize(evidence.adGroupName) !== normalize(metric.adGroupName || '')) return false;
  if (evidence.entityName) {
    const normalizedEntity = normalize(evidence.entityName);
    const metricEntities = [
      metric.searchTerm,
      metric.targeting,
      metric.campaignName,
      metric.adGroupName,
    ].map((value) => normalize(value || ''));
    if (!metricEntities.includes(normalizedEntity)) return false;
  }
  return true;
}

function normalizeSourcePath(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase();
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
