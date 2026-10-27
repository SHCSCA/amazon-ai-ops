import { BusinessDataConfigurationGuard } from '../components/business-data-configuration';
import { rendererRuntimeLog } from '../runtime-log';
import { usePageOperation } from './use-page-operation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useBusinessDataPipeline,
  ScopeText,
} from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import { TagMetricGroup } from '../components/tag-metric-group';
import {
  PageHeader,
  Panel,
  StatusPill,
} from '../components/ui';
import {
  VirtualDataTable,
  type VirtualDataTableColumn,
} from '../components/virtual-data-table';
import {
  ResponsiveInspector,
  TaskBanner,
  WorkbenchPanel,
  WorkspaceState,
} from '../components/workspace';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import {
  buildAdQuantProductGroups,
  filterAdQuantByProduct,
  productGroupScopePatch,
} from '../ad-quant-product-groups';
import { buildAdQuantDiagnosisSummary } from '../evidence-display';
import {
  formatPercent,
  formatUsd,
} from '../formatters';
import {
  buildRecommendationGateIssues,
  resolveRecommendationBatchId,
} from '../recommendation-readiness';
import {
  importedReportTypeCoverageCount,
  realReportCoverageCount,
} from '../report-coverage';
import {
  countProductsWithTargets,
  normalizeProductContexts,
} from '../product-context';
import { useScopeStore } from '../scope-store';
import { toUserFacingError } from '../user-facing-error';
import type {
  AdStrategyDiagnosisView,
  AiDiagnosisRunView,
  BusinessQuantDiagnostic,
  OperationScope,
} from '../types';
import {
  buildDiagnosisQueueRows,
  buildDiagnosisWorkspaceModel,
  type DiagnosisQueueRow,
} from './diagnosis-workspace-model';
import {
  buildStrategyRunFeedback,
  runAdQuantDiagnosisWorkflowMutation,
} from "./ad-quant-workflow-feedback";
import { type AdQuantMetricFocus } from "./ad-quant-contracts";
import {
  normalizeRuleConfig,
  priorityScore,
  quantStatusLabel,
  priorityReason,
  navigate,
  trendLabel,
  lifecycleLabel,
  quantSourceDescription,
} from "./ad-quant-values";
import {
  adQuantDiagnosticMatchesFocus,
  adQuantTimelineMatchesFocus,
  buildWasteRiskSpendTile,
  adQuantFocusLabel,
  buildQuantAccountingLine,
} from "./ad-quant-metric-focus";
import {
  ruleThresholdSummary,
  thresholdLine,
  thresholdSourceLine,
} from "./ad-quant-thresholds";
import {
  buildAdQuantDecisionStatus,
  adQuantBlockerDetail,
} from "./ad-quant-decision-gates";
import {
  createAdQuantScopeRequestGate,
  adQuantScopeKey,
  buildAiDiagnosisRunsRequest,
} from "./ad-quant-scope";
import {
  diagnosisTimelineMatchesDiagnostic,
  referencedEvidenceIds,
  diagnosisRunEvidenceLabel,
  diagnosisRunSummaryText,
  diagnosisRunInsightPreview,
} from "./ad-quant-evidence";

