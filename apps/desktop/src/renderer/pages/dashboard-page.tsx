import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { OperatorTaskPanel } from '../components/operator-task-panel';
import { ProgressiveDetails } from '../components/progressive-details';
import { PageHeader, Panel, StateLightGrid, StatusPill } from '../components/ui';
import { buildDeliveryReadinessMatrix, buildDeliveryReadinessMatrixInput, type DeliveryMatrixItem, type DeliveryMatrixStatus } from '../delivery-readiness-matrix';
import { compactPath, formatPercent, formatUsd } from '../formatters';
import { operatorFacingAiError } from '../ai-call-diagnostics';
import { hasRealReportCoverage, realReportCoverageCount } from '../report-coverage';
import type { AiDiagnosisRunView, AppRoute, DeliveryEvidenceStatusView, DeliveryReadinessView, ProductHistoryLedgerView, RecommendationView, SettingsRuleConfig } from '../types';
import { toUserFacingError } from '../user-facing-error';

type DashboardRecommendationStatus = 'pending' | 'needs_review';

export function dashboardRecommendationStatusFilters(): DashboardRecommendationStatus[] {
  return ['pending', 'needs_review'];
}

export function dashboardVisibleDeliveryItems(items: DeliveryMatrixItem[], limit = 3): DeliveryMatrixItem[] {
  const unfinished = items.filter((item) => item.tone !== 'ready');
  return (unfinished.length ? unfinished : items).slice(0, limit);
}

function dashboardDeliveryGateItemCopy(item: DeliveryMatrixItem, gateState: {
  realReportCount: number;
  importedRows: number;
}, route: AppRoute, nextAction: string): Partial<DeliveryMatrixItem> {
  if (route === 'ad-quant') {
    return {
      route,
      label: '量化口径',
      statusLabel: '等待量化复核',
      detail: `${gateState.realReportCount}/8 类真实报表已入库 ${gateState.importedRows} 行指标；先复核量化口径和数据门槛。`,
      nextAction,
    };
  }
  if (route === 'data-import-validation') {
    return {
      route,
      label: '数据门槛',
      statusLabel: '等待指标入库',
      detail: '已有真实报表，先完成指标入库。',
      nextAction,
    };
  }
  return {
    route,
    label: '数据门槛',
    statusLabel: '等待真实报表',
    detail: '先补齐真实报表和数据门槛。',
    nextAction,
  };
}

export function dashboardNormalizeDeliveryItem(item: DeliveryMatrixItem, gateState: {
  canGenerateFormalRecommendations: boolean;
  hasRealFiles: boolean;
  realReportCount: number;
  importedRows: number;
  actionableRows: number;
}): DeliveryMatrixItem {
  if (gateState.canGenerateFormalRecommendations) return item;
  if (!gateState.hasRealFiles || gateState.realReportCount < 8) {
    return {
      ...item,
      ...dashboardDeliveryGateItemCopy(item, gateState, 'data-collection', '补齐真实报表'),
    };
  }
  if (gateState.importedRows <= 0) {
    return {
      ...item,
      ...dashboardDeliveryGateItemCopy(item, gateState, 'data-import-validation', '导入广告指标'),
    };
  }
  if (gateState.actionableRows <= 0) {
    return {
      ...item,
      ...dashboardDeliveryGateItemCopy(item, gateState, 'ad-quant', '复核量化口径'),
    };
  }
  return {
    ...item,
    ...dashboardDeliveryGateItemCopy(item, gateState, 'ad-quant', '复核量化口径'),
  };
}

export function dashboardDeliveryPrimaryRoute(input: {
  deliveryStatus: DeliveryMatrixStatus;
  gateRoute: AppRoute;
}): AppRoute {
  return input.deliveryStatus === 'blocked' ? input.gateRoute : 'delivery';
}

export function dashboardDeliveryPrimaryAction(input: {
  canGenerateFormalRecommendations?: boolean;
  deliveryStatus: DeliveryMatrixStatus;
  gateRoute: AppRoute;
  gateLabel: string;
  matrixLabel: string;
}): { route: AppRoute; label: string } {
  if (input.canGenerateFormalRecommendations === false) {
    return {
      route: input.gateRoute,
      label: input.gateLabel,
    };
  }
  const route = dashboardDeliveryPrimaryRoute({
    deliveryStatus: input.deliveryStatus,
    gateRoute: input.gateRoute,
  });
  if (route === 'delivery') {
    return {
      route,
      label: input.matrixLabel,
    };
  }
  if (input.gateRoute === 'ad-quant') {
    return {
      route,
      label: input.gateLabel || '复核量化口径',
    };
  }
  if (input.gateRoute === 'data-import-validation') {
    return {
      route,
      label: input.gateLabel || '导入广告指标',
    };
  }
  if (input.gateRoute === 'data-collection') {
    return {
      route,
      label: input.gateLabel || '补齐真实报表',
    };
  }
  return {
    route,
    label: input.gateLabel || input.matrixLabel,
  };
}

