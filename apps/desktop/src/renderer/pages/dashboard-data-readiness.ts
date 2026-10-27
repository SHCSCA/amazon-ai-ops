import type { AppRoute } from '../types';
import { type DashboardActionQueueItem } from "./dashboard-contracts";

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
