import type { AppRoute } from '../types';
import { type DashboardWorkflowStep } from "./dashboard-contracts";
import { dashboardDataGateAction } from "./dashboard-data-readiness";

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