export function dashboardDeliveryHeadline(input: {
  canGenerateFormalRecommendations: boolean;
  gateRoute: AppRoute;
  gateLabel: string;
  matrixHeadline: string;
}): string {
  if (input.canGenerateFormalRecommendations) return input.matrixHeadline;
  if (input.gateRoute === 'data-collection') return `数据门槛未闭合：${input.gateLabel || '补齐真实报表'}`;
  if (input.gateRoute === 'data-import-validation') return `数据门槛未闭合：${input.gateLabel || '导入广告指标'}`;
  if (input.gateRoute === 'ad-quant') return `量化门槛未闭合：${input.gateLabel || '复核量化口径'}`;
  return `数据门槛未闭合：${input.gateLabel || '完成前置校验'}`;
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
      if (input.realReportCount < 8) {
        return `${input.realReportCount}/8 类真实报表已导入 ${input.importedRows} 行指标，但量化门槛未闭合；需补齐 8 类真实报表。`;
      }
      if (input.actionableRows <= 0) {
        return `${input.realReportCount}/8 类真实报表已导入 ${input.importedRows} 行指标，但未形成可行动对象；需复核量化口径。`;
      }
      return `${input.realReportCount}/8 类真实报表已导入 ${input.importedRows} 行指标，但量化门槛未闭合；需复核量化口径。`;
    }
    return `${input.realReportCount}/8 类真实报表尚未导入量化指标。`;
  }
  return '还没有 xlsx/xls/csv 原始广告表格，不能计算 ACOS 或形成量化对象。';
}

export function dashboardDataGateAction(input: {
  canGenerateFormalRecommendations: boolean;
  hasRealFiles: boolean;
  hasMetrics: boolean;
  realReportCount: number;
  importedRows: number;
  actionableRows: number;
}): { route: AppRoute; label: string; title: string; detail: string } {
  const formalGatePassed = input.canGenerateFormalRecommendations
    && input.realReportCount >= 8
    && input.importedRows > 0
    && input.actionableRows > 0
    && input.hasMetrics;

  if (formalGatePassed) {
    return {
      route: 'ad-quant',
      label: '复核量化诊断',
      title: '可以分析：真实报表和日级指标已闭合',
      detail: dashboardDataGateDetail({
        isQuantifiable: true,
        hasRealFiles: input.hasRealFiles,
        realReportCount: input.realReportCount,
        importedRows: input.importedRows,
        actionableRows: input.actionableRows,
      }),
    };
  }
  if (!input.hasRealFiles) {
    return {
      route: 'data-collection',
      label: '先下载真实报表',
      title: '不可分析：缺真实报表和入库指标',
      detail: dashboardDataGateDetail({
        isQuantifiable: false,
        hasRealFiles: false,
        realReportCount: input.realReportCount,
        importedRows: input.importedRows,
        actionableRows: input.actionableRows,
      }),
    };
  }
  if (input.realReportCount < 8) {
    return {
      route: 'data-collection',
      label: '补齐真实报表',
      title: `数据门槛未闭合：当前只完成 ${input.realReportCount}/8 类真实报表`,
      detail: dashboardDataGateDetail({
        isQuantifiable: false,
        hasRealFiles: true,
        realReportCount: input.realReportCount,
        importedRows: input.importedRows,
        actionableRows: input.actionableRows,
      }),
    };
  }
  if (input.importedRows <= 0) {
    return {
      route: 'data-import-validation',
      label: '导入广告指标',
      title: '不可分析：广告指标未入库',
      detail: dashboardDataGateDetail({
        isQuantifiable: false,
        hasRealFiles: true,
        realReportCount: input.realReportCount,
        importedRows: input.importedRows,
        actionableRows: input.actionableRows,
      }),
    };
  }
  if (!input.hasMetrics || input.actionableRows <= 0) {
    return {
      route: 'ad-quant',
      label: '复核量化口径',
      title: input.actionableRows <= 0
        ? '量化口径待复核：已导入指标但无可行动对象'
        : '量化口径待复核：指标状态未闭合',
      detail: input.actionableRows <= 0
        ? `${input.realReportCount}/8 类真实报表已导入 ${input.importedRows} 行指标，但未形成可行动对象；需复核量化口径。`
        : `${input.realReportCount}/8 类真实报表已导入 ${input.importedRows} 行指标，已有 ${input.actionableRows} 行可行动对象；需复核量化口径。`,
    };
  }
  return {
    route: 'ad-quant',
    label: '复核量化门槛',
    title: '量化门槛待复核',
    detail: '已有指标尚未闭合量化门槛，先回到广告量化页确认对象、阈值和证据口径。',
  };
}

