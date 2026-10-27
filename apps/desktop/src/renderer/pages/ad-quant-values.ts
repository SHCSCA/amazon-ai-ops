import {
  formatPercent,
  formatUsd,
} from '../formatters';
import {
  localizeProductStage,
  localizeQuantStatus,
} from '@amazon-ai-ops/business-presenters';
import type {
  AppRoute,
  BusinessQuantDiagnostic,
  BusinessQuantTimeline,
  SettingsRuleConfig,
} from '../types';
import { DEFAULT_QUANT_RULE_CONFIG } from "./ad-quant-constants";

export function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeRuleConfig(config: Partial<SettingsRuleConfig> | null | undefined) {
  return {
    targetAcos: readNumber(config?.targetAcos, DEFAULT_QUANT_RULE_CONFIG.targetAcos),
    highAcosThreshold: readNumber(config?.highAcosThreshold, DEFAULT_QUANT_RULE_CONFIG.highAcosThreshold),
    noOrderClickThreshold: readNumber(config?.noOrderClickThreshold, DEFAULT_QUANT_RULE_CONFIG.noOrderClickThreshold),
    minSpend: readNumber(config?.minSpend, DEFAULT_QUANT_RULE_CONFIG.minSpend),
  };
}

export function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

export function quantSourceLabel(source?: string): string {
  if (source === 'canonical_advertised_product') return '推广商品报表口径';
  if (source === 'canonical_ad_group') return '广告组报表口径';
  if (source === 'canonical_user_search_term') return '用户搜索词权威口径';
  if (source === 'canonical_search_term') return '搜索词总盘口径';
  if (source === 'actionable_fallback') return '可行动报表近似口径';
  return '未形成量化口径';
}

export function quantSourceDescription(source?: string): string {
  if (source === 'canonical_advertised_product') return '总盘使用推广商品报表汇总，优先对齐领星 ERP 广告效果的 ASIN 级花费、销售、订单和点击。';
  if (source === 'canonical_ad_group') return '总盘使用广告组报表汇总，优先对齐领星 ERP 广告效果的花费、销售、订单和点击。';
  if (source === 'canonical_user_search_term') return '总盘使用用户搜索词报表汇总，避免广告活动/广告组/投放位置等报表重复累加。';
  if (source === 'canonical_search_term') return '总盘使用搜索词报表汇总，避免广告活动/广告组/投放位置等报表重复累加。';
  if (source === 'actionable_fallback') return '未找到推广商品、广告组或搜索词权威总表，暂用关键词、商品投放和自动投放等可行动报表近似汇总。';
  return '当前范围缺少真实原始报表或导入指标，不能计算广告表现。';
}

export function lifecycleLabel(stage?: string): string {
  return localizeProductStage(stage);
}

export function quantStatusLabel(status?: string): string {
  return localizeQuantStatus(status);
}

export function trendLabel(value?: string): string {
  const labels: Record<string, string> = {
    up: '上升',
    down: '下降',
    flat: '平稳',
    insufficient: '样本不足',
  };
  return labels[value || 'insufficient'] || '样本不足';
}

export function maxDailyCost(daily: Array<{ cost: number }>): number {
  return Math.max(1, ...daily.map((item) => Number(item.cost || 0)));
}

export function timelineTone(timeline: BusinessQuantTimeline): 'ready' | 'warning' | 'blocked' | 'pending' {
  if (timeline.quantStatus === 'waste') return 'blocked';
  if (timeline.quantStatus === 'scale') return 'ready';
  if (timeline.reviewRequired || timeline.quantStatus === 'watch') return 'warning';
  return 'pending';
}

export function priorityReason(row: BusinessQuantDiagnostic, config: ReturnType<typeof normalizeRuleConfig>): string {
  if (row.orders === 0 && row.spend >= config.minSpend) return `花费达到 ${formatUsd(config.minSpend)} 仍无订单`;
  if (row.orders === 0 && row.clicks >= config.noOrderClickThreshold) return `点击达到 ${config.noOrderClickThreshold} 仍无订单`;
  if (row.acos >= config.highAcosThreshold && row.spend >= config.minSpend) return `ACOS 高于 ${formatPercent(config.highAcosThreshold * 100)}`;
  if (row.orders > 0 && row.acos <= config.targetAcos) return `ACOS 低于目标 ${formatPercent(config.targetAcos * 100)}`;
  if (row.clicks > 0 && row.sales === 0) return '有点击无销售';
  return '需人工复核相关性';
}

export function priorityScore(row: BusinessQuantDiagnostic, config: ReturnType<typeof normalizeRuleConfig>): number {
  const noOrderPenalty = row.orders === 0 && (row.spend >= config.minSpend || row.clicks >= config.noOrderClickThreshold) ? 10000 : 0;
  const highAcosPenalty = row.acos >= config.highAcosThreshold && row.spend >= config.minSpend ? 5000 : 0;
  return noOrderPenalty + highAcosPenalty + row.spend + row.clicks * 0.1;
}
