import type { AppRoute, DeliveryReadinessView } from './types';

export type OperatorTone = 'ready' | 'warning' | 'blocked' | 'pending';

export interface OperatorCopy {
  label: string;
  tone: OperatorTone;
  detail: string;
}

export interface PrimaryAction extends OperatorCopy {
  route: AppRoute;
}

type DeliveryStatusInput = Partial<DeliveryReadinessView> | null | undefined;

export interface DataStateInput {
  realReportCount: number;
  importedRows: number;
  actionableRows: number;
}

const TECHNICAL_TERM_PATTERNS = [
  /\bAPP_[A-Z0-9_]+\b/,
  /\b(?:[A-Z0-9]+_)*NEEDS_WORK\b/,
  /\b(?:[A-Z0-9]+_)+READY\b/,
  /\bAPP_READY\b/i,
  /\bAPP_NEEDS_WORK\b/i,
  /\bREADY\b/i,
  /\bmanifest\b/i,
  /\bgate\b/i,
  /\breadback\b/i,
  /\bjson\b/i,
  /\bsha-?256\b/i,
];

export function containsTechnicalTerm(copy: string): boolean {
  return TECHNICAL_TERM_PATTERNS.some((pattern) => pattern.test(copy));
}

export function operatorStatusLabel(tone: OperatorTone): string {
  switch (tone) {
    case 'ready':
      return '已完成';
    case 'warning':
      return '需复核';
    case 'blocked':
      return '需处理';
    case 'pending':
      return '待开始';
  }
}

export function deliveryStatusCopy(readiness: DeliveryStatusInput): OperatorCopy {
  if (readiness?.appReady && readiness.manifestDriven) {
    return {
      label: '可以交付',
      tone: 'ready',
      detail: '最终验收和安装包证据已通过。保留交付包、安装包路径和校验码。',
    };
  }

  return {
    label: '还不能交付',
    tone: 'blocked',
    detail: '还有验收项未通过。先补齐下方最关键缺口，再刷新最终验收。',
  };
}

export function primaryActionForDataState(dataState: DataStateInput): PrimaryAction {
  const normalizedDataState = {
    realReportCount: normalizeCount(dataState.realReportCount),
    importedRows: normalizeCount(dataState.importedRows),
    actionableRows: normalizeCount(dataState.actionableRows),
  };

  if (normalizedDataState.realReportCount <= 0) {
    return {
      label: '获取真实报表',
      tone: 'blocked',
      detail: '先下载当前范围的真实广告报表，再进入导入和量化。',
      route: 'data-collection',
    };
  }

  if (normalizedDataState.importedRows <= 0) {
    return {
      label: '导入广告指标',
      tone: 'warning',
      detail: '已有真实报表，先把表格写入日级广告指标。',
      route: 'data-import-validation',
    };
  }

  if (normalizedDataState.actionableRows > 0) {
    return {
      label: '查看广告表现',
      tone: 'ready',
      detail: '已有可复核广告对象，检查花费、订单和 ACOS 后再生成建议。',
      route: 'ad-quant',
    };
  }

  return {
    label: '复核数据缺口',
    tone: 'warning',
    detail: '已导入指标，但还没有可复核广告对象。检查报表范围、ASIN 和广告对象字段。',
    route: 'data-import-validation',
  };
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