export function dashboardMetricStatusCopy(input: {
  isQuantifiable: boolean;
  canGenerateFormalRecommendations: boolean;
  hasRealFiles: boolean;
  realReportCount: number;
  importedRows: number;
  actionableRows: number;
  hasMetrics: boolean;
  operatingJudgment: string;
}): { dataGateDetail: string; performanceDetail: string } {
  if (input.isQuantifiable) {
    return {
      dataGateDetail: `${input.actionableRows} 行可生成建议。`,
      performanceDetail: input.operatingJudgment,
    };
  }
  const gateAction = dashboardDataGateAction(input);
  if (gateAction.route === 'data-collection') {
    return {
      dataGateDetail: gateAction.detail,
      performanceDetail: gateAction.label.includes('下载') ? '先下载真实报表。' : '先补齐真实报表。',
    };
  }
  if (gateAction.route === 'data-import-validation') {
    return {
      dataGateDetail: gateAction.detail,
      performanceDetail: '等待广告指标导入。',
    };
  }
  if (input.importedRows > 0 && input.actionableRows <= 0) {
    return {
      dataGateDetail: `${input.importedRows} 行指标已入库，但未形成可行动对象。`,
      performanceDetail: '需复核量化口径和可行动对象。',
    };
  }
  if (input.importedRows > 0) {
    return {
      dataGateDetail: `${input.actionableRows} 行可行动对象，需复核量化口径。`,
      performanceDetail: '需复核量化口径。',
    };
  }
  return {
    dataGateDetail: '先导入真实报表指标。',
    performanceDetail: '等待真实指标导入。',
  };
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
  hasMetrics: boolean;
  realReportCount: number;
  importedRows: number;
  actionableRows: number;
}): string {
  if (input.canGenerateFormalRecommendations) return '已具备量化条件';
  return dashboardDataGateAction(input).label;
}

export function dashboardTaskEntryStatus(input: {
  canGenerateFormalRecommendations: boolean;
  hasRealFiles: boolean;
  realReportCount: number;
  importedRows: number;
}): string {
  if (input.canGenerateFormalRecommendations) return '可以分析：真实报表和日级指标已闭合';
  if (input.hasRealFiles && input.importedRows > 0 && input.realReportCount < 8) {
    return `数据门槛未闭合：当前只完成 ${input.realReportCount}/8 类真实报表`;
  }
  if (input.hasRealFiles && input.realReportCount < 8) {
    return `数据门槛未闭合：当前只完成 ${input.realReportCount}/8 类真实报表`;
  }
  if (input.hasRealFiles) return '不可分析：广告指标未入库';
  return '不可分析：缺真实报表和入库指标';
}

export function dashboardWorkflowQuantStatus(input: {
  canGenerateFormalRecommendations: boolean;
  hasMetrics: boolean;
  realReportCount: number;
  actionableRows: number;
}): string {
  if (input.canGenerateFormalRecommendations) return `${input.actionableRows} 行可生成建议`;
  if (input.hasMetrics && input.realReportCount < 8) return `${input.actionableRows} 行已导入但未达量化门槛`;
  return '缺可行动指标';
}

export function dashboardWorkflowQuantNext(input: {
  canGenerateFormalRecommendations: boolean;
  hasMetrics: boolean;
  hasRealFiles: boolean;
  realReportCount: number;
  importedRows: number;
  actionableRows: number;
}): { route: AppRoute; label: string } {
  if (input.canGenerateFormalRecommendations) return { route: 'ad-quant', label: '复核量化诊断' };
  const gateAction = dashboardDataGateAction(input);
  return {
    route: gateAction.route,
    label: gateAction.label,
  };
}

export function dashboardWorkflowCollectStep(input: {
  isQuantifiable: boolean;
  hasRealFiles: boolean;
  gateRoute: AppRoute;
  gateLabel: string;
}): { route: AppRoute; status: string; tone: 'ready' | 'pending' | 'blocked' | 'warning'; next: string } {
  if (!input.hasRealFiles) {
    return {
      route: 'data-collection',
      status: '缺原始文件',
      tone: 'blocked',
      next: '去数据采集',
    };
  }
  if (input.isQuantifiable) {
    return {
      route: 'data-collection',
      status: '已拿到原始文件',
      tone: 'ready',
      next: '查看文件与导入结果',
    };
  }
  if (input.gateRoute === 'data-import-validation') {
    return {
      route: 'data-import-validation',
      status: '已拿到原始文件',
      tone: 'warning',
      next: input.gateLabel || '去导入校验',
    };
  }
  if (input.gateRoute === 'ad-quant') {
    return {
      route: 'ad-quant',
      status: '已拿到原始文件',
      tone: 'warning',
      next: input.gateLabel.includes('量化口径') ? '复核量化口径' : '完成量化',
    };
  }
  return {
    route: input.gateRoute,
    status: '报表待补齐',
    tone: 'warning',
    next: input.gateLabel || '补齐报表',
  };
}

type DashboardWorkflowStep = {
  id: string;
  route: AppRoute;
  title: string;
  status: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
  next: string;
};

export function dashboardWorkflowPostQuantSteps(input: {
  isQuantifiable: boolean;
  fallbackRoute: AppRoute;
}): DashboardWorkflowStep[] {
  if (!input.isQuantifiable) {
    return [
      {
        id: 'recommendations',
        route: input.fallbackRoute,
        title: '3. 完成量化门槛',
        status: '等待量化门槛',
        tone: 'blocked',
        next: '先完成量化',
      },
      {
        id: 'approval',
        route: input.fallbackRoute,
        title: '4. 数据门槛通过后处理',
        status: '等待数据门槛',
        tone: 'blocked',
        next: '先完成量化',
      },
    ];
  }
  return [
    {
      id: 'recommendations',
      route: 'recommendations',
      title: '3. 生成建议',
      status: '可生成建议',
      tone: 'pending',
      next: '生成优化建议',
    },
    {
      id: 'approval',
      route: 'approval',
      title: '4. 审批与执行回读',
      status: '建议生成后进入审批',
      tone: 'pending',
      next: '去审批中心',
    },
  ];
}