export function AdQuantPage() {
  const { data, error, loading, reload, scope, configurationRequired } = useBusinessDataPipeline();
  const setScope = useScopeStore((state) => state.setScope);
  const strategyRequestGateRef = useRef(createAdQuantScopeRequestGate());
  const diagnosisRunsRequestGateRef = useRef(createAdQuantScopeRequestGate());
  const queueFocusFallbackRef = useRef<HTMLDivElement | null>(null);
  const [ruleConfig, setRuleConfig] = useState(() => normalizeRuleConfig(null));
  const [strategyState, setStrategyState] = useState<{
    scopeKey: string;
    diagnosis: AdStrategyDiagnosisView | null;
    loading: boolean;
    error: string;
    lastRunAt: string;
  }>({ scopeKey: '', diagnosis: null, loading: false, error: '', lastRunAt: '' });
  const [diagnosisRunsState, setDiagnosisRunsState] = useState<{
    scopeKey: string;
    runs: AiDiagnosisRunView[];
    error: string;
  }>({ scopeKey: '', runs: [], error: '' });
  const [metricFocus, setMetricFocus] = useState<AdQuantMetricFocus>('all');
  const [selectedDiagnosticKey, setSelectedDiagnosticKey] = useState<string | null>(null);
  const quant = data?.quant;
  const collection = data?.collection;
  const operationEvents = data?.operations?.events || [];
  const sourceBatchIds = collection?.sourceBatchIds || (collection?.latestBatch?.id ? [collection.latestBatch.id] : []);
  const currentBatchId = resolveRecommendationBatchId({
    scopeBatchId: scope.batchId,
    latestBatchId: collection?.latestBatch?.id,
    sourceBatchIds,
  });
  const strategyRequestScope: OperationScope = { ...scope, batchId: currentBatchId || '' };
  const strategyScopeKey = adQuantScopeKey(strategyRequestScope);
  const pageOperation = usePageOperation(strategyScopeKey);
  strategyRequestGateRef.current.activate(strategyScopeKey);
  diagnosisRunsRequestGateRef.current.activate(strategyScopeKey);
  const activeStrategyState = strategyState.scopeKey === pageOperation.contextKey
    ? strategyState
    : { scopeKey: strategyScopeKey, diagnosis: null, loading: false, error: '', lastRunAt: '' };
  const strategyDiagnosis = activeStrategyState.diagnosis;
  const strategyLoading = activeStrategyState.loading;
  const strategyError = activeStrategyState.error;
  const strategyLastRunAt = activeStrategyState.lastRunAt;
  const diagnosisRuns = diagnosisRunsState.scopeKey === pageOperation.contextKey ? diagnosisRunsState.runs : [];
  const diagnosisRunsError = diagnosisRunsState.scopeKey === pageOperation.contextKey ? diagnosisRunsState.error : '';
  const realReportCount = realReportCoverageCount(collection);
  const importedReportTypeCount = importedReportTypeCoverageCount(collection);
  const importedRowCount = collection?.fileAudit?.importedRowCount ?? quant?.importedRows ?? 0;
  const recommendationGateIssues = data
    ? buildRecommendationGateIssues({
      requiredReportCount: 8,
      realReportFileCount: realReportCount,
      realReportFilesLength: collection?.realReportFiles.length ?? 0,
      importedReportTypeCount,
      importedRowCount,
      quantImportedRows: quant?.importedRows ?? 0,
      hasImportedMetrics: Boolean(quant?.hasImportedMetrics),
      currentBatchId,
      collectionBlockers: collection?.blockers || [],
      quantBlockers: quant?.blockers || [],
    })
    : ['正在读取当前业务范围的数据状态'];
  const canDiagnose = Boolean(
    realReportCount >= 8
      && importedReportTypeCount >= 8
      && importedRowCount > 0
      && quant?.hasImportedMetrics,
  );
  const canGenerateFormalRecommendations = Boolean(data && recommendationGateIssues.length === 0);
  const visibleQuant = canDiagnose ? quant : undefined;
  const allDiagnostics = canDiagnose ? quant?.diagnostics || [] : [];
  const allTimelines = canDiagnose ? quant?.adObjectTimelines || [] : [];
  const allProductHistoryLedgers = canDiagnose ? data?.productHistory?.ledgers || [] : [];
  const productGrouping = useMemo(() => buildAdQuantProductGroups({
    scopeAsin: scope.asin,
    canonicalSummary: visibleQuant && scope.asin
      ? {
          asin: scope.asin,
          cost: visibleQuant.totalSpend,
          sales: visibleQuant.totalSales,
          orders: visibleQuant.totalOrders,
          clicks: visibleQuant.totalClicks,
        }
      : undefined,
    diagnostics: allDiagnostics,
    timelines: allTimelines,
    ledgers: allProductHistoryLedgers,
  }), [scope.asin, visibleQuant, allDiagnostics, allTimelines, allProductHistoryLedgers]);
  const [selectedProductKey, setSelectedProductKey] = useState(() => String(scope.asin || '').trim().toUpperCase());
  const selectedProduct = selectedProductKey;
  const selectedProductGroup = productGrouping.groups.find((group) => group.productKey === selectedProduct);
  const productFiltered = filterAdQuantByProduct({
    productKey: selectedProduct,
    diagnostics: allDiagnostics,
    timelines: allTimelines,
    ledgers: allProductHistoryLedgers,
  });
  const productDiagnostics = productFiltered.diagnostics;
  const productTimelines = productFiltered.timelines;
  const visibleDiagnostics = useMemo(
    () => productDiagnostics.filter((row) => adQuantDiagnosticMatchesFocus(row, metricFocus, ruleConfig)),
    [productDiagnostics, metricFocus, ruleConfig],
  );
  const visibleTimelines = useMemo(
    () => productTimelines.filter((timeline) => adQuantTimelineMatchesFocus(timeline, metricFocus, ruleConfig)),
    [productTimelines, metricFocus, ruleConfig],
  );
  const productHistoryLedgers = productFiltered.ledgers;
  const diagnosisQueueRows = useMemo(
    () => buildDiagnosisQueueRows(
      visibleDiagnostics,
      (row) => priorityScore(row, ruleConfig),
    ),
    [ruleConfig, visibleDiagnostics],
  );
  const selectedQueueRow = diagnosisQueueRows.find((entry) => entry.key === selectedDiagnosticKey) || null;
  const selectedDiagnostic = selectedQueueRow?.diagnostic || null;
  const selectedTimeline = selectedDiagnostic
    ? productTimelines.find((timeline) => diagnosisTimelineMatchesDiagnostic(timeline, selectedDiagnostic)) || null
    : null;
  const selectedProductContext = selectedDiagnostic?.asin
    ? normalizeProductContexts(data?.productContext?.products).find((product) => product.asin === selectedDiagnostic.asin?.trim().toUpperCase())
    : undefined;
  const selectedLedger = selectedDiagnostic?.asin
    ? allProductHistoryLedgers.find((ledger) => String(ledger.asin || '').trim().toUpperCase() === selectedDiagnostic.asin?.trim().toUpperCase())
    : undefined;
  const selectedOperationEvents = selectedDiagnostic
    ? operationEvents.filter((event) => !event.asin || String(event.asin).trim().toUpperCase() === String(selectedDiagnostic.asin || '').trim().toUpperCase()).slice(0, 3)
    : [];
  const quantDiagnosisSummary = buildAdQuantDiagnosisSummary(strategyDiagnosis?.summary);
  const decisionStatus = buildAdQuantDecisionStatus({
    canDiagnose,
    canGenerateFormalRecommendations,
    diagnosticCount: productDiagnostics.length,
    diagnosis: strategyDiagnosis?.summary,
  });
  const strategyRunFeedback = buildStrategyRunFeedback({
    canDiagnose,
    loading: strategyLoading,
    realReportCount,
    importedReportTypeCount,
    requiredReportCount: 8,
    error: strategyError,
    diagnosis: strategyDiagnosis,
    lastRunAt: strategyLastRunAt,
  });
  const strategyReferencedEvidenceIds = strategyDiagnosis ? referencedEvidenceIds(strategyDiagnosis.summary) : new Set<string>();
  const productContexts = normalizeProductContexts(data?.productContext?.products);
  const productContextCount = data?.productContext?.productCount ?? productContexts.length;
  const productWithTargets = countProductsWithTargets(productContexts);
  const canonicalRows = quant?.canonicalRows ?? 0;
  const actionableRows = quant?.actionableRows ?? 0;
  const breakdownRows = quant?.breakdownRows ?? 0;
  const diagnosticCount = productDiagnostics.length;
  const productHighAcosRows = productDiagnostics.filter((row) => adQuantDiagnosticMatchesFocus(row, 'high_acos', ruleConfig));
  const productNoOrderRows = productDiagnostics.filter((row) => adQuantDiagnosticMatchesFocus(row, 'waste', ruleConfig));
  const productOrderRows = productDiagnostics.filter((row) => adQuantDiagnosticMatchesFocus(row, 'orders', ruleConfig));
  const productScaleRows = productDiagnostics.filter((row) => adQuantDiagnosticMatchesFocus(row, 'scale', ruleConfig));
  const productReviewRows = productDiagnostics.filter((row) => adQuantDiagnosticMatchesFocus(row, 'review', ruleConfig));
  const productNoOrderSpend = productNoOrderRows.reduce((sum, row) => sum + row.spend, 0);
  const workspaceModel = buildDiagnosisWorkspaceModel({
    realReportCount,
    requiredReportCount: 8,
    importedReportTypeCount,
    importedRowCount,
    hasImportedMetrics: Boolean(quant?.hasImportedMetrics),
    recommendationGateIssues,
    diagnosticCount: productDiagnostics.length,
    visibleDiagnosticCount: visibleDiagnostics.length,
    selectedObject: selectedDiagnostic
      ? {
          name: selectedDiagnostic.objectName || selectedDiagnostic.campaignName,
          diagnosis: selectedDiagnostic.diagnosis,
        }
      : null,
    scopeAiSummary: strategyDiagnosis?.summary.summary,
  });
  const selectedSpend = selectedProductGroup?.cost ?? visibleQuant?.totalSpend ?? 0;
  const selectedSales = selectedProductGroup?.sales ?? visibleQuant?.totalSales ?? 0;
  const selectedOrders = selectedProductGroup?.orders ?? visibleQuant?.totalOrders ?? 0;
  const selectedAcos = selectedProductGroup ? selectedProductGroup.acos : (visibleQuant?.acos ?? 0);
  const wasteRiskSpendTile = buildWasteRiskSpendTile({
    wastedSpend: visibleQuant?.wastedSpend,
    totalSpend: selectedSpend,
    highRiskCount: visibleQuant?.highRiskCount,
  });
  useEffect(() => {
    const scopedProduct = String(scope.asin || '').trim().toUpperCase();
    setSelectedProductKey(
      scopedProduct && productGrouping.groups.some((group) => group.productKey === scopedProduct)
        ? scopedProduct
        : '',
    );
  }, [productGrouping.groups, scope.asin]);

  useEffect(() => {
    setSelectedDiagnosticKey((current) => (
      current && diagnosisQueueRows.some((entry) => entry.key === current) ? current : null
    ));
  }, [diagnosisQueueRows]);

  useEffect(() => {
    setSelectedDiagnosticKey(null);
  }, [strategyScopeKey, pageOperation.contextKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadRuleConfig() {
      try {
        const config = await (window as any).electronAPI?.getRuleConfig?.();
        if (!cancelled) setRuleConfig(normalizeRuleConfig(config));
      } catch (caught) {
      rendererRuntimeLog.error('renderer.ad_quant_workspace.failed', { error: caught });
        if (!cancelled) setRuleConfig(normalizeRuleConfig(null));
      }
    }

    loadRuleConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadDiagnosisRuns(requestedScope: OperationScope = strategyRequestScope) {
    if (!pageOperation.hasAuthority) {
      setDiagnosisRunsState({ scopeKey: pageOperation.contextKey, runs: [], error: pageOperation.blockedReason });
      return;
    }
    const api = (window as any).electronAPI;
    const requestedScopeKey = adQuantScopeKey(requestedScope);
    const canPublish = pageOperation.capture();
    const request = diagnosisRunsRequestGateRef.current.begin(requestedScopeKey);
    if (!canPublish() || !diagnosisRunsRequestGateRef.current.isCurrent(request)) return;
    if (!api?.listAiDiagnosisRuns) {
      setDiagnosisRunsState({ scopeKey: pageOperation.contextKey, runs: [], error: '' });
      return;
    }
    try {
      const runs = await api.listAiDiagnosisRuns(buildAiDiagnosisRunsRequest({
        scope: requestedScope,
      }));
      if (!canPublish() || !diagnosisRunsRequestGateRef.current.isCurrent(request)) return;
      setDiagnosisRunsState({
        scopeKey: pageOperation.contextKey,
        runs: Array.isArray(runs) ? runs : [],
        error: '',
      });
    } catch (caught) {
      rendererRuntimeLog.error('renderer.ad_quant_workspace.failed', { error: caught });
      if (!canPublish() || !diagnosisRunsRequestGateRef.current.isCurrent(request)) return;
      setDiagnosisRunsState({
        scopeKey: pageOperation.contextKey,
        runs: [],
        error: caught instanceof Error ? caught.message : String(caught || '读取 AI 诊断记录失败。'),
      });
    }
  }

  useEffect(() => {
    void loadDiagnosisRuns(strategyRequestScope);
  }, [strategyScopeKey, pageOperation.contextKey]);

  async function runStrategyDiagnosis() {
    if (!pageOperation.hasAuthority) {
      setStrategyState(current => ({ ...current, error: pageOperation.blockedReason }));
      return;
    }
    const ticket = pageOperation.begin();
    if (!ticket) return;
    const api = (window as any).electronAPI;
    const requestedScope = { ...strategyRequestScope };
    const request = strategyRequestGateRef.current.begin(strategyScopeKey);
    if (!strategyRequestGateRef.current.isCurrent(request)) { ticket.finish(); return; }
    const canPublish = () => ticket.isCurrent() && strategyRequestGateRef.current.isCurrent(request);
    setStrategyState({
      scopeKey: pageOperation.contextKey,
      diagnosis: null,
      loading: true,
      error: '',
      lastRunAt: '',
    });
    try {
      if (!api?.runAdStrategyDiagnosis) {
        throw new Error('AI 阶段诊断接口未暴露。');
      }
      const result = await runAdQuantDiagnosisWorkflowMutation<any>(() => api.runAdStrategyDiagnosis({
        dateFrom: requestedScope.dateFrom,
        dateTo: requestedScope.dateTo,
        storeName: requestedScope.storeName,
        marketplaceCode: requestedScope.marketplaceCode,
        asin: requestedScope.asin,
        batchId: requestedScope.batchId,
        limit: 300,
      }), undefined, canPublish);
      if (!canPublish()) return;
      setStrategyState({
        scopeKey: pageOperation.contextKey,
        diagnosis: result,
        loading: true,
        error: '',
        lastRunAt: new Date().toISOString(),
      });
      await loadDiagnosisRuns(requestedScope);
    } catch (caught) {
      rendererRuntimeLog.error('renderer.ad_quant_workspace.failed', { error: caught });
      if (!canPublish()) return;
      setStrategyState({
        scopeKey: pageOperation.contextKey,
        diagnosis: null,
        loading: true,
        error: toUserFacingError(caught, 'AI 阶段诊断失败。'),
        lastRunAt: new Date().toISOString(),
      });
    } finally {
      if (canPublish()) {
        setStrategyState((current) => current.scopeKey === pageOperation.contextKey
          ? { ...current, loading: false }
          : current);
      }
      ticket.finish();
    }
  }

  const queueColumns = useMemo<Array<VirtualDataTableColumn<DiagnosisQueueRow<BusinessQuantDiagnostic>>>>(() => [
    {
      key: 'object',
      header: '广告对象',
      width: 'minmax(220px, 1.45fr)',
      sticky: 'left',
      cell: (entry) => (
        <div>
          <strong>{entry.diagnostic.objectName || entry.diagnostic.campaignName || '-'}</strong>
          <div className="table-subtext">
            {entry.diagnostic.objectType || '-'} / {quantStatusLabel(entry.diagnostic.quantStatus)}
          </div>
        </div>
      ),
    },
    {
      key: 'diagnosis',
      header: '诊断与方向',
      width: 'minmax(260px, 1.8fr)',
      cell: (entry) => (
        <div>
          <strong>{entry.diagnostic.diagnosis || '待人工复核'}</strong>
          <div className="table-subtext">{entry.diagnostic.suggestedDirection || '暂无明确方向'}</div>
        </div>
      ),
    },
    {
      key: 'spend',
      header: '花费 / 销售',
      width: '150px',
      cell: (entry) => (
        <div>
          <strong>{formatUsd(entry.diagnostic.spend)}</strong>
          <div className="table-subtext">{formatUsd(entry.diagnostic.sales)}</div>
        </div>
      ),
    },
    {
      key: 'orders',
      header: '订单 / 点击',
      width: '130px',
      cell: (entry) => (
        <div>
          <strong>{entry.diagnostic.orders} 单</strong>
          <div className="table-subtext">{entry.diagnostic.clicks} 点击</div>
        </div>
      ),
    },
    {
      key: 'risk',
      header: 'ACOS / 优先级',
      width: '180px',
      cell: (entry) => (
        <div>
          <StatusPill
            tone={entry.diagnostic.severity === 'high' || entry.diagnostic.quantStatus === 'waste'
              ? 'blocked'
              : entry.diagnostic.severity === 'medium' || entry.diagnostic.quantStatus === 'watch'
                ? 'warning'
                : 'ready'}
          >
            {formatPercent(entry.diagnostic.acos * 100)}
          </StatusPill>
          <div className="table-subtext">{priorityReason(entry.diagnostic, ruleConfig)}</div>
        </div>
      ),
    },
  ], [ruleConfig]);

  const taskPrimaryAction = loading
    ? {
        label: '正在读取诊断数据',
        busy: true,
        busyLabel: '正在读取诊断数据',
        disabled: true,
        disabledReason: '正在读取当前范围数据，请等待完成后重试。',
        onClick: reload,
      }
    : error
      ? {
          label: '重新读取',
          disabledReason: '正在运行 AI 阶段分析，请等待完成后重新读取。',
          onClick: reload,
        }
      : {
          label: workspaceModel.primaryAction.label,
          disabled: workspaceModel.primaryAction.disabled,
          disabledReason: strategyLoading ? '正在运行 AI 阶段分析，请等待完成后进入建议。' : workspaceModel.primaryAction.disabled ? '当前范围没有可进入建议的诊断对象；请先到报表采集与导入检查补齐数据。' : undefined,
          onClick: () => navigate(workspaceModel.primaryAction.target),
        };
  const taskSecondaryActions = canDiagnose && !error
    ? [
        {
          label: strategyError ? '重新运行 AI' : '运行 AI 阶段分析',
          busy: strategyLoading,
          busyLabel: 'AI 分析中...',
          disabled: strategyLoading || !pageOperation.hasAuthority,
          disabledReason: !pageOperation.hasAuthority ? pageOperation.blockedReason : '正在运行 AI 阶段分析，请等待完成后再操作。',
          onClick: () => { void runStrategyDiagnosis(); },
        },
        {
          label: strategyError ? '检查 AI 设置' : '补充运营事件',
          disabled: strategyLoading,
          disabledReason: '正在运行 AI 阶段分析，请等待完成后再打开设置或运营事件。',
          onClick: () => navigate(strategyError ? 'settings' : 'operation-events'),
        },
      ]
    : [];
  const taskTone: 'neutral' | 'attention' | 'blocked' | 'confirmed' = error || !canDiagnose
    ? 'blocked'
    : workspaceModel.formalRecommendationsLocked
      ? 'attention'
      : 'confirmed';

  return (
    <div
      className="diagnosis-workspace"
      data-workspace="diagnosis"
      data-workspace-evidence-root="true"
      data-workspace-subview="analysis"
    >
      <PageHeader
        eyebrow="数据"
        title={PAGE_HEADER_TITLES.adQuant}
        description="按风险优先级复核广告对象；选择一行后在检查器中核对规则、趋势、产品上下文与安全边界。"
      />
<BusinessDataConfigurationGuard configurationRequired={configurationRequired}>


      <div data-diagnosis-summary-boundary>
        <TaskBanner
          compact
          description={error
            ? '当前业务数据读取失败，先重新读取，再继续对象诊断。'
            : strategyRunFeedback.visible
              ? (
                  <span
                    aria-atomic="true"
                    aria-busy={strategyRunFeedback.ariaBusy || undefined}
                    aria-live="polite"
                    className="diagnosis-ai-run-inline"
                    data-ai-run-status-visible="true"
                    data-ai-run-tone={strategyRunFeedback.tone}
                    id="ai-strategy-run-feedback"
                    role="status"
                    title={`${strategyRunFeedback.title}：${strategyRunFeedback.detail}`}
                  >
                    {strategyRunFeedback.ariaBusy && <span aria-hidden="true" className="workspace-spinner" />}
                    <strong>{strategyRunFeedback.title}</strong>
                    <span className="diagnosis-ai-run-inline__detail">· {strategyRunFeedback.detail}</span>
                    <span className="diagnosis-ai-run-inline__state">{strategyRunFeedback.statusLabel}</span>
                  </span>
                )
              : workspaceModel.readinessDetail}
          meta={(selectedProductGroup?.label || '全部产品')
            + ' · 花费 ' + formatUsd(selectedSpend)
            + ' · 销售 ' + formatUsd(selectedSales)
            + ' · ' + selectedOrders + ' 单'
            + ' · ACOS ' + formatPercent(selectedAcos * 100)}
          primaryAction={taskPrimaryAction}
          secondaryActions={taskSecondaryActions}
          status={loading
            ? '读取中'
            : error
              ? '读取失败'
              : workspaceModel.formalRecommendationsLocked
                ? '正式建议锁定'
                : '正式建议可进入'}
          title={selectedDiagnostic
            ? '正在复核：' + (selectedDiagnostic.objectName || selectedDiagnostic.campaignName || '未命名对象')
            : canDiagnose
              ? '选择一个广告对象开始复核'
              : '先闭合真实广告数据'}
          tone={taskTone}
        />
      </div>

      <div className="diagnosis-workbench-layout" data-workspace-work-surface="true">
        <div data-workspace-queue="true" ref={queueFocusFallbackRef} tabIndex={-1}>
          <WorkbenchPanel
            className="ad-quant-primary-panel diagnosis-queue-panel"
            description="队列按止损风险、ACOS 风险和花费排序。当前筛选只改变可见对象，不改变正式建议资格。"
            status={(
              <StatusPill tone={diagnosisQueueRows.length ? 'ready' : canDiagnose ? 'warning' : 'blocked'}>
                {diagnosisQueueRows.length}/{diagnosticCount} 个对象
              </StatusPill>
            )}
            title="广告对象诊断"
            toolbar={(
              <label className="inline-field">
                <span>产品范围</span>
                <select
                  aria-label="选择广告诊断产品范围"
                  aria-describedby={loading ? "ad-quant-product-lock-reason" : undefined}
                  disabled={loading}
                  onChange={(event) => {
                    const nextProductKey = event.target.value;
                    setSelectedProductKey(nextProductKey);
                    setSelectedDiagnosticKey(null);
                    setScope(productGroupScopePatch(nextProductKey));
                  }}
                  value={selectedProductKey}
                >
                  <option value="">全部产品</option>
                  {productGrouping.groups.map((group) => (
                    <option key={group.productKey} value={group.productKey}>
                      {group.label} · {group.diagnosticCount} 个对象
                    </option>
                  ))}
                </select>
                {loading && <small id="ad-quant-product-lock-reason">正在读取当前范围，请等待读取完成后切换产品。</small>}
              </label>
            )}
          >
            <div className="diagnosis-queue-controls">
              <TagMetricGroup
                activeKey={metricFocus}
                ariaLabel="广告表现维度快速聚焦"
                dimInactive={metricFocus !== 'all'}
                items={[
                  { key: 'all', label: '全部对象', value: productDiagnostics.length, tone: productDiagnostics.length > 0 ? 'ready' : 'blocked', detail: realReportCount + '/8 类真实报表' },
                  { key: 'waste', label: '浪费超支', value: formatUsd(productNoOrderSpend), tone: productNoOrderSpend > 0 ? 'blocked' : 'ready' },
                  { key: 'high_acos', label: '高 ACOS', value: productHighAcosRows.length, tone: productHighAcosRows.length > 0 ? 'warning' : 'ready' },
                  { key: 'orders', label: '出单对象', value: productOrderRows.length, tone: productOrderRows.length > 0 ? 'ready' : 'warning' },
                  { key: 'scale', label: '可扩量', value: productScaleRows.length, tone: productScaleRows.length > 0 ? 'ready' : 'neutral' },
                  { key: 'review', label: '待复核', value: productReviewRows.length, tone: productReviewRows.length > 0 ? 'warning' : 'ready' },
                ]}
                onSelect={(item) => setMetricFocus((item.key || 'all') as AdQuantMetricFocus)}
              />
              <p className="ad-quant-focus-line" aria-live="polite">
                当前聚焦：{adQuantFocusLabel(metricFocus)}。筛选仅改变当前队列视图；正式资格仍按未筛选的 {diagnosticCount} 个对象计算。
              </p>
            </div>

            {loading ? (
              <WorkspaceState
                description="正在读取当前范围的真实报表、逐类入库和广告对象诊断。"
                kind="loading"
                title="正在读取诊断数据"
              />
            ) : error ? (
              <WorkspaceState
                action={{ label: '重新读取', onClick: reload }}
                description={error}
                kind="error"
                title="诊断数据读取失败"
              />
            ) : !canDiagnose ? (
              <WorkspaceState
                description={adQuantBlockerDetail({
                  realReportCount,
                  importedReportTypeCount,
                  requiredReportCount: 8,
                  fallback: quant?.blockers?.[0],
                })}
                details="截图、审计文件和空报表不作为广告数据；8 类真实报表未闭合时不生成诊断。"
                kind="blocked"
                title="广告表现阻断"
              />
            ) : diagnosticCount <= 0 ? (
              <WorkspaceState
                description="当前产品范围没有形成可复核的广告对象。请检查 ASIN 范围、批次与逐类入库结果。"
                kind="empty"
                title="当前范围没有诊断对象"
              />
            ) : diagnosisQueueRows.length <= 0 ? (
              <WorkspaceState
                action={{ label: '查看全部对象', onClick: () => setMetricFocus('all') }}
                description={'当前聚焦“' + adQuantFocusLabel(metricFocus) + '”没有匹配对象；这不会锁定正式建议入口。'}
                kind="empty"
                title="当前筛选没有匹配对象"
              />
            ) : (
              <VirtualDataTable
                columns={queueColumns}
                emptyMessage="当前没有可展示的诊断对象。"
                estimateSize={54}
                getRowKey={(entry) => entry.key}
                minWidth="940px"
                onRowSelect={(entry) => setSelectedDiagnosticKey(entry.key)}
                rowAriaLabel={(entry) => {
                  const row = entry.diagnostic;
                  return '复核 ' + (row.objectName || row.campaignName || '未命名对象')
                    + '，' + (row.diagnosis || '待人工复核')
                    + '，ACOS ' + formatPercent(row.acos * 100);
                }}
                rows={diagnosisQueueRows}
                selectedRowKey={selectedDiagnosticKey}
              />
            )}
          </WorkbenchPanel>
        </div>

        <ResponsiveInspector
          description={selectedDiagnostic
            ? (selectedDiagnostic.campaignName || '-') + ' / ' + (selectedDiagnostic.adGroupName || '-') + ' / ' + (selectedDiagnostic.asin || '未绑定 ASIN')
            : undefined}
          onClose={() => setSelectedDiagnosticKey(null)}
          open={Boolean(selectedDiagnostic)}
          resolveFocusReturnTarget={(trigger) => (
            trigger && trigger.isConnected !== false ? trigger : queueFocusFallbackRef.current
          )}
          title={selectedDiagnostic?.objectName || selectedDiagnostic?.campaignName || '广告对象详情'}
        >
          {selectedDiagnostic && (
            <div className="business-stack diagnosis-inspector-stack">
              <Panel
                title="当前规则判断"
                titleAccessory={(
                  <StatusPill tone={selectedDiagnostic.severity === 'high' ? 'blocked' : selectedDiagnostic.severity === 'medium' ? 'warning' : 'ready'}>
                    {quantStatusLabel(selectedDiagnostic.quantStatus)}
                  </StatusPill>
                )}
                tone={selectedDiagnostic.severity === 'high' ? 'blocked' : selectedDiagnostic.severity === 'medium' ? 'warning' : 'success'}
              >
                <p><strong>{selectedDiagnostic.diagnosis || '待人工复核'}</strong></p>
                <p className="muted-line">{selectedDiagnostic.suggestedDirection || '暂无明确建议方向。'}</p>
                <div className="business-pill-row">
                  <StatusPill tone="pending">花费 {formatUsd(selectedDiagnostic.spend)}</StatusPill>
                  <StatusPill tone="pending">销售 {formatUsd(selectedDiagnostic.sales)}</StatusPill>
                  <StatusPill tone={selectedDiagnostic.orders > 0 ? 'ready' : 'warning'}>{selectedDiagnostic.orders} 单</StatusPill>
                  <StatusPill tone={selectedDiagnostic.acos >= ruleConfig.highAcosThreshold ? 'blocked' : 'ready'}>ACOS {formatPercent(selectedDiagnostic.acos * 100)}</StatusPill>
                </div>
                <p className="muted-line">复核优先级：{priorityReason(selectedDiagnostic, ruleConfig)}</p>
                <p className="muted-line">当前规则：{ruleThresholdSummary(ruleConfig)}</p>
              </Panel>

              <Panel title="对象时间线" tone={selectedTimeline ? 'success' : 'warning'}>
                {selectedTimeline ? (
                  <>
                    <div className="context-summary-grid compact-summary diagnosis-inspector-summary diagnosis-inspector-summary--timeline">
                      <div>
                        <span>日期范围</span>
                        <strong className="diagnosis-inspector-date-range">
                          <time dateTime={selectedTimeline.dateFrom}>{selectedTimeline.dateFrom}</time>
                          <span className="diagnosis-inspector-date-range__end">
                            至 <time dateTime={selectedTimeline.dateTo}>{selectedTimeline.dateTo}</time>
                          </span>
                        </strong>
                        <p>{selectedTimeline.daysActive} 个活跃日</p>
                      </div>
                      <div>
                        <span>趋势</span>
                        <strong className="diagnosis-inspector-trend">
                          <span className="diagnosis-inspector-trend__item">花费{trendLabel(selectedTimeline.trend.spend)} /</span>
                          <span className="diagnosis-inspector-trend__item">销售{trendLabel(selectedTimeline.trend.sales)}</span>
                        </strong>
                        <p>{selectedTimeline.totals.orders} 单 / {selectedTimeline.totals.clicks} 点击</p>
                      </div>
                    </div>
                    <p className="muted-line">{thresholdLine(selectedTimeline)}</p>
                    {selectedTimeline.reasons.length > 0 && (
                      <ul className="business-list">
                        {selectedTimeline.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="muted-line">没有找到与当前行对象身份完全匹配的时间线；这里不会用产品总盘替代对象证据。</p>
                )}
              </Panel>

              <Panel title="产品上下文与历史" tone={selectedProductContext || selectedLedger ? 'success' : 'warning'}>
                {selectedProductContext ? (
                  <div className="context-summary-grid compact-summary diagnosis-inspector-summary diagnosis-inspector-summary--product">
                    <div>
                      <span>产品</span>
                      <strong>{selectedProductContext.title || selectedProductContext.asin}</strong>
                      <p>{selectedProductContext.asin} / {selectedProductContext.status || '未标记状态'}</p>
                    </div>
                    <div>
                      <span>产品阶段</span>
                      <strong>{lifecycleLabel(selectedProductContext.productStage)}</strong>
                      <p>
                        目标 ACOS {typeof selectedProductContext.cost?.targetAcos === 'number' ? formatPercent(selectedProductContext.cost.targetAcos * 100) : '未配置'}
                        {' / '}目标 TACOS {typeof selectedProductContext.cost?.targetTacos === 'number' ? formatPercent(selectedProductContext.cost.targetTacos * 100) : '未配置'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="muted-line">当前对象没有匹配的产品配置。</p>
                )}
                {selectedLedger ? (
                  <p className="muted-line">
                    产品历史：{selectedLedger.dateFrom} 至 {selectedLedger.dateTo}，{selectedLedger.activeDays} 个活跃日，
                    花费 {formatUsd(selectedLedger.totals.cost)}，销售 {formatUsd(selectedLedger.totals.sales)}，{selectedLedger.totals.orders} 单。
                  </p>
                ) : (
                  <p className="muted-line">当前对象没有匹配的产品历史账本。</p>
                )}
                {selectedOperationEvents.length > 0 ? (
                  <ul className="business-list">
                    {selectedOperationEvents.map((event) => (
                      <li key={event.id}>
                        {event.eventDate} · {event.title}
                        {event.impactExpectation ? ' · ' + event.impactExpectation : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-line">当前对象没有匹配的近期运营事件。</p>
                )}
              </Panel>

              <Panel title="范围级 AI 总结" tone={workspaceModel.scopeAiSummary ? 'success' : 'warning'}>
                {workspaceModel.scopeAiSummary ? (
                  <>
                    <p>{workspaceModel.scopeAiSummary.text}</p>
                    <p className="warning-line">{workspaceModel.scopeAiSummary.caveat}</p>
                  </>
                ) : (
                  <p className="muted-line">当前范围尚未运行 AI 阶段分析；对象规则诊断仍可独立复核。</p>
                )}
              </Panel>

              <Panel title="执行安全边界" tone="blocked">
                <p className="blocked-line">
                  本页只做诊断和证据复核，不写入 Amazon Ads。任何动作仍需进入优化建议、人工审批，并完成执行回读证据。
                </p>
              </Panel>
            </div>
          )}
        </ResponsiveInspector>
      </div>

      <ProgressiveDetails title="技术依据与诊断上下文">
        <div className="business-stack">
          <Panel title="数据来源与量化口径" tone={canDiagnose ? 'success' : 'blocked'}>
            <div className="business-split">
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone={realReportCount >= 8 ? 'ready' : 'blocked'}>真实报表 {realReportCount}/8</StatusPill>
                <StatusPill tone={importedReportTypeCount >= 8 ? 'ready' : 'blocked'}>逐类入库 {importedReportTypeCount}/8</StatusPill>
                <StatusPill tone={importedRowCount > 0 ? 'ready' : 'blocked'}>指标 {importedRowCount} 行</StatusPill>
              </div>
            </div>
            <p className="muted-line">{quantSourceDescription(quant?.summarySource)}</p>
            <p className="muted-line">
              {buildQuantAccountingLine({
                summarySource: quant?.summarySource,
                batchIds: sourceBatchIds,
                asin: scope.asin,
                canonicalRows,
              })}
            </p>
            <p className="muted-line">
              可加总 {canonicalRows} 行 / 可行动 {actionableRows} 行 / 分解明细 {breakdownRows} 行 / 产品配置 {productWithTargets}/{productContextCount}。
            </p>
            {quant?.summaryWarning && <p className="warning-line">{quant.summaryWarning}</p>}
          </Panel>

          <Panel title="AI 与规则诊断依据" tone={strategyDiagnosis ? 'success' : 'warning'}>
            <div className="business-pill-row">
              <StatusPill tone={decisionStatus.aiTone}>{decisionStatus.aiLabel}</StatusPill>
              <StatusPill tone={decisionStatus.ruleTone}>{decisionStatus.ruleLabel}</StatusPill>
              <StatusPill tone={decisionStatus.actionTone}>{decisionStatus.actionLabel}</StatusPill>
            </div>
            <p className="muted-line">规则阈值：{ruleThresholdSummary(ruleConfig)}</p>
            <p>{quantDiagnosisSummary.headline}</p>
            {quantDiagnosisSummary.reasons.length > 0 && (
              <ul className="business-list">
                {quantDiagnosisSummary.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
            <p className="muted-line">证据：{quantDiagnosisSummary.evidenceStats}。下一步：{quantDiagnosisSummary.nextAction}</p>
            {quantDiagnosisSummary.riskWarnings.length > 0 && (
              <p className="warning-line">复核提示：{quantDiagnosisSummary.riskWarnings.join('；')}</p>
            )}
            <p className="muted-line">{thresholdSourceLine()}</p>
          </Panel>

          <Panel title="最近 AI 诊断记录" tone={diagnosisRunsError ? 'blocked' : diagnosisRuns.length ? 'success' : 'warning'}>
            {diagnosisRunsError && <p className="blocked-line">{diagnosisRunsError}</p>}
            {!diagnosisRunsError && diagnosisRuns.length === 0 && (
              <p className="muted-line">当前范围还没有历史 AI 诊断记录。</p>
            )}
            {diagnosisRuns.length > 0 && (
              <div className="ad-quant-review-list">
                {diagnosisRuns.slice(0, 5).map((run) => (
                  <div className="ad-quant-review-item" key={run.id}>
                    <span>{run.createdAt.replace('T', ' ').slice(0, 16)} · {diagnosisRunEvidenceLabel(run)}</span>
                    <strong>{diagnosisRunSummaryText(run)}</strong>
                    {diagnosisRunInsightPreview(run).map((line) => <p key={line}>{line}</p>)}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </ProgressiveDetails>
    
</BusinessDataConfigurationGuard>
</div>
  );
}
