import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import { StateLightGrid, StatusPill } from '../components/ui';
import {
  PageFrame,
  PriorityDataTable,
  SummaryStrip,
  TaskBanner,
  WorkbenchPanel,
  WorkspaceState,
  type PriorityDataTableColumn,
} from '../components/workspace';
import { buildDeliveryReadinessMatrix, buildDeliveryReadinessMatrixInput, type DeliveryMatrixItem, type DeliveryMatrixStatus } from '../delivery-readiness-matrix';
import { compactPath, formatPercent, formatUsd } from '../formatters';
import { operatorFacingAiError } from '../ai-call-diagnostics';
import {
  hasRealReportCoverage,
  importedReportTypeCoverageCount,
  realReportCoverageCount,
} from '../report-coverage';
import type { NavigationIntent } from '../navigation';
import type { NextSafeAction } from '../workflow-state';
import type { AiDiagnosisRunView, AppRoute, BusinessQuantDiagnostic, DeliveryEvidenceStatusView, DeliveryReadinessView, ProductHistoryLedgerView, RecommendationView, SettingsRuleConfig } from '../types';
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
  importedReportTypeCount?: number;
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
    const importedReportTypeCount = Math.max(0, Number(gateState.importedReportTypeCount || 0));
    return {
      route,
      label: '数据门槛',
      statusLabel: '等待指标入库',
      detail: `报表文件 ${gateState.realReportCount}/8 类，逐类入库 ${importedReportTypeCount}/8 类；先到导入检查补齐。`,
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
  importedReportTypeCount?: number;
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
  const importedReportTypeCount = Number.isFinite(Number(gateState.importedReportTypeCount))
    ? Math.max(0, Number(gateState.importedReportTypeCount))
    : 0;
  if (importedReportTypeCount < 8) {
    return {
      ...item,
      ...dashboardDeliveryGateItemCopy(item, { ...gateState, importedReportTypeCount }, 'data-import-validation', importedReportTypeCount > 0 ? '补齐逐类入库' : '导入广告指标'),
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
  importedReportTypeCount?: number;
  importedRows: number;
  actionableRows: number;
}): string {
  const importedReportTypeCount = Number.isFinite(Number(input.importedReportTypeCount))
    ? Math.max(0, Number(input.importedReportTypeCount))
    : 0;
  if (input.isQuantifiable) {
    return `${input.realReportCount}/8 类报表文件、${importedReportTypeCount}/8 类逐类入库，共 ${input.importedRows} 行广告指标，其中 ${input.actionableRows} 行可生成建议。`;
  }
  if (input.hasRealFiles) {
    if (input.importedRows > 0) {
      if (input.realReportCount < 8) {
        return `${input.realReportCount}/8 类真实报表已导入 ${input.importedRows} 行指标，但量化门槛未闭合；需补齐 8 类真实报表。`;
      }
      if (importedReportTypeCount < 8) {
        return `${input.realReportCount}/8 类报表文件已落盘，但仅 ${importedReportTypeCount}/8 类逐类入库（共 ${input.importedRows} 行）；需先到导入检查补齐。`;
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
  importedReportTypeCount?: number;
  importedRows: number;
  actionableRows: number;
}): { route: AppRoute; label: string; title: string; detail: string } {
  const importedReportTypeCount = Number.isFinite(Number(input.importedReportTypeCount))
    ? Math.max(0, Number(input.importedReportTypeCount))
    : 0;
  const formalGatePassed = input.canGenerateFormalRecommendations
    && input.realReportCount >= 8
    && importedReportTypeCount >= 8
    && input.importedRows > 0
    && input.actionableRows > 0
    && input.hasMetrics;

  if (formalGatePassed) {
    return {
      route: 'ad-quant',
      label: '查看广告表现',
      title: '可以分析：真实报表和日级指标已闭合',
      detail: dashboardDataGateDetail({
        isQuantifiable: true,
        hasRealFiles: input.hasRealFiles,
        realReportCount: input.realReportCount,
        importedReportTypeCount,
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
        importedReportTypeCount,
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
        importedReportTypeCount,
        importedRows: input.importedRows,
        actionableRows: input.actionableRows,
      }),
    };
  }
  if (importedReportTypeCount < 8) {
    return {
      route: 'data-import-validation',
      label: importedReportTypeCount > 0 ? '补齐逐类入库' : '导入广告指标',
      title: `数据门槛未闭合：当前仅 ${importedReportTypeCount}/8 类逐类入库`,
      detail: dashboardDataGateDetail({
        isQuantifiable: false,
        hasRealFiles: true,
        realReportCount: input.realReportCount,
        importedReportTypeCount,
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
        importedReportTypeCount,
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
    detail: '已有指标尚未闭合量化门槛，先回到广告表现页确认对象、阈值和证据口径。',
  };
}

export function dashboardMetricStatusCopy(input: {
  isQuantifiable: boolean;
  canGenerateFormalRecommendations: boolean;
  hasRealFiles: boolean;
  realReportCount: number;
  importedReportTypeCount?: number;
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
  importedReportTypeCount: number;
  importedRows: number;
  actionableRows: number;
  hasImportedMetrics: boolean;
}): boolean {
  return input.realReportCount >= 8
    && input.importedReportTypeCount >= 8
    && input.importedRows > 0
    && input.actionableRows > 0
    && input.hasImportedMetrics;
}

export function dashboardDataGateLabel(input: {
  canGenerateFormalRecommendations: boolean;
  hasRealFiles: boolean;
  hasMetrics: boolean;
  realReportCount: number;
  importedReportTypeCount?: number;
  importedRows: number;
  actionableRows: number;
}): string {
  if (input.canGenerateFormalRecommendations) return '已具备广告表现条件';
  return dashboardDataGateAction(input).label;
}

export function dashboardTaskEntryStatus(input: {
  canGenerateFormalRecommendations: boolean;
  hasRealFiles: boolean;
  realReportCount: number;
  importedReportTypeCount?: number;
  importedRows: number;
}): string {
  if (input.canGenerateFormalRecommendations) return '可以分析：真实报表和日级指标已闭合';
  if (input.realReportCount >= 8 && Number(input.importedReportTypeCount ?? 0) < 8) {
    return `数据门槛未闭合：当前仅 ${Math.max(0, Number(input.importedReportTypeCount || 0))}/8 类逐类入库`;
  }
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
  importedReportTypeCount?: number;
  actionableRows: number;
}): string {
  if (input.canGenerateFormalRecommendations) return `${input.actionableRows} 行可生成建议`;
  if (input.realReportCount >= 8 && Number(input.importedReportTypeCount ?? 0) < 8) {
    return `${Math.max(0, Number(input.importedReportTypeCount || 0))}/8 类逐类入库，正式诊断保持阻断`;
  }
  if (input.hasMetrics && input.realReportCount < 8) return `${input.actionableRows} 行已导入但未达量化门槛`;
  return '缺可行动指标';
}

export function dashboardWorkflowQuantNext(input: {
  canGenerateFormalRecommendations: boolean;
  hasMetrics: boolean;
  hasRealFiles: boolean;
  realReportCount: number;
  importedReportTypeCount?: number;
  importedRows: number;
  actionableRows: number;
}): { route: AppRoute; label: string } {
  if (input.canGenerateFormalRecommendations) return { route: 'ad-quant', label: '查看广告表现' };
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
      title: '4. 审批与结果核对',
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
  importedReportTypeCount?: number;
  importedRows: number;
  actionableRows: number;
  pendingRecommendationCount: number;
  reviewRecommendationCount: number;
}): DashboardPrimaryTaskAction {
  const formalGatePassed = input.canGenerateFormalRecommendations
    && input.realReportCount >= 8
    && Number(input.importedReportTypeCount ?? 0) >= 8
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
    label: '复核广告表现',
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
      title: '先锁定产品上下文',
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
  importedReportTypeCount?: number;
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

function navigate(target: AppRoute | NavigationIntent) {
  window.dispatchEvent(new CustomEvent<AppRoute | NavigationIntent>('amazon-ai-ops:navigate', { detail: target }));
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
      detail: operatorFacingAiError(latest.errorMessage || latest.diagnosis?.aiFallbackReason || '最近一次 AI 诊断失败，建议到广告表现页查看调用记录并复测 AI 设置。'),
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

export function dashboardDecisionSummary(input: {
  actionRecommendationCount: number;
  reviewRecommendationCount: number;
  approvedRecommendationCount: number;
  canGenerateFormalRecommendations: boolean;
}): { value: string; detail: string } {
  if (input.actionRecommendationCount > 0) {
    const reviewCount = Math.min(
      input.actionRecommendationCount,
      Math.max(0, input.reviewRecommendationCount),
    );
    const pendingCount = Math.max(0, input.actionRecommendationCount - reviewCount);
    return {
      value: `${input.actionRecommendationCount} 条`,
      detail: [
        pendingCount > 0 ? `${pendingCount} 条待审批` : '',
        reviewCount > 0 ? `${reviewCount} 条需人工复核` : '',
      ].filter(Boolean).join('，'),
    };
  }
  if (input.approvedRecommendationCount > 0) {
    return {
      value: '0 条',
      detail: `已决策 ${input.approvedRecommendationCount} 条，批准不等于执行`,
    };
  }
  return {
    value: '待生成',
    detail: input.canGenerateFormalRecommendations
      ? '当前数据已可生成判断'
      : '先完成真实数据与量化门槛',
  };
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
  if (input.isQuantifiable) return '当前范围暂无风险对象。';
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
      label: '查看广告表现',
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

export function dashboardRiskObjectTone(row: BusinessQuantDiagnostic): 'ready' | 'pending' | 'warning' | 'blocked' {
  if (row.severity === 'high' || row.quantStatus === 'blocked' || row.quantStatus === 'waste') return 'blocked';
  if (row.severity === 'medium' || row.quantStatus === 'watch') return 'warning';
  if (row.quantStatus === 'healthy' || row.quantStatus === 'scale') return 'ready';
  return 'pending';
}

export function dashboardRiskObjectLabel(row: BusinessQuantDiagnostic): string {
  if (row.severity === 'high') return '高风险';
  if (row.severity === 'medium' || row.quantStatus === 'watch') return '待复核';
  if (row.quantStatus === 'waste') return row.orders === 0 ? '无订单风险' : '浪费风险';
  if (row.quantStatus === 'blocked') return '数据阻塞';
  if (row.quantStatus === 'healthy') return '健康';
  if (row.quantStatus === 'scale') return '可扩量';
  return '待复核';
}

export function dashboardRiskObjectQueue(input: {
  diagnostics: BusinessQuantDiagnostic[];
  isQuantifiable: boolean;
  limit?: number;
}): {
  rows: BusinessQuantDiagnostic[];
  status: { tone: 'ready' | 'pending' | 'warning' | 'blocked'; label: string };
} {
  const tonePriority: Record<'ready' | 'pending' | 'warning' | 'blocked', number> = {
    ready: 0,
    pending: 1,
    warning: 2,
    blocked: 3,
  };
  const attentionRows = input.diagnostics
    .filter((row) => dashboardRiskObjectTone(row) !== 'ready')
    .sort((left, right) => (
      tonePriority[dashboardRiskObjectTone(right)] - tonePriority[dashboardRiskObjectTone(left)]
      || Number(right.spend || 0) - Number(left.spend || 0)
      || Number(right.clicks || 0) - Number(left.clicks || 0)
    ));
  const rows = attentionRows.slice(0, input.limit ?? 6);
  if (!attentionRows.length) {
    return {
      rows,
      status: input.isQuantifiable
        ? { tone: 'ready', label: '暂无风险对象' }
        : { tone: 'warning', label: '等待数据' },
    };
  }
  const tones = attentionRows.map(dashboardRiskObjectTone);
  const tone = tones.includes('blocked') ? 'blocked' : tones.includes('warning') ? 'warning' : 'pending';
  return { rows, status: { tone, label: `${attentionRows.length} 个待看` } };
}

const dashboardRiskColumns: Array<PriorityDataTableColumn<BusinessQuantDiagnostic>> = [
  {
    key: 'object',
    header: '对象',
    priority: 'anchor',
    cell: (row) => (
      <div className="priority-object-cell">
        <strong>{row.objectName || row.asin || row.objectType || '待识别对象'}</strong>
        <span>{row.objectType || '广告对象'}{row.asin ? ` · ${row.asin}` : ''}</span>
      </div>
    ),
  },
  {
    key: 'diagnosis',
    header: '当前判断',
    priority: 'primary',
    cell: (row) => (
      <div className="priority-diagnosis-cell">
        <StatusPill tone={dashboardRiskObjectTone(row)}>{dashboardRiskObjectLabel(row)}</StatusPill>
        <span>{row.diagnosis || row.suggestedDirection || '等待人工复核'}</span>
      </div>
    ),
  },
  {
    key: 'spend',
    header: '花费',
    priority: 'supporting',
    align: 'right',
    cell: (row) => formatUsd(row.spend),
  },
  {
    key: 'acos',
    header: 'ACOS',
    priority: 'supporting',
    align: 'right',
    cell: (row) => row.orders > 0 ? formatPercent(row.acos * 100) : '-',
  },
];

export function DashboardPage({ nextSafeAction }: { nextSafeAction: NextSafeAction }) {
  const { data, error, loading, reload, scope } = useBusinessDataPipeline();
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

  const riskQueue = dashboardRiskObjectQueue({
    diagnostics: quant?.diagnostics || [],
    isQuantifiable,
  });
  const riskRows = riskQueue.rows;

  return (
    <div data-workspace="today" data-workspace-evidence-root data-workspace-subview="overview">
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
                  <h3 id="today-evidence-path-title">最近文件路径</h3>
                </div>
                <StatusPill tone={collection?.evidencePaths.length ? 'ready' : 'warning'}>{collection?.evidencePaths.length || 0} 个入口</StatusPill>
              </div>
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
                <p className="muted-line">当前还没有可打开的真实报表或证据路径。</p>
              )}
            </section>
          </div>
        </ProgressiveDetails>
      </PageFrame>
    </div>
  );
}
