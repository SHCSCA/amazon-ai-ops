import { countMetricsWithSourceRow, countMetricsWithSourceFileAndRow, countMetricsWithAsin } from './business-metric-projection';
import { parseIntegerSetting } from './main-value-coercion';
import * as crypto from 'crypto';
import { RecommendationGenerator } from '@amazon-ai-ops/rules-engine';
import { AdStrategyDiagnoser, assessAdEvidenceSufficiency, type AdStrategyDiagnosisOutput, type AiEvidenceItem } from '@amazon-ai-ops/ai-adapter';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import type { RuleConfig } from '@amazon-ai-ops/rules-engine';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { runtimeLog } from './runtime-log-adapter';
import { applyCurrentKeywordBids } from './recommendation-live-bid';
import { bindRecommendationsToScopeAsin, buildAdStrategyDiagnosisInput } from './ad-recommendation-ai-context';
import { buildAdAiEvidencePack, summarizeAiEvidencePack } from './ad-ai-evidence-pack';
import { validateAiDiagnosisEvidence } from './ad-ai-evidence-validator';
import { loadProductHistoryObservation } from './ad-product-history-source-runtime';
import { assertRecommendationMetricsLoaded, filterFormalRecommendationMetrics } from './recommendation-generation-gate';
import { buildAdActionReasonAiCallLogInput, type AdActionExplanationForLog } from './ad-action-ai-call-log';
import { assertRuntimeAnalysisWindow, assertRuntimeConfigStore } from './store-runtime-analysis-config';
import { buildAiProviderConfig, governedAiProvider, normalizeAiSettings, readAiSettingsForMain } from './main-ai-settings-runtime';
import { resolveBusinessStoreAuthority } from './main-business-scope-runtime';
import { getBusinessRecommendationGate, loadBusinessRecommendationMetrics } from './main-business-metrics-runtime';
import { currentStoreRuntimeAnalysisConfig } from './main-store-access-runtime';
import { createRecommendationBidReader } from './main-operator-browser-runtime';
import { buildAiInsightsFromValidation, loadProductStrategyContexts, recordAdStrategyAiCallLog, selectStrategyEvidencePreview, summarizeStrategyDiagnosis } from './main-ad-strategy-enrichment-runtime';
import type { AdStrategyGenerationSummary, AiEvidencePackSummary, AiInsightSummary } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function recordAdActionReasonAiCallLog(input: {
  recommendation: ActionRecommendation;
  explanation: AdActionExplanationForLog;
  model: string;
}, capturedStoreId: StoreContextEnvelope['storeId']): void {
  const mainRuntimeContext = getMainRuntimeContext();
  try {
    mainRuntimeContext.state.aiCallLogRepo?.insertForStore(capturedStoreId, buildAdActionReasonAiCallLogInput(input));
  } catch (error) {
    runtimeLog.warn('[AI] Failed to write ad action reason log', error);
  }
}

export function recordAdStrategyDiagnosisRun(capturedStoreId: StoreContextEnvelope['storeId'], input: {
  diagnosis: AdStrategyDiagnosisOutput;
  settings: ReturnType<typeof normalizeAiSettings>;
  scope: Record<string, unknown>;
  evidencePackSummary?: AiEvidencePackSummary;
  evidencePackPreview?: AiEvidenceItem[];
  aiInsights: AiInsightSummary[];
  formalRecommendationCount: number;
}): void {
  const mainRuntimeContext = getMainRuntimeContext();
  try {
    mainRuntimeContext.state.aiDiagnosisRunRepo?.insertForStore(capturedStoreId, {
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: input.settings.aiModel,
      scope: input.scope,
      evidencePackSummary: input.evidencePackSummary,
      evidencePackPreview: input.evidencePackPreview,
      diagnosis: {
        schemaVersion: input.diagnosis.schemaVersion,
        source: input.diagnosis.source,
        lifecycleStage: input.diagnosis.lifecycleStage,
        lifecycleStageReason: input.diagnosis.lifecycleStageReason,
        lifecycleStageEvidenceRefs: input.diagnosis.lifecycleStageEvidenceRefs,
        lifecycleStageRequiresReview: input.diagnosis.lifecycleStageRequiresReview,
        lifecycleStageInvalidReasons: input.diagnosis.lifecycleStageInvalidReasons,
        summary: input.diagnosis.summary,
        mainProblems: input.diagnosis.mainProblems,
        thresholdSuggestions: input.diagnosis.thresholdSuggestions,
        aiCandidateCount: input.diagnosis.aiCandidates.length,
        riskWarnings: input.diagnosis.riskWarnings,
        aiFallbackReason: input.diagnosis.aiFallbackReason,
      },
      insights: input.aiInsights,
      formalRecommendationCount: input.formalRecommendationCount,
      success: input.diagnosis.source === 'ai' && !input.diagnosis.aiFallbackReason,
      errorMessage: input.diagnosis.aiFallbackReason,
    });
  } catch (error) {
    runtimeLog.warn('[AI] Failed to write ad strategy diagnosis run', error);
  }
}