export function dashboardWorkflowRecommendationRoute(input: {
  canGenerateFormalRecommendations: boolean;
  fallbackRoute: AppRoute;
}): AppRoute {
  return input.canGenerateFormalRecommendations ? 'recommendations' : input.fallbackRoute;
}

type DashboardPrimaryTaskAction = { route: AppRoute; label: string; title: string };
type DashboardPrimaryTaskNavigationFeedback = {
  label: string;
  busy: boolean;
  busyLabel?: string;
  disabled: boolean;
};

export function dashboardPrimaryTaskAction(input: {
  canGenerateFormalRecommendations: boolean;
  hasRealFiles: boolean;
  hasMetrics: boolean;
  realReportCount: number;
  importedRows: number;
  actionableRows: number;
  pendingRecommendationCount: number;
  reviewRecommendationCount: number;
}): DashboardPrimaryTaskAction {
  const formalGatePassed = input.canGenerateFormalRecommendations
    && input.realReportCount >= 8
    && input.importedRows > 0
    && input.actionableRows > 0
    && input.hasMetrics;
  const gateAction = dashboardDataGateAction(input);

  if (!formalGatePassed) {
    return {
      route: gateAction.route,
      label: gateAction.label,
      title: gateAction.title,
    };
  }
  if (input.pendingRecommendationCount > 0) {
    return {
      route: 'approval',
      label: '处理待审批建议',
      title: '可以分析：有建议待审批',
    };
  }
  if (input.reviewRecommendationCount > 0) {
    return {
      route: 'recommendations',
      label: '复核待确认建议',
      title: '可以分析：有建议需复核',
    };
  }
  return {
    route: 'ad-quant',
    label: '复核广告量化',
    title: '可以分析：真实报表和日级指标已闭合',
  };
}

export function dashboardProductWorkbenchAction(input: {
  scopeAsin?: string;
  baseAction: DashboardPrimaryTaskAction;
}): DashboardPrimaryTaskAction {
  if (!String(input.scopeAsin || '').trim()) {
    return {
      route: 'product-management',
      label: '选择产品',
      title: '先选择产品工作台',
    };
  }
  return input.baseAction;
}

export function dashboardPrimaryTaskNavigationFeedback(input: {
  action: DashboardPrimaryTaskAction;
  pendingRoute: AppRoute | null;
}): DashboardPrimaryTaskNavigationFeedback {
  const busy = Boolean(input.pendingRoute);
  return {
    label: input.action.label,
    busy,
    busyLabel: busy ? '转跳中...' : undefined,
    disabled: busy,
  };
}

export function dashboardPathActionKey(label: string, targetPath: string): string {
  return `${label}:${String(targetPath || 'missing')}`;
}

