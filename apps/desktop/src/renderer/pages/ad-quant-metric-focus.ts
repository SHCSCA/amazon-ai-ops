import {
  formatPercent,
  formatUsd,
} from '../formatters';
import type {
  BusinessQuantDiagnostic,
  BusinessQuantTimeline,
  SettingsRuleConfig,
} from '../types';
import {
  type AdQuantMetricFocus,
  type WasteRiskSpendTile,
} from "./ad-quant-contracts";
import { quantSourceLabel } from "./ad-quant-values";

export function adQuantFocusLabel(focus: AdQuantMetricFocus): string {
  const labels: Record<AdQuantMetricFocus, string> = {
    all: '全部诊断对象',
    high_acos: '高 ACOS 对象',
    waste: '无订单浪费对象',
    orders: '已出单对象',
    scale: '可扩量对象',
    review: '待复核对象',
  };
  return labels[focus];
}

export function adQuantDiagnosticMatchesFocus(
  row: BusinessQuantDiagnostic,
  focus: AdQuantMetricFocus,
  config: Pick<SettingsRuleConfig, 'highAcosThreshold' | 'noOrderClickThreshold' | 'minSpend'>,
): boolean {
  if (focus === 'all') return true;
  if (focus === 'high_acos') return row.acos >= config.highAcosThreshold && row.spend >= config.minSpend;
  if (focus === 'waste') return row.quantStatus === 'waste' || (row.orders === 0 && (row.spend >= config.minSpend || row.clicks >= config.noOrderClickThreshold));
  if (focus === 'orders') return row.orders > 0;
  if (focus === 'scale') return row.quantStatus === 'scale';
  if (focus === 'review') return row.quantStatus === 'watch' || row.quantStatus === 'blocked' || row.severity === 'medium' || row.severity === 'high';
  return true;
}

export function adQuantTimelineMatchesFocus(
  timeline: BusinessQuantTimeline,
  focus: AdQuantMetricFocus,
  config: Pick<SettingsRuleConfig, 'highAcosThreshold' | 'noOrderClickThreshold' | 'minSpend'>,
): boolean {
  if (focus === 'all') return true;
  if (focus === 'high_acos') return timeline.totals.acos >= config.highAcosThreshold && timeline.totals.cost >= config.minSpend;
  if (focus === 'waste') return timeline.quantStatus === 'waste' || (timeline.totals.orders === 0 && (timeline.totals.cost >= config.minSpend || timeline.totals.clicks >= config.noOrderClickThreshold));
  if (focus === 'orders') return timeline.totals.orders > 0;
  if (focus === 'scale') return timeline.quantStatus === 'scale';
  if (focus === 'review') return timeline.reviewRequired || timeline.quantStatus === 'watch' || timeline.quantStatus === 'blocked';
  return true;
}

export function buildQuantAccountingLine(input: {
  summarySource?: string;
  batchIds?: string[];
  asin?: string;
  canonicalRows?: number;
}): string {
  const batchText = input.batchIds?.length ? input.batchIds.join('、') : '当前匹配批次';
  const asinText = input.asin ? `，只筛选 ASIN ${input.asin}` : '';
  const rowText = Number(input.canonicalRows || 0) > 0 ? `，可加总 ${input.canonicalRows} 行` : '';
  return `当前总盘只读取 ${batchText} 的 ${quantSourceLabel(input.summarySource)}${asinText}${rowText}；重复采集按批次隔离，不跨批次、不跨报表层级重复相加。`;
}

export function buildWasteRiskSpendTile(input: {
  wastedSpend?: number | null;
  totalSpend?: number | null;
  highRiskCount?: number | null;
}): WasteRiskSpendTile {
  const hasWastedSpend = typeof input.wastedSpend === 'number' && Number.isFinite(input.wastedSpend);
  const totalSpend = typeof input.totalSpend === 'number' && Number.isFinite(input.totalSpend) ? input.totalSpend : 0;
  const highRiskCount = Math.max(0, Number(input.highRiskCount || 0));

  if (!hasWastedSpend) {
    return {
      label: '浪费/高风险花费',
      value: '待日级数据',
      detail: '先导入 8 类真实报表后显示金额占比。',
      tone: 'pending',
    };
  }

  const wastedSpend = Math.max(0, Number(input.wastedSpend));
  const riskText = highRiskCount > 0 ? `${highRiskCount} 个高风险对象` : '暂无高风险对象';
  const ratioText = totalSpend > 0
    ? `占当前产品花费 ${formatPercent((wastedSpend / totalSpend) * 100)}`
    : '当前产品花费为 0，暂不计算占比';

  return {
    label: '浪费/高风险花费',
    value: formatUsd(wastedSpend),
    detail: `${ratioText}；${riskText}`,
    tone: wastedSpend > 0 || highRiskCount > 0 ? 'blocked' : 'ready',
  };
}
