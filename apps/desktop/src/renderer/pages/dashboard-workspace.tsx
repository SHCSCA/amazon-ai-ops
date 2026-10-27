import { BusinessDataConfigurationGuard } from '../components/business-data-configuration';
import { rendererRuntimeLog } from '../runtime-log';
import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import { usePageOperation } from './use-page-operation';
import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import {
  StateLightGrid,
  StatusPill,
} from '../components/ui';
import {
  PageFrame,
  PriorityDataTable,
  SummaryStrip,
  TaskBanner,
  WorkbenchPanel,
  WorkspaceState,
} from '../components/workspace';
import {
  buildDeliveryReadinessMatrix,
  buildDeliveryReadinessMatrixInput,
} from '../delivery-readiness-matrix';
import {
  formatPercent,
  formatUsd,
} from '../formatters';
import { useMissionControlStoreContext } from '../mission-control/store-context';
import {
  hasRealReportCoverage,
  importedReportTypeCoverageCount,
  realReportCoverageCount,
} from '../report-coverage';
import type { NextSafeAction } from '../workflow-state';
import type {
  AiDiagnosisRunView,
  DeliveryEvidenceStatusView,
  DeliveryReadinessView,
  RecommendationView,
} from '../types';
import { toUserFacingError } from '../user-facing-error';
import {
  dashboardDecisionSummary,
  dashboardRecommendationHealthSummary,
  dashboardRecommendationStatusFilters,
} from "./dashboard-recommendations";
import {
  dashboardVisibleDeliveryItems,
  dashboardNormalizeDeliveryItem,
  dashboardDeliveryPrimaryAction,
  dashboardDeliveryHeadline,
} from "./dashboard-delivery";
import {
  dashboardCanGenerateFormalRecommendations,
  dashboardMetricStatusCopy,
  dashboardDataGateAction,
  dashboardDataGateLabel,
} from "./dashboard-data-readiness";
import { dashboardWorkflowQuantNext } from "./dashboard-workflow";
import {
  dashboardArtifactActionKey,
  dashboardOpenArtifactButtonView,
  navigate,
} from "./dashboard-task-actions";
import {
  normalizeRuleConfig,
  dashboardAiStatus,
  dashboardAiWorkStatus,
  dashboardSelectProductHistory,
  productStageLabel,
} from "./dashboard-status";
import {
  dashboardRiskObjectFallbackCopy,
  dashboardRiskObjectQueue,
  dashboardRiskColumns,
} from "./dashboard-risk-objects";

