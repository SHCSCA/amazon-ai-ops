import {
  formatPercent,
  formatUsd,
} from '../formatters';
import type {
  AdStrategyDiagnosisView,
  AiDiagnosisRunView,
  AiEvidenceDisplayItemView,
  BusinessQuantDiagnostic,
  BusinessQuantTimeline,
} from '../types';
import { lifecycleLabel } from "./ad-quant-values";

export function diagnosisIdentityPart(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

export function diagnosisTimelineMatchesDiagnostic(
  timeline: BusinessQuantTimeline,
  diagnostic: BusinessQuantDiagnostic,
): boolean {
  const timelineObjectKey = diagnosisIdentityPart(timeline.objectKey);
  const diagnosticObjectKey = diagnosisIdentityPart(diagnostic.objectKey);
  if (!timelineObjectKey || !diagnosticObjectKey || timelineObjectKey !== diagnosticObjectKey) return false;

  return diagnosisIdentityPart(timeline.objectType) === diagnosisIdentityPart(diagnostic.objectType)
    && diagnosisIdentityPart(timeline.objectName) === diagnosisIdentityPart(diagnostic.objectName)
    && diagnosisIdentityPart(timeline.campaignName) === diagnosisIdentityPart(diagnostic.campaignName)
    && diagnosisIdentityPart(timeline.adGroupName) === diagnosisIdentityPart(diagnostic.adGroupName)
    && diagnosisIdentityPart(timeline.asin) === diagnosisIdentityPart(diagnostic.asin);
}

export function diagnosisRunEvidenceTotal(run: AiDiagnosisRunView): number {
  return Number(run.evidencePackSummary?.total || 0);
}

export function diagnosisRunEvidenceLabel(run: AiDiagnosisRunView): string {
  return `证据包 ${diagnosisRunEvidenceTotal(run)} 条`;
}

export function diagnosisRunSummaryText(run: AiDiagnosisRunView): string {
  const summary = run.diagnosis?.summary?.trim();
  if (summary) return summary;

  const fallbackReason = run.diagnosis?.aiFallbackReason?.trim();
  if (fallbackReason) return fallbackReason;

  const insightCount = run.insights?.length || 0;
  if (insightCount > 0 && !run.formalRecommendationCount) {
    return `AI 已完成诊断，产生 ${insightCount} 条洞察，但未形成可审批建议。先补齐证据引用、来源行和广告对象绑定后再重新生成。`;
  }

  if (insightCount > 0) {
    return `AI 已完成诊断，产生 ${insightCount} 条洞察，并形成 ${run.formalRecommendationCount} 条正式建议。`;
  }

  if (run.success === false) return run.errorMessage || 'AI 诊断失败，当前没有可展示摘要。';
  return '本次诊断没有形成摘要；请检查 AI 调用日志、证据包和当前范围数据。';
}

export function diagnosisRunInsightPreview(run: AiDiagnosisRunView): string[] {
  return (run.insights || []).slice(0, 3).map((insight) => {
    const reason = insight.invalidReasons?.filter(Boolean).join('；')
      || insight.reason
      || '未进入建议池';
    return `${insight.entityType || '对象'} / ${insight.actionType || '动作'} / ${insight.entityName || '-'}：${reason}`;
  });
}

export function evidenceTypeLabel(type: AiEvidenceDisplayItemView['type']): string {
  const labels: Record<AiEvidenceDisplayItemView['type'], string> = {
    metric: '报表指标',
    timeline: '对象时间线',
    operation_event: '运营事件',
    product_context: '产品配置',
    rule_candidate: '规则候选',
  };
  return labels[type] || type;
}

export function evidenceMetricLine(item: AiEvidenceDisplayItemView): string {
  if (!item.metrics) return '';
  return [
    `${formatUsd(item.metrics.cost || 0)} / ${formatUsd(item.metrics.sales || 0)}`,
    `${Number(item.metrics.orders || 0)} 单`,
    `${Number(item.metrics.clicks || 0)} 点击`,
  ].join(' / ');
}

export function evidenceContextLine(item: AiEvidenceDisplayItemView): string {
  return [item.campaignName, item.adGroupName, item.entityName].filter(Boolean).join(' / ');
}

export function evidenceSourceLine(item: AiEvidenceDisplayItemView): string {
  const parts = [
    item.dateRange,
    item.batchId ? `批次 ${item.batchId}` : '',
    item.reportType ? `报表 ${item.reportType}` : '',
    item.sourceRow ? `行 ${item.sourceRow}` : '',
  ].filter(Boolean);
  return parts.join(' / ');
}

export function evidenceEventLine(item: AiEvidenceDisplayItemView): string {
  if (!item.event) return '';
  return [item.event.eventDate, item.event.eventType, item.event.impactExpectation].filter(Boolean).join(' / ');
}

export function evidenceProductLine(item: AiEvidenceDisplayItemView): string {
  if (!item.product) return '';
  return [
    item.product.productStage ? `阶段 ${lifecycleLabel(item.product.productStage)}` : '',
    typeof item.product.targetAcos === 'number' ? `目标 ACOS ${formatPercent(item.product.targetAcos * 100)}` : '',
    typeof item.product.targetTacos === 'number' ? `目标 TACOS ${formatPercent(item.product.targetTacos * 100)}` : '',
    typeof item.product.minPrice === 'number' ? `最低价 ${formatUsd(item.product.minPrice)}` : '',
  ].filter(Boolean).join(' / ');
}

export function evidenceTimelineLine(item: AiEvidenceDisplayItemView): string {
  if (!item.timeline) return '';
  return [
    item.timeline.inferredStage ? `阶段 ${lifecycleLabel(item.timeline.inferredStage)}` : '',
    typeof item.timeline.activeDays === 'number' ? `活跃 ${item.timeline.activeDays} 天` : '',
    item.timeline.firstMetricDate && item.timeline.lastMetricDate ? `${item.timeline.firstMetricDate} 至 ${item.timeline.lastMetricDate}` : '',
  ].filter(Boolean).join(' / ');
}

export function evidenceTimelineDailyLine(item: AiEvidenceDisplayItemView): string {
  const recent = item.timeline?.recentDaily || [];
  if (!recent.length) return '';
  return recent
    .slice(-3)
    .map((day) => `${day.date} ${formatUsd(day.cost || 0)} / ${day.orders || 0} 单`)
    .join('；');
}

export function evidenceSufficiencyLabel(level?: string): string {
  if (level === 'high') return '证据充分';
  if (level === 'medium') return '证据中等';
  if (level === 'low') return '证据不足';
  return '无指标证据';
}

export function evidenceSufficiencyTone(level?: string): 'ready' | 'warning' | 'blocked' | 'pending' {
  if (level === 'high') return 'ready';
  if (level === 'medium') return 'warning';
  if (level === 'low' || level === 'none') return 'blocked';
  return 'pending';
}

export function referencedEvidenceIds(summary: AdStrategyDiagnosisView['summary']): Set<string> {
  const refs = [
    ...(summary.lifecycleStageEvidenceRefs || []),
    ...Object.values(summary.thresholdSuggestions || {}).flatMap((item) => item.evidenceRefs || []),
    ...(summary.aiInsights || []).flatMap((item) => item.evidenceRefs || []),
  ];
  return new Set(refs.filter(Boolean));
}