export function handleListAiDiagnosisRuns(request: any = {}) {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.aiDiagnosisRunRepo) return [];
  const { context } = resolveBusinessStoreAuthority();
  const limit = Number.isFinite(Number(request.limit)) ? Math.max(1, Math.min(20, Number(request.limit))) : 5;
  return mainRuntimeContext.state.aiDiagnosisRunRepo.findRecentForStore(context.storeId, {
    dateFrom: typeof request.dateFrom === 'string' && request.dateFrom.trim() ? request.dateFrom.trim() : undefined,
    dateTo: typeof request.dateTo === 'string' && request.dateTo.trim() ? request.dateTo.trim() : undefined,
    marketplaceCode: typeof request.marketplaceCode === 'string' && request.marketplaceCode.trim() ? request.marketplaceCode.trim() : undefined,
    asin: typeof request.asin === 'string' && request.asin.trim() ? request.asin.trim() : undefined,
    batchId: typeof request.batchId === 'string' && request.batchId.trim() ? request.batchId.trim() : undefined,
    limit,
  });
}

export function hashAiDiagnosisInput(
  input: ReturnType<typeof buildAdStrategyDiagnosisInput>,
  evidencePackSummary?: AiEvidencePackSummary,
): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      scope: input.scope,
      currentRuleConfig: input.currentRuleConfig,
      metricCount: input.metrics.length,
      operationEventCount: input.operationEvents.length,
      productContextCount: input.productContexts?.length || 0,
      ruleCandidateCount: input.ruleCandidates.length,
      evidencePackSummary,
    }))
    .digest('hex');
}