export function DashboardPage({ nextSafeAction }: { nextSafeAction: NextSafeAction }) {
  const { data, error, loading, reload, scope, configurationRequired } = useBusinessDataPipeline();
  const storeAuthority = useMissionControlStoreContext();
  const pageOperation = usePageOperation(JSON.stringify([scope, data?.collection.latestBatch?.id]));
  const [publishedContextKey, setPublishedContextKey] = useState<string | null>(null);
  const contextCurrent = publishedContextKey === pageOperation.contextKey;
  const [artifactNoticeValue, setArtifactNotice] = useState<string | null>(null);
  const [openingArtifactKeyValue, setOpeningArtifactKey] = useState<string | null>(null);
  const [ruleConfigValue, setRuleConfig] = useState(() => normalizeRuleConfig(null));
  const [aiStatusValue, setAiStatus] = useState(() => dashboardAiStatus(null));
  const [pendingRecommendationsValue, setPendingRecommendations] = useState<RecommendationView[]>([]);
  const [reviewRecommendationsValue, setReviewRecommendations] = useState<RecommendationView[]>([]);
  const [approvedRecommendationsValue, setApprovedRecommendations] = useState<RecommendationView[]>([]);
  const [aiDiagnosisRunsValue, setAiDiagnosisRuns] = useState<AiDiagnosisRunView[]>([]);
  const [deliveryReadinessValue, setDeliveryReadiness] = useState<DeliveryReadinessView | null>(null);
  const [deliveryEvidenceStatusValue, setDeliveryEvidenceStatus] = useState<DeliveryEvidenceStatusView | null>(null);
  const artifactNotice = contextCurrent ? artifactNoticeValue : null;
  const openingArtifactKey = contextCurrent ? openingArtifactKeyValue : null;
  const ruleConfig = contextCurrent ? ruleConfigValue : normalizeRuleConfig(null);
  const aiStatus = contextCurrent ? aiStatusValue : dashboardAiStatus(null);
  const pendingRecommendations = contextCurrent ? pendingRecommendationsValue : [];
  const reviewRecommendations = contextCurrent ? reviewRecommendationsValue : [];
  const approvedRecommendations = contextCurrent ? approvedRecommendationsValue : [];
  const aiDiagnosisRuns = contextCurrent ? aiDiagnosisRunsValue : [];
  const deliveryReadiness = contextCurrent ? deliveryReadinessValue : null;
  const deliveryEvidenceStatus = contextCurrent ? deliveryEvidenceStatusValue : null;
  const collection = data?.collection;
  const quant = data?.quant;
  const hasMetrics = Boolean(quant?.hasImportedMetrics);
  const realReportCount = realReportCoverageCount(collection);
  const importedReportTypeCount = importedReportTypeCoverageCount(collection);
  const importedRows = collection?.fileAudit?.importedRowCount ?? quant?.importedRows ?? 0;
  const actionableRows = quant?.actionableRows ?? 0;
  const hasRealFiles = hasRealReportCoverage(collection);
  const isQuantifiable = dashboardCanGenerateFormalRecommendations({
    realReportCount,
    importedReportTypeCount,
    importedRows,
    actionableRows,
    hasImportedMetrics: hasMetrics,
  });
  const acosPercent = (quant?.acos ?? 0) * 100;
  const operatingJudgment = isQuantifiable
    ? (quant?.acos ?? 0) >= ruleConfig.highAcosThreshold
      ? 'ACOS 偏高，先复核高花费/低转化对象'
      : quant?.totalOrders
        ? '已有订单，优先复核可降本与可扩量对象'
        : '已有花费但缺订单，先定位浪费对象'
    : '当前范围缺少真实报表或导入指标';
  const metricStatusCopy = dashboardMetricStatusCopy({
    isQuantifiable,
    canGenerateFormalRecommendations: isQuantifiable,
    hasRealFiles,
    realReportCount,
    importedRows,
    actionableRows,
    hasMetrics,
    operatingJudgment,
  });
  const deliveryMatrix = useMemo(() => buildDeliveryReadinessMatrix({
    ...buildDeliveryReadinessMatrixInput({
      data,
      readiness: deliveryReadiness,
      evidenceStatus: deliveryEvidenceStatus,
      aiAvailable: aiStatus.label === 'AI 可用',
      aiDiagnosisRuns,
      pendingRecommendations,
      needsReviewRecommendations: reviewRecommendations,
      approvedRecommendations,
    }),
    realReportCount,
    importedReportTypeCount,
    importedRows,
    actionableRows,
  }), [
    actionableRows,
    aiStatus.label,
    approvedRecommendations.length,
    data,
    deliveryEvidenceStatus,
    deliveryReadiness,
    importedReportTypeCount,
    importedRows,
    aiDiagnosisRuns,
    pendingRecommendations.length,
    reviewRecommendations.length,
    realReportCount,
  ]);
  const pendingRecommendationCount = pendingRecommendations.length;
  const reviewRecommendationCount = reviewRecommendations.length;
  const actionRecommendationCount = pendingRecommendationCount + reviewRecommendationCount;
  const decisionSummary = dashboardDecisionSummary({
    actionRecommendationCount,
    reviewRecommendationCount,
    approvedRecommendationCount: approvedRecommendations.length,
    canGenerateFormalRecommendations: isQuantifiable,
  });
  const visibleDeliveryItems = useMemo(() => dashboardVisibleDeliveryItems(deliveryMatrix.items), [deliveryMatrix.items]);
  const normalizedVisibleDeliveryItems = useMemo(() => visibleDeliveryItems.map((item) => dashboardNormalizeDeliveryItem(item, {
    canGenerateFormalRecommendations: isQuantifiable,
    hasRealFiles,
    realReportCount,
    importedReportTypeCount,
    importedRows,
    actionableRows,
  })), [actionableRows, hasRealFiles, importedReportTypeCount, importedRows, isQuantifiable, realReportCount, visibleDeliveryItems]);
  const hiddenDeliveryItemCount = Math.max(0, deliveryMatrix.items.length - visibleDeliveryItems.length);
  const productHistoryLedgers = data?.productHistory?.ledgers || [];
  const selectedScopeAsin = String(scope.asin || '').trim().toUpperCase();
  const selectedProductContext = (data?.productContext?.products || []).find((product) => product.asin.toUpperCase() === selectedScopeAsin);
  const hasProductScope = Boolean(selectedScopeAsin);
  const aiWorkStatus = dashboardAiWorkStatus(aiStatus, aiDiagnosisRuns);
  const currentDataGateAction = dashboardDataGateAction({
    canGenerateFormalRecommendations: isQuantifiable,
    hasRealFiles,
    hasMetrics,
    realReportCount,
    importedReportTypeCount,
    importedRows,
    actionableRows,
  });
  const recommendationHealthSummary = dashboardRecommendationHealthSummary({
    isQuantifiable,
    gateRoute: currentDataGateAction.route,
    gateLabel: currentDataGateAction.label,
    aiWorkStatus,
    actionRecommendationCount,
    pendingRecommendationCount,
    reviewRecommendationCount,
  });
  const primaryProductHistory = dashboardSelectProductHistory(productHistoryLedgers, selectedScopeAsin);
  const primaryProductTrendDays = primaryProductHistory?.daily.slice(-4) || [];
  const dataGateLabel = dashboardDataGateLabel({
    canGenerateFormalRecommendations: isQuantifiable,
    hasRealFiles,
    hasMetrics,
    realReportCount,
    importedReportTypeCount,
    importedRows,
    actionableRows,
  });
  const workflowQuantNext = dashboardWorkflowQuantNext({
    canGenerateFormalRecommendations: isQuantifiable,
    hasMetrics,
    hasRealFiles,
    realReportCount,
    importedReportTypeCount,
    importedRows,
    actionableRows,
  });
  const deliveryPrimaryAction = dashboardDeliveryPrimaryAction({
    canGenerateFormalRecommendations: isQuantifiable,
    deliveryStatus: deliveryMatrix.status,
    gateRoute: workflowQuantNext.route,
    gateLabel: workflowQuantNext.label,
    matrixLabel: deliveryMatrix.primaryNextAction,
  });
  const deliveryHeadline = dashboardDeliveryHeadline({
    canGenerateFormalRecommendations: isQuantifiable,
    gateRoute: workflowQuantNext.route,
    gateLabel: workflowQuantNext.label,
    matrixHeadline: deliveryMatrix.headline,
  });
  const riskObjectFallbackCopy = dashboardRiskObjectFallbackCopy({
    isQuantifiable,
    hasRealFiles,
    importedRows,
    actionableRows,
  });
  const dashboardProductEntryTone: 'ready' | 'warning' = hasProductScope && primaryProductHistory ? 'ready' : 'warning';
  const productCostValue = selectedProductContext?.cost?.purchaseCost;
  const productCostCopy = Number.isFinite(Number(productCostValue)) && Number(productCostValue) > 0 ? formatUsd(productCostValue) : '成本未填';
  const productTargetAcosValue = selectedProductContext?.cost?.targetAcos;
  const productTargetAcosCopy = Number.isFinite(Number(productTargetAcosValue)) && Number(productTargetAcosValue) > 0
    ? formatPercent(Number(productTargetAcosValue) * 100)
    : formatPercent(ruleConfig.targetAcos * 100);

  useEffect(() => {
    let cancelled = false;
    const canPublish = pageOperation.capture();
    setArtifactNotice(null); setOpeningArtifactKey(null);
    setRuleConfig(normalizeRuleConfig(null)); setAiStatus(dashboardAiStatus(null));
    setPendingRecommendations([]); setReviewRecommendations([]); setApprovedRecommendations([]);
    setAiDiagnosisRuns([]); setDeliveryReadiness(null); setDeliveryEvidenceStatus(null);
    setPublishedContextKey(pageOperation.contextKey);
    async function loadDashboardContext() {
      const effectiveBatchId = scope.batchId || data?.collection.latestBatch?.id;
      try {
        if (!pageOperation.hasAuthority || !canPublish()) return;
        const config = await (window as any).electronAPI?.getRuleConfig?.();
        if (!cancelled && canPublish()) setRuleConfig(normalizeRuleConfig(config));
      } catch (caught) {
      rendererRuntimeLog.error('renderer.dashboard_workspace.failed', { error: caught });
        if (!cancelled && canPublish()) setRuleConfig(normalizeRuleConfig(null));
      }
      try {
        if (!pageOperation.hasAuthority || !canPublish()) return;
        const settings = await (window as any).electronAPI?.getSettings?.();
        if (!cancelled && canPublish()) setAiStatus(dashboardAiStatus(settings));
      } catch (caught) {
      rendererRuntimeLog.error('renderer.dashboard_workspace.failed', { error: caught });
        if (!cancelled && canPublish()) setAiStatus(dashboardAiStatus(null));
      }
      try {
        if (!pageOperation.hasAuthority || !canPublish()) return;
        const rowsByStatus = await Promise.all(dashboardRecommendationStatusFilters().map(async (status) => {
          const rows = await (window as any).electronAPI?.getRecommendations?.({
            dateFrom: scope.dateFrom,
            dateTo: scope.dateTo,
            storeName: scope.storeName,
            marketplaceCode: scope.marketplaceCode,
            asin: scope.asin,
            batchId: effectiveBatchId,
            status,
            limit: 20,
          });
          return Array.isArray(rows) ? rows : [];
        }));
        if (!cancelled && canPublish()) {
          setPendingRecommendations(rowsByStatus[0] || []);
          setReviewRecommendations(rowsByStatus[1] || []);
        }
      } catch (caught) {
      rendererRuntimeLog.error('renderer.dashboard_workspace.failed', { error: caught });
        if (!cancelled && canPublish()) {
          setPendingRecommendations([]);
          setReviewRecommendations([]);
        }
      }
      try {
        if (!pageOperation.hasAuthority || !canPublish()) return;
        const rows = await (window as any).electronAPI?.getRecommendations?.({
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
          batchId: effectiveBatchId,
          status: 'approved',
          limit: 20,
        });
        if (!cancelled && canPublish()) setApprovedRecommendations(Array.isArray(rows) ? rows : []);
      } catch (caught) {
      rendererRuntimeLog.error('renderer.dashboard_workspace.failed', { error: caught });
        if (!cancelled && canPublish()) setApprovedRecommendations([]);
      }
      try {
        if (!pageOperation.hasAuthority || !canPublish()) return;
        const runs = await (window as any).electronAPI?.listAiDiagnosisRuns?.({
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
          batchId: effectiveBatchId,
          limit: 5,
        });
        if (!cancelled && canPublish()) setAiDiagnosisRuns(Array.isArray(runs) ? runs : []);
      } catch (caught) {
      rendererRuntimeLog.error('renderer.dashboard_workspace.failed', { error: caught });
        if (!cancelled && canPublish()) setAiDiagnosisRuns([]);
      }
      try {
        if (!pageOperation.hasAuthority || !canPublish()) return;
        const readiness = await (window as any).electronAPI?.getDeliveryReadiness?.();
        if (!cancelled && canPublish()) setDeliveryReadiness(readiness || null);
      } catch (caught) {
      rendererRuntimeLog.error('renderer.dashboard_workspace.failed', { error: caught });
        if (!cancelled && canPublish()) setDeliveryReadiness(null);
      }
      try {
        if (!pageOperation.hasAuthority || !canPublish()) return;
        const status = await (window as any).electronAPI?.getDeliveryEvidenceStatus?.({
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
          batchId: effectiveBatchId,
        });
        if (!cancelled && canPublish()) setDeliveryEvidenceStatus(status || null);
      } catch (caught) {
      rendererRuntimeLog.error('renderer.dashboard_workspace.failed', { error: caught });
        if (!cancelled && canPublish()) setDeliveryEvidenceStatus(null);
      }
    }

    loadDashboardContext();
    return () => {
      cancelled = true;
    };
  }, [data?.collection.latestBatch?.id, scope.asin, scope.batchId, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName, pageOperation.contextKey]);

  async function openArtifact(artifactId: string, label = '打开工件') {
    if (!pageOperation.hasAuthority) { setArtifactNotice(pageOperation.blockedReason); return; }
    const ticket = pageOperation.begin();
    if (!ticket) return;
    if (!artifactId) {
      setArtifactNotice('打开操作不可用：当前没有已登记的文件或目录。');
      ticket.finish();
      return;
    }
    const artifactKey = dashboardArtifactActionKey(label, artifactId);
    setOpeningArtifactKey(artifactKey);
    setArtifactNotice(`${label}打开中...`);
    try {
      const storeContext = storeAuthority.authoritativeContext;
      if (!storeContext) throw new Error('当前店铺权威不可用。');
      const open = (window as any).electronAPI?.openReportArtifact;
      if (typeof open !== 'function') throw new Error('当前版本未提供文件打开服务，请重新连接当前店铺后重试。');
      await open(artifactId, { ...storeContext });
      if (!ticket.isCurrent()) return;
      setArtifactNotice(`${label}已请求打开。`);
    } catch (caught) {
      rendererRuntimeLog.error('renderer.dashboard_workspace.failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setArtifactNotice(`打开失败：${toUserFacingError(caught, '打开工件失败。')}`);
    } finally {
      if (ticket.isCurrent()) setOpeningArtifactKey(null);
      ticket.finish();
    }
  }

  function renderOpenArtifactButton(input: {
    artifactId: string;
    className?: string;
    idleLabel: string;
    messageLabel?: string;
  }) {
    const messageLabel = input.messageLabel || input.idleLabel;
    const view = dashboardOpenArtifactButtonView({
      activeArtifactKey: openingArtifactKey,
      artifactKey: dashboardArtifactActionKey(messageLabel, input.artifactId),
      baseClassName: input.className,
      idleLabel: input.idleLabel,
    });
    return (
      <WorkspaceActionButton disabledReason={!pageOperation.hasAuthority ? pageOperation.blockedReason : !input.artifactId ? '尚无已登记工件，请先到报表采集完成当前批次。' : '正在打开工件，请等待本次操作完成后重试。'}
        aria-busy={view.ariaBusy}
        className={view.className}
        disabled={view.disabled || !pageOperation.hasAuthority || !input.artifactId}
        onClick={() => openArtifact(input.artifactId, messageLabel)}
        type="button"
      >
        {view.showSpinner && <span aria-hidden="true" className="button-spinner" />}
        <span>{view.label}</span>
      </WorkspaceActionButton>
    );
  }

  const riskQueue = dashboardRiskObjectQueue({
    diagnostics: quant?.diagnostics || [],
    isQuantifiable,
  });
  const riskRows = riskQueue.rows;

  return (
    <div data-workspace="today" data-workspace-evidence-root data-workspace-subview="overview">
      <BusinessDataConfigurationGuard configurationRequired={configurationRequired}>
<PageFrame
        pageId="today-workspace"
        title="今日任务"
        description="先处理当前阻塞，再进入真实对象队列。"
        task={(
          <TaskBanner
            eyebrow="下一安全动作"
            title={nextSafeAction.label}
            description={nextSafeAction.reason}
            tone={nextSafeAction.blocked ? 'blocked' : 'confirmed'}
            status={<StatusPill tone={nextSafeAction.blocked ? 'blocked' : 'ready'}>{nextSafeAction.blocked ? '当前阻塞' : '链路已闭合'}</StatusPill>}
            meta={<span>{hasProductScope ? `当前产品 ${selectedScopeAsin}` : '尚未锁定产品'} · {scope.dateFrom} 至 {scope.dateTo}</span>}
            primaryAction={{
              label: nextSafeAction.label,
              onClick: () => navigate(nextSafeAction.intent),
            }}
          />
        )}
        summary={(
          <SummaryStrip
            ariaLabel="今日运营决策摘要"
            items={[
              {
                id: 'product',
                label: '当前产品',
                value: hasProductScope ? selectedScopeAsin : '待锁定',
                detail: hasProductScope ? productStageLabel(selectedProductContext?.productStage || primaryProductHistory?.inferredStage) : '先选择运营对象',
              },
              {
                id: 'data',
                label: '逐类入库',
                value: `${importedReportTypeCount}/8 类`,
                detail: importedRows > 0
                  ? `报表文件 ${realReportCount}/8 类 · ${importedRows} 行`
                  : `报表文件 ${realReportCount}/8 类 · ${dataGateLabel}`,
              },
              {
                id: 'performance',
                label: '广告表现',
                value: isQuantifiable ? `ACOS ${formatPercent(acosPercent)}` : '待量化',
                detail: isQuantifiable ? `花费 ${formatUsd(quant?.totalSpend)} · 销售 ${formatUsd(quant?.totalSales)}` : metricStatusCopy.performanceDetail,
              },
              {
                id: 'decisions',
                label: '待判断',
                value: decisionSummary.value,
                detail: decisionSummary.detail,
              },
            ]}
          />
        )}
      >
        <WorkbenchPanel
          title="风险对象队列"
          description="按真实花费、转化与风险判断，先处理最需要人工复核的对象。"
          status={<StatusPill tone={riskQueue.status.tone}>{riskQueue.status.label}</StatusPill>}
          toolbar={isQuantifiable ? (
            <button
              className="secondary-button"
              data-action-priority="secondary"
              onClick={() => navigate('ad-quant')}
              type="button"
            >
              查看完整诊断
            </button>
          ) : undefined}
          footer={(
            <div className={`workbench-context-bar dashboard-product-entry-${dashboardProductEntryTone}`} aria-label="当前产品上下文">
              <div>
                <span>{hasProductScope ? '当前产品' : '产品上下文'}</span>
                <strong>{hasProductScope ? `ASIN ${selectedScopeAsin}${selectedProductContext?.title ? ` · ${selectedProductContext.title}` : ''}` : '尚未锁定产品'}</strong>
                <p>{hasProductScope ? `阶段 ${productStageLabel(selectedProductContext?.productStage || primaryProductHistory?.inferredStage)} · ${productCostCopy} · 目标 ACOS ${productTargetAcosCopy}` : '锁定产品后，范围、数据、建议和回读会保持在同一对象上。'}</p>
              </div>
              {hasProductScope && (
                <button
                  className="secondary-button"
                  data-action-priority="secondary"
                  onClick={() => navigate('product-management')}
                  type="button"
                >
                  管理当前产品
                </button>
              )}
            </div>
          )}
        >
          {loading && !data ? (
            <WorkspaceState kind="loading" description="正在读取当前范围的真实报表、广告指标和风险对象。" />
          ) : error ? (
            <WorkspaceState
              kind="error"
              description={`读取当前范围失败：${error}`}
              action={{
                label: '重试读取',
                onClick: reload,
                ariaLabel: '重新读取当前范围数据',
              }}
            />
          ) : riskRows.length ? (
            <PriorityDataTable
              caption="当前范围风险对象"
              rows={riskRows}
              columns={dashboardRiskColumns}
              getRowKey={(row) => [row.objectType, row.objectName, row.asin, row.campaignName, row.adGroupName, row.spend, row.diagnosis].join('|')}
              rowAriaLabel={(row) => `${row.objectName || row.asin || '广告对象'}，${row.diagnosis || '待复核'}`}
            />
          ) : (
            <WorkspaceState
              kind={isQuantifiable ? 'empty' : 'blocked'}
              description={riskObjectFallbackCopy}
            />
          )}
        </WorkbenchPanel>

        <ProgressiveDetails title="数据、产品历史与交付明细">
          <div className="workspace-technical-surface">
            <section aria-labelledby="today-data-health-title">
              <div className="workspace-technical-heading">
                <div>
                  <span>辅助状态</span>
                  <h3 id="today-data-health-title">数据健康</h3>
                </div>
                <StatusPill tone={isQuantifiable ? 'ready' : hasRealFiles ? 'warning' : 'blocked'}>{dataGateLabel}</StatusPill>
              </div>
              <StateLightGrid
                items={[
                  {
                    label: '当前范围',
                    value: hasProductScope ? `产品 ${selectedScopeAsin}` : '未选产品',
                    detail: `${scope.dateFrom} 至 ${scope.dateTo} / ${scope.storeName || '-'} / ${scope.marketplaceCode || '-'}`,
                    tone: hasProductScope ? 'ready' : 'blocked',
                  },
                  {
                    label: '数据门槛',
                    value: `${realReportCount}/8 类 · ${importedRows} 行`,
                    detail: metricStatusCopy.dataGateDetail,
                    tone: isQuantifiable ? 'ready' : hasRealFiles ? 'warning' : 'blocked',
                  },
                  {
                    label: 'AI / 建议',
                    value: recommendationHealthSummary.label,
                    detail: recommendationHealthSummary.detail,
                    tone: pendingRecommendationCount > 0 ? 'warning' : reviewRecommendationCount > 0 ? 'pending' : isQuantifiable ? 'ready' : 'blocked',
                  },
                  {
                    label: '广告表现',
                    value: isQuantifiable ? `${formatUsd(quant?.totalSpend)} / ACOS ${formatPercent(acosPercent)}` : '-',
                    detail: metricStatusCopy.performanceDetail,
                    tone: isQuantifiable ? 'ready' : 'pending',
                  },
                ]}
              />
            </section>

            <section aria-labelledby="today-product-history-title">
              <div className="workspace-technical-heading">
                <div>
                  <span>当前产品</span>
                  <h3 id="today-product-history-title">广告历史摘要</h3>
                </div>
                <StatusPill tone={primaryProductHistory ? 'ready' : 'warning'}>{primaryProductHistory ? `${primaryProductHistory.activeDays} 天` : '待入库'}</StatusPill>
              </div>
              {primaryProductHistory ? (
                <div className="dashboard-history-summary-grid" aria-label="广告历史账本摘要">
                  <div><span>累计花费</span><strong>{formatUsd(primaryProductHistory.totals.cost)}</strong><small>{primaryProductHistory.firstMetricDate || primaryProductHistory.dateFrom} 起</small></div>
                  <div><span>累计销售</span><strong>{formatUsd(primaryProductHistory.totals.sales)}</strong><small>{primaryProductHistory.totals.orders} 单</small></div>
                  <div><span>累计 ACOS</span><strong>{formatPercent(primaryProductHistory.totals.acos * 100)}</strong><small>阶段 {productStageLabel(primaryProductHistory.inferredStage)}</small></div>
                  <div><span>近 4 日趋势</span><strong>{primaryProductTrendDays.length ? `${primaryProductTrendDays.length} 天` : '-'}</strong><small>{primaryProductTrendDays.length ? `${formatUsd(primaryProductTrendDays.reduce((sum, day) => sum + Number(day.cost || 0), 0))} 花费` : '暂无日级数据'}</small></div>
                </div>
              ) : (
                <p className="muted-line">{hasProductScope ? '当前产品还没有形成按 ASIN 汇总的广告历史。' : '锁定产品后展示该产品的历史账本。'}</p>
              )}
            </section>

            <section aria-labelledby="today-delivery-title">
              <div className="workspace-technical-heading">
                <div>
                  <span>正式验收</span>
                  <h3 id="today-delivery-title">交付缺口</h3>
                </div>
                <StatusPill tone={deliveryMatrix.status === 'ready' ? 'ready' : deliveryMatrix.status === 'blocked' ? 'blocked' : 'warning'}>已闭合 {deliveryMatrix.readyCount}/{deliveryMatrix.totalCount}</StatusPill>
              </div>
              <p className="workspace-technical-lead"><strong>{deliveryHeadline}</strong></p>
              <ul className="workspace-gap-list">
                {normalizedVisibleDeliveryItems.map((item) => (
                  <li key={item.key}>
                    <div><strong>{item.label}</strong><span>{item.detail}</span></div>
                    <StatusPill tone={item.tone}>{item.statusLabel}</StatusPill>
                  </li>
                ))}
              </ul>
              {hiddenDeliveryItemCount > 0 && <p className="muted-line">其余 {hiddenDeliveryItemCount} 项在系统与交付工作区查看。</p>}
              <button className="secondary-button" data-action-priority="secondary" onClick={() => navigate(deliveryPrimaryAction.route)} type="button">{deliveryPrimaryAction.label}</button>
            </section>

            <section aria-labelledby="today-evidence-path-title">
              <div className="workspace-technical-heading">
                <div>
                  <span>本地证据</span>
                  <h3 id="today-evidence-path-title">最近证据工件</h3>
                </div>
                <StatusPill tone={collection?.evidenceArtifacts.length ? 'ready' : 'warning'}>{collection?.evidenceArtifacts.length || 0} 个入口</StatusPill>
              </div>
              {collection?.evidenceArtifacts.length ? (
                <div className="path-list">
                  {collection.evidenceArtifacts.map((item) => (
                    <div className="path-row" key={`${item.kind}-${item.artifactId}`}>
                      <span>{item.label}</span>
                      <code title={item.displayName}>{item.displayName}</code>
                      {renderOpenArtifactButton({ artifactId: item.artifactId, className: 'secondary-button compact-button', idleLabel: '打开', messageLabel: `打开${item.label}` })}
                    </div>
                  ))}
                  {artifactNotice && <p className={artifactNotice.startsWith('打开失败') ? 'blocked-line' : 'muted-line'}>{artifactNotice}</p>}
                </div>
              ) : (
                <p className="muted-line">当前还没有可打开的真实报表或已登记证据工件。</p>
              )}
            </section>
          </div>
        </ProgressiveDetails>
      </PageFrame>
</BusinessDataConfigurationGuard>
    </div>
  );
}
