import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { buildDeliveryReadinessMatrix, buildDeliveryReadinessMatrixInput, type DeliveryMatrixItem } from '../delivery-readiness-matrix';
import { compactPath, formatPercent, formatUsd } from '../formatters';
import { operatorFacingAiError } from '../ai-call-diagnostics';
import { hasRealReportCoverage, realReportCoverageCount } from '../report-coverage';
import type { AiDiagnosisRunView, AppRoute, DeliveryEvidenceStatusView, DeliveryReadinessView, RecommendationView, SettingsRuleConfig } from '../types';
import { toUserFacingError } from '../user-facing-error';

type DashboardRecommendationStatus = 'pending' | 'needs_review';

export function dashboardRecommendationStatusFilters(): DashboardRecommendationStatus[] {
  return ['pending', 'needs_review'];
}

export function dashboardVisibleDeliveryItems(items: DeliveryMatrixItem[], limit = 3): DeliveryMatrixItem[] {
  const unfinished = items.filter((item) => item.tone !== 'ready');
  return (unfinished.length ? unfinished : items).slice(0, limit);
}

export function dashboardDataGateDetail(input: {
  isQuantifiable: boolean;
  hasRealFiles: boolean;
  realReportCount: number;
  importedRows: number;
  actionableRows: number;
}): string {
  if (input.isQuantifiable) {
    return `${input.realReportCount}/8 类真实报表，${input.importedRows} 行广告指标，其中 ${input.actionableRows} 行可生成建议。`;
  }
  if (input.hasRealFiles) {
    if (input.importedRows > 0) {
      return `${input.realReportCount}/8 类真实报表已导入 ${input.importedRows} 行指标，但未达到正式建议门槛；需补齐 8 类真实报表。`;
    }
    return `${input.realReportCount}/8 类真实报表尚未导入量化指标。`;
  }
  return '还没有 xlsx/xls/csv 原始广告表格，不能计算 ACOS 或生成建议。';
}

export function dashboardCanGenerateFormalRecommendations(input: {
  realReportCount: number;
  importedRows: number;
  actionableRows: number;
  hasImportedMetrics: boolean;
}): boolean {
  return input.realReportCount >= 8
    && input.importedRows > 0
    && input.actionableRows > 0
    && input.hasImportedMetrics;
}

export function dashboardDataGateLabel(input: {
  canGenerateFormalRecommendations: boolean;
  hasRealFiles: boolean;
  realReportCount: number;
  importedRows: number;
}): string {
  if (input.canGenerateFormalRecommendations) return '已具备量化条件';
  if (input.hasRealFiles && input.importedRows > 0 && input.realReportCount < 8) return '已导入部分数据，待补齐报表';
  if (input.hasRealFiles) return '已有表格，待导入指标';
  return '缺真实广告表格';
}

export function dashboardTaskEntryStatus(input: {
  canGenerateFormalRecommendations: boolean;
  hasRealFiles: boolean;
  realReportCount: number;
  importedRows: number;
}): string {
  if (input.canGenerateFormalRecommendations) return '可以分析：真实报表和日级指标已闭合';
  if (input.hasRealFiles && input.importedRows > 0 && input.realReportCount < 8) {
    return `不可生成正式建议：当前只完成 ${input.realReportCount}/8 类真实报表`;
  }
  if (input.hasRealFiles) return '不可分析：真实报表未入库';
  return '不可分析：缺真实报表和入库指标';
}

export function dashboardWorkflowQuantStatus(input: {
  canGenerateFormalRecommendations: boolean;
  hasMetrics: boolean;
  realReportCount: number;
  actionableRows: number;
}): string {
  if (input.canGenerateFormalRecommendations) return `${input.actionableRows} 行可生成建议`;
  if (input.hasMetrics && input.realReportCount < 8) return `${input.actionableRows} 行已导入但未达正式建议门槛`;
  return '缺可行动指标';
}

