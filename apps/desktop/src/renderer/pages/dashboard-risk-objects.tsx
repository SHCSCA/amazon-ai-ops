import { StatusPill } from '../components/ui';
import { type PriorityDataTableColumn } from '../components/workspace';
import {
  formatPercent,
  formatUsd,
} from '../formatters';
import type {
  AppRoute,
  BusinessQuantDiagnostic,
} from '../types';
import { type DashboardRouteAction } from "./dashboard-contracts";

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

export const dashboardRiskColumns: Array<PriorityDataTableColumn<BusinessQuantDiagnostic>> = [
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
