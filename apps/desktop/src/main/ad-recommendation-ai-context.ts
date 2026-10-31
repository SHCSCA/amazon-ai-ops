import { recommendationDecisionIdentity, resolveAiDecisionIdentity, type AdDecisionScope } from './ad-decision-identity';
import type {
  AdStrategyDiagnosisInput,
  AdStrategyDiagnosisOutput,
  AiEvidenceItem,
  AiReasonedDecision,
  ProductStrategyContext,
} from '@amazon-ai-ops/ai-adapter';
import { AdQuantifier, DEFAULT_RULE_CONFIG, adDecisionIdentityKey, type MergedAdDecision, type RuleConfig } from '@amazon-ai-ops/rules-engine';
import type { ActionRecommendation, AdActionType, AdDailyMetrics, CreateOperationEventInput, OperationEvent } from '@amazon-ai-ops/shared-types';
import { buildAdProductHistoryQuality, type AdProductHistoryQuality } from './ad-product-history-quality';

export interface RecommendationDiagnosisScope {
  storeId?: string;
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
  productHistoryQuality?: AdProductHistoryQuality;
}

export interface AnnotateRecommendationsWithStrategyParams {
  identityScope?: AdDecisionScope;
  identityMetrics?: AdDailyMetrics[];
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
    productHistoryLedgers: [],
    productHistoryQuality: params.productHistoryQuality || buildAdProductHistoryQuality(params.scope, params.metrics),
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
  return params.recommendations.map((recommendation, recommendationIndex) => {
    const matchingDecisions = params.decisions.filter((item) => matchesRecommendation(item, recommendation, params.identityScope) && item.ruleCandidateIndex === recommendationIndex);
    const matched = matchingDecisions[0];
    const matchedAi = matched ? findAiDecision(params.diagnosis.aiCandidates, matched) : undefined;
    const aiIdentity = matchedAi && params.identityScope && params.identityMetrics
      ? resolveAiDecisionIdentity(matchedAi, params.recommendations, params.identityMetrics, params.evidencePack || [], params.identityScope)
      : undefined;
    const recommendationKey = adDecisionIdentityKey({ ...recommendation, identity: recommendationDecisionIdentity(recommendation, params.identityScope) });
    const duplicateRules = params.recommendations.filter((item) => recommendationKey
      ? recommendationKey === adDecisionIdentityKey({ ...item, identity: recommendationDecisionIdentity(item, params.identityScope) })
      : normalize(item.entityType) === normalize(recommendation.entityType) && normalize(item.entityName) === normalize(recommendation.entityName)).length > 1;
    const ruleOnlyWithoutAi = !duplicateRules && params.diagnosis.aiCandidates.length === 0 && params.decisions.every((item) => item.source === 'rule');
    const hasAmbiguousDecision = !ruleOnlyWithoutAi && (matchingDecisions.length !== 1
      || (matched && (matched.recommendedValue?.trim() || undefined) !== (recommendation.recommendedValue?.trim() || undefined))
      || (matched && matched.source !== 'rule' && (!aiIdentity
        || adDecisionIdentityKey({ ...matched, identity: aiIdentity }) !== adDecisionIdentityKey(matched)))
      || (matchingDecisions.length === 1 && matchingDecisions[0].source !== 'rule'
        && (!findAiDecision(params.diagnosis.aiCandidates, matchingDecisions[0])
          || params.decisions.filter((item) => item.aiCandidateIndex === matchingDecisions[0].aiCandidateIndex).length !== 1))
      || (matchingDecisions.length === 1
        && params.recommendations.filter((item) => matchesRecommendation(matchingDecisions[0], item, params.identityScope)).length > 1));
    // 缺少唯一身份时不猜测归属，保留原建议并交由复核。
    const decision = hasAmbiguousDecision || ruleOnlyWithoutAi ? undefined : matchingDecisions[0];
    const aiDecision = decision ? findAiDecision(params.diagnosis.aiCandidates, decision) : undefined;
    const aiEvidenceDetails = resolveEvidenceDetails(params.evidencePack || [], aiDecision?.evidenceRefs || []);
    const lifecycleEvidenceDetails = resolveEvidenceDetails(
      params.evidencePack || [],
      params.diagnosis.lifecycleStageEvidenceRefs,
    );
    const productContext = findProductContext(params.productContexts || [], recommendation.asin || recommendation.evidence?.asin);
    const aiActionParticipated = Boolean(decision && (decision.agreement === 'aligned' || decision.agreement === 'ai_only'));
    const needsStrategyReview = Boolean(
      hasAmbiguousDecision
      || (aiActionParticipated && params.diagnosis.lifecycleStageRequiresReview)
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
        decisionRiskWarnings: hasAmbiguousDecision
          ? ['对象身份缺失、冲突或非一对一，无法安全匹配规则/AI 决策，必须人工复核。']
          : decision?.riskWarnings ?? recommendation.evidence.decisionRiskWarnings,
        decisionRequiresReview: Boolean(hasAmbiguousDecision || decision?.requiresReview || recommendation.evidence.decisionRequiresReview),
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
    if (decision.agreement !== 'ai_only' || !adDecisionIdentityKey(decision)) continue;
    const identity = decision.identity!;
    if (identity.storeId !== params.scope.storeId || identity.storeName !== params.scope.storeName || identity.marketplaceCode !== params.scope.marketplaceCode
      || (params.scope.asin && identity.asin !== params.scope.asin) || identity.batchId !== params.scope.batchId
      || identity.dateFrom !== params.scope.dateFrom || identity.dateTo !== params.scope.dateTo) continue;
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
      entityId: decision.identity!.nativeEntityId || '',
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
  decision: MergedAdDecision,
): AiReasonedDecision | undefined {
  if (!Number.isSafeInteger(decision.aiCandidateIndex) || decision.aiCandidateIndex! < 0) return undefined;
  const candidate = aiCandidates[decision.aiCandidateIndex!];
  if (!candidate || candidate.entityType !== decision.entityType || candidate.entityName !== decision.entityName
    || normalize(candidate.actionType) !== normalize(decision.actionType)) return undefined;
  if (decision.agreement === 'aligned'
    && (candidate.recommendedValue?.trim() || undefined) !== (decision.recommendedValue?.trim() || undefined)) return undefined;
  return candidate;
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

function matchesRecommendation(decision: MergedAdDecision, recommendation: ActionRecommendation, scope?: AdDecisionScope): boolean {
  const identity = recommendationDecisionIdentity(recommendation, scope);
  const key = adDecisionIdentityKey({ ...recommendation, identity });
  return Boolean(key && key === adDecisionIdentityKey(decision)
    && normalize(decision.actionType) === normalize(recommendation.actionType));
}

function findMetricForDecision(
  metrics: AdDailyMetrics[],
  decision: MergedAdDecision,
  entityType: ActionRecommendation['entityType'],
  evidencePack: AiEvidenceItem[] = [],
  aiDecision?: AiReasonedDecision,
): AdDailyMetrics | undefined {
  const identity = decision.identity;
  if (!identity || !adDecisionIdentityKey(decision) || !aiDecision) return undefined;
  const matches: AdDailyMetrics[] = [];
  for (const ref of new Set(aiDecision.evidenceRefs)) {
    const evidenceMatches = evidencePack.filter((item) => item.evidenceId === ref);
    if (evidenceMatches.length !== 1) return undefined;
    const evidence = evidenceMatches[0];
    if (evidence.type !== 'metric') continue;
    if (evidence.storeName !== identity.storeName || evidence.marketplaceCode !== identity.marketplaceCode
      || evidence.asin !== identity.asin || evidence.batchId !== identity.batchId
      || evidence.campaignName !== identity.campaignName || evidence.adGroupName !== identity.adGroupName) return undefined;
    if ((evidence.reportType || 'unknown_report') !== (identity.reportType || 'unknown_report') || evidence.sourceFile !== identity.sourceFile || evidence.sourceRow !== identity.sourceRow
      || evidence.dateRange !== `${identity.metricDate}~${identity.metricDate}`) return undefined;
    const rows = metrics.filter((metric) => metric.sourceFile === evidence.sourceFile
      && metric.sourceRow === evidence.sourceRow && Number.isSafeInteger(metric.sourceRow) && Number(metric.sourceRow) > 0
      && metric.storeName === identity.storeName && metric.marketplaceCode === identity.marketplaceCode
      && metric.asin === identity.asin && metric.batchId === identity.batchId && metric.date === identity.metricDate && metric.reportType === identity.reportType
      && metric.campaignName === identity.campaignName && metric.adGroupName === identity.adGroupName
      && metric.matchType === identity.matchType && metricEntityMatches(metric, entityType, normalize(decision.entityName)));
    if (rows.length !== 1) return undefined;
    const row = rows[0];
    const evidenceType = row.searchTerm ? 'search_term' : row.targeting ? 'target' : row.adGroupName ? 'ad_group' : 'campaign';
    if (evidence.entityType !== evidenceType || evidence.entityName !== (row.searchTerm || row.targeting || row.adGroupName || row.campaignName)
      || ('storeId' in row && row.storeId !== identity.storeId) || ('storeId' in evidence && evidence.storeId !== identity.storeId)) return undefined;
    matches.push(row);
  }
  return matches.length && matches.every((metric) => metric === matches[0]) ? matches[0] : undefined;
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