export function dashboardWorkflowQuantNext(input: {
  canGenerateFormalRecommendations: boolean;
  hasMetrics: boolean;
  hasRealFiles: boolean;
  realReportCount: number;
}): { route: AppRoute; label: string } {
  if (input.canGenerateFormalRecommendations) return { route: 'ad-quant', label: '复核量化诊断' };
  if (input.hasMetrics && input.realReportCount < 8) return { route: 'data-collection', label: '补齐报表' };
  if (input.hasRealFiles) return { route: 'data-import-validation', label: '去导入校验' };
  return { route: 'data-collection', label: '先下载报表' };
}

type DashboardActionQueueItem = {
  title: string;
  detail: string;
  route: AppRoute;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
};

export function dashboardDataActionQueueBlocker(input: {
  canGenerateFormalRecommendations: boolean;
  hasRealFiles: boolean;
  hasMetrics: boolean;
  realReportCount: number;
}): DashboardActionQueueItem | null {
  if (!input.hasRealFiles) {
    return {
      title: '补齐真实报表',
      detail: '先下载或重新创建当前范围 8 类 Lingxing 广告报表。',
      route: 'data-collection',
      tone: 'blocked',
    };
  }
  if (!input.hasMetrics) {
    return {
      title: '导入广告指标',
      detail: '当前已有表格，但还没有入库指标，先进入数据导入与校验页写入本地指标。',
      route: 'data-import-validation',
      tone: 'warning',
    };
  }
  if (!input.canGenerateFormalRecommendations && input.realReportCount < 8) {
    return {
      title: '补齐 8 类真实报表',
      detail: `当前只完成 ${input.realReportCount}/8 类真实报表；已有指标可用于预览，但不能生成正式优化建议。`,
      route: 'data-collection',
      tone: 'blocked',
    };
  }
  return null;
}

