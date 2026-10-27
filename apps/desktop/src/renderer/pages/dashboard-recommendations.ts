import type { AppRoute } from '../types';
import {
  type DashboardRecommendationStatus,
  type DashboardStatusCard,
} from "./dashboard-contracts";

export function dashboardRecommendationStatusFilters(): DashboardRecommendationStatus[] {
  return ['pending', 'needs_review'];
}

export function dashboardPreGateActionCopy(input: {
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
