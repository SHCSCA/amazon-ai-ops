import { useEffect,useMemo,useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { buildDecisionEvidenceSummary } from '../evidence-display';
import { countProductsWithTargets,normalizeProductContexts,pickPrimaryProductContext } from '../product-context';
import { buildRecommendationGateIssues,resolveRecommendationBatchId } from '../recommendation-readiness';
import { importedReportTypeCoverageCount,realReportCoverageCount } from '../report-coverage';
import { rendererRuntimeLog } from '../runtime-log';
import type { AiProviderSettings,AppRoute,RecommendationView,SettingsRuleConfig } from '../types';
import {
type GenerateAiSummary,
aiReadinessFromSettings,
emptyRecommendationReason,
normalizeAiSettings
} from './recommendation-ai-status';
import {
recommendationCanEnterFormalApproval,
recommendationHasEvidenceBlocker,
recommendationNeedsOperatorResolution,
recommendationRequiresManualReview
} from './recommendation-evidence';
import {
errorMessage,
eventMatchesRecommendation
} from './recommendation-labels';
import {
APPROVAL_SELECTION_STORAGE_KEY,
type RecommendationBucketFilter,
recommendationActionButtonView,
recommendationBatchSelectionState,
recommendationMatchesBucketFilter,
recommendationPrimaryTaskActionState,
recommendationStatusFiltersForPage,
recommendationWorkflowActionState,
runRecommendationWorkflowMutation,
} from './recommendation-selection';

export function useRecommendationsPage() {

  const { data, loading: pipelineLoading, reload: reloadPipeline, scope, configurationRequired } = useBusinessDataPipeline();
  const [recommendations, setRecommendations] = useState<RecommendationView[]>([]);
  const [selected, setSelected] = useState<RecommendationView | null>(null);
  const [ruleConfig, setRuleConfig] = useState<SettingsRuleConfig | null>(null);
  const [aiSettings, setAiSettings] = useState<AiProviderSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastGenerateResult, setLastGenerateResult] = useState<GenerateAiSummary | null>(null);
  const [selectedRecommendationIds, setSelectedRecommendationIds] = useState<Set<string>>(() => new Set());
  const [bucketFilter, setBucketFilter] = useState<RecommendationBucketFilter>('all');
  const currentBatchId = resolveRecommendationBatchId({
    scopeBatchId: scope.batchId,
    latestBatchId: data?.collection.latestBatch?.id,
    sourceBatchIds: data?.collection.sourceBatchIds,
  });
  const importedRowCount = data?.collection.fileAudit?.importedRowCount ?? data?.quant.importedRows ?? 0;
  const realReportCount = realReportCoverageCount(data?.collection);
  const importedReportTypeCount = importedReportTypeCoverageCount(data?.collection);
  const currentRealReportSourceFiles = useMemo(
    () => (data?.collection.realReportFiles || [])
      .map((file) => file.artifactDisplayName || file.fileName || file.displayName)
      .filter(Boolean),
    [data?.collection.realReportFiles],
  );
  const actionableMetricRows = data?.quant.actionableRows ?? 0;
  const diagnosticCount = data?.quant.diagnostics?.length ?? 0;
  const timelineCount = data?.quant.adObjectTimelines?.length ?? 0;
  const recommendationGateIssues = useMemo(() => {
    const issues = new Set<string>();
    if (configurationRequired) {
      issues.add('当前店铺运行配置待创建，当前业务数据尚未读取');
      return Array.from(issues);
    }
    if (!data) {
      issues.add('正在读取当前业务范围的数据状态');
      return Array.from(issues);
    }
    return buildRecommendationGateIssues({
      requiredReportCount: 8,
      realReportFileCount: realReportCount,
      realReportFilesLength: data.collection.realReportFiles.length,
      importedReportTypeCount,
      importedRowCount,
      quantImportedRows: data.quant.importedRows,
      hasImportedMetrics: data.quant.hasImportedMetrics,
      currentBatchId,
      collectionBlockers: data.collection.blockers || [],
      quantBlockers: data.quant.blockers || [],
    });
  }, [configurationRequired, currentBatchId, data, importedReportTypeCount, importedRowCount, realReportCount]);
  const quantReady = Boolean(data && recommendationGateIssues.length === 0);
  const operationEvents = data?.operations?.events || [];
  const productContexts = normalizeProductContexts(data?.productContext?.products);
  const productContextCount = data?.productContext?.productCount ?? productContexts.length;
  const productWithTargetCount = countProductsWithTargets(productContexts);
  const primaryProductContext = pickPrimaryProductContext(productContexts, scope.asin);
  const latestOperationEvent = [...operationEvents].sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')))[0];
  const aiTextCount = recommendations.filter((item) => item.evidence?.explanationSource === 'ai').length;
  const aiStrategyCount = recommendations.filter((item) => item.evidence?.aiStrategySource === 'ai').length;
  const aiParticipatedCount = recommendations.filter((item) => item.evidence?.explanationSource === 'ai' || item.evidence?.aiStrategySource === 'ai').length;
  const ruleOnlyCount = recommendations.length - aiParticipatedCount;
  const alignedCount = recommendations.filter((item) => item.evidence?.decisionAgreement === 'aligned').length;
  const conflictCount = recommendations.filter((item) => item.evidence?.decisionAgreement === 'conflict').length;
  const aiOnlyCount = recommendations.filter((item) => item.evidence?.decisionAgreement === 'ai_only').length;
  const wasteCount = recommendations.filter((item) => item.evidence?.quantStatus === 'waste').length;
  const totalPendingSpend = recommendations.reduce((sum, item) => sum + Number(item.evidence?.cost ?? item.cost ?? 0), 0);
  const highRiskCount = recommendations.filter((item) => ['high', 'APPROVAL', 'HIGH'].includes(String(item.riskLevel))).length;
  const formalApprovalCount = recommendations.filter((item) => recommendationCanEnterFormalApproval(item, currentBatchId, currentRealReportSourceFiles)).length;
  const manualReviewCount = recommendations.filter((item) => recommendationRequiresManualReview(item, currentBatchId, currentRealReportSourceFiles)).length;
  const evidenceBlockedCount = recommendations.filter((item) => recommendationHasEvidenceBlocker(item, currentBatchId, currentRealReportSourceFiles)).length;
  const operatorResolutionCount = recommendations.filter((item) => recommendationNeedsOperatorResolution(item, currentBatchId, currentRealReportSourceFiles)).length;
  const workflowActionState = recommendationWorkflowActionState({
    recommendationCount: recommendations.length,
    formalApprovalCount,
    manualReviewCount,
    evidenceBlockedCount,
  });
  const primaryTaskAction = recommendationPrimaryTaskActionState({
    quantReady,
    recommendationCount: recommendations.length,
    formalApprovalCount,
    manualReviewCount,
    evidenceBlockedCount,
    realReportCount,
    importedRowCount,
    actionableMetricRows,
    generating,
    pipelineLoading,
  });
  const insightOnlyCount = Math.max(
    recommendations.filter((item) => item.evidence?.aiInsightOnly).length,
    Number(lastGenerateResult?.strategy?.insightOnlyCandidateCount || 0),
    Number(lastGenerateResult?.strategy?.filteredAiOnlyCandidateCount || 0),
    Array.isArray(lastGenerateResult?.strategy?.aiInsights) ? lastGenerateResult.strategy.aiInsights.length : 0,
  );
  const insightOnlyReasons = [
    ...(lastGenerateResult?.strategy?.aiInsights || []).flatMap((item) => item.invalidReasons || []),
    ...(lastGenerateResult?.strategy?.filterReasons || []),
  ].filter(Boolean);
  const aiReadiness = aiReadinessFromSettings(aiSettings);
  const emptyReason = emptyRecommendationReason(quantReady, lastGenerateResult, aiReadiness, recommendationGateIssues);
  const noFormalAiDiagnosis = useMemo(() => {
    if (!quantReady || recommendations.length || !lastGenerateResult) return null;
    const strategy = lastGenerateResult.strategy;
    const aiWasUsed = lastGenerateResult.invoked || strategy?.source === 'ai';
    if (!aiWasUsed || lastGenerateResult.finalActionCount > 0) return null;
    const reasons = Array.from(new Set([
      ...(strategy?.filterReasons || []),
      ...(strategy?.aiInsights || []).flatMap((item) => item.invalidReasons || []),
      !lastGenerateResult.aiCandidateCount ? 'AI 没有返回可审批动作候选。' : '',
    ].filter(Boolean)));
    return {
      summary: strategy?.summary || lastGenerateResult.reason || 'AI 已完成诊断，但未返回可进入审批的广告动作。',
      reasons: reasons.length ? reasons : ['规则和 AI 完成诊断，但没有找到足够明确、可绑定广告活动/广告组/对象的动作。'],
      insights: strategy?.aiInsights || [],
      nextStep: '回到广告表现页复核风险对象、样本量和规则阈值；必要时补充运营事件或产品配置后重新生成。',
    };
  }, [lastGenerateResult, quantReady, recommendations.length]);
  const visibleRecommendations = useMemo(
    () => recommendations.filter((item) => recommendationMatchesBucketFilter(item, bucketFilter, currentBatchId, currentRealReportSourceFiles)),
    [bucketFilter, currentBatchId, currentRealReportSourceFiles, recommendations],
  );
  const visibleFormalApprovalRecommendations = useMemo(
    () => visibleRecommendations.filter((item) => recommendationCanEnterFormalApproval(item, currentBatchId, currentRealReportSourceFiles)),
    [currentBatchId, currentRealReportSourceFiles, visibleRecommendations],
  );
  const visibleFormalApprovalIdSet = useMemo(
    () => new Set(visibleFormalApprovalRecommendations.map((item) => String(item.id))),
    [visibleFormalApprovalRecommendations],
  );
  const selectedVisibleFormalRecommendations = useMemo(
    () => visibleFormalApprovalRecommendations.filter((item) => selectedRecommendationIds.has(String(item.id))),
    [selectedRecommendationIds, visibleFormalApprovalRecommendations],
  );
  const batchSelectionState = recommendationBatchSelectionState({
    selectableCount: visibleFormalApprovalRecommendations.length,
    selectedCount: selectedVisibleFormalRecommendations.length,
  });
  const showApprovalSelection = visibleFormalApprovalRecommendations.length > 0;
  const compactRecommendationTableColSpan = showApprovalSelection ? 9 : 8;
  const activeBucketLabel: Record<RecommendationBucketFilter, string> = {
    all: '全部建议',
    blocked: '高风险强阻断',
    review: '需人工复核',
    ready: '已就绪可批准',
  };
  const bucketItems: Array<{
    filter: RecommendationBucketFilter;
    label: string;
    value: string;
    detail: string;
    tone: 'ready' | 'pending' | 'blocked' | 'warning';
  }> = [
    {
      filter: 'all',
      label: '全部建议',
      value: `${recommendations.length} 条`,
      detail: '清除快速筛选，回到完整建议池',
      tone: recommendations.length > 0 ? 'pending' : 'blocked',
    },
    {
      filter: 'blocked',
      label: '高风险强阻断',
      value: `缺证据 ${evidenceBlockedCount}`,
      detail: '缺批次、来源或可回查证据',
      tone: evidenceBlockedCount > 0 ? 'blocked' : 'ready',
    },
    {
      filter: 'review',
      label: '需人工复核',
      value: `需复核 ${manualReviewCount}`,
      detail: 'AI 独立洞察或规则冲突',
      tone: manualReviewCount > 0 ? 'warning' : 'pending',
    },
    {
      filter: 'ready',
      label: '已就绪可批准',
      value: `可审批 ${formalApprovalCount}`,
      detail: `${recommendations.length} 条建议 / ${realReportCount}/8 类报表`,
      tone: formalApprovalCount > 0 ? 'ready' : recommendations.length ? 'warning' : 'pending',
    },
  ];
  const topRecommendation = [...recommendations].sort((a, b) => {
    const riskDelta = Number(['high', 'APPROVAL', 'HIGH'].includes(String(b.riskLevel))) - Number(['high', 'APPROVAL', 'HIGH'].includes(String(a.riskLevel)));
    if (riskDelta !== 0) return riskDelta;
    return Number(b.evidence?.cost ?? b.cost ?? 0) - Number(a.evidence?.cost ?? a.cost ?? 0);
  })[0];
  const selectedOperationEvents = selected
    ? operationEvents.filter((event) => eventMatchesRecommendation(event, selected)).slice(0, 4)
    : [];
  const selectedDecisionSummary = useMemo(
    () => buildDecisionEvidenceSummary(selected?.evidence),
    [selected],
  );

  const filter = useMemo(() => ({
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    batchId: currentBatchId,
    limit: 100,
  }), [currentBatchId, scope.asin, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);

  async function loadRecommendations(invalidateWorkflow = false) {
    setLoading(true);
    setMessage(null);
    try {
      const getRecommendations = (window as any).electronAPI?.getRecommendations;
      const fetchRows = async () => typeof getRecommendations === 'function'
        ? Promise.all(recommendationStatusFiltersForPage().map((status) => getRecommendations({ ...filter, status })))
        : [];
      const rowGroups = invalidateWorkflow && typeof getRecommendations === 'function'
        ? await runRecommendationWorkflowMutation('refresh', fetchRows)
        : await fetchRows();
      const byId = new Map<number | string, RecommendationView>();
      for (const rows of rowGroups) {
        for (const row of Array.isArray(rows) ? rows : []) {
          byId.set(row.id, row);
        }
      }
      const nextRows = Array.from(byId.values());
      setRecommendations(nextRows);
      setSelected((current) => (current && nextRows.some((row) => row.id === current.id) ? current : null));
      setSelectedRecommendationIds((current) => {
        const nextRowIds = new Set(nextRows.map((row) => String(row.id)));
        const next = new Set<string>();
        for (const id of current) {
          if (nextRowIds.has(id)) next.add(id);
        }
        return next;
      });
    } catch (caught) {
      rendererRuntimeLog.error('renderer.recommendations_load_failed', { error: caught });
      setMessage(errorMessage(caught, '加载优化建议失败'));
    } finally {
      setLoading(false);
    }
  }

  function refreshRecommendations() {
    void loadRecommendations(true);
  }

  async function generateRecommendations() {
    if (configurationRequired) {
      setMessage('当前店铺运行配置待创建，当前业务数据尚未读取；新建议生成保持锁定。');
      return;
    }
    if (!quantReady) {
      setMessage(`建议生成被锁定：${recommendationGateIssues.length ? recommendationGateIssues.join('；') : '当前范围缺少真实原始报表文件或导入指标'}。`);
      return;
    }
    setGenerating(true);
    setMessage(null);
    try {
      const generateRecommendationsApi = (window as any).electronAPI?.generateRecommendations;
      if (typeof generateRecommendationsApi !== 'function') {
        throw new Error('建议生成接口未暴露。');
      }
      const result = await runRecommendationWorkflowMutation<any>('generate', () => generateRecommendationsApi({
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
        asin: scope.asin,
        batchId: currentBatchId,
        limit: 300,
      }));
      await reloadPipeline();
      await loadRecommendations();
      const generated = Number(result?.generated ?? 0);
      const metrics = Number(result?.metrics ?? 0);
      const candidates = Number(result?.recommendationCandidates ?? generated);
      const skipped = Number(result?.skippedDuplicates ?? 0);
      const refreshed = Number(result?.refreshedDuplicates ?? 0);
      const aiExplanation = result?.aiExplanation || {};
      const strategyDiagnosis = aiExplanation.strategyDiagnosis && typeof aiExplanation.strategyDiagnosis === 'object'
        ? aiExplanation.strategyDiagnosis
        : undefined;
      const aiReason = aiExplanation.reason ? ` ${aiExplanation.reason}` : '';
      const duplicateNote = skipped > 0 ? ` 另有 ${skipped} 条重复建议已跳过。` : '';
      const refreshNote = refreshed > 0 ? ` 已刷新 ${refreshed} 条历史不完整建议。` : '';
      setLastGenerateResult({
        generated,
        metrics,
        candidates,
        skipped,
        refreshed,
        configured: Boolean(aiExplanation.configured),
        invoked: Boolean(aiExplanation.invoked),
        aiCount: Number(aiExplanation.aiCount || 0),
        ruleCount: Number(aiExplanation.ruleCount || 0),
        model: typeof aiExplanation.model === 'string' ? aiExplanation.model : undefined,
        reason: typeof aiExplanation.reason === 'string' ? aiExplanation.reason : '本次生成未返回 AI 参与说明。',
        aiCandidateCount: Number(strategyDiagnosis?.aiCandidateCount || 0),
        finalActionCount: generated + skipped + refreshed,
        strategy: strategyDiagnosis,
      });
      const aiCandidateCount = Number(strategyDiagnosis?.aiCandidateCount || 0);
      const finalActionCount = generated + skipped + refreshed;
      setMessage(`已生成 ${generated} 条新建议，规则候选 ${candidates} 条，AI 候选 ${aiCandidateCount} 条，最终可审批动作 ${finalActionCount} 条，处理 ${metrics} 行广告指标。${refreshNote}${duplicateNote}${aiReason}`);
    } catch (caught) {
      rendererRuntimeLog.error('renderer.recommendations_generation_failed', { error: caught });
      setMessage(errorMessage(caught, '生成优化建议失败'));
    } finally {
      setGenerating(false);
    }
  }

  function navigate(route: AppRoute) {
    window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: route }));
  }

  function toggleRecommendationSelection(rec: RecommendationView) {
    const id = String(rec.id);
    if (!visibleFormalApprovalIdSet.has(id)) {
      setSelected(rec);
      setMessage('这条建议还不能进入普通审批；请先查看详情里的送审前证据检查。');
      return;
    }
    setSelectedRecommendationIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFormalSelection() {
    setSelectedRecommendationIds((current) => {
      const allIds = visibleFormalApprovalRecommendations.map((item) => String(item.id));
      const allSelected = allIds.length > 0 && allIds.every((id) => current.has(id));
      return new Set(allSelected ? [] : allIds);
    });
  }

  function submitSelectedToApproval() {
    if (!selectedVisibleFormalRecommendations.length) {
      setMessage('请先勾选至少 1 条可审批建议。');
      return;
    }
    const ids = selectedVisibleFormalRecommendations.map((item) => String(item.id));
    try {
      window.sessionStorage?.setItem(APPROVAL_SELECTION_STORAGE_KEY, JSON.stringify({
        ids,
        count: ids.length,
        batchId: currentBatchId,
        scope: {
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
        },
        createdAt: new Date().toISOString(),
      }));
    } catch (caught) {
      rendererRuntimeLog.warn('renderer.approval_selection_hint_failed', { error: caught });
      // 本地提示写入失败不授予审批权限，审批页仍重新读取真实队列。
    }
    setMessage(`已选择 ${ids.length} 条建议，正在进入审批中心逐条确认。`);
    navigate('approval');
  }

  function applyBucketFilter(nextFilter: RecommendationBucketFilter) {
    setBucketFilter(nextFilter);
    setSelected(null);
    setSelectedRecommendationIds(new Set());
  }

  function runPrimaryTaskAction() {
    if (primaryTaskAction.action === 'generate') {
      generateRecommendations();
      return;
    }
    if (primaryTaskAction.route) navigate(primaryTaskAction.route);
  }

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      try {
        const config = await (window as any).electronAPI?.getRuleConfig?.();
        if (!cancelled && config) setRuleConfig(config);
      } catch (caught) {
        rendererRuntimeLog.error('renderer.recommendation_rule_config_load_failed', { error: caught });
        if (!cancelled) setRuleConfig(null);
      }
      try {
        const getSettings = (window as any).electronAPI?.getSettings;
        if (typeof getSettings !== 'function') {
          if (!cancelled) setAiSettings(null);
        } else {
          const settings = await getSettings();
          if (!cancelled) setAiSettings(normalizeAiSettings(settings));
        }
      } catch (caught) {
        rendererRuntimeLog.error('renderer.recommendation_ai_settings_load_failed', { error: caught });
        if (!cancelled) setAiSettings(null);
      }
    }

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentBatchId) {
      setRecommendations([]);
      setSelected(null);
      return;
    }
    loadRecommendations();
  }, [currentBatchId, filter]);

  const refreshRecommendationsButton = recommendationActionButtonView({
    active: loading,
    baseClassName: 'secondary-button',
    busyLabel: '刷新中...',
    idleLabel: '刷新建议',
  });
  const directGenerateButton = recommendationActionButtonView({
    active: generating,
    baseClassName: 'secondary-button',
    busyLabel: '生成中...',
    disabled: !quantReady || pipelineLoading,
    idleLabel: '生成优化建议',
  });
  const primaryGenerateButton = recommendationActionButtonView({
    active: generating,
    baseClassName: 'primary-button compact-button',
    busyLabel: '生成中...',
    disabled: primaryTaskAction.disabled,
    idleLabel: primaryTaskAction.label,
  });
  const workflowGenerateButton = recommendationActionButtonView({
    active: generating,
    baseClassName: 'workflow-step',
    busyLabel: '生成中...',
    disabled: !quantReady || pipelineLoading,
    idleLabel: recommendations.length ? `${recommendations.length} 条待处理` : '等待生成建议',
  });

  
  return {
    configurationRequired,
    formalApprovalCount,
    recommendations,
    visibleRecommendations,
    manualReviewCount,
    evidenceBlockedCount,
    primaryTaskAction,
    primaryGenerateButton,
    runPrimaryTaskAction,
    directGenerateButton,
    generateRecommendations,
    refreshRecommendationsButton,
    refreshRecommendations,
    navigate,
    bucketItems,
    bucketFilter,
    applyBucketFilter,
    activeBucketLabel,
    visibleFormalApprovalRecommendations,
    batchSelectionState,
    toggleAllFormalSelection,
    selectedVisibleFormalRecommendations,
    submitSelectedToApproval,
    showApprovalSelection,
    visibleFormalApprovalIdSet,
    selectedRecommendationIds,
    toggleRecommendationSelection,
    currentBatchId,
    currentRealReportSourceFiles,
    setSelected,
    compactRecommendationTableColSpan,
    quantReady,
    message,
    data,
    scope,
    realReportCount,
    importedRowCount,
    aiReadiness,
    actionableMetricRows,
    diagnosticCount,
    timelineCount,
    operationEvents,
    productContextCount,
    productWithTargetCount,
    primaryProductContext,
    ruleConfig,
    recommendationGateIssues,
    lastGenerateResult,
    workflowGenerateButton,
    workflowActionState,
    insightOnlyCount,
    insightOnlyReasons,
    aiStrategyCount,
    aiTextCount,
    ruleOnlyCount,
    alignedCount,
    conflictCount,
    aiOnlyCount,
    wasteCount,
    operatorResolutionCount,
    latestOperationEvent,
    totalPendingSpend,
    highRiskCount,
    emptyReason,
    noFormalAiDiagnosis,
    topRecommendation,
    aiParticipatedCount,
    selected,
    selectedDecisionSummary,
    selectedOperationEvents,
  };
}