const DEFAULT_DASHBOARD_RULE_CONFIG = {
  targetAcos: 0.25,
  highAcosThreshold: 0.4,
  noOrderClickThreshold: 30,
  minSpend: 10,
};

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeRuleConfig(config: Partial<SettingsRuleConfig> | null | undefined) {
  return {
    targetAcos: readNumber(config?.targetAcos, DEFAULT_DASHBOARD_RULE_CONFIG.targetAcos),
    highAcosThreshold: readNumber(config?.highAcosThreshold, DEFAULT_DASHBOARD_RULE_CONFIG.highAcosThreshold),
    noOrderClickThreshold: readNumber(config?.noOrderClickThreshold, DEFAULT_DASHBOARD_RULE_CONFIG.noOrderClickThreshold),
    minSpend: readNumber(config?.minSpend, DEFAULT_DASHBOARD_RULE_CONFIG.minSpend),
  };
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function productStageLabel(stage?: string): string {
  const labels: Record<string, string> = {
    cold_start: '冷启动',
    keyword_exploration: '测词',
    stable_conversion: '稳定转化',
    scaling: '放量',
    profit_harvesting: '利润收割',
    declining_repair: '异常修复',
    unknown: '阶段待判定',
  };
  return labels[stage || 'unknown'] || stage || '阶段待判定';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function normalizeBaseUrl(value: unknown): string {
  return readString(value).replace(/\/+$/, '');
}

type DashboardStatusCard = {
  label: string;
  detail: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
  route?: AppRoute;
  actionLabel?: string;
};

export function dashboardAiStatus(settings: Record<string, unknown> | null | undefined): {
  label: string;
  detail: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
} {
  if (!settings) {
    return {
      label: 'AI 状态未读取',
      detail: '设置接口不可用时，建议仍可使用规则兜底，但不会标记 AI 已参与。',
      tone: 'pending',
    };
  }
  const keyConfigured = readBoolean(settings.aiKeyConfigured ?? settings.ai_key_configured)
    || Boolean(readString(settings.aiApiKey ?? settings.ai_api_key));
  const baseUrl = readString(settings.aiBaseUrl ?? settings.ai_base_url) || 'https://api.deepseek.com';
  const model = readString(settings.aiModel ?? settings.ai_model) || 'deepseek-v4-flash';
  const testedBase = normalizeBaseUrl(settings.aiLastTestBaseUrl ?? settings.ai_last_test_base_url);
  const testedModel = readString(settings.aiLastTestModel ?? settings.ai_last_test_model);
  const testStatus = readString(settings.aiLastTestStatus ?? settings.ai_last_test_status);
  if (!keyConfigured) {
    return {
      label: 'AI 未配置',
      detail: '未配置 DeepSeek/OpenAI Compatible Key，优化建议会回落到规则解释。',
      tone: 'warning',
    };
  }
  if (testedBase === normalizeBaseUrl(baseUrl) && testedModel === model && testStatus === 'available') {
    return {
      label: 'AI 可用',
      detail: `${model} 已测试通过；生成建议时参与阶段诊断和动态阈值。`,
      tone: 'ready',
    };
  }
  if (testedBase === normalizeBaseUrl(baseUrl) && testedModel === model && testStatus === 'failed') {
    return {
      label: 'AI 测试失败',
      detail: readString(settings.aiLastTestMessage ?? settings.ai_last_test_message) || '最近一次连接测试失败，需要到 AI 设置复测。',
      tone: 'blocked',
    };
  }
  return {
    label: 'AI 待测试',
    detail: `${model} 已配置但当前 Base URL/模型未完成可用性测试。`,
    tone: 'pending',
  };
}

function latestDiagnosisRun(runs: AiDiagnosisRunView[]): AiDiagnosisRunView | undefined {
  return [...runs].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
}

export function dashboardAiWorkStatus(baseStatus: DashboardStatusCard, runs: AiDiagnosisRunView[]): DashboardStatusCard {
  const latest = latestDiagnosisRun(runs);
  if (!latest) return baseStatus;

  if (latest.success === false) {
    return {
      label: 'AI 最近诊断失败',
      detail: operatorFacingAiError(latest.errorMessage || latest.diagnosis?.aiFallbackReason || '最近一次 AI 诊断失败，建议到广告量化页查看调用记录并复测 AI 设置。'),
      tone: 'blocked',
      route: 'ad-quant',
      actionLabel: '查看 AI 诊断',
    };
  }

  const insightCount = latest.insights?.length || 0;
  const formalCount = latest.formalRecommendationCount || 0;
  if (formalCount > 0) {
    return {
      label: 'AI 已产出建议',
      detail: `最近一次 AI 诊断形成 ${formalCount} 条正式建议，另有 ${insightCount} 条洞察。继续到优化建议页查看证据和审批状态。`,
      tone: 'ready',
      route: 'recommendations',
      actionLabel: '去建议页',
    };
  }

  if (insightCount > 0) {
    return {
      label: 'AI 有洞察待补证据',
      detail: `最近一次 AI 诊断产生 ${insightCount} 条洞察，但因证据引用或广告对象绑定不足未进入建议池。先补齐证据引用、来源行和广告活动/广告组/关键词绑定。`,
      tone: 'warning',
      route: 'ad-quant',
      actionLabel: '查看 AI 诊断',
    };
  }

  if (latest.diagnosis?.summary) {
    return {
      label: 'AI 已完成诊断',
      detail: latest.diagnosis.summary,
      tone: 'pending',
      route: 'ad-quant',
      actionLabel: '查看诊断',
    };
  }

  return baseStatus;
}

export function DashboardPage() {
  const { data, error, loading, scope } = useBusinessDataPipeline();
  const [pathNotice, setPathNotice] = useState<string | null>(null);
  const [ruleConfig, setRuleConfig] = useState(() => normalizeRuleConfig(null));
  const [aiStatus, setAiStatus] = useState(() => dashboardAiStatus(null));
  const [pendingRecommendations, setPendingRecommendations] = useState<RecommendationView[]>([]);
  const [reviewRecommendations, setReviewRecommendations] = useState<RecommendationView[]>([]);
  const [approvedRecommendations, setApprovedRecommendations] = useState<RecommendationView[]>([]);
  const [aiDiagnosisRuns, setAiDiagnosisRuns] = useState<AiDiagnosisRunView[]>([]);
  const [deliveryReadiness, setDeliveryReadiness] = useState<DeliveryReadinessView | null>(null);
  const [deliveryEvidenceStatus, setDeliveryEvidenceStatus] = useState<DeliveryEvidenceStatusView | null>(null);
  const collection = data?.collection;
  const quant = data?.quant;
  const hasMetrics = Boolean(quant?.hasImportedMetrics);
  const realReportCount = realReportCoverageCount(collection);
  const importedRows = collection?.fileAudit?.importedRowCount ?? quant?.importedRows ?? 0;
  const actionableRows = quant?.actionableRows ?? 0;
  const hasRealFiles = hasRealReportCoverage(collection);
  const isQuantifiable = dashboardCanGenerateFormalRecommendations({
    realReportCount,
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
    importedRows,
    actionableRows,
  }), [
    actionableRows,
    aiStatus.label,
    approvedRecommendations.length,
    data,
    deliveryEvidenceStatus,
    deliveryReadiness,
    importedRows,
    aiDiagnosisRuns,
    pendingRecommendations.length,
    reviewRecommendations.length,
    realReportCount,
  ]);
  const pendingRecommendationCount = pendingRecommendations.length;
  const reviewRecommendationCount = reviewRecommendations.length;
  const actionRecommendationCount = pendingRecommendationCount + reviewRecommendationCount;
  const visibleDeliveryItems = useMemo(() => dashboardVisibleDeliveryItems(deliveryMatrix.items), [deliveryMatrix.items]);
  const hiddenDeliveryItemCount = Math.max(0, deliveryMatrix.items.length - visibleDeliveryItems.length);
  const productHistoryLedgers = data?.productHistory?.ledgers || [];
  const aiWorkStatus = dashboardAiWorkStatus(aiStatus, aiDiagnosisRuns);
  const primaryProductHistory = productHistoryLedgers[0];
  const primaryProductTrendDays = primaryProductHistory?.daily.slice(-4) || [];
  const primaryProductMaxDailyCost = Math.max(1, ...primaryProductTrendDays.map((item) => Number(item.cost || 0)));
  const topDiagnostic = quant?.diagnostics?.[0];
  const highAcosDiagnostics = (quant?.diagnostics || []).filter((item) => item.acos >= ruleConfig.highAcosThreshold && item.spend >= ruleConfig.minSpend);
  const noOrderDiagnostics = (quant?.diagnostics || []).filter((item) => item.orders === 0 && (item.spend >= ruleConfig.minSpend || item.clicks >= ruleConfig.noOrderClickThreshold));
  const actionQueue = useMemo(() => {
    const dataBlocker = dashboardDataActionQueueBlocker({
      canGenerateFormalRecommendations: isQuantifiable,
      hasRealFiles,
      hasMetrics,
      realReportCount,
    });
    if (dataBlocker) return [dataBlocker];
    return [
      {
        title: highAcosDiagnostics.length ? '先复核高 ACOS' : '复核量化明细',
        detail: highAcosDiagnostics.length
          ? `${highAcosDiagnostics.length} 个对象超过 ${formatPercent(ruleConfig.highAcosThreshold * 100)} 且花费达到 ${formatUsd(ruleConfig.minSpend)}。`
          : '暂无超过风险线的对象，仍需检查高花费和相关性。',
        route: 'ad-quant' as AppRoute,
        tone: highAcosDiagnostics.length ? 'warning' as const : 'pending' as const,
      },
      {
        title: noOrderDiagnostics.length ? '处理无订单花费' : '检查无订单风险',
        detail: noOrderDiagnostics.length
          ? `${noOrderDiagnostics.length} 个对象达到无订单阈值，先判断是否降价、否词或暂停。`
          : `无订单对象未达到 ${ruleConfig.noOrderClickThreshold} 点击或 ${formatUsd(ruleConfig.minSpend)} 门槛。`,
        route: 'ad-quant' as AppRoute,
        tone: noOrderDiagnostics.length ? 'warning' as const : 'pending' as const,
      },
      {
        title: '生成优化建议',
        detail: '量化复核后进入建议页生成 AI/规则解释，再走审批和回读。',
        route: 'recommendations' as AppRoute,
        tone: 'pending' as const,
      },
    ];
  }, [hasMetrics, hasRealFiles, highAcosDiagnostics.length, isQuantifiable, noOrderDiagnostics.length, realReportCount, ruleConfig.highAcosThreshold, ruleConfig.minSpend, ruleConfig.noOrderClickThreshold]);
  const dataGateLabel = dashboardDataGateLabel({
    canGenerateFormalRecommendations: isQuantifiable,
    hasRealFiles,
    realReportCount,
    importedRows,
  });
  const workflowQuantNext = dashboardWorkflowQuantNext({
    canGenerateFormalRecommendations: isQuantifiable,
    hasMetrics,
    hasRealFiles,
    realReportCount,
  });
  const workflowSteps = [
    {
      id: 'collect',
      route: 'data-collection' as AppRoute,
      title: '1. 获取真实报表',
      status: hasRealFiles ? '已拿到原始文件' : '缺原始文件',
      tone: hasRealFiles ? 'ready' : 'blocked',
      next: hasRealFiles ? '查看文件与导入结果' : '去数据采集',
    },
    {
      id: 'quant',
      route: workflowQuantNext.route,
      title: '2. 广告量化',
      status: dashboardWorkflowQuantStatus({
        canGenerateFormalRecommendations: isQuantifiable,
        hasMetrics,
        realReportCount,
        actionableRows,
      }),
      tone: isQuantifiable ? 'ready' : 'blocked',
      next: workflowQuantNext.label,
    },
    {
      id: 'recommendations',
      route: 'recommendations' as AppRoute,
      title: '3. 生成建议',
      status: isQuantifiable ? '可生成建议' : '等待真实数据',
      tone: isQuantifiable ? 'pending' : 'blocked',
      next: isQuantifiable ? '生成优化建议' : '先完成量化',
    },
    {
      id: 'approval',
      route: isQuantifiable ? 'approval' as AppRoute : 'data-collection' as AppRoute,
      title: '4. 审批与执行回读',
      status: isQuantifiable ? '建议生成后进入审批' : '等待真实数据',
      tone: isQuantifiable ? 'pending' : 'blocked',
      next: isQuantifiable ? '去审批中心' : '先完成量化',
    },
  ] as const;
  const taskEntryStatus = dashboardTaskEntryStatus({
    canGenerateFormalRecommendations: isQuantifiable,
    hasRealFiles,
    realReportCount,
    importedRows,
  });
  const taskEntryNext = isQuantifiable
    ? '下一步：复核广告量化'
    : hasRealFiles
      ? '下一步：导入日级指标'
      : '下一步：先获取真实报表';
  const taskEntryRoute: AppRoute = isQuantifiable ? 'ad-quant' : hasRealFiles ? 'data-import-validation' : 'data-collection';

  useEffect(() => {
    let cancelled = false;
    async function loadDashboardContext() {
      const effectiveBatchId = scope.batchId || data?.collection.latestBatch?.id;
      try {
        const config = await (window as any).electronAPI?.getRuleConfig?.();
        if (!cancelled) setRuleConfig(normalizeRuleConfig(config));
      } catch {
        if (!cancelled) setRuleConfig(normalizeRuleConfig(null));
      }
      try {
        const settings = await (window as any).electronAPI?.getSettings?.();
        if (!cancelled) setAiStatus(dashboardAiStatus(settings));
      } catch {
        if (!cancelled) setAiStatus(dashboardAiStatus(null));
      }
      try {
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
        if (!cancelled) {
          setPendingRecommendations(rowsByStatus[0] || []);
          setReviewRecommendations(rowsByStatus[1] || []);
        }
      } catch {
        if (!cancelled) {
          setPendingRecommendations([]);
          setReviewRecommendations([]);
        }
      }
      try {
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
        if (!cancelled) setApprovedRecommendations(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setApprovedRecommendations([]);
      }
      try {
        const runs = await (window as any).electronAPI?.listAiDiagnosisRuns?.({
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
          batchId: effectiveBatchId,
          limit: 5,
        });
        if (!cancelled) setAiDiagnosisRuns(Array.isArray(runs) ? runs : []);
      } catch {
        if (!cancelled) setAiDiagnosisRuns([]);
      }
      try {
        const readiness = await (window as any).electronAPI?.getDeliveryReadiness?.();
        if (!cancelled) setDeliveryReadiness(readiness || null);
      } catch {
        if (!cancelled) setDeliveryReadiness(null);
      }
      try {
        const status = await (window as any).electronAPI?.getDeliveryEvidenceStatus?.({
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
          batchId: effectiveBatchId,
        });
        if (!cancelled) setDeliveryEvidenceStatus(status || null);
      } catch {
        if (!cancelled) setDeliveryEvidenceStatus(null);
      }
    }

    loadDashboardContext();
    return () => {
      cancelled = true;
    };
  }, [data?.collection.latestBatch?.id, scope.asin, scope.batchId, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);

  async function openPath(targetPath: string) {
    try {
      await (window as any).electronAPI?.openReportPath?.(targetPath);
      setPathNotice(`已请求打开：${compactPath(targetPath)}`);
    } catch (caught) {
      setPathNotice(`打开失败：${toUserFacingError(caught, '打开路径失败。')}`);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="运营总览"
        title="仪表盘"
        description="当前范围、真实数据、建议和下一步。"
        primaryTask={taskEntryStatus}
        nextAction={taskEntryNext}
      />

      <div className="business-stack">
        <Panel title="数据健康" tone={isQuantifiable ? 'success' : 'blocked'}>
          <div className="context-summary-grid dashboard-health-grid">
            <div>
              <span>当前范围</span>
              <strong>{dataGateLabel}</strong>
              <p>{scope.dateFrom} 至 {scope.dateTo} / {scope.storeName || '-'} / {scope.marketplaceCode || '-'}</p>
            </div>
            <div>
              <span>数据门槛</span>
              <strong>{realReportCount}/8 类 · {importedRows} 行</strong>
              <p>{hasMetrics ? `${actionableRows} 行可生成建议。` : '先导入真实报表指标。'}</p>
            </div>
            <div>
              <span>AI / 建议</span>
              <strong>{aiWorkStatus.label}</strong>
              <p>{actionRecommendationCount ? `${pendingRecommendationCount} 条待审批，${reviewRecommendationCount} 条需复核。` : aiWorkStatus.detail}</p>
            </div>
            <div>
              <span>广告表现</span>
              <strong>{isQuantifiable ? `${formatUsd(quant?.totalSpend)} / ACOS ${formatPercent(acosPercent)}` : '-'}</strong>
              <p>{isQuantifiable ? operatingJudgment : '等待真实指标导入。'}</p>
            </div>
          </div>
          {loading && <p className="muted-line">正在读取数据状态...</p>}
          {error && <p className="blocked-line">读取接口异常：{error}</p>}
        </Panel>

        <Panel title="今天先做什么" tone={isQuantifiable ? 'success' : 'blocked'}>
          <div className="judgment-panel judgment-panel-compact">
            <div>
              <span>当前主线</span>
              <strong>{taskEntryStatus}</strong>
            </div>
            <button className="primary-button" onClick={() => navigate(taskEntryRoute)} type="button">
              {taskEntryNext}
            </button>
          </div>
          <div className="workflow-strip workflow-strip-compact">
            {workflowSteps.map((step) => (
              <button className="workflow-step" key={step.id} onClick={() => navigate(step.route)} type="button">
                <span>{step.title}</span>
                <strong>{step.status}</strong>
                <StatusPill tone={step.tone}>{step.next}</StatusPill>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="交付状态矩阵" tone={deliveryMatrix.status === 'ready' ? 'success' : deliveryMatrix.status === 'blocked' ? 'blocked' : 'warning'}>
          <div className="judgment-panel">
            <div>
              <span>当前可交付判断</span>
              <strong>{deliveryMatrix.headline}</strong>
              <p>已闭合 {deliveryMatrix.readyCount}/{deliveryMatrix.totalCount} 项；首页只显示最关键缺口。</p>
            </div>
            <button className="primary-button" onClick={() => navigate(deliveryMatrix.status === 'blocked' ? 'data-collection' : 'delivery')} type="button">
              {deliveryMatrix.primaryNextAction}
            </button>
          </div>
          <div className="context-summary-grid">
            {visibleDeliveryItems.map((item) => (
              <button className="context-action-card" key={item.key} onClick={() => navigate(item.route)} type="button">
                <span>{item.label}</span>
                <strong>{item.statusLabel}</strong>
                <p>{item.detail}</p>
                <StatusPill tone={item.tone}>{item.nextAction}</StatusPill>
              </button>
            ))}
          </div>
          {hiddenDeliveryItemCount > 0 && (
            <p className="muted-line">其余 {hiddenDeliveryItemCount} 项证据明细已收起，可到交付验收页查看。</p>
          )}
        </Panel>

        <Panel title="行动队列" tone={isQuantifiable ? 'warning' : 'blocked'}>
          <div className="context-summary-grid">
            {actionQueue.map((item, index) => (
              <button className="context-action-card" key={`${item.title}-${index}`} onClick={() => navigate(item.route)} type="button">
                <span>#{index + 1}</span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <StatusPill tone={item.tone}>{item.route === 'recommendations' ? '去建议页' : item.route === 'ad-quant' ? '去量化页' : item.route === 'data-import-validation' ? '去导入页' : '去采集页'}</StatusPill>
              </button>
            ))}
          </div>
          <p className="muted-line">
            当前规则：目标 ACOS {formatPercent(ruleConfig.targetAcos * 100)} / 风险 ACOS {formatPercent(ruleConfig.highAcosThreshold * 100)} / 无订单 {ruleConfig.noOrderClickThreshold} 点击 / 最低花费 {formatUsd(ruleConfig.minSpend)}。
          </p>
        </Panel>

        <Panel title="首要风险对象" tone={topDiagnostic ? 'warning' : isQuantifiable ? 'default' : 'blocked'}>
          {topDiagnostic ? (
            <div className="detail-grid">
              <div><span>广告组合/活动</span><strong>{topDiagnostic.portfolioName || '-'} / {topDiagnostic.campaignName || '-'}</strong></div>
              <div><span>广告组</span><strong>{topDiagnostic.adGroupName || '-'}</strong></div>
              <div><span>产品/ASIN</span><strong>{topDiagnostic.asin || '-'}</strong></div>
              <div><span>对象</span><strong>{topDiagnostic.objectType || '-'} / {topDiagnostic.objectName || '-'}</strong></div>
              <div><span>花费/销售/订单</span><strong>{formatUsd(topDiagnostic.spend)} / {formatUsd(topDiagnostic.sales)} / {topDiagnostic.orders}</strong></div>
              <div><span>诊断</span><strong>{topDiagnostic.diagnosis}</strong></div>
            </div>
          ) : (
            <p className={isQuantifiable ? 'muted-line' : 'blocked-line'}>
              {isQuantifiable ? '当前范围暂无诊断对象。' : '缺少真实广告表格和导入指标，无法给出风险对象。'}
            </p>
          )}
          <div className="action-row">
            <button className="secondary-button" disabled={!isQuantifiable} onClick={() => navigate('ad-quant')} type="button">查看量化明细</button>
            <button className="secondary-button" disabled={!isQuantifiable} onClick={() => navigate('recommendations')} type="button">生成优化建议</button>
          </div>
        </Panel>

        <Panel title="产品广告历史账本" tone={primaryProductHistory ? 'success' : isQuantifiable ? 'warning' : 'blocked'}>
          {primaryProductHistory ? (
            <details className="dashboard-details">
              <summary>
                {primaryProductHistory.asin} · 阶段 {productStageLabel(primaryProductHistory.inferredStage)} · 活跃 {primaryProductHistory.activeDays} 天
              </summary>
              <div className="business-split">
                <div>
                  <span className="eyebrow">{primaryProductHistory.dateFrom} 至 {primaryProductHistory.dateTo}</span>
                  <strong>{primaryProductHistory.asin}</strong>
                  <p>阶段 {productStageLabel(primaryProductHistory.inferredStage)}</p>
                  <p className="muted-line">
                    活跃 {primaryProductHistory.activeDays} 天；{formatUsd(primaryProductHistory.totals.cost)} 花费 / {formatUsd(primaryProductHistory.totals.sales)} 销售 / {primaryProductHistory.totals.orders} 单 / ACOS {formatPercent(primaryProductHistory.totals.acos * 100)}。
                  </p>
                  {primaryProductHistory.stageReasons?.[0] && <p className="muted-line">{primaryProductHistory.stageReasons[0]}</p>}
                </div>
                <div className="business-pill-row business-pill-row-right">
                  <StatusPill tone="pending">活跃 {primaryProductHistory.activeDays} 天</StatusPill>
                  <StatusPill tone="ready">阶段 {productStageLabel(primaryProductHistory.inferredStage)}</StatusPill>
                  <StatusPill tone={primaryProductHistory.events?.length ? 'ready' : 'warning'}>运营事件 {primaryProductHistory.events?.length || 0}</StatusPill>
                </div>
              </div>
              <div className="product-history-preview-grid">
                <div>
                  <h3>日级趋势</h3>
                  <div className="product-trend-list">
                    {primaryProductTrendDays.map((day) => (
                      <div className="product-trend-row" key={`${primaryProductHistory.asin}-${day.date}`}>
                        <span>{day.date}</span>
                        <div className="product-trend-bar" aria-label={`${day.date} ${formatUsd(day.cost)} 花费`}>
                          <i style={{ width: `${Math.max(8, Math.min(100, (Number(day.cost || 0) / primaryProductMaxDailyCost) * 100))}%` }} />
                        </div>
                        <strong>{formatUsd(day.cost)} / {day.orders} 单</strong>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3>事件叠加</h3>
                  {primaryProductHistory.events?.length ? (
                    <div className="product-event-stack">
                      {primaryProductHistory.events.slice(0, 3).map((event) => (
                        <div className="product-event-chip" key={`${event.eventDate}-${event.title}`}>
                          <span>{event.eventDate} / {event.eventType}</span>
                          <strong>{event.title}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-line">当前范围没有运营事件。</p>
                  )}
                </div>
              </div>
            </details>
          ) : (
            <p className={isQuantifiable ? 'muted-line' : 'blocked-line'}>
              {isQuantifiable ? '当前范围已有指标，但还没有形成按 ASIN 汇总的产品广告历史。' : '完成真实报表导入后，这里会展示产品从首日投放到当前范围的日级广告历史。'}
            </p>
          )}
          <div className="action-row">
            <button className="secondary-button" disabled={!primaryProductHistory} onClick={() => navigate('ad-quant')} type="button">
              查看产品历史明细
            </button>
          </div>
        </Panel>

        <Panel title="最近证据/文件路径入口">
          {collection?.evidencePaths.length ? (
            <details className="dashboard-details">
              <summary>{collection.evidencePaths.length} 个本地文件入口</summary>
              <div className="path-list">
                {collection.evidencePaths.map((item) => (
                  <div className="path-row" key={`${item.kind}-${item.path}`}>
                    <span>{item.label}</span>
                    <code title={item.path}>{compactPath(item.path)}</code>
                    <button
                      className="secondary-button compact-button"
                      onClick={() => openPath(item.path)}
                      type="button"
                    >
                      打开
                    </button>
                  </div>
                ))}
                {pathNotice && <p className={pathNotice.startsWith('打开失败') ? 'blocked-line' : 'muted-line'}>{pathNotice}</p>}
              </div>
            </details>
          ) : (
            <p className="blocked-line">还没有可打开的真实报表或证据路径。</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