export function dashboardOpenPathButtonView(input: {
  activePathKey: string | null;
  baseClassName?: string;
  disabled?: boolean;
  idleLabel: string;
  pathKey: string;
}): {
  label: string;
  disabled: boolean;
  ariaBusy?: true;
  className: string;
  showSpinner: boolean;
} {
  const active = input.activePathKey === input.pathKey;
  return {
    label: active ? '打开中...' : input.idleLabel,
    disabled: Boolean(input.disabled || input.activePathKey),
    ariaBusy: active ? true : undefined,
    className: [input.baseClassName || 'secondary-button', active ? 'button-loading' : ''].filter(Boolean).join(' '),
    showSpinner: active,
  };
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
  importedRows: number;
  actionableRows: number;
}): DashboardActionQueueItem | null {
  const gateAction = dashboardDataGateAction(input);
  if (input.canGenerateFormalRecommendations) return null;

  if (!input.hasRealFiles) {
    return {
      title: '补齐真实报表',
      detail: gateAction.detail,
      route: gateAction.route,
      tone: 'blocked',
    };
  }
  if (!input.canGenerateFormalRecommendations && input.realReportCount < 8) {
    return {
      title: '补齐 8 类真实报表',
      detail: gateAction.detail,
      route: gateAction.route,
      tone: 'blocked',
    };
  }
  if (input.importedRows <= 0) {
    return {
      title: gateAction.label,
      detail: gateAction.detail,
      route: gateAction.route,
      tone: 'warning',
    };
  }
  return {
    title: gateAction.label,
    detail: gateAction.detail,
    route: gateAction.route,
    tone: 'warning',
  };
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

export function dashboardSelectProductHistory(
  ledgers: ProductHistoryLedgerView[],
  scopeAsin?: string,
): ProductHistoryLedgerView | undefined {
  const requestedAsin = String(scopeAsin || '').trim().toUpperCase();
  if (!requestedAsin) return undefined;
  return ledgers.find((ledger) => ledger.asin.toUpperCase() === requestedAsin);
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

function dashboardPreGateActionCopy(input: {
  gateRoute: AppRoute;
  gateLabel: string;
}): { label: string; detail: string; metric: string } {
  const label = input.gateLabel || (
    input.gateRoute === 'ad-quant'
      ? '复核量化口径'
      : input.gateRoute === 'data-import-validation'
        ? '导入广告指标'
        : '补齐真实报表'
  );
  if (input.gateRoute === 'ad-quant') {
    return {
      label: '等待量化门槛',
      detail: `量化门槛未闭合，${label}。`,
      metric: `量化门槛未闭合，${label}`,
    };
  }
  return {
    label: '等待数据门槛',
    detail: `数据门槛未闭合，${label}。`,
    metric: `数据门槛未闭合，${label}`,
  };
}

export function dashboardRecommendationHealthCopy(input: {
  isQuantifiable: boolean;
  gateRoute: AppRoute;
  gateLabel: string;
  aiWorkStatus: DashboardStatusCard;
  actionRecommendationCount: number;
  pendingRecommendationCount: number;
  reviewRecommendationCount: number;
}): string {
  if (!input.isQuantifiable) {
    return dashboardPreGateActionCopy({
      gateRoute: input.gateRoute,
      gateLabel: input.gateLabel,
    }).detail;
  }
  if (input.actionRecommendationCount > 0) {
    return `${input.pendingRecommendationCount} 条待审批，${input.reviewRecommendationCount} 条需复核。`;
  }
  return input.aiWorkStatus.detail;
}

export function dashboardRecommendationHealthSummary(input: {
  isQuantifiable: boolean;
  gateRoute: AppRoute;
  gateLabel: string;
  aiWorkStatus: DashboardStatusCard;
  actionRecommendationCount: number;
  pendingRecommendationCount: number;
  reviewRecommendationCount: number;
}): { label: string; detail: string } {
  const preGateCopy = dashboardPreGateActionCopy({
    gateRoute: input.gateRoute,
    gateLabel: input.gateLabel,
  });
  return {
    label: input.isQuantifiable ? input.aiWorkStatus.label : preGateCopy.label,
    detail: dashboardRecommendationHealthCopy(input),
  };
}

export function dashboardTaskRecommendationMetric(input: {
  isQuantifiable: boolean;
  gateRoute: AppRoute;
  gateLabel: string;
  actionRecommendationCount: number;
  pendingRecommendationCount: number;
  reviewRecommendationCount: number;
}): string | null {
  if (input.actionRecommendationCount <= 0) return null;
  if (!input.isQuantifiable) {
    return dashboardPreGateActionCopy({
      gateRoute: input.gateRoute,
      gateLabel: input.gateLabel,
    }).metric;
  }
  return `${input.pendingRecommendationCount} 条待审批 / ${input.reviewRecommendationCount} 条需复核`;
}

export function dashboardSecondaryRecommendationAction(input: {
  isQuantifiable: boolean;
  gateRoute: AppRoute;
  gateLabel: string;
}): { route: AppRoute; label: string; disabled: boolean } {
  if (input.isQuantifiable) {
    return {
      route: 'recommendations',
      label: '生成优化建议',
      disabled: false,
    };
  }
  if (input.gateRoute === 'ad-quant') {
    return {
      route: 'ad-quant',
      label: input.gateLabel.includes('量化口径') ? '复核量化口径' : '完成量化',
      disabled: false,
    };
  }
  if (input.gateRoute === 'data-import-validation') {
    return {
      route: 'data-import-validation',
      label: '先导入广告指标',
      disabled: true,
    };
  }
  if (input.gateRoute === 'data-collection') {
    return {
      route: 'data-collection',
      label: '先补齐真实报表',
      disabled: true,
    };
  }
  return {
    route: input.gateRoute,
    label: '先完成量化',
    disabled: true,
  };
}

export function dashboardRiskObjectFallbackCopy(input: {
  isQuantifiable: boolean;
  hasRealFiles: boolean;
  importedRows: number;
  actionableRows: number;
}): string {
  if (input.isQuantifiable) return '当前范围暂无诊断对象。';
  if (input.importedRows > 0 && input.actionableRows <= 0) {
    return '已有导入指标，但没有可行动对象；需复核量化口径。';
  }
  if (input.hasRealFiles) {
    return '已有真实广告表格，先完成指标入库。';
  }
  return '缺少真实广告表格，无法给出风险对象。';
}

export function dashboardRiskObjectPrimaryAction(input: {
  isQuantifiable: boolean;
  gateRoute: AppRoute;
  gateLabel: string;
}): { route: AppRoute; label: string; disabled: boolean } {
  if (input.isQuantifiable) {
    return {
      route: 'ad-quant',
      label: '查看量化明细',
      disabled: false,
    };
  }
  if (input.gateRoute === 'ad-quant') {
    return {
      route: 'ad-quant',
      label: input.gateLabel.includes('量化口径') ? '复核量化口径' : '完成量化',
      disabled: false,
    };
  }
  return {
    route: input.gateRoute,
    label: input.gateLabel || '完成数据门槛',
    disabled: false,
  };
}

type DashboardRouteAction = { route: AppRoute; label: string; disabled: boolean };

export function dashboardRiskObjectSecondaryAction(input: {
  isQuantifiable: boolean;
  primaryAction: DashboardRouteAction;
  secondaryAction: DashboardRouteAction;
}): DashboardRouteAction | null {
  if (!input.isQuantifiable && input.primaryAction.route === input.secondaryAction.route) return null;
  return input.secondaryAction;
}

export function DashboardPage() {
  const { data, error, loading, scope } = useBusinessDataPipeline();
  const [pathNotice, setPathNotice] = useState<string | null>(null);
  const [openingPathKey, setOpeningPathKey] = useState<string | null>(null);
  const [ruleConfig, setRuleConfig] = useState(() => normalizeRuleConfig(null));
  const [aiStatus, setAiStatus] = useState(() => dashboardAiStatus(null));
  const [pendingRecommendations, setPendingRecommendations] = useState<RecommendationView[]>([]);
  const [reviewRecommendations, setReviewRecommendations] = useState<RecommendationView[]>([]);
  const [approvedRecommendations, setApprovedRecommendations] = useState<RecommendationView[]>([]);
  const [aiDiagnosisRuns, setAiDiagnosisRuns] = useState<AiDiagnosisRunView[]>([]);
  const [deliveryReadiness, setDeliveryReadiness] = useState<DeliveryReadinessView | null>(null);
  const [deliveryEvidenceStatus, setDeliveryEvidenceStatus] = useState<DeliveryEvidenceStatusView | null>(null);
  const [pendingPrimaryRoute, setPendingPrimaryRoute] = useState<AppRoute | null>(null);
  const primaryNavigationTimerRef = useRef<number | null>(null);
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
  const normalizedVisibleDeliveryItems = useMemo(() => visibleDeliveryItems.map((item) => dashboardNormalizeDeliveryItem(item, {
    canGenerateFormalRecommendations: isQuantifiable,
    hasRealFiles,
    realReportCount,
    importedRows,
    actionableRows,
  })), [actionableRows, hasRealFiles, importedRows, isQuantifiable, realReportCount, visibleDeliveryItems]);
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
  const taskRecommendationMetric = dashboardTaskRecommendationMetric({
    isQuantifiable,
    gateRoute: currentDataGateAction.route,
    gateLabel: currentDataGateAction.label,
    actionRecommendationCount,
    pendingRecommendationCount,
    reviewRecommendationCount,
  });
  const primaryProductHistory = dashboardSelectProductHistory(productHistoryLedgers, selectedScopeAsin);
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
      importedRows,
      actionableRows,
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
  }, [actionableRows, hasMetrics, hasRealFiles, highAcosDiagnostics.length, importedRows, isQuantifiable, noOrderDiagnostics.length, realReportCount, ruleConfig.highAcosThreshold, ruleConfig.minSpend, ruleConfig.noOrderClickThreshold]);
  const dataGateLabel = dashboardDataGateLabel({
    canGenerateFormalRecommendations: isQuantifiable,
    hasRealFiles,
    hasMetrics,
    realReportCount,
    importedRows,
    actionableRows,
  });
  const workflowQuantNext = dashboardWorkflowQuantNext({
    canGenerateFormalRecommendations: isQuantifiable,
    hasMetrics,
    hasRealFiles,
    realReportCount,
    importedRows,
    actionableRows,
  });
  const workflowCollectStep = dashboardWorkflowCollectStep({
    isQuantifiable,
    hasRealFiles,
    gateRoute: workflowQuantNext.route,
    gateLabel: workflowQuantNext.label,
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
  const secondaryRecommendationAction = dashboardSecondaryRecommendationAction({
    isQuantifiable,
    gateRoute: workflowQuantNext.route,
    gateLabel: workflowQuantNext.label,
  });
  const riskObjectFallbackCopy = dashboardRiskObjectFallbackCopy({
    isQuantifiable,
    hasRealFiles,
    importedRows,
    actionableRows,
  });
  const riskObjectPrimaryAction = dashboardRiskObjectPrimaryAction({
    isQuantifiable,
    gateRoute: workflowQuantNext.route,
    gateLabel: workflowQuantNext.label,
  });
  const riskObjectSecondaryAction = dashboardRiskObjectSecondaryAction({
    isQuantifiable,
    primaryAction: riskObjectPrimaryAction,
    secondaryAction: secondaryRecommendationAction,
  });
  const postQuantWorkflowSteps = dashboardWorkflowPostQuantSteps({
    isQuantifiable,
    fallbackRoute: workflowQuantNext.route,
  });
  const workflowSteps: DashboardWorkflowStep[] = [
    {
      id: 'collect',
      route: workflowCollectStep.route,
      title: '1. 获取真实报表',
      status: workflowCollectStep.status,
      tone: workflowCollectStep.tone,
      next: workflowCollectStep.next,
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
    ...postQuantWorkflowSteps,
  ];
  const basePrimaryTaskAction = dashboardPrimaryTaskAction({
    canGenerateFormalRecommendations: isQuantifiable,
    hasRealFiles,
    hasMetrics,
    realReportCount,
    importedRows,
    actionableRows,
    pendingRecommendationCount,
    reviewRecommendationCount,
  });
  const primaryTaskAction = dashboardProductWorkbenchAction({
    scopeAsin: selectedScopeAsin,
    baseAction: basePrimaryTaskAction,
  });
  const primaryTaskDetail = hasProductScope
    ? dashboardDataGateDetail({
        isQuantifiable,
        hasRealFiles,
        realReportCount,
        importedRows,
        actionableRows,
      })
    : '先在产品管理中选择或维护一个 ASIN；后续广告量化、优化建议、运营事件、关键词机会和 Listing 都按该产品读取数据库。';
  const primaryTaskSecondaryActions = deliveryMatrix.status === 'ready'
    ? []
    : [{
        label: '查看交付缺口',
        onClick: () => navigate('delivery' as AppRoute),
      }];
  const primaryTaskNavigationFeedback = dashboardPrimaryTaskNavigationFeedback({
    action: primaryTaskAction,
    pendingRoute: pendingPrimaryRoute,
  });

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

  useEffect(() => () => {
    if (primaryNavigationTimerRef.current) {
      window.clearTimeout(primaryNavigationTimerRef.current);
    }
  }, []);

  async function openPath(targetPath: string, label = '打开路径') {
    if (openingPathKey) return;
    if (!targetPath) {
      setPathNotice('打开路径不可用：当前没有可打开的文件或目录。');
      return;
    }
    const pathKey = dashboardPathActionKey(label, targetPath);
    setOpeningPathKey(pathKey);
    setPathNotice(`${label}打开中...`);
    try {
      await (window as any).electronAPI?.openReportPath?.(targetPath);
      setPathNotice(`已请求打开：${compactPath(targetPath)}`);
    } catch (caught) {
      setPathNotice(`打开失败：${toUserFacingError(caught, '打开路径失败。')}`);
    } finally {
      setOpeningPathKey(null);
    }
  }

  function renderOpenPathButton(input: {
    className?: string;
    idleLabel: string;
    messageLabel?: string;
    targetPath: string;
  }) {
    const messageLabel = input.messageLabel || input.idleLabel;
    const view = dashboardOpenPathButtonView({
      activePathKey: openingPathKey,
      baseClassName: input.className,
      idleLabel: input.idleLabel,
      pathKey: dashboardPathActionKey(messageLabel, input.targetPath),
    });
    return (
      <button
        aria-busy={view.ariaBusy}
        className={view.className}
        disabled={view.disabled}
        onClick={() => openPath(input.targetPath, messageLabel)}
        type="button"
      >
        {view.showSpinner && <span aria-hidden="true" className="button-spinner" />}
        <span>{view.label}</span>
      </button>
    );
  }

  function navigatePrimaryTask(route: AppRoute) {
    setPendingPrimaryRoute(route);
    if (primaryNavigationTimerRef.current) {
      window.clearTimeout(primaryNavigationTimerRef.current);
    }
    primaryNavigationTimerRef.current = window.setTimeout(() => {
      navigate(route);
      setPendingPrimaryRoute(null);
      primaryNavigationTimerRef.current = null;
    }, 150);
  }

  return (
    <div>
      <PageHeader
        eyebrow="运营总览"
        title="今日看板"
        description="看数据就绪、安全门禁和下一步。"
      />

      <OperatorTaskPanel
        eyebrow="当前主任务"
        title={primaryTaskAction.title}
        detail={primaryTaskDetail}
        primaryAction={{
          label: primaryTaskNavigationFeedback.label,
          busy: primaryTaskNavigationFeedback.busy,
          busyLabel: primaryTaskNavigationFeedback.busyLabel,
          disabled: primaryTaskNavigationFeedback.disabled,
          onClick: () => navigatePrimaryTask(primaryTaskAction.route),
        }}
        secondaryActions={primaryTaskSecondaryActions}
      >
        <div className="dashboard-task-metrics" aria-label="数据健康摘要">
          <StatusPill tone={hasProductScope ? 'ready' : 'warning'}>{hasProductScope ? `产品 ${selectedScopeAsin}` : '未选产品'}</StatusPill>
          <StatusPill tone={isQuantifiable ? 'ready' : hasRealFiles ? 'warning' : 'blocked'}>{dataGateLabel}</StatusPill>
          <span>{realReportCount}/8 类报表</span>
          <span>{importedRows} 行指标</span>
          {actionableRows > 0 && <span>{actionableRows} 行{isQuantifiable ? '可建议' : '可行动'}</span>}
          {taskRecommendationMetric && <span>{taskRecommendationMetric}</span>}
        </div>
      </OperatorTaskPanel>

      <div className="business-stack dashboard-stack-after-task">
        <Panel title="产品工作台" tone={hasProductScope ? primaryProductHistory ? 'success' : 'warning' : 'warning'}>
          <div className="judgment-panel">
            <div>
              <span>当前产品</span>
              <strong>
                {hasProductScope
                  ? [selectedProductContext?.title, selectedScopeAsin].filter(Boolean).join(' / ')
                  : '未选择产品'}
              </strong>
              <p>
                {hasProductScope
                  ? '当前看板、AI 量化、运营事件、关键词机会和 Listing 优化都沿用这个 ASIN。'
                  : '先选择或维护产品，避免不同产品的数据、事件和建议混在同一个工作流里。'}
              </p>
            </div>
            <button
              className={hasProductScope ? 'secondary-button' : 'primary-button'}
              onClick={() => navigate('product-management')}
              type="button"
            >
              {hasProductScope ? '查看产品管理' : '选择产品'}
            </button>
          </div>
        </Panel>

        <Panel title="数据健康" tone={isQuantifiable ? 'success' : 'blocked'}>
          <StateLightGrid
            refreshing={primaryTaskNavigationFeedback.busy}
            items={[
              {
                label: '当前范围',
                value: hasProductScope ? `产品 ${selectedScopeAsin}` : '未选产品',
                detail: `${dataGateLabel} / ${scope.dateFrom} 至 ${scope.dateTo} / ${scope.storeName || '-'} / ${scope.marketplaceCode || '-'}`,
                tone: isQuantifiable ? 'ready' : hasRealFiles ? 'warning' : 'blocked',
              },
              {
                label: '数据门槛',
                value: `${realReportCount}/8 类 · ${importedRows} 行`,
                detail: metricStatusCopy.dataGateDetail,
                tone: isQuantifiable ? 'ready' : hasRealFiles ? 'warning' : 'blocked',
              },
              {
                label: isQuantifiable ? 'AI / 建议' : 'AI / 数据门槛',
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
          {loading && <p className="muted-line">正在读取数据状态...</p>}
          {error && <p className="blocked-line">读取接口异常：{error}</p>}
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
              {riskObjectFallbackCopy}
            </p>
          )}
          <div className="action-row">
            <button className="secondary-button" disabled={riskObjectPrimaryAction.disabled} onClick={() => navigate(riskObjectPrimaryAction.route)} type="button">{riskObjectPrimaryAction.label}</button>
            {riskObjectSecondaryAction && (
              <button className="secondary-button" disabled={riskObjectSecondaryAction.disabled} onClick={() => navigate(riskObjectSecondaryAction.route)} type="button">{riskObjectSecondaryAction.label}</button>
            )}
          </div>
        </Panel>

        <Panel title="产品广告历史账本" tone={hasProductScope ? primaryProductHistory ? 'success' : isQuantifiable ? 'warning' : 'blocked' : 'warning'}>
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
            <p className={hasProductScope && !isQuantifiable ? 'blocked-line' : 'muted-line'}>
              {!hasProductScope
                ? '先在产品管理中选择产品；本卡片不会再默认取第一条产品，避免看错 ASIN 的历史。'
                : isQuantifiable ? '当前产品范围已有指标，但还没有形成按 ASIN 汇总的产品广告历史。' : '完成真实报表导入后，这里会展示该产品从首日投放到当前范围的日级广告历史。'}
            </p>
          )}
          <div className="action-row">
            <button
              className="secondary-button"
              disabled={hasProductScope && !primaryProductHistory}
              onClick={() => navigate(hasProductScope ? 'ad-quant' : 'product-management')}
              type="button"
            >
              {hasProductScope ? '查看产品历史明细' : '选择产品'}
            </button>
          </div>
        </Panel>

        <Panel title="交付与技术明细" tone={deliveryMatrix.status === 'ready' ? 'success' : deliveryMatrix.status === 'blocked' ? 'blocked' : 'warning'}>
          <div className="dashboard-compact-section">
            <ProgressiveDetails title="完整流程入口">
              <div className="workflow-strip workflow-strip-compact dashboard-workflow-details">
                {workflowSteps.map((step) => (
                  <button className="workflow-step" key={step.id} onClick={() => navigate(step.route)} type="button">
                    <span>{step.title}</span>
                    <strong>{step.status}</strong>
                    <StatusPill tone={step.tone}>{step.next}</StatusPill>
                  </button>
                ))}
              </div>
            </ProgressiveDetails>

            <ProgressiveDetails title={`交付缺口：已闭合 ${deliveryMatrix.readyCount}/${deliveryMatrix.totalCount}`}>
              <div className="judgment-panel dashboard-compact-judgment">
                <div>
                  <span>当前可交付判断</span>
                  <strong>{deliveryHeadline}</strong>
                  <p>这里只保留最关键的 {normalizedVisibleDeliveryItems.length} 项缺口；完整状态在交付验收页。</p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => navigate(deliveryPrimaryAction.route)}
                  type="button"
                >
                  {deliveryPrimaryAction.label}
                </button>
              </div>
              <div className="context-summary-grid dashboard-compact-card-grid">
                {normalizedVisibleDeliveryItems.map((item) => (
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
            </ProgressiveDetails>

            <ProgressiveDetails title={`行动队列：${actionQueue.length} 项`}>
              <div className="context-summary-grid dashboard-compact-card-grid">
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
            </ProgressiveDetails>

            <ProgressiveDetails title={collection?.evidencePaths.length ? `最近证据/文件路径：${collection.evidencePaths.length} 个入口` : '最近证据/文件路径'}>
              {collection?.evidencePaths.length ? (
                <div className="path-list">
                  {collection.evidencePaths.map((item) => (
                    <div className="path-row" key={`${item.kind}-${item.path}`}>
                      <span>{item.label}</span>
                      <code title={item.path}>{compactPath(item.path)}</code>
                      {renderOpenPathButton({ className: 'secondary-button compact-button', idleLabel: '打开', messageLabel: `打开${item.label}`, targetPath: item.path })}
                    </div>
                  ))}
                  {pathNotice && <p className={pathNotice.startsWith('打开失败') ? 'blocked-line' : 'muted-line'}>{pathNotice}</p>}
                </div>
              ) : (
                <p className="blocked-line">还没有可打开的真实报表或证据路径。</p>
              )}
            </ProgressiveDetails>
          </div>
        </Panel>
      </div>
    </div>
  );
}
