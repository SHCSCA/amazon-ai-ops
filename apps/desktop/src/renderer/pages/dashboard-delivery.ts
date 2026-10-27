import {
  type DeliveryMatrixItem,
  type DeliveryMatrixStatus,
} from '../delivery-readiness-matrix';
import type { AppRoute } from '../types';

export function dashboardVisibleDeliveryItems(items: DeliveryMatrixItem[], limit = 3): DeliveryMatrixItem[] {
  const unfinished = items.filter((item) => item.tone !== 'ready');
  return (unfinished.length ? unfinished : items).slice(0, limit);
}

export function dashboardDeliveryGateItemCopy(item: DeliveryMatrixItem, gateState: {
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
