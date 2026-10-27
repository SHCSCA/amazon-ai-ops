import { formatPercent,formatUsd } from '../formatters';
import type { AiEvidenceDisplayItemView,RecommendationView } from '../types';
import { hasCurrentRecommendationReviewResolution } from './approval-page';
import {
lifecycleLabel,
recommendationObject,
} from './recommendation-labels';

export function evidenceBatch(rec: RecommendationView, fallbackBatchId?: string): string {
  return rec.evidence?.batchId || fallbackBatchId || '-';
}

export function evidenceSourceFiles(rec: RecommendationView): string[] {
  return Array.from(new Set((rec.evidence?.sourceFiles || []).filter(Boolean)));
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
    `CPC ${formatUsd(item.metrics.cpc || 0)}`,
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

export function evidenceAdObjectLine(item: AiEvidenceDisplayItemView): string {
  return [
    item.campaignName || '-',
    item.adGroupName || '-',
    item.asin || '-',
    item.entityType || '-',
    item.entityName || '-',
  ].join(' / ');
}

export function evidenceEventLine(item: AiEvidenceDisplayItemView): string {
  if (!item.event) return '';
  return [
    item.event.eventDate || '-',
    item.event.eventType || '-',
    item.event.impactExpectation || '-',
  ].join(' / ');
}

export function evidenceProductLine(item: AiEvidenceDisplayItemView): string {
  if (!item.product) return '';
  return [
    item.product.productStage ? `阶段 ${lifecycleLabel(item.product.productStage)}` : '',
    item.product.targetAcos ? `目标 ACOS ${formatPercent(item.product.targetAcos * 100)}` : '',
    item.product.targetTacos ? `目标 TACOS ${formatPercent(item.product.targetTacos * 100)}` : '',
    item.product.targetNetMargin ? `目标净利率 ${formatPercent(item.product.targetNetMargin * 100)}` : '',
    item.product.minPrice ? `最低价 ${formatUsd(item.product.minPrice)}` : '',
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

export function aiEvidenceDetailIssues(rec: RecommendationView): string[] {
  if (rec.evidence?.aiStrategySource !== 'ai') return [];
  const agreement = String(rec.evidence?.decisionAgreement || '');
  const aiActionParticipated = agreement === 'aligned' || agreement === 'ai_only';
  if (!aiActionParticipated) return [];
  const refs = (rec.evidence?.aiEvidenceRefs || []).map((ref) => String(ref || '').trim()).filter(Boolean);
  if (!refs.length) return ['缺 AI 可回查证据引用'];
  const detailIds = new Set((rec.evidence?.aiEvidenceDetails || []).map((item) => String(item.evidenceId || '').trim()).filter(Boolean));
  const missingRefs = refs.filter((ref) => !detailIds.has(ref));
  return missingRefs.length ? [`AI 证据缺少可展示明细：${missingRefs.slice(0, 3).join('、')}`] : [];
}

export function firstNonEmptyStrings(...values: Array<string[] | undefined>): string[] {
  for (const value of values) {
    if (value?.length) return value;
  }
  return [];
}

export function normalizeReportSourcePath(sourceRef: unknown): string {
  return String(sourceRef || '').trim().replace(/\\/g, '/').toLowerCase();
}

export function isRealReportSourceFile(sourceRef: unknown): boolean {
  return /\.(xlsx|xls|csv)$/i.test(String(sourceRef || '').trim().split(/[?#]/)[0]);
}

export function hasPositiveSourceRow(value: unknown): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function aiLifecycleReviewIssues(rec: RecommendationView): string[] {
  if (rec.evidence?.aiLifecycleStageRequiresReview !== true) return [];
  const agreement = String(rec.evidence?.decisionAgreement || '');
  if (agreement !== 'aligned' && agreement !== 'ai_only') return [];
  return firstNonEmptyStrings(
    rec.evidence.aiLifecycleStageInvalidReasons,
    ['AI 阶段判断需要人工复核'],
  );
}

export function recommendationEvidenceIssues(rec: RecommendationView, currentBatchId?: string, allowedSourceFiles?: string[]): string[] {
  const issues: string[] = [];
  const sourceBatchId = rec.evidence?.batchId;
  const recSourceFiles = evidenceSourceFiles(rec);
  if (!sourceBatchId) issues.push('缺来源批次');
  if (sourceBatchId && currentBatchId && sourceBatchId !== currentBatchId) issues.push('来源批次不一致');
  if (!rec.evidence?.date) issues.push('缺指标日期');
  if (!rec.currentValue) issues.push('缺当前值');
  if (!rec.recommendedValue) issues.push('缺建议值');
  if (!recSourceFiles.length) issues.push('缺来源文件');
  if (recSourceFiles.length && !recSourceFiles.every(isRealReportSourceFile)) issues.push('来源文件不是真实广告报表');
  if (!hasPositiveSourceRow(rec.evidence?.sourceRow)) issues.push('缺来源行号');
  if (recSourceFiles.length && Array.isArray(allowedSourceFiles) && allowedSourceFiles.length === 0) {
    issues.push('当前批次真实报表文件未加载');
  }
  if (recSourceFiles.length && Array.isArray(allowedSourceFiles) && allowedSourceFiles.length > 0) {
    const allowed = new Set(allowedSourceFiles.map(normalizeReportSourcePath));
    const allSourcesCurrent = recSourceFiles.every((file) => allowed.has(normalizeReportSourcePath(file)));
    if (!allSourcesCurrent) {
      issues.push('来源文件不属于当前数据批次真实报表');
      issues.push('未能与当前批次的不透明报表工件对应（旧路径证据已阻断）');
    }
  }
  if (!rec.evidence?.campaignName) issues.push('缺广告活动');
  if (!rec.evidence?.adGroupName) issues.push('缺广告组');
  if (!recommendationObject(rec) || recommendationObject(rec) === '-') issues.push('缺关键词/搜索词/投放对象');
  const writableTarget = rec.evidence?.writableTarget;
  if (!writableTarget) {
    issues.push('缺 Ads 可写对象');
  } else if (
    !writableTarget.entityType
    || !writableTarget.entityId
    || !writableTarget.entityName
    || !writableTarget.campaignName
    || !writableTarget.adGroupName
    || !writableTarget.sourceFile
    || !hasPositiveSourceRow(writableTarget.sourceRow)
    || !writableTarget.identitySource
    || !writableTarget.identityProofPath
  ) {
    issues.push('Ads 可写对象核验不完整');
  }
  return [...issues, ...aiEvidenceDetailIssues(rec), ...aiLifecycleReviewIssues(rec)];
}

export function recommendationHasEvidenceBlocker(rec: RecommendationView, currentBatchId?: string, allowedSourceFiles?: string[]): boolean {
  if (rec.evidence?.aiInsightOnly) return true;
  if (rec.evidence?.aiInsightInvalidReasons?.length) return true;
  if (aiEvidenceDetailIssues(rec).length) return true;
  if (aiLifecycleReviewIssues(rec).length) return true;
  if (rec.evidence?.aiEvidenceSufficiency && rec.evidence.aiEvidenceSufficiency.canUseForFormalActions === false) return true;
  return recommendationEvidenceIssues(rec, currentBatchId, allowedSourceFiles).length > 0;
}

export function recommendationRequiresManualReview(rec: RecommendationView, currentBatchId?: string, allowedSourceFiles?: string[]): boolean {
  if (recommendationHasEvidenceBlocker(rec, currentBatchId, allowedSourceFiles)) return false;
  if (rec.status === 'needs_review') return true;
  if (rec.evidence?.decisionRequiresReview) return true;
  if (rec.evidence?.quantReviewRequired && !hasCurrentRecommendationReviewResolution(rec)) return true;
  if (rec.evidence?.decisionAgreement === 'conflict' || rec.evidence?.decisionAgreement === 'ai_only') return true;
  return false;
}

export function recommendationCanEnterFormalApproval(rec: RecommendationView, currentBatchId?: string, allowedSourceFiles?: string[]): boolean {
  if (rec.status !== 'pending') return false;
  if (recommendationHasEvidenceBlocker(rec, currentBatchId, allowedSourceFiles)) return false;
  if (recommendationRequiresManualReview(rec, currentBatchId, allowedSourceFiles)) return false;
  return true;
}

export function recommendationNeedsOperatorResolution(rec: RecommendationView, currentBatchId?: string, allowedSourceFiles?: string[]): boolean {
  return recommendationHasEvidenceBlocker(rec, currentBatchId, allowedSourceFiles) || recommendationRequiresManualReview(rec, currentBatchId, allowedSourceFiles);
}
