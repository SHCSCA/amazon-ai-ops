import {
  formatEvidenceRefSummary,
  operatorFacingAdQuantReason,
} from '../evidence-display';
import {
  formatPercent,
  formatUsd,
} from '../formatters';
import type {
  AdStrategyDiagnosisView,
  AiEvidenceDisplayItemView,
  BusinessQuantTimeline,
} from '../types';
import { normalizeRuleConfig } from "./ad-quant-values";

export function strategyDiagnosisSourceLabel(source?: string): string {
  return source === 'ai' ? 'AI 已分析' : '规则兜底';
}

export function strategyThresholdTitle(source?: string): string {
  return source === 'ai' ? 'AI 动态阈值建议' : '规则兜底阈值建议';
}

export function thresholdLine(timeline: BusinessQuantTimeline): string {
  return [
    `目标 ACOS ${formatPercent(Number(timeline.thresholds.targetAcos || 0) * 100)}`,
    `高风险 ${formatPercent(Number(timeline.thresholds.highAcosThreshold || 0) * 100)}`,
    `无订单 ${Number(timeline.thresholds.noOrderClickThreshold || 0)} 点击`,
    `止损 ${formatUsd(timeline.thresholds.minSpend)}`,
  ].join(' / ');
}

export function thresholdSourceLine(): string {
  return '来源：当前规则配置；AI 动态阈值在“优化建议”生成时结合运营事件、产品阶段和每日趋势复核。';
}

export function ruleThresholdSummary(config: ReturnType<typeof normalizeRuleConfig>): string {
  return [
    `目标 ACOS ${formatPercent(config.targetAcos * 100)}`,
    `高风险 ${formatPercent(config.highAcosThreshold * 100)}`,
    `无订单 ${config.noOrderClickThreshold} 点击`,
    `最低花费 ${formatUsd(config.minSpend)}`,
  ].join(' / ');
}

export function aiThresholdValueLabel(key: keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions'], value: number): string {
  if (key === 'targetAcos' || key === 'highAcosThreshold') return formatPercent(value * 100);
  if (key === 'minSpend') return formatUsd(value);
  return `${Math.round(value)} 点击`;
}

export function aiThresholdLabel(key: keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions']): string {
  const labels: Record<keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions'], string> = {
    targetAcos: '目标 ACOS',
    highAcosThreshold: '高风险 ACOS',
    noOrderClickThreshold: '无订单点击',
    minSpend: '最低花费',
  };
  return labels[key];
}

export function ruleThresholdValue(config: ReturnType<typeof normalizeRuleConfig>, key: keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions']): number {
  if (key === 'targetAcos') return config.targetAcos;
  if (key === 'highAcosThreshold') return config.highAcosThreshold;
  if (key === 'noOrderClickThreshold') return config.noOrderClickThreshold;
  return config.minSpend;
}

export function thresholdDeltaLabel(
  key: keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions'],
  ruleValue: number,
  aiValue: number,
): string {
  const delta = aiValue - ruleValue;
  if (Math.abs(delta) < 0.0001) return '与规则一致';
  const prefix = delta > 0 ? 'AI 更宽松' : 'AI 更严格';
  if (key === 'targetAcos' || key === 'highAcosThreshold') return `${prefix} ${formatPercent(Math.abs(delta) * 100)}`;
  if (key === 'minSpend') return `${prefix} ${formatUsd(Math.abs(delta))}`;
  return `${prefix} ${Math.round(Math.abs(delta))} 点击`;
}

export function aiFallbackMessage(diagnosis: AdStrategyDiagnosisView | null): string {
  if (!diagnosis || diagnosis.summary.source === 'ai') return '';
  if (diagnosis.summary.fallbackReason?.includes('未配置 AI Key')) {
    return 'AI 未连接：当前只使用规则量化。可在设置页测试 DeepSeek 后重新分析。';
  }
  if (diagnosis.summary.fallbackReason) {
    return `AI 未参与：${operatorFacingAdQuantReason(diagnosis.summary.fallbackReason)}。当前只使用规则量化。`;
  }
  return 'AI 未参与：当前只使用规则量化。';
}

export function thresholdEvidenceReviewLine(input: {
  item: AdStrategyDiagnosisView['summary']['thresholdSuggestions'][keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions']];
  evidencePackPreview?: AiEvidenceDisplayItemView[];
}): { tone: 'muted' | 'warning'; text: string } {
  const evidenceSummary = formatEvidenceRefSummary(input.item.evidenceRefs, input.evidencePackPreview);
  const missingDetail = evidenceSummary.includes('缺少证据明细：');
  const reviewReasons = [
    ...(input.item.reviewReasons || []),
    ...(missingDetail ? [evidenceSummary] : []),
  ].map(operatorFacingAdQuantReason);
  const needsReview = input.item.requiresReview === true || missingDetail;
  const reviewText = needsReview
    ? `；需要人工复核后才能覆盖规则阈值${reviewReasons.length ? `。复核原因：${reviewReasons.join('；')}` : '。'}`
    : '';
  return {
    tone: needsReview ? 'warning' : 'muted',
    text: `引用证据：${evidenceSummary}${reviewText}`,
  };
}