export async function handleRunAdStrategyDiagnosis(request: any = {}): Promise<{
  configured: boolean;
  invoked: boolean;
  model: string;
  metrics: number;
  ruleCandidateCount: number;
  summary: AdStrategyGenerationSummary;
}> {
  const mainRuntimeContext = getMainRuntimeContext();
  const capturedAuthority = resolveBusinessStoreAuthority(request?.storeContext);
  const scope = {
    dateFrom: typeof request.dateFrom === 'string' && request.dateFrom.trim() ? request.dateFrom.trim() : undefined,
    dateTo: typeof request.dateTo === 'string' && request.dateTo.trim() ? request.dateTo.trim() : undefined,
    storeName: capturedAuthority.store.displayName,
    marketplaceCode: 'US' as const,
    storeContext: capturedAuthority.context,
    asin: typeof request.asin === 'string' && request.asin.trim() ? request.asin.trim() : undefined,
    batchId: typeof request.batchId === 'string' && request.batchId.trim() ? request.batchId.trim() : undefined,
  };
  if (!scope.dateFrom || !scope.dateTo) {
    throw new Error('AI 阶段诊断需要明确当前操作范围：开始日期和结束日期。');
  }

  const gate = getBusinessRecommendationGate(scope, 'diagnosis');
  const limit = Number.isFinite(Number(request.limit)) ? Math.max(1, Math.min(1000, Number(request.limit))) : 300;
  const metrics = filterFormalRecommendationMetrics(
    loadBusinessRecommendationMetrics(gate.scope, gate.metricSource, Math.max(limit, mainRuntimeContext.RECOMMENDATION_METRIC_LOAD_LIMIT)),
    gate.scope.asin,
  );
  assertRecommendationMetricsLoaded({
    metricsLength: metrics.length,
    realReportFileCount: gate.pipeline.collection.fileAudit.realReportFileCount,
    requiredReportCount: LINGXING_AD_REPORTS.length,
    sourceFileCount: gate.metricSource.sourceFiles.length,
    sourceRowCount: countMetricsWithSourceRow(metrics),
    sourceFileRowCount: countMetricsWithSourceFileAndRow(metrics),
    asinBoundCount: countMetricsWithAsin(metrics),
    scopeAsin: gate.scope.asin,
    importedRows: gate.pipeline.collection.fileAudit.importedRowCount,
  });

  const runtimeConfig = currentStoreRuntimeAnalysisConfig();
  assertRuntimeConfigStore(runtimeConfig, gate.scope.storeId);
  assertRuntimeAnalysisWindow(runtimeConfig, gate.scope.dateFrom, gate.scope.dateTo);
  const generator = new RecommendationGenerator(runtimeConfig.ruleConfig);
  const firstMetric = metrics[0];
  const ruleCandidates = await applyCurrentKeywordBids(bindRecommendationsToScopeAsin(generator.generateTimelineBatch(metrics, {
    storeName: scope.storeName || firstMetric?.storeName || mainRuntimeContext.state.currentStore || 'unknown',
    marketplaceCode: scope.marketplaceCode || firstMetric?.marketplaceCode || 'US',
    config: runtimeConfig.ruleConfig,
    taskId: `strategy_${Date.now()}`,
  }), gate.scope.asin), createRecommendationBidReader(resolveBusinessStoreAuthority().context), runtimeConfig.ruleConfig, true);
  const operationEvents = mainRuntimeContext.state.operationEventRepo?.findByScopeForStore(gate.scope.storeId, {
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    limit: 100,
  }) || [];
  const productContexts = loadProductStrategyContexts(gate.scope);
  const productHistoryQuality = loadProductHistoryObservation(mainRuntimeContext.state.db, gate.scope, gate.metricSource);
  const evidencePack = buildAdAiEvidencePack({
    scope: {
      dateFrom: gate.scope.dateFrom,
      dateTo: gate.scope.dateTo,
      storeName: gate.scope.storeName,
      marketplaceCode: gate.scope.marketplaceCode,
      asin: gate.scope.asin,
      batchId: gate.scope.batchId,
    },
    metrics,
    operationEvents,
    productContexts,
    ruleRecommendations: ruleCandidates,
    productHistoryQuality,
  });
  const evidencePackSummary = summarizeAiEvidencePack(evidencePack);
  const diagnosisInput = buildAdStrategyDiagnosisInput({
    scope: gate.scope,
    metrics,
    operationEvents,
    productContexts,
    ruleConfig: runtimeConfig.ruleConfig as RuleConfig & { minSpend?: number },
    recommendations: ruleCandidates,
    evidencePack,
    productHistoryQuality,
  });
  const settings = readAiSettingsForMain();
  const fallbackDiagnosis: AdStrategyDiagnosisOutput = {
    schemaVersion: 'ad_strategy_diagnosis_v1',
    evidenceSufficiency: assessAdEvidenceSufficiency(diagnosisInput),
    lifecycleStage: 'unknown',
    lifecycleStageReason: runtimeConfig.values.aiRecommendationsEnabled
      ? '未配置 AI Key，不能执行 AI 阶段判断。'
      : '当前店铺已关闭 AI 建议，不能执行 AI 阶段判断。',
    lifecycleStageEvidenceRefs: [],
    summary: runtimeConfig.values.aiRecommendationsEnabled
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
    source: 'rule',
    aiFallbackReason: runtimeConfig.values.aiRecommendationsEnabled
      ? '未配置 AI Key，广告阶段诊断使用规则 fallback'
      : '当前店铺已关闭 AI 建议，广告阶段诊断使用规则 fallback',
  };
  const diagnosis = runtimeConfig.values.aiRecommendationsEnabled && settings.aiApiKey
    ? await new AdStrategyDiagnoser(governedAiProvider(buildAiProviderConfig(settings), capturedAuthority.context, 'strategy_analysis'), {
        persona: settings.aiPersona,
        outputLanguage: settings.aiOutputLanguage,
        maxTokens: parseIntegerSetting(settings.aiMaxTokens || settings.ai_max_tokens, 8192),
      }).diagnose(diagnosisInput)
    : fallbackDiagnosis;
  recordAdStrategyAiCallLog(gate.scope.storeId, diagnosisInput, diagnosis, settings, evidencePackSummary);
  const validation = validateAiDiagnosisEvidence({
    diagnosis,
    evidencePack,
    scope: gate.scope,
  });
  const aiInsights = buildAiInsightsFromValidation(diagnosis, validation.invalidReasons);
  const mergeDiagnosis: AdStrategyDiagnosisOutput = {
    ...diagnosis,
    aiCandidates: diagnosis.aiCandidates.filter((_, index) => validation.validCandidateIndexes.includes(index)),
  };
  const evidencePackPreview = selectStrategyEvidencePreview(mergeDiagnosis, aiInsights, evidencePack);
  recordAdStrategyDiagnosisRun(gate.scope.storeId, {
    diagnosis: mergeDiagnosis,
    settings,
    scope: gate.scope,
    evidencePackSummary,
    evidencePackPreview,
    aiInsights,
    formalRecommendationCount: 0,
  });

  return {
    configured: runtimeConfig.values.aiRecommendationsEnabled && Boolean(settings.aiApiKey),
    invoked: runtimeConfig.values.aiRecommendationsEnabled && Boolean(settings.aiApiKey),
    model: settings.aiModel,
    metrics: metrics.length,
    ruleCandidateCount: ruleCandidates.length,
    summary: summarizeStrategyDiagnosis(mergeDiagnosis, operationEvents.length, productContexts.length, aiInsights, evidencePackSummary, evidencePackPreview),
  };
}
