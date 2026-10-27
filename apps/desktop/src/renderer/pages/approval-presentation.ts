import {
  formatPercent,
  formatUsd,
} from '../formatters';
import type {
  AiEvidenceDisplayItemView,
  RecommendationView,
} from '../types';
import { toUserFacingError } from '../user-facing-error';
import { localizeProductStage } from '@amazon-ai-ops/business-presenters';

export function errorMessage(caught: unknown, fallback: string): string {
  return `${fallback}: ${toUserFacingError(caught, fallback)}`;
}

export function objectName(rec: RecommendationView): string {
  return rec.evidence?.searchTerm || rec.evidence?.targeting || rec.entityName || '-';
}

export function quantSummary(rec: RecommendationView): string {
  const status = rec.evidence?.quantStatus || '未量化';
  const stage = rec.evidence?.quantLifecycleStage || '未知阶段';
  const severity = rec.evidence?.quantSeverity || '未知风险';
  return `${status} / ${stage} / ${severity}`;
}

export function decisionLabel(rec: RecommendationView): string {
  const labels: Record<string, string> = {
    aligned: '规则+AI 一致',
    conflict: '规则/AI 冲突',
    ai_only: 'AI 独立洞察',
    rule_only: '规则独立建议',
  };
  return labels[String(rec.evidence?.decisionAgreement || 'rule_only')] || String(rec.evidence?.decisionAgreement || '规则独立建议');
}

export function strategyLabel(rec: RecommendationView): string {
  if (rec.evidence?.aiStrategySource === 'ai') return 'AI 阶段诊断';
  if (rec.evidence?.aiStrategySource === 'rule') return '规则策略兜底';
  return '未诊断';
}

export function thresholdSummary(rec: RecommendationView): string {
  const thresholds = rec.evidence?.quantThresholds;
  if (!thresholds) return '暂无规则量化阈值';
  return [
    `目标 ACOS ${formatPercent(Number(thresholds.targetAcos || 0) * 100)}`,
    `高 ACOS ${formatPercent(Number(thresholds.highAcosThreshold || 0) * 100)}`,
    `无订单 ${Number(thresholds.noOrderClickThreshold || 0)} 点击`,
    `止损 ${formatUsd(thresholds.minSpend)}`,
  ].join(' / ');
}

export function aiThresholdReviewSuffix(thresholds: NonNullable<RecommendationView['evidence']>['aiThresholdSuggestions']): string {
  const reviewReasons = Object.values(thresholds || {})
    .filter((item) => item?.requiresReview)
    .flatMap((item) => item.reviewReasons?.length ? item.reviewReasons : ['AI 动态阈值需要人工复核。']);
  return reviewReasons.length ? ` / 需复核：${Array.from(new Set(reviewReasons)).slice(0, 2).join('；')}` : '';
}

export function aiThresholdSummary(rec: RecommendationView): string {
  const thresholds = rec.evidence?.aiThresholdSuggestions;
  if (!thresholds) return '暂无 AI 动态阈值';
  const parts = [
    thresholds.targetAcos ? `目标 ACOS ${formatPercent(Number(thresholds.targetAcos.value) * 100)}` : '',
    thresholds.highAcosThreshold ? `高 ACOS ${formatPercent(Number(thresholds.highAcosThreshold.value) * 100)}` : '',
    thresholds.noOrderClickThreshold ? `无订单 ${Number(thresholds.noOrderClickThreshold.value)} 点击` : '',
    thresholds.minSpend ? `最低花费 ${formatUsd(Number(thresholds.minSpend.value))}` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(' / ')}${aiThresholdReviewSuffix(thresholds)}` : '暂无 AI 动态阈值';
}

export function compactList(values?: string[]): string {
  return values?.length ? values.join('；') : '无';
}

export function optionalPercent(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? formatPercent(numeric * 100) : '-';
}

export function optionalMoney(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? formatUsd(numeric) : '-';
}

export function evidenceTypeLabel(type?: string): string {
  const labels: Record<string, string> = {
    metric: '报表指标',
    timeline: '时间线',
    operation_event: '运营事件',
    product_context: '产品配置',
    rule_candidate: '规则候选',
  };
  return labels[String(type || '')] || String(type || '未知证据');
}

export function evidenceMetricLine(item: AiEvidenceDisplayItemView): string {
  if (!item.metrics) return '无指标值';
  return [
    `${formatUsd(item.metrics.cost || 0)} / ${formatUsd(item.metrics.sales || 0)}`,
    `${Number(item.metrics.orders || 0)} 单`,
    `${Number(item.metrics.clicks || 0)} 点击`,
    `ACOS ${formatPercent(Number(item.metrics.acos || 0) * 100)}`,
  ].join(' / ');
}

export function evidenceContextLine(item: AiEvidenceDisplayItemView): string {
  return [
    item.batchId ? `批次 ${item.batchId}` : '',
    item.reportType ? `报表 ${item.reportType}` : '',
    item.dateRange ? `日期 ${item.dateRange}` : '',
    item.sourceRow ? `行 ${item.sourceRow}` : '',
  ].filter(Boolean).join(' / ') || '无来源上下文';
}

export function productStageLabel(stage?: string): string {
  return localizeProductStage(stage);
}
