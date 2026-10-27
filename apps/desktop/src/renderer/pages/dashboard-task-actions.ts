import type { NavigationIntent } from '../navigation';
import type { AppRoute } from '../types';
import {
  type DashboardPrimaryTaskAction,
  type DashboardPrimaryTaskNavigationFeedback,
} from "./dashboard-contracts";
import { dashboardDataGateAction } from "./dashboard-data-readiness";

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

export function dashboardArtifactActionKey(label: string, artifactId: string): string {
  return `${label}:${String(artifactId || 'missing')}`;
}

export function dashboardOpenArtifactButtonView(input: {
  activeArtifactKey: string | null;
  baseClassName?: string;
  disabled?: boolean;
  idleLabel: string;
  artifactKey: string;
}): {
  label: string;
  disabled: boolean;
  ariaBusy?: true;
  className: string;
  showSpinner: boolean;
} {
  const active = input.activeArtifactKey === input.artifactKey;
  return {
    label: active ? '打开中...' : input.idleLabel,
    disabled: Boolean(input.disabled || input.activeArtifactKey),
    ariaBusy: active ? true : undefined,
    className: [input.baseClassName || 'secondary-button', active ? 'button-loading' : ''].filter(Boolean).join(' '),
    showSpinner: active,
  };
}

export function navigate(target: AppRoute | NavigationIntent) {
  window.dispatchEvent(new CustomEvent<AppRoute | NavigationIntent>('amazon-ai-ops:navigate', { detail: target }));
}
