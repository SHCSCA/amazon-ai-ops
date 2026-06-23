import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { OperatorTaskPanel } from '../components/operator-task-panel';
import { ProgressiveDetails } from '../components/progressive-details';
import { PageHeader, Panel, StateLightGrid, StatusPill } from '../components/ui';
import { buildDecisionEvidenceSummary, formatEvidenceRefSummary } from '../evidence-display';
import { formatPercent, formatUsd } from '../formatters';
import { buildRecommendationGateIssues, resolveRecommendationBatchId } from '../recommendation-readiness';
import { realReportCoverageCount } from '../report-coverage';
import { countProductsWithTargets, normalizeProductContexts, pickPrimaryProductContext } from '../product-context';
import type { AiEvidenceDisplayItemView, AiEvidenceSufficiencyView, AiProviderSettings, AppRoute, RecommendationView, SettingsRuleConfig } from '../types';
import { toUserFacingError } from '../user-facing-error';

function errorMessage(caught: unknown, fallback: string): string {
  return `${fallback}: ${toUserFacingError(caught, fallback)}`;
}

function recommendationObject(rec: RecommendationView): string {
  return rec.evidence?.searchTerm || rec.evidence?.targeting || rec.entityName || '-';
}

function sourceLabel(rec: RecommendationView): string {
  if (rec.evidence?.explanationSource === 'ai') return 'DeepSeek AI';
  if (rec.evidence?.explanationSource === 'rule' || rec.evidence?.aiActionFallbackReason) return '规则解释兜底';
  if (rec.evidence?.aiFallbackReason) return '规则兜底';
  return '规则';
}

function strategyLabel(rec: RecommendationView): string {
  if (rec.evidence?.aiStrategySource === 'ai') return 'AI 策略诊断';
  if (rec.evidence?.aiStrategySource === 'rule' || rec.evidence?.aiStrategyFallbackReason) return '规则策略兜底';
  return '未诊断';
}

function lifecycleLabel(stage?: string): string {
  const labels: Record<string, string> = {
    cold_start: '冷启动',
    keyword_exploration: '关键词探索',
    stable_conversion: '稳定转化',
    scaling: '放量',
    profit_harvesting: '利润收割',
    clearance: '清货',
    declining_repair: '衰退修复',
    unknown: '未知阶段',
  };
  return labels[String(stage || 'unknown')] || String(stage || '未知阶段');
}

function decisionLabel(rec: RecommendationView): string {
  const labels: Record<string, string> = {
    aligned: '规则+AI 一致',
    conflict: '规则/AI 冲突',
    ai_only: 'AI 独立洞察',
    rule_only: '规则独立建议',
  };
  return labels[String(rec.evidence?.decisionAgreement || '')] || '未合并';
}

function decisionTone(rec: RecommendationView): 'ready' | 'pending' | 'blocked' | 'warning' {
  if (rec.evidence?.decisionAgreement === 'aligned') return 'ready';
  if (rec.evidence?.decisionAgreement === 'conflict') return 'blocked';
  if (rec.evidence?.decisionAgreement === 'ai_only') return 'warning';
  if (rec.evidence?.decisionRequiresReview) return 'warning';
  return 'pending';
}

function quantLabel(status?: string): string {
  const labels: Record<string, string> = {
    healthy: '健康',
    watch: '观察',
    waste: '浪费风险',
    scale: '可扩量',
    blocked: '样本不足',
  };
  return labels[String(status || '')] || '未量化';
}

function quantTone(status?: string): 'ready' | 'pending' | 'blocked' | 'warning' {
  if (status === 'waste') return 'blocked';
  if (status === 'scale' || status === 'healthy') return 'ready';
  if (status === 'watch') return 'warning';
  return 'pending';
}

function thresholdReviewSuffix(thresholds: NonNullable<RecommendationView['evidence']>['aiThresholdSuggestions']): string {
  const reviewReasons = Object.values(thresholds || {})
    .filter((item) => item?.requiresReview)
    .flatMap((item) => item.reviewReasons?.length ? item.reviewReasons : ['AI 动态阈值需要人工复核。']);
  return reviewReasons.length ? ` / 需复核：${Array.from(new Set(reviewReasons)).slice(0, 2).join('；')}` : '';
}

export function thresholdSuggestionSummary(rec: RecommendationView): string {
  const thresholds = rec.evidence?.aiThresholdSuggestions;
  if (!thresholds) return '暂无 AI 动态阈值';
  const parts = [
    thresholds.targetAcos ? `目标 ACOS ${formatPercent(Number(thresholds.targetAcos.value) * 100)}` : '',
    thresholds.highAcosThreshold ? `高 ACOS ${formatPercent(Number(thresholds.highAcosThreshold.value) * 100)}` : '',
    thresholds.noOrderClickThreshold ? `无订单 ${thresholds.noOrderClickThreshold.value} 点击` : '',
    thresholds.minSpend ? `最低花费 ${formatUsd(thresholds.minSpend.value)}` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(' / ')}${thresholdReviewSuffix(thresholds)}` : '暂无 AI 动态阈值';
}

function ruleQuantThresholdSummary(rec: RecommendationView): string {
  const thresholds = rec.evidence?.quantThresholds;
  if (!thresholds) return '暂无规则阈值';
  return [
    `目标 ACOS ${formatPercent(Number(thresholds.targetAcos || 0) * 100)}`,
    `高风险 ${formatPercent(Number(thresholds.highAcosThreshold || 0) * 100)}`,
    `无订单 ${Number(thresholds.noOrderClickThreshold || 0)} 点击`,
    `止损 ${formatUsd(thresholds.minSpend)}`,
  ].join(' / ');
}

function reviewReason(rec: RecommendationView): string {
  if (rec.evidence?.decisionAgreement === 'conflict') return 'AI 与规则冲突，必须人工复核';
  if (rec.evidence?.decisionAgreement === 'ai_only') return 'AI 独立洞察，必须人工复核';
  if (rec.evidence?.quantReviewRequired) return '规则量化要求人工复核';
  if (rec.status === 'needs_review') return '已进入复核队列';
  return '可进入普通审批';
}

export function recommendationFormalApprovalExplanationText(): string {
  return '证据完整、绑定当前批次和广告对象，且不是 AI 独立洞察、冲突或显式复核标记。';
}

export function recommendationReviewExplanationText(): string {
  return '规则与 AI 冲突、AI 独立洞察、样本复核或明确进入复核队列的动作先由运营判断。';
}

export function recommendationMergeSummaryText(counts: { aligned: number; conflict: number; aiOnly: number }): string {
  return `${counts.aligned} 一致 / ${counts.conflict} 冲突 / ${counts.aiOnly} AI 独立洞察`;
}

export function recommendationMergeExplanationText(): string {
  return '冲突和 AI 独立洞察建议必须人工复核，不会进入自动执行。';
}

function evidenceBatch(rec: RecommendationView, fallbackBatchId?: string): string {
  return rec.evidence?.batchId || fallbackBatchId || '-';
}

function evidenceSourceFiles(rec: RecommendationView): string[] {
  return Array.from(new Set((rec.evidence?.sourceFiles || []).filter(Boolean)));
}

function evidenceTypeLabel(type?: string): string {
  const labels: Record<string, string> = {
    metric: '报表指标',
    timeline: '时间线',
    operation_event: '运营事件',
    product_context: '产品配置',
    rule_candidate: '规则候选',
  };
  return labels[String(type || '')] || String(type || '未知证据');
}

function evidenceMetricLine(item: AiEvidenceDisplayItemView): string {
  if (!item.metrics) return '无指标值';
  return [
    `${formatUsd(item.metrics.cost || 0)} / ${formatUsd(item.metrics.sales || 0)}`,
    `${Number(item.metrics.orders || 0)} 单`,
    `${Number(item.metrics.clicks || 0)} 点击`,
    `ACOS ${formatPercent(Number(item.metrics.acos || 0) * 100)}`,
    `CPC ${formatUsd(item.metrics.cpc || 0)}`,
  ].join(' / ');
}

function evidenceContextLine(item: AiEvidenceDisplayItemView): string {
  return [
    item.batchId ? `批次 ${item.batchId}` : '',
    item.reportType ? `报表 ${item.reportType}` : '',
    item.dateRange ? `日期 ${item.dateRange}` : '',
    item.sourceRow ? `行 ${item.sourceRow}` : '',
  ].filter(Boolean).join(' / ') || '无来源上下文';
}

function evidenceAdObjectLine(item: AiEvidenceDisplayItemView): string {
  return [
    item.campaignName || '-',
    item.adGroupName || '-',
    item.asin || '-',
    item.entityType || '-',
    item.entityName || '-',
  ].join(' / ');
}

function evidenceEventLine(item: AiEvidenceDisplayItemView): string {
  if (!item.event) return '';
  return [
    item.event.eventDate || '-',
    item.event.eventType || '-',
    item.event.impactExpectation || '-',
  ].join(' / ');
}

function evidenceProductLine(item: AiEvidenceDisplayItemView): string {
  if (!item.product) return '';
  return [
    item.product.productStage ? `阶段 ${lifecycleLabel(item.product.productStage)}` : '',
    item.product.targetAcos ? `目标 ACOS ${formatPercent(item.product.targetAcos * 100)}` : '',
    item.product.targetTacos ? `目标 TACOS ${formatPercent(item.product.targetTacos * 100)}` : '',
    item.product.targetNetMargin ? `目标净利率 ${formatPercent(item.product.targetNetMargin * 100)}` : '',
    item.product.minPrice ? `最低价 ${formatUsd(item.product.minPrice)}` : '',
  ].filter(Boolean).join(' / ');
}

function evidenceTimelineLine(item: AiEvidenceDisplayItemView): string {
  if (!item.timeline) return '';
  return [
    item.timeline.inferredStage ? `阶段 ${lifecycleLabel(item.timeline.inferredStage)}` : '',
    typeof item.timeline.activeDays === 'number' ? `活跃 ${item.timeline.activeDays} 天` : '',
    item.timeline.firstMetricDate && item.timeline.lastMetricDate ? `${item.timeline.firstMetricDate} 至 ${item.timeline.lastMetricDate}` : '',
  ].filter(Boolean).join(' / ');
}

function evidenceTimelineDailyLine(item: AiEvidenceDisplayItemView): string {
  const recent = item.timeline?.recentDaily || [];
  if (!recent.length) return '';
  return recent
    .slice(-3)
    .map((day) => `${day.date} ${formatUsd(day.cost || 0)} / ${day.orders || 0} 单`)
    .join('；');
}

function evidenceSufficiencyLabel(level?: string): string {
  if (level === 'high') return '证据充分';
  if (level === 'medium') return '证据中等';
  if (level === 'low') return '证据不足';
  return '无指标证据';
}

function evidenceSufficiencyTone(level?: string): 'ready' | 'warning' | 'blocked' | 'pending' {
  if (level === 'high') return 'ready';
  if (level === 'medium') return 'warning';
  if (level === 'low' || level === 'none') return 'blocked';
  return 'pending';
}

function aiEvidenceDetailIssues(rec: RecommendationView): string[] {
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

function firstNonEmptyStrings(...values: Array<string[] | undefined>): string[] {
  for (const value of values) {
    if (value?.length) return value;
  }
  return [];
}

function normalizeReportSourcePath(filePath: unknown): string {
  return String(filePath || '').trim().replace(/\\/g, '/').toLowerCase();
}

function isRealReportSourceFile(filePath: unknown): boolean {
  return /\.(xlsx|xls|csv)$/i.test(String(filePath || '').trim().split(/[?#]/)[0]);
}

function hasPositiveSourceRow(value: unknown): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function aiLifecycleReviewIssues(rec: RecommendationView): string[] {
  if (rec.evidence?.aiLifecycleStageRequiresReview !== true) return [];
  const agreement = String(rec.evidence?.decisionAgreement || '');
  if (agreement !== 'aligned' && agreement !== 'ai_only') return [];
  return firstNonEmptyStrings(
    rec.evidence.aiLifecycleStageInvalidReasons,
    ['AI 阶段判断需要人工复核'],
  );
}

function recommendationEvidenceIssues(rec: RecommendationView, currentBatchId?: string, allowedSourceFiles?: string[]): string[] {
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
    if (!allSourcesCurrent) issues.push('来源文件不属于当前数据批次真实报表');
  }
  if (!rec.evidence?.campaignName) issues.push('缺广告活动');
  if (!rec.evidence?.adGroupName) issues.push('缺广告组');
  if (!recommendationObject(rec) || recommendationObject(rec) === '-') issues.push('缺关键词/搜索词/投放对象');
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

function recommendationRequiresManualReview(rec: RecommendationView, currentBatchId?: string, allowedSourceFiles?: string[]): boolean {
  if (recommendationHasEvidenceBlocker(rec, currentBatchId, allowedSourceFiles)) return false;
  if (rec.status === 'needs_review') return true;
  if (rec.evidence?.decisionRequiresReview || rec.evidence?.quantReviewRequired) return true;
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

export function recommendationWorkflowActionState(input: {
  recommendationCount: number;
  formalApprovalCount: number;
  manualReviewCount: number;
  evidenceBlockedCount: number;
  approvedCount?: number;
}): {
  approvalDisabled: boolean;
  readbackDisabled: boolean;
  approvalLabel: string;
  readbackLabel: string;
} {
  const formalApprovalCount = Math.max(0, Number(input.formalApprovalCount || 0));
  const approvedCount = Math.max(0, Number(input.approvedCount || 0));
  if (formalApprovalCount > 0) {
    return {
      approvalDisabled: false,
      readbackDisabled: approvedCount <= 0,
      approvalLabel: '去审批中心',
      readbackLabel: approvedCount > 0 ? '去执行回读' : '审批后回读',
    };
  }
  if (input.recommendationCount > 0 && (input.manualReviewCount > 0 || input.evidenceBlockedCount > 0)) {
    return {
      approvalDisabled: true,
      readbackDisabled: true,
      approvalLabel: '先处理复核/证据',
      readbackLabel: '等待可审批建议',
    };
  }
  return {
    approvalDisabled: true,
    readbackDisabled: true,
    approvalLabel: '等待建议',
    readbackLabel: '等待可审批建议',
  };
}

export function recommendationPrimaryTaskActionState(input: {
  quantReady: boolean;
  recommendationCount: number;
  formalApprovalCount: number;
  manualReviewCount: number;
  evidenceBlockedCount: number;
  realReportCount: number;
  importedRowCount: number;
  actionableMetricRows: number;
  generating?: boolean;
  pipelineLoading?: boolean;
}): {
  label: '生成优化建议' | '去审批中心' | '补齐证据或复核';
  action: 'generate' | 'navigate';
  route?: AppRoute;
  title: string;
  detail: string;
  disabled: boolean;
} {
  const recommendationCount = Math.max(0, Number(input.recommendationCount || 0));
  const formalApprovalCount = Math.max(0, Number(input.formalApprovalCount || 0));
  const manualReviewCount = Math.max(0, Number(input.manualReviewCount || 0));
  const evidenceBlockedCount = Math.max(0, Number(input.evidenceBlockedCount || 0));
  const realReportCount = Math.max(0, Number(input.realReportCount || 0));
  const importedRowCount = Math.max(0, Number(input.importedRowCount || 0));
  const actionableMetricRows = Math.max(0, Number(input.actionableMetricRows || 0));

  if (!input.quantReady) {
    const route: AppRoute = realReportCount < 8
      ? 'data-collection'
      : importedRowCount <= 0
        ? 'data-import-validation'
        : 'ad-quant';
    return {
      label: '补齐证据或复核',
      action: 'navigate',
      route,
      title: `建议池未开放：可审批 0，需复核 ${manualReviewCount}，缺证据 ${evidenceBlockedCount}`,
      detail: `当前真实报表 ${realReportCount}/8 类，导入指标 ${importedRowCount} 行，可行动指标 ${actionableMetricRows} 行。下一步：补齐证据或复核。`,
      disabled: false,
    };
  }

  if (formalApprovalCount > 0) {
    return {
      label: '去审批中心',
      action: 'navigate',
      route: 'approval',
      title: `建议池：可审批 ${formalApprovalCount}，需复核 ${manualReviewCount}，缺证据 ${evidenceBlockedCount}`,
      detail: `当前共有 ${recommendationCount} 条待处理建议。下一步：去审批中心逐条批准或拒绝；真实执行和回读仍在后续页面完成。`,
      disabled: false,
    };
  }

  if (recommendationCount > 0 && (manualReviewCount > 0 || evidenceBlockedCount > 0)) {
    return {
      label: '补齐证据或复核',
      action: 'navigate',
      route: 'ad-quant',
      title: `建议池：可审批 0，需复核 ${manualReviewCount}，缺证据 ${evidenceBlockedCount}`,
      detail: `当前共有 ${recommendationCount} 条建议，但没有可进入普通审批的动作。下一步：补齐证据或复核量化输入。`,
      disabled: false,
    };
  }

  return {
    label: '生成优化建议',
    action: 'generate',
    title: `建议池：可审批 ${formalApprovalCount}，需复核 ${manualReviewCount}，缺证据 ${evidenceBlockedCount}`,
    detail: `真实报表 ${realReportCount}/8 类，导入指标 ${importedRowCount} 行，可行动指标 ${actionableMetricRows} 行。下一步：生成优化建议。`,
    disabled: Boolean(input.generating || input.pipelineLoading),
  };
}

function recommendationType(rec: RecommendationView): string {
  return rec.entityType || rec.evidence?.matchType || '-';
}

function riskTone(riskLevel?: string): 'ready' | 'pending' | 'blocked' | 'warning' {
  const normalized = String(riskLevel || '').toLowerCase();
  if (normalized.includes('high') || normalized.includes('approval')) return 'warning';
  if (normalized.includes('block')) return 'blocked';
  return 'pending';
}

function eventMatchesRecommendation(event: { asin?: string; campaignName?: string; adGroupName?: string }, rec: RecommendationView): boolean {
  const recAsin = String(rec.evidence?.asin || '').trim().toUpperCase();
  const recCampaign = String(rec.evidence?.campaignName || '').trim().toLowerCase();
  const recAdGroup = String(rec.evidence?.adGroupName || '').trim().toLowerCase();
  const eventHasSpecificTarget = Boolean(event.asin || event.campaignName || event.adGroupName);
  if (!eventHasSpecificTarget) return true;
  if (event.asin && recAsin && event.asin.trim().toUpperCase() !== recAsin) return false;
  if (event.campaignName && recCampaign && event.campaignName.trim().toLowerCase() !== recCampaign) return false;
  if (event.adGroupName && recAdGroup && event.adGroupName.trim().toLowerCase() !== recAdGroup) return false;
  return true;
}

function operationEventTypeLabel(type?: string): string {
  const labels: Record<string, string> = {
    coupon: 'Coupon',
    deal: 'Deal / 促销',
    bd: 'BD',
    ld: 'LD',
    promotion: '大促 / 活动',
    price_change: '调价',
    inventory_issue: '库存异常',
    inventory: '库存',
    listing_change: 'Listing 修改',
    offsite_promotion: '站外推广',
    review_change: '评价变化',
    external_traffic: '站外流量',
    note: '备注',
    manual_note: '人工备注',
  };
  return labels[String(type || '')] || String(type || '事件');
}

function thresholdSummary(config: SettingsRuleConfig | null): string {
  if (!config) return '正在读取规则阈值';
  return `目标 ACOS ${formatPercent(config.targetAcos * 100)} / 高 ACOS ${formatPercent(config.highAcosThreshold * 100)} / 无订单 ${config.noOrderClickThreshold} 点击 / 最低花费 ${formatUsd(config.minSpend)}`;
}

type AiReadinessStatus = 'unknown' | 'unconfigured' | 'pending_test' | 'available' | 'failed';

interface AiReadiness {
  status: AiReadinessStatus;
  label: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
  model?: string;
  baseUrl?: string;
  lastTestAt?: string;
  message: string;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function normalizeBaseUrl(value: unknown): string {
  return readString(value).replace(/\/+$/, '');
}

function normalizeAiSettings(settings: Record<string, unknown> | null | undefined): AiProviderSettings {
  return {
    aiApiKey: readString(settings?.aiApiKey ?? settings?.ai_api_key),
    aiKeyConfigured: readBoolean(settings?.aiKeyConfigured ?? settings?.ai_key_configured),
    aiBaseUrl: readString(settings?.aiBaseUrl ?? settings?.ai_base_url) || 'https://api.deepseek.com',
    aiModel: readString(settings?.aiModel ?? settings?.ai_model) || 'deepseek-v4-flash',
    aiTemperature: readString(settings?.aiTemperature ?? settings?.ai_temperature) || '0.3',
    aiMaxTokens: readString(settings?.aiMaxTokens ?? settings?.ai_max_tokens) || '8192',
    aiLastTestStatus: readString(settings?.aiLastTestStatus ?? settings?.ai_last_test_status) as AiProviderSettings['aiLastTestStatus'],
    aiLastTestAt: readString(settings?.aiLastTestAt ?? settings?.ai_last_test_at),
    aiLastTestBaseUrl: readString(settings?.aiLastTestBaseUrl ?? settings?.ai_last_test_base_url),
    aiLastTestModel: readString(settings?.aiLastTestModel ?? settings?.ai_last_test_model),
    aiLastTestMessage: readString(settings?.aiLastTestMessage ?? settings?.ai_last_test_message),
  };
}

function aiReadinessFromSettings(settings: AiProviderSettings | null): AiReadiness {
  if (!settings) {
    return {
      status: 'unknown',
      label: 'AI 状态未读取',
      tone: 'pending',
      message: '无法读取 AI 设置时，本页仍可使用规则生成建议，但不会声称 AI 已参与。',
    };
  }
  const keyPresent = Boolean(settings.aiApiKey.trim() || settings.aiKeyConfigured);
  if (!keyPresent) {
    return {
      status: 'unconfigured',
      label: 'AI 未配置',
      tone: 'warning',
      model: settings.aiModel,
      baseUrl: settings.aiBaseUrl,
      message: '未配置 API Key，本次只能使用规则量化和规则解释。',
    };
  }
  const testedSameBase = normalizeBaseUrl(settings.aiLastTestBaseUrl) === normalizeBaseUrl(settings.aiBaseUrl);
  const testedSameModel = settings.aiLastTestModel === settings.aiModel;
  if (testedSameBase && testedSameModel && settings.aiLastTestStatus === 'available') {
    return {
      status: 'available',
      label: 'AI 可用',
      tone: 'ready',
      model: settings.aiModel,
      baseUrl: settings.aiBaseUrl,
      lastTestAt: settings.aiLastTestAt,
      message: '生成建议时会调用 AI 参与产品阶段诊断、动态阈值建议和动作解释。',
    };
  }
  if (testedSameBase && testedSameModel && settings.aiLastTestStatus === 'failed') {
    return {
      status: 'failed',
      label: 'AI 测试失败',
      tone: 'blocked',
      model: settings.aiModel,
      baseUrl: settings.aiBaseUrl,
      lastTestAt: settings.aiLastTestAt,
      message: settings.aiLastTestMessage || '最近一次 AI 连接测试失败，本次可能回落到规则。',
    };
  }
  return {
    status: 'pending_test',
    label: 'AI 待测试',
    tone: 'pending',
    model: settings.aiModel,
    baseUrl: settings.aiBaseUrl,
    message: 'API Key 已配置，但当前 Base URL 或模型未完成可用性测试；建议先到设置页测试 AI 连接。',
  };
}

interface GenerateAiSummary {
  generated: number;
  metrics: number;
  candidates: number;
  skipped: number;
  refreshed: number;
  configured: boolean;
  invoked: boolean;
  aiCount: number;
  ruleCount: number;
  model?: string;
  reason: string;
  aiCandidateCount: number;
  finalActionCount: number;
  strategy?: {
    source?: 'ai' | 'rule';
    evidenceSufficiency?: AiEvidenceSufficiencyView;
    lifecycleStage?: string;
    summary?: string;
    mainProblems?: string[];
    riskWarnings?: string[];
    thresholdSuggestions?: Record<string, { value: number; reason: string }>;
    aiCandidateCount?: number;
    operationEventCount?: number;
    productContextCount?: number;
    decisionCounts?: {
      total?: number;
      aligned?: number;
      ruleOnly?: number;
      aiOnly?: number;
      conflict?: number;
      reviewRequired?: number;
    };
    finalCandidateCount?: number;
    insightOnlyCandidateCount?: number;
    aiInsights?: Array<{
      entityType?: string;
      entityName?: string;
      actionType?: string;
      reason?: string;
      invalidReasons?: string[];
      confidence?: number;
    }>;
    filteredAiOnlyCandidateCount?: number;
    filterReasons?: string[];
    fallbackReason?: string;
  };
}

type RecommendationListStatus = 'pending' | 'needs_review';

export function recommendationStatusFiltersForPage(): RecommendationListStatus[] {
  return ['pending', 'needs_review'];
}

function generateAiTone(summary: GenerateAiSummary): 'success' | 'default' | 'blocked' | 'warning' {
  if (!summary.configured) return 'warning';
  if (!summary.invoked) return 'default';
  if (summary.aiCount > 0 || summary.strategy?.source === 'ai') return 'success';
  return 'warning';
}

export function generateAiStatus(summary: GenerateAiSummary): string {
  if (!summary.configured) return '未配置 AI Key';
  if (!summary.invoked) return 'AI 未调用';
  if (summary.aiCount > 0) return 'AI 已参与';
  if (summary.strategy?.source === 'ai') return 'AI 已参与诊断';
  if (summary.strategy?.fallbackReason) return `AI 已转为规则兜底：${summary.strategy.fallbackReason}`;
  if (summary.strategy?.aiInsights?.length) return 'AI 仅作洞察';
  return 'AI 无可用输出';
}

function generateStrategyThresholdLine(summary: GenerateAiSummary): string {
  const thresholds = summary.strategy?.thresholdSuggestions;
  if (!thresholds) return '暂无动态阈值建议';
  const parts = [
    thresholds.targetAcos ? `目标 ACOS ${formatPercent(Number(thresholds.targetAcos.value) * 100)}` : '',
    thresholds.highAcosThreshold ? `高 ACOS ${formatPercent(Number(thresholds.highAcosThreshold.value) * 100)}` : '',
    thresholds.noOrderClickThreshold ? `无订单 ${Number(thresholds.noOrderClickThreshold.value)} 点击` : '',
    thresholds.minSpend ? `最低花费 ${formatUsd(Number(thresholds.minSpend.value))}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : '暂无动态阈值建议';
}

export function generateDecisionDiagnosticLine(summary: GenerateAiSummary): string {
  const counts = summary.strategy?.decisionCounts;
  if (!counts) return '暂无 AI/规则合并诊断';
  return [
    `一致 ${Number(counts.aligned || 0)}`,
    `规则独立 ${Number(counts.ruleOnly || 0)}`,
    `AI 独立洞察 ${Number(counts.aiOnly || 0)}`,
    `冲突 ${Number(counts.conflict || 0)}`,
    `需复核 ${Number(counts.reviewRequired || 0)}`,
  ].join(' / ');
}

function generateFilterReasonLine(summary: GenerateAiSummary): string {
  const reasons = summary.strategy?.filterReasons || [];
  if (reasons.length) return reasons.join('；');
  return '本次没有返回额外过滤原因。';
}

function productStageLabel(stage?: string): string {
  const labels: Record<string, string> = {
    cold_start: '冷启动',
    keyword_exploration: '关键词探索',
    stable_conversion: '稳定转化',
    scaling: '放量',
    profit_harvesting: '利润收割',
    clearance: '清货',
    declining_repair: '衰退修复',
    launch: '新品启动',
    growth: '增长期',
    stabilize: '稳定期',
    harvest: '利润收割',
    active: '在售',
    unknown: '未知阶段',
  };
  return labels[String(stage || 'unknown')] || String(stage || '未知阶段');
}

function optionalPercent(value: unknown): string {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? formatPercent(numberValue * 100) : '-';
}

function optionalMoney(value: unknown): string {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? formatUsd(numberValue) : '-';
}

export function emptyRecommendationReason(
  quantReady: boolean,
  lastGenerateResult: GenerateAiSummary | null,
  aiReadiness: AiReadiness,
  gateIssues: string[],
): { title: string; detail: string; nextStep: string; tone: 'default' | 'warning' | 'blocked' } {
  if (!quantReady) {
    return {
      title: '缺少真实数据，建议生成被锁定',
      detail: gateIssues.length
        ? `当前阻断：${gateIssues.slice(0, 3).join('；')}。`
        : '当前范围没有真实报表文件或导入指标，系统不会调用 AI，也不会用 0 值生成建议。',
      nextStep: '回到数据采集页，确认 xlsx/xls/csv 文件存在并完成导入。',
      tone: 'blocked',
    };
  }
  if (!lastGenerateResult) {
    return {
      title: '尚未生成当前范围建议',
      detail: '当前列表显示待审批建议和需复核建议。请先点击“生成优化建议”，系统会用规则和 AI 并行诊断当前范围。',
      nextStep: aiReadiness.status === 'available' ? '点击生成优化建议。' : '建议先到设置页测试 AI；也可以先用规则兜底生成。',
      tone: 'default',
    };
  }
  if (lastGenerateResult.generated === 0 && lastGenerateResult.refreshed > 0) {
    return {
      title: '已刷新历史不完整建议',
      detail: `${lastGenerateResult.candidates} 条候选中有 ${lastGenerateResult.refreshed} 条旧建议已补齐为当前证据链版本。`,
      nextStep: '刷新建议池，检查这些建议的来源报表、行号和建议值后再进入审批。',
      tone: 'default',
    };
  }
  if (lastGenerateResult.generated === 0 && lastGenerateResult.skipped > 0) {
    return {
      title: '没有新增建议，候选已存在',
      detail: `${lastGenerateResult.candidates} 条候选中有 ${lastGenerateResult.skipped} 条重复建议已跳过，建议池可能已经被审批、拒绝或过滤。`,
      nextStep: '刷新建议池，或到审批中心查看已处理建议。',
      tone: 'warning',
    };
  }
  if (lastGenerateResult.generated === 0 && lastGenerateResult.candidates === 0) {
    const aiCandidateText = lastGenerateResult.aiCandidateCount > 0
      ? `AI 返回 ${lastGenerateResult.aiCandidateCount} 条候选，但未形成可绑定当前广告对象的待审批动作。`
      : 'AI 没有返回可审批动作候选。';
    const insightReasons = (lastGenerateResult.strategy?.aiInsights || []).flatMap((item) => item.invalidReasons || []);
    const filterReasonList = [
      ...(lastGenerateResult.strategy?.filterReasons || []),
      ...insightReasons,
    ].filter(Boolean);
    const filterReasons = filterReasonList.length
      ? ` 未进入建议池原因：${Array.from(new Set(filterReasonList)).slice(0, 4).join('；')}`
      : '';
    if ((lastGenerateResult.strategy?.aiInsights?.length || 0) > 0 || insightReasons.length > 0) {
      return {
        title: 'AI 仅生成洞察，未进入建议池',
        detail: `${lastGenerateResult.reason || 'AI 已完成诊断，但没有形成可审批动作。'} ${aiCandidateText}${filterReasons}`,
        nextStep: '先补齐证据和对象绑定：确认来源行、广告活动/广告组/关键词或投放对象能回查到当前真实报表；必要时补充运营事件和产品配置后重新生成。',
        tone: 'warning',
      };
    }
    return {
      title: '没有可安全绑定的广告动作',
      detail: `${lastGenerateResult.reason || '规则和 AI 完成诊断，但没有找到足够明确、可绑定广告活动/广告组/对象的动作。'} ${aiCandidateText}${filterReasons}`,
      nextStep: '查看广告量化页的风险对象；必要时补充运营事件或调整阈值后重新生成。若 AI 候选被过滤，说明它缺少可匹配的广告活动/广告组/关键词/投放对象。',
      tone: 'warning',
    };
  }
  return {
    title: '建议池为空',
    detail: '本次生成可能已经完成但当前筛选状态没有待审批或需复核建议，或建议已被处理。',
    nextStep: '刷新建议列表，或到审批中心查看已审批/已拒绝记录。',
    tone: 'default',
  };
}

export function RecommendationsPage() {
  const { data, loading: pipelineLoading, reload: reloadPipeline, scope } = useBusinessDataPipeline();
  const [recommendations, setRecommendations] = useState<RecommendationView[]>([]);
  const [selected, setSelected] = useState<RecommendationView | null>(null);
  const [ruleConfig, setRuleConfig] = useState<SettingsRuleConfig | null>(null);
  const [aiSettings, setAiSettings] = useState<AiProviderSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastGenerateResult, setLastGenerateResult] = useState<GenerateAiSummary | null>(null);
  const currentBatchId = resolveRecommendationBatchId({
    scopeBatchId: scope.batchId,
    latestBatchId: data?.collection.latestBatch?.id,
    sourceBatchIds: data?.collection.sourceBatchIds,
  });
  const importedRowCount = data?.collection.fileAudit?.importedRowCount ?? data?.quant.importedRows ?? 0;
  const realReportCount = realReportCoverageCount(data?.collection);
  const currentRealReportSourceFiles = useMemo(
    () => (data?.collection.realReportFiles || []).map((file) => file.filePath).filter(Boolean),
    [data?.collection.realReportFiles],
  );
  const actionableMetricRows = data?.quant.actionableRows ?? 0;
  const diagnosticCount = data?.quant.diagnostics?.length ?? 0;
  const timelineCount = data?.quant.adObjectTimelines?.length ?? 0;
  const recommendationGateIssues = useMemo(() => {
    const issues = new Set<string>();
    if (!data) {
      issues.add('正在读取当前业务范围的数据状态');
      return Array.from(issues);
    }
    return buildRecommendationGateIssues({
      requiredReportCount: 8,
      realReportFileCount: realReportCount,
      realReportFilesLength: data.collection.realReportFiles.length,
      importedRowCount,
      quantImportedRows: data.quant.importedRows,
      hasImportedMetrics: data.quant.hasImportedMetrics,
      currentBatchId,
      collectionBlockers: data.collection.blockers || [],
      quantBlockers: data.quant.blockers || [],
    });
  }, [currentBatchId, data, importedRowCount, realReportCount]);
  const quantReady = Boolean(data && recommendationGateIssues.length === 0);
  const operationEvents = data?.operations?.events || [];
  const productContexts = normalizeProductContexts(data?.productContext?.products);
  const productContextCount = data?.productContext?.productCount ?? productContexts.length;
  const productWithTargetCount = countProductsWithTargets(productContexts);
  const primaryProductContext = pickPrimaryProductContext(productContexts, scope.asin);
  const latestOperationEvent = [...operationEvents].sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')))[0];
  const aiTextCount = recommendations.filter((item) => item.evidence?.explanationSource === 'ai').length;
  const aiStrategyCount = recommendations.filter((item) => item.evidence?.aiStrategySource === 'ai').length;
  const aiParticipatedCount = recommendations.filter((item) => item.evidence?.explanationSource === 'ai' || item.evidence?.aiStrategySource === 'ai').length;
  const ruleOnlyCount = recommendations.length - aiParticipatedCount;
  const alignedCount = recommendations.filter((item) => item.evidence?.decisionAgreement === 'aligned').length;
  const conflictCount = recommendations.filter((item) => item.evidence?.decisionAgreement === 'conflict').length;
  const aiOnlyCount = recommendations.filter((item) => item.evidence?.decisionAgreement === 'ai_only').length;
  const wasteCount = recommendations.filter((item) => item.evidence?.quantStatus === 'waste').length;
  const totalPendingSpend = recommendations.reduce((sum, item) => sum + Number(item.evidence?.cost ?? item.cost ?? 0), 0);
  const highRiskCount = recommendations.filter((item) => ['high', 'APPROVAL', 'HIGH'].includes(String(item.riskLevel))).length;
  const formalApprovalCount = recommendations.filter((item) => recommendationCanEnterFormalApproval(item, currentBatchId, currentRealReportSourceFiles)).length;
  const manualReviewCount = recommendations.filter((item) => recommendationRequiresManualReview(item, currentBatchId, currentRealReportSourceFiles)).length;
  const evidenceBlockedCount = recommendations.filter((item) => recommendationHasEvidenceBlocker(item, currentBatchId, currentRealReportSourceFiles)).length;
  const operatorResolutionCount = recommendations.filter((item) => recommendationNeedsOperatorResolution(item, currentBatchId, currentRealReportSourceFiles)).length;
  const workflowActionState = recommendationWorkflowActionState({
    recommendationCount: recommendations.length,
    formalApprovalCount,
    manualReviewCount,
    evidenceBlockedCount,
  });
  const primaryTaskAction = recommendationPrimaryTaskActionState({
    quantReady,
    recommendationCount: recommendations.length,
    formalApprovalCount,
    manualReviewCount,
    evidenceBlockedCount,
    realReportCount,
    importedRowCount,
    actionableMetricRows,
    generating,
    pipelineLoading,
  });
  const insightOnlyCount = Math.max(
    recommendations.filter((item) => item.evidence?.aiInsightOnly).length,
    Number(lastGenerateResult?.strategy?.insightOnlyCandidateCount || 0),
    Number(lastGenerateResult?.strategy?.filteredAiOnlyCandidateCount || 0),
    Array.isArray(lastGenerateResult?.strategy?.aiInsights) ? lastGenerateResult.strategy.aiInsights.length : 0,
  );
  const insightOnlyReasons = [
    ...(lastGenerateResult?.strategy?.aiInsights || []).flatMap((item) => item.invalidReasons || []),
    ...(lastGenerateResult?.strategy?.filterReasons || []),
  ].filter(Boolean);
  const aiReadiness = aiReadinessFromSettings(aiSettings);
  const emptyReason = emptyRecommendationReason(quantReady, lastGenerateResult, aiReadiness, recommendationGateIssues);
  const noFormalAiDiagnosis = useMemo(() => {
    if (!quantReady || recommendations.length || !lastGenerateResult) return null;
    const strategy = lastGenerateResult.strategy;
    const aiWasUsed = lastGenerateResult.invoked || strategy?.source === 'ai';
    if (!aiWasUsed || lastGenerateResult.finalActionCount > 0) return null;
    const reasons = Array.from(new Set([
      ...(strategy?.filterReasons || []),
      ...(strategy?.aiInsights || []).flatMap((item) => item.invalidReasons || []),
      !lastGenerateResult.aiCandidateCount ? 'AI 没有返回可审批动作候选。' : '',
    ].filter(Boolean)));
    return {
      summary: strategy?.summary || lastGenerateResult.reason || 'AI 已完成诊断，但未返回可进入审批的广告动作。',
      reasons: reasons.length ? reasons : ['规则和 AI 完成诊断，但没有找到足够明确、可绑定广告活动/广告组/对象的动作。'],
      insights: strategy?.aiInsights || [],
      nextStep: '回到广告量化页复核风险对象、样本量和规则阈值；必要时补充运营事件或产品配置后重新生成。',
    };
  }, [lastGenerateResult, quantReady, recommendations.length]);
  const topRecommendation = [...recommendations].sort((a, b) => {
    const riskDelta = Number(['high', 'APPROVAL', 'HIGH'].includes(String(b.riskLevel))) - Number(['high', 'APPROVAL', 'HIGH'].includes(String(a.riskLevel)));
    if (riskDelta !== 0) return riskDelta;
    return Number(b.evidence?.cost ?? b.cost ?? 0) - Number(a.evidence?.cost ?? a.cost ?? 0);
  })[0];
  const selectedOperationEvents = selected
    ? operationEvents.filter((event) => eventMatchesRecommendation(event, selected)).slice(0, 4)
    : [];
  const selectedDecisionSummary = useMemo(
    () => buildDecisionEvidenceSummary(selected?.evidence),
    [selected],
  );

  const filter = useMemo(() => ({
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    batchId: currentBatchId,
    limit: 100,
  }), [currentBatchId, scope.asin, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);

  async function loadRecommendations() {
    setLoading(true);
    setMessage(null);
    try {
      const getRecommendations = (window as any).electronAPI?.getRecommendations;
      const rowGroups = typeof getRecommendations === 'function'
        ? await Promise.all(recommendationStatusFiltersForPage().map((status) => getRecommendations({ ...filter, status })))
        : [];
      const byId = new Map<number | string, RecommendationView>();
      for (const rows of rowGroups) {
        for (const row of Array.isArray(rows) ? rows : []) {
          byId.set(row.id, row);
        }
      }
      const nextRows = Array.from(byId.values());
      setRecommendations(nextRows);
      setSelected((current) => (current && nextRows.some((row) => row.id === current.id) ? current : null));
    } catch (caught) {
      setMessage(errorMessage(caught, '加载优化建议失败'));
    } finally {
      setLoading(false);
    }
  }

  async function generateRecommendations() {
    if (!quantReady) {
      setMessage(`建议生成被锁定：${recommendationGateIssues.length ? recommendationGateIssues.join('；') : '当前范围缺少真实原始报表文件或导入指标'}。`);
      return;
    }
    setGenerating(true);
    setMessage(null);
    try {
      const result = await (window as any).electronAPI?.generateRecommendations?.({
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
        asin: scope.asin,
        batchId: currentBatchId,
        limit: 300,
      });
      await reloadPipeline();
      await loadRecommendations();
      const generated = Number(result?.generated ?? 0);
      const metrics = Number(result?.metrics ?? 0);
      const candidates = Number(result?.recommendationCandidates ?? generated);
      const skipped = Number(result?.skippedDuplicates ?? 0);
      const refreshed = Number(result?.refreshedDuplicates ?? 0);
      const aiExplanation = result?.aiExplanation || {};
      const strategyDiagnosis = aiExplanation.strategyDiagnosis && typeof aiExplanation.strategyDiagnosis === 'object'
        ? aiExplanation.strategyDiagnosis
        : undefined;
      const aiReason = aiExplanation.reason ? ` ${aiExplanation.reason}` : '';
      const duplicateNote = skipped > 0 ? ` 另有 ${skipped} 条重复建议已跳过。` : '';
      const refreshNote = refreshed > 0 ? ` 已刷新 ${refreshed} 条历史不完整建议。` : '';
      setLastGenerateResult({
        generated,
        metrics,
        candidates,
        skipped,
        refreshed,
        configured: Boolean(aiExplanation.configured),
        invoked: Boolean(aiExplanation.invoked),
        aiCount: Number(aiExplanation.aiCount || 0),
        ruleCount: Number(aiExplanation.ruleCount || 0),
        model: typeof aiExplanation.model === 'string' ? aiExplanation.model : undefined,
        reason: typeof aiExplanation.reason === 'string' ? aiExplanation.reason : '本次生成未返回 AI 参与说明。',
        aiCandidateCount: Number(strategyDiagnosis?.aiCandidateCount || 0),
        finalActionCount: generated + skipped + refreshed,
        strategy: strategyDiagnosis,
      });
      const aiCandidateCount = Number(strategyDiagnosis?.aiCandidateCount || 0);
      const finalActionCount = generated + skipped + refreshed;
      setMessage(`已生成 ${generated} 条新建议，规则候选 ${candidates} 条，AI 候选 ${aiCandidateCount} 条，最终可审批动作 ${finalActionCount} 条，处理 ${metrics} 行广告指标。${refreshNote}${duplicateNote}${aiReason}`);
    } catch (caught) {
      setMessage(errorMessage(caught, '生成优化建议失败'));
    } finally {
      setGenerating(false);
    }
  }

  function navigate(route: AppRoute) {
    window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: route }));
  }

  function runPrimaryTaskAction() {
    if (primaryTaskAction.action === 'generate') {
      generateRecommendations();
      return;
    }
    if (primaryTaskAction.route) navigate(primaryTaskAction.route);
  }

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      try {
        const config = await (window as any).electronAPI?.getRuleConfig?.();
        if (!cancelled && config) setRuleConfig(config);
      } catch {
        if (!cancelled) setRuleConfig(null);
      }
      try {
        const getSettings = (window as any).electronAPI?.getSettings;
        if (typeof getSettings !== 'function') {
          if (!cancelled) setAiSettings(null);
        } else {
          const settings = await getSettings();
          if (!cancelled) setAiSettings(normalizeAiSettings(settings));
        }
      } catch {
        if (!cancelled) setAiSettings(null);
      }
    }

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentBatchId) {
      setRecommendations([]);
      setSelected(null);
      return;
    }
    loadRecommendations();
  }, [currentBatchId, filter]);

  return (
    <div>
      <PageHeader
        eyebrow="广告执行"
        title="优化建议"
        description="只负责生成和解释广告建议。审批、真实执行和回读在后续独立页面完成，避免一个页面承担全部任务。"
        primaryTask="解释为什么要改"
        nextAction={quantReady ? '生成或复核建议' : '先完成数据采集和广告量化'}
      />

      <div className="business-stack">
        <OperatorTaskPanel
          eyebrow="建议池"
          title={primaryTaskAction.title}
          detail={primaryTaskAction.detail}
          primaryAction={{
            label: primaryTaskAction.label,
            disabled: primaryTaskAction.disabled,
            onClick: runPrimaryTaskAction,
          }}
        >
          <StateLightGrid
            items={[
              {
                label: '高风险强阻断',
                value: `缺证据 ${evidenceBlockedCount}`,
                detail: '缺批次、来源或可回查证据',
                tone: evidenceBlockedCount > 0 ? 'blocked' : 'ready',
              },
              {
                label: '需人工复核',
                value: `需复核 ${manualReviewCount}`,
                detail: 'AI 独立洞察或规则冲突',
                tone: manualReviewCount > 0 ? 'warning' : 'pending',
              },
              {
                label: '已就绪可批准',
                value: `可审批 ${formalApprovalCount}`,
                detail: `${recommendations.length} 条建议 / ${realReportCount}/8 类报表`,
                tone: formalApprovalCount > 0 ? 'ready' : recommendations.length ? 'warning' : 'pending',
              },
            ]}
          />
          <div className="business-pill-row" aria-label="建议池分类计数">
            <StatusPill tone={formalApprovalCount > 0 ? 'ready' : 'pending'}>正式可审批 {formalApprovalCount}</StatusPill>
            <StatusPill tone={manualReviewCount > 0 ? 'warning' : 'pending'}>人工复核 {manualReviewCount}</StatusPill>
            <StatusPill tone={insightOnlyCount > 0 ? 'warning' : 'ready'}>AI 洞察未采纳 {insightOnlyCount}</StatusPill>
            <StatusPill tone={evidenceBlockedCount > 0 ? 'blocked' : 'ready'}>证据不足阻断 {evidenceBlockedCount}</StatusPill>
          </div>
        </OperatorTaskPanel>

        {message && <p className={message.includes('失败') || message.includes('不能') ? 'blocked-line' : 'muted-line'}>{message}</p>}

        <ProgressiveDetails title="生成范围、AI 配置和规则阈值">
        <Panel title="建议生成范围" tone={quantReady ? 'success' : 'blocked'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">
                真实报表 {realReportCount}/8 类，导入指标 {importedRowCount} 行。
              </p>
            </div>
            <StatusPill tone={quantReady ? 'ready' : 'blocked'}>
              {quantReady ? '可以生成建议' : '缺真实数据，建议生成锁定'}
            </StatusPill>
          </div>
          <div className="business-pill-row">
            <StatusPill tone={aiReadiness.tone}>{aiReadiness.label}</StatusPill>
            <StatusPill tone="pending">{aiReadiness.model || '模型未读取'}</StatusPill>
            <StatusPill tone="pending">{aiReadiness.baseUrl || 'Base URL 未读取'}</StatusPill>
          </div>
          <p className={aiReadiness.status === 'available' ? 'muted-line' : aiReadiness.status === 'failed' ? 'blocked-line' : 'warning-line'}>
            {aiReadiness.message}
          </p>
          <div className="context-summary-grid">
            <div>
              <span>真实广告事实</span>
              <strong>{realReportCount}/8 类真实报表 / {importedRowCount} 行 DB 指标</strong>
              <p>只使用当前范围真实 xlsx/xls/csv 导入后的每日广告事实。</p>
            </div>
            <div>
              <span>可执行口径</span>
              <strong>{actionableMetricRows} 行 / {diagnosticCount} 个诊断对象</strong>
              <p>建议只绑定 keyword、search term、target 等能落到广告对象的行。</p>
            </div>
            <div>
              <span>阶段与运营上下文</span>
              <strong>{timelineCount} 条时间线 / {operationEvents.length} 条运营事件</strong>
              <p>AI 会结合对象生命周期、Coupon、BD、调价、库存和 Listing 变更解释波动。</p>
            </div>
            <div>
              <span>产品配置</span>
              <strong>{productContextCount} 个产品 / {productWithTargetCount} 个有目标阈值</strong>
              <p>
                {primaryProductContext
                  ? `${primaryProductContext.asin} / ${productStageLabel(primaryProductContext.productStage)} / 目标 ACOS ${optionalPercent(primaryProductContext.cost?.targetAcos)} / TACOS ${optionalPercent(primaryProductContext.cost?.targetTacos)}`
                  : '未配置产品成本、阶段和目标阈值时，AI 只能按广告表现估算。'}
              </p>
            </div>
            <div>
              <span>规则阈值</span>
              <strong>{thresholdSummary(ruleConfig)}</strong>
              <p>规则先给出可复现候选，AI 再参与阶段判断、动态阈值和异常解释。</p>
            </div>
            <div>
              <span>本次 AI 输入</span>
              <strong>广告事实 + 产品配置 + 运营事件 + 规则阈值 + 量化诊断</strong>
              <p>AI 不直接读取审计包，也不会在缺真实数据时用 0 值生成建议。</p>
            </div>
            <div>
              <span>安全边界</span>
              <strong>生成建议池</strong>
              <p>本页不审批、不执行广告、不写入 Amazon；后续必须逐条审批和回读。</p>
            </div>
          </div>
          {!quantReady && recommendationGateIssues.length > 0 && (
            <div className="inline-blocker-list">
              <strong>当前不能生成建议的原因</strong>
              <ul>
                {recommendationGateIssues.slice(0, 6).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="action-row">
            <button className="secondary-button" disabled={loading} onClick={loadRecommendations} type="button">
              {loading ? '刷新中...' : '刷新建议'}
            </button>
          </div>
        </Panel>
        </ProgressiveDetails>

        {lastGenerateResult && (
          <ProgressiveDetails title="本次生成 AI 参与状态">
          <Panel title="本次生成 AI 参与状态" tone={generateAiTone(lastGenerateResult)}>
            <div className="context-summary-grid">
              <div>
                <span>AI 状态</span>
                <strong>{generateAiStatus(lastGenerateResult)}</strong>
                <p>{lastGenerateResult.reason}</p>
              </div>
              <div>
                <span>模型</span>
                <strong>{lastGenerateResult.model || '-'}</strong>
                <p>{lastGenerateResult.configured ? '来自当前保存的 DeepSeek/OpenAI Compatible 设置。' : '未配置 Key 时不会伪装成 AI 策略。'}</p>
              </div>
              <div>
                <span>生成结果</span>
                <strong>{lastGenerateResult.generated} 新建议 / {lastGenerateResult.finalActionCount} 可审批动作</strong>
                <p>规则候选 {lastGenerateResult.candidates} 条，AI 候选 {lastGenerateResult.aiCandidateCount} 条，刷新 {lastGenerateResult.refreshed} 条旧建议，跳过 {lastGenerateResult.skipped} 条重复建议。</p>
              </div>
              <div>
                <span>解释来源</span>
                <strong>{lastGenerateResult.aiCount} AI 建议解释 / {lastGenerateResult.ruleCount} 规则解释</strong>
                <p>
                  {lastGenerateResult.strategy?.source === 'ai'
                    ? 'AI 已参与产品阶段诊断和动态阈值；AI 独立洞察和冲突建议只进入人工复核。'
                    : '这里统计建议文本解释来源；AI 不可用时回落到规则解释。'}
                </p>
              </div>
              <div>
                <span>事件上下文</span>
                <strong>{operationEvents.length} 条运营事件</strong>
                <p>{operationEvents.length ? '已进入广告阶段诊断和动态阈值判断。' : '本次生成没有运营事件背景，AI 只看广告数据。'}</p>
              </div>
              <div>
                <span>产品上下文</span>
                <strong>{lastGenerateResult.strategy?.productContextCount ?? productContextCount} 个产品配置</strong>
                <p>
                  {primaryProductContext
                    ? `${primaryProductContext.asin} / ${productStageLabel(primaryProductContext.productStage)} / 目标 ACOS ${optionalPercent(primaryProductContext.cost?.targetAcos)}`
                    : '本次没有产品成本和目标阈值，AI 阈值建议缺少利润空间约束。'}
                </p>
              </div>
              <div>
                <span>广告阶段诊断</span>
                <strong>{lifecycleLabel(lastGenerateResult.strategy?.lifecycleStage)} / {lastGenerateResult.strategy?.source === 'ai' ? 'AI' : '规则兜底'}</strong>
                <p>{lastGenerateResult.strategy?.summary || '本次没有返回阶段诊断摘要。'}</p>
              </div>
              <div>
                <span>动态阈值建议</span>
                <strong>{generateStrategyThresholdLine(lastGenerateResult)}</strong>
                <p>
                  AI 候选 {lastGenerateResult.aiCandidateCount} 条，
                  运营事件 {lastGenerateResult.strategy?.operationEventCount ?? 0} 条，
                  产品配置 {lastGenerateResult.strategy?.productContextCount ?? productContextCount} 个进入诊断上下文。
                </p>
              </div>
              <div>
                <span>AI/规则合并诊断</span>
                <strong>{generateDecisionDiagnosticLine(lastGenerateResult)}</strong>
                <p>{generateFilterReasonLine(lastGenerateResult)}</p>
              </div>
            </div>
          </Panel>
          </ProgressiveDetails>
        )}

        <ProgressiveDetails title="完整处理路径与安全边界">
        <Panel title="建议处理路径">
          <div className="workflow-strip">
            <button className="workflow-step" onClick={() => generateRecommendations()} disabled={!quantReady || generating || pipelineLoading} type="button">
              <span>1. 生成解释</span>
              <strong>{recommendations.length ? `${recommendations.length} 条待处理` : '等待生成建议'}</strong>
              <StatusPill tone={quantReady ? 'pending' : 'blocked'}>{quantReady ? '本页完成' : '缺真实数据'}</StatusPill>
            </button>
            <button className="workflow-step" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'approval' }))} disabled={workflowActionState.approvalDisabled} type="button">
              <span>2. 审批决策</span>
              <strong>人工批准或拒绝</strong>
              <StatusPill tone={workflowActionState.approvalDisabled ? 'blocked' : 'pending'}>{workflowActionState.approvalLabel}</StatusPill>
            </button>
            <button className="workflow-step" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'readback' }))} disabled={workflowActionState.readbackDisabled} type="button">
              <span>3. 执行回读</span>
              <strong>记录执行前/执行后/回读</strong>
              <StatusPill tone={workflowActionState.readbackDisabled ? 'blocked' : 'warning'}>{workflowActionState.readbackLabel}</StatusPill>
            </button>
          </div>
          <p className="blocked-line">本页不审批、不执行广告、不写入 Amazon；真实动作必须在审批后逐条记录截图和回读证据。</p>
        </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="建议池分类解释">
        <Panel title="建议决策总览" tone={evidenceBlockedCount > 0 ? 'warning' : 'default'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line">只把证据完整、可绑定当前广告对象的动作送入审批中心。</div>
              <p className="muted-line">
                AI 洞察、证据缺失、对象无法绑定、规则与 AI 冲突的动作不会混进普通审批列表；需要先补数据或人工复核。
              </p>
            </div>
            <StatusPill tone={formalApprovalCount > 0 ? 'ready' : recommendations.length ? 'warning' : 'pending'}>
              {formalApprovalCount > 0 ? '有正式建议' : recommendations.length ? '需复核' : '暂无建议'}
            </StatusPill>
          </div>
          <StateLightGrid
            items={[
              {
                label: '正式可审批',
                value: `正式可审批 ${formalApprovalCount}`,
                detail: recommendationFormalApprovalExplanationText(),
                tone: formalApprovalCount > 0 ? 'ready' : 'pending',
              },
              {
                label: '人工复核',
                value: `人工复核 ${manualReviewCount}`,
                detail: recommendationReviewExplanationText(),
                tone: manualReviewCount > 0 ? 'warning' : 'pending',
              },
              {
                label: 'AI 洞察未采纳',
                value: `AI 洞察未采纳 ${insightOnlyCount}`,
                detail: '缺证据、无法绑定对象或被合并层过滤',
                tone: insightOnlyCount > 0 ? 'warning' : 'ready',
              },
              {
                label: '证据不足阻断',
                value: `证据不足阻断 ${evidenceBlockedCount}`,
                detail: '缺批次、来源文件、当前/建议值或 AI 证据',
                tone: evidenceBlockedCount > 0 ? 'blocked' : 'ready',
              },
            ]}
          />
          {insightOnlyReasons.length > 0 && (
            <p className="warning-line">未进入建议池原因：{Array.from(new Set(insightOnlyReasons)).slice(0, 3).join('；')}</p>
          )}
        </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="建议上下文检查">
        <Panel title="建议上下文检查">
          <div className="context-summary-grid">
            <div>
              <span>当前批次</span>
              <strong>{currentBatchId || '-'}</strong>
              <p>建议必须绑定当前真实报表批次；审批时会重新校验。</p>
            </div>
            <div>
              <span>待处理建议</span>
              <strong>{recommendations.length}</strong>
              <p>{aiStrategyCount} 条 AI 策略诊断，{aiTextCount} 条 AI 文本解释，{ruleOnlyCount} 条纯规则兜底。</p>
            </div>
            <div>
              <span>AI/规则合并</span>
              <strong>{recommendationMergeSummaryText({ aligned: alignedCount, conflict: conflictCount, aiOnly: aiOnlyCount })}</strong>
              <p>{recommendationMergeExplanationText()}</p>
            </div>
            <div>
              <span>规则量化</span>
              <strong>{wasteCount} 浪费 / {operatorResolutionCount} 需处理</strong>
              <p>需处理包括人工复核 {manualReviewCount} 条和证据阻断 {evidenceBlockedCount} 条；证据不闭合时不会进入普通审批。</p>
            </div>
            <div>
              <span>运营事件</span>
              <strong>{operationEvents.length} 条进入 AI 上下文</strong>
              <p>{latestOperationEvent ? `${latestOperationEvent.eventDate} / ${latestOperationEvent.title}` : '无事件时 AI 只能参考广告报表。'}</p>
            </div>
            <div>
              <span>产品目标</span>
              <strong>{productContextCount} 个产品配置</strong>
              <p>
                {primaryProductContext
                  ? `${primaryProductContext.asin}：${productStageLabel(primaryProductContext.productStage)}，目标 ACOS ${optionalPercent(primaryProductContext.cost?.targetAcos)}，TACOS ${optionalPercent(primaryProductContext.cost?.targetTacos)}。`
                  : '建议到“产品配置”填写阶段、成本、最低价和目标 ACOS/TACOS。'}
              </p>
            </div>
            <div>
              <span>涉及花费</span>
              <strong>{formatUsd(totalPendingSpend)}</strong>
              <p>金额口径为 USD，仅来自当前范围导入指标。</p>
            </div>
            <div>
              <span>执行边界</span>
              <strong>{highRiskCount} 条需重点复核</strong>
              <p>本页只生成解释，不执行广告动作。</p>
            </div>
          </div>
        </Panel>
        </ProgressiveDetails>

        {!recommendations.length && (
          <Panel title="为什么现在没有建议" tone={emptyReason.tone}>
            <div className="business-split">
              <div>
                <div className="business-scope-line">{emptyReason.title}</div>
                <p className="muted-line">{emptyReason.detail}</p>
                <p className="muted-line">{emptyReason.nextStep}</p>
              </div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone={quantReady ? 'ready' : 'blocked'}>{quantReady ? '真实数据可用' : '缺真实数据'}</StatusPill>
                <StatusPill tone={aiReadiness.tone}>{aiReadiness.label}</StatusPill>
                {lastGenerateResult && (
                  <>
                    <StatusPill tone={lastGenerateResult.candidates > 0 ? 'pending' : 'warning'}>规则候选 {lastGenerateResult.candidates}</StatusPill>
                    <StatusPill tone={lastGenerateResult.aiCandidateCount > 0 ? 'pending' : 'warning'}>AI候选 {lastGenerateResult.aiCandidateCount}</StatusPill>
                    <StatusPill tone={lastGenerateResult.finalActionCount > 0 ? 'ready' : 'warning'}>可审批 {lastGenerateResult.finalActionCount}</StatusPill>
                    <StatusPill tone={lastGenerateResult.refreshed > 0 ? 'ready' : 'pending'}>刷新 {lastGenerateResult.refreshed}</StatusPill>
                    <StatusPill tone={lastGenerateResult.skipped > 0 ? 'warning' : 'pending'}>跳过 {lastGenerateResult.skipped}</StatusPill>
                  </>
                )}
              </div>
            </div>
            {noFormalAiDiagnosis && (
              <div className="evidence-check-panel">
                <h3>AI 诊断已完成，但未形成正式建议</h3>
                <div className="business-scope-line">0 建议原因分布</div>
                <div className="context-summary-grid compact-summary">
                  <div>
                    <span>规则候选</span>
                    <strong>规则候选 {lastGenerateResult?.candidates ?? 0}</strong>
                    <p>{(lastGenerateResult?.candidates ?? 0) > 0 ? '规则产生了候选，但后续合并或去重未形成新增建议。' : '规则阈值没有产生可执行广告动作。'}</p>
                  </div>
                  <div>
                    <span>AI 候选</span>
                    <strong>AI 候选 {lastGenerateResult?.aiCandidateCount ?? 0}</strong>
                    <p>{(lastGenerateResult?.aiCandidateCount ?? 0) > 0 ? 'AI 返回了候选，但需要确认能绑定当前真实广告对象。' : 'AI 没有返回可审批动作候选。'}</p>
                  </div>
                  <div>
                    <span>洞察未采纳</span>
                    <strong>洞察未采纳 {insightOnlyCount}</strong>
                    <p>AI 判断缺少可回查证据或对象绑定时，只作为洞察展示。</p>
                  </div>
                  <div>
                    <span>最终可审批</span>
                    <strong>最终可审批 {lastGenerateResult?.finalActionCount ?? 0}</strong>
                    <p>只有证据完整、可绑定当前广告活动/广告组/对象的动作进入审批。</p>
                  </div>
                </div>
                <div className="business-scope-line">下一步处理顺序</div>
                <ul className="business-list">
                  <li>先回广告量化页查看风险对象和样本量</li>
                  <li>补充运营事件或产品配置后重新生成</li>
                  <li>确认广告活动、广告组、关键词/搜索词/投放对象能绑定真实报表行</li>
                </ul>
                <div className="context-summary-grid">
                  <div>
                    <span>AI 诊断摘要</span>
                    <strong>{lifecycleLabel(lastGenerateResult?.strategy?.lifecycleStage)} / {lastGenerateResult?.strategy?.source === 'ai' ? 'AI' : '规则'}</strong>
                    <p>{noFormalAiDiagnosis.summary}</p>
                  </div>
                  <div>
                    <span>未进入建议池的原因</span>
                    <strong>{noFormalAiDiagnosis.reasons.length} 条阻断说明</strong>
                    {noFormalAiDiagnosis.reasons.slice(0, 3).map((reason) => (
                      <p key={reason}>{reason}</p>
                    ))}
                  </div>
                  <div>
                    <span>下一步补证据</span>
                    <strong>复核量化输入</strong>
                    <p>{noFormalAiDiagnosis.nextStep}</p>
                  </div>
                </div>
                {noFormalAiDiagnosis.insights.length > 0 && (
                  <>
                    <div className="business-scope-line">AI 洞察但未采纳</div>
                    <div className="context-summary-grid compact-summary">
                      {noFormalAiDiagnosis.insights.slice(0, 4).map((insight, index) => (
                        <div key={`${insight.entityName || 'insight'}-${index}`}>
                          <span>{insight.entityType || '对象'} / {insight.actionType || '观察'}</span>
                          <strong>{insight.entityName || '未绑定对象'}</strong>
                          <p>{insight.reason || 'AI 返回了洞察，但没有形成可审批动作。'}</p>
                          {(insight.invalidReasons || []).map((reason) => (
                            <p key={reason}>未采纳：{reason}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="action-row">
              <button className="secondary-button" disabled={!quantReady || generating || pipelineLoading} onClick={generateRecommendations} type="button">
                {generating ? '生成中...' : '生成优化建议'}
              </button>
              <button className="secondary-button" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: quantReady ? 'ad-quant' : 'data-collection' }))} type="button">
                {quantReady ? '查看广告量化' : '去数据采集'}
              </button>
            </div>
          </Panel>
        )}

        <ProgressiveDetails title="AI + 规则并行决策模型">
        <Panel title="AI + 规则并行决策模型" tone={quantReady ? 'default' : 'blocked'}>
          <div className="context-summary-grid">
            <div>
              <span>规则引擎</span>
              <strong>硬阈值与安全边界</strong>
              <p>使用目标 ACOS、高风险 ACOS、无订单点击、最低花费和白名单，先产生可解释的规则候选。</p>
            </div>
            <div>
              <span>DeepSeek / AI</span>
              <strong>{aiReadiness.label}</strong>
              <p>{aiReadiness.status === 'available' ? '结合每日广告数据、产品推广阶段和运营事件，判断冷启动、测词、放量、稳定或异常修复。' : aiReadiness.message}</p>
            </div>
            <div>
              <span>合并层</span>
              <strong>{recommendationMergeSummaryText({ aligned: alignedCount, conflict: conflictCount, aiOnly: aiOnlyCount })}</strong>
              <p>规则和 AI 一致才进入普通审批；冲突、AI 独立洞察和样本不足进入人工复核。</p>
            </div>
            <div>
              <span>量化输入</span>
              <strong>{importedRowCount} 行 / {operationEvents.length} 条事件 / {productContextCount} 个产品</strong>
              <p>建议只基于当前范围真实报表、产品配置和运营事件；没有导入指标时不调用 AI 生成建议。</p>
            </div>
            <div>
              <span>利润约束</span>
              <strong>目标 ACOS {optionalPercent(primaryProductContext?.cost?.targetAcos)} / 净利率 {optionalPercent(primaryProductContext?.cost?.targetNetMargin)}</strong>
              <p>{primaryProductContext ? `最低价 ${optionalMoney(primaryProductContext.cost?.minPrice)}，用于约束 AI 动态阈值建议。` : '未维护成本和目标时，建议先到产品配置页补齐。'}</p>
            </div>
          </div>
        </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="判断标准、阈值和优先级">
        <Panel title="建议优先级与判断标准" tone={recommendations.length ? 'warning' : 'default'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line">
                {topRecommendation ? `${topRecommendation.actionType} / ${recommendationObject(topRecommendation)}` : '当前范围暂无待处理建议'}
              </div>
              <p className="muted-line">
                {topRecommendation
                  ? `优先按风险等级和涉及花费排序：${formatUsd(topRecommendation.evidence?.cost ?? topRecommendation.cost)} / ACOS ${formatPercent((topRecommendation.evidence?.acos ?? topRecommendation.acos ?? 0) * 100)}。`
                  : '生成建议前先确认真实报表、导入指标和量化口径。'}
              </p>
              <p className="muted-line">规则阈值：{thresholdSummary(ruleConfig)}</p>
            </div>
            <div className="business-pill-row business-pill-row-right">
              <StatusPill tone={highRiskCount > 0 ? 'warning' : 'pending'}>高风险 {highRiskCount}</StatusPill>
              <StatusPill tone={conflictCount > 0 ? 'blocked' : alignedCount > 0 ? 'ready' : 'pending'}>AI/规则一致 {alignedCount}</StatusPill>
              <StatusPill tone={operatorResolutionCount > 0 ? 'warning' : 'pending'}>需处理 {operatorResolutionCount}</StatusPill>
              <StatusPill tone={aiParticipatedCount > 0 ? 'ready' : 'pending'}>AI参与 {aiParticipatedCount}</StatusPill>
              <StatusPill tone={aiTextCount > 0 ? 'ready' : 'pending'}>AI解释 {aiTextCount}</StatusPill>
              <StatusPill tone={recommendations.length > 0 ? 'ready' : 'pending'}>待处理 {recommendations.length}</StatusPill>
            </div>
          </div>
          <div className="action-row">
            <button className="secondary-button" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'settings' }))} type="button">
              调整规则阈值
            </button>
            <button className="secondary-button" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'approval' }))} disabled={workflowActionState.approvalDisabled} type="button">
              {workflowActionState.approvalLabel}
            </button>
          </div>
        </Panel>
        </ProgressiveDetails>

        <Panel title="待处理建议">
          <details className="evidence-disclosure">
            <summary>展开待处理建议表（{recommendations.length} 条）</summary>
            <div className="table-wrap">
              <table className="business-table recommendation-table">
              <thead>
                <tr>
                  <th>建议动作</th>
                  <th>广告组合</th>
                  <th>广告活动</th>
                  <th>广告组</th>
                  <th>产品/ASIN</th>
                  <th>对象类型</th>
                  <th>对象</th>
                  <th>当前值</th>
                  <th>建议值</th>
                  <th>证据指标</th>
                  <th>批次/来源</th>
                  <th>来源</th>
                  <th>规则量化</th>
                  <th>AI/规则判断</th>
                  <th>风险</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map((rec) => (
                  <tr key={rec.id}>
                    <td>{rec.actionType}</td>
                    <td>{rec.evidence?.portfolioName || '-'}</td>
                    <td>{rec.evidence?.campaignName || '-'}</td>
                    <td>{rec.evidence?.adGroupName || '-'}</td>
                    <td>{rec.evidence?.asin || '-'}</td>
                    <td>{recommendationType(rec)}</td>
                    <td>{recommendationObject(rec)}</td>
                    <td>{rec.currentValue || '-'}</td>
                    <td>{rec.recommendedValue || '-'}</td>
                    <td>
                      <strong>{formatUsd(rec.evidence?.cost ?? rec.cost)}</strong>
                      <div className="muted-cell">
                        ACOS {formatPercent((rec.evidence?.acos ?? rec.acos ?? 0) * 100)} / {rec.evidence?.orders ?? '-'} 单 / {rec.evidence?.clicks ?? rec.clicks} 点击
                      </div>
                    </td>
                    <td>
                      <strong>{evidenceBatch(rec, currentBatchId)}</strong>
                      <div className="muted-cell">{evidenceSourceFiles(rec).length} 个来源文件{rec.evidence?.sourceRow ? ` / 行 ${rec.evidence.sourceRow}` : ''}</div>
                    </td>
                    <td>{sourceLabel(rec)}</td>
                    <td>
                      <StatusPill tone={quantTone(rec.evidence?.quantStatus)}>{quantLabel(rec.evidence?.quantStatus)}</StatusPill>
                      <div className="muted-cell">{lifecycleLabel(rec.evidence?.quantLifecycleStage || rec.evidence?.aiLifecycleStage)}</div>
                    </td>
                    <td>
                      <StatusPill tone={decisionTone(rec)}>{decisionLabel(rec)}</StatusPill>
                      <div className="muted-cell">{reviewReason(rec)}</div>
                    </td>
                    <td><StatusPill tone={riskTone(rec.riskLevel)}>{rec.riskLevel}</StatusPill></td>
                    <td>
                      <button className="secondary-button compact-button" onClick={() => setSelected(rec)} type="button">
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
                {!recommendations.length && (
                  <tr>
                    <td colSpan={16}>{quantReady ? '当前范围还没有待审批或需复核建议。' : '缺少真实数据，本页不生成建议。'}</td>
                  </tr>
                )}
              </tbody>
              </table>
            </div>
          </details>
        </Panel>

        {selected && (
          <Panel title="建议详情">
            {(() => {
              const issues = recommendationEvidenceIssues(selected, currentBatchId, currentRealReportSourceFiles);
              const sourceBatchId = selected.evidence?.batchId || '-';
              const batchMatched = Boolean(selected.evidence?.batchId && currentBatchId && selected.evidence.batchId === currentBatchId);
              return (
                <div className="evidence-check-panel">
                  <div className="business-split">
                    <div>
                      <h3>送审前证据检查</h3>
                      <p className="muted-line">审批中心只接收绑定当前批次、对象、来源文件和当前/建议值完整的建议。</p>
                    </div>
                    <StatusPill tone={issues.length ? 'blocked' : 'ready'}>
                      {issues.length ? `缺 ${issues.length} 项` : '证据完整'}
                    </StatusPill>
                  </div>
                  <div className="business-pill-row">
                    <StatusPill tone={batchMatched ? 'ready' : 'blocked'}>
                      {batchMatched ? '来源批次匹配' : '来源批次需核对'}
                    </StatusPill>
                    <StatusPill tone={evidenceSourceFiles(selected).length ? 'ready' : 'blocked'}>
                      来源文件 {evidenceSourceFiles(selected).length}
                    </StatusPill>
                    <StatusPill tone={selected.currentValue && selected.recommendedValue ? 'ready' : 'blocked'}>
                      当前/建议值
                    </StatusPill>
                    <StatusPill tone={selected.evidence?.explanationSource === 'ai' ? 'ready' : 'pending'}>
                      {sourceLabel(selected)}
                    </StatusPill>
                    <StatusPill tone={decisionTone(selected)}>
                      {decisionLabel(selected)}
                    </StatusPill>
                  </div>
                  <p className={issues.length ? 'blocked-line' : 'muted-line'}>
                    {issues.length
                      ? `送审前需要补齐：${issues.join('、')}。`
                      : `可进入审批中心复核；来源批次 ${sourceBatchId} 已绑定当前范围。`}
                  </p>
                </div>
              );
            })()}
            <ProgressiveDetails title="AI/规则、阈值、来源行和引用证据">
            <div className="evidence-check-panel">
              <div className="business-split">
                <div>
                  <h3>AI/规则决策摘要</h3>
                  <p className="muted-line">{selectedDecisionSummary.headline}</p>
                </div>
                <StatusPill tone={selectedDecisionSummary.tone}>{selectedDecisionSummary.statusLabel}</StatusPill>
              </div>
              {selectedDecisionSummary.reasons.length > 0 && (
                <ul className="business-list">
                  {selectedDecisionSummary.reasons.slice(0, 3).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
              <div className="context-summary-grid">
                <div>
                  <span>引用证据</span>
                  <strong>{selected.evidence?.aiEvidenceRefs?.length || 0} 条</strong>
                  <p>{selectedDecisionSummary.evidenceSummary}</p>
                </div>
                <div>
                  <span>下一步</span>
                  <strong>{selectedDecisionSummary.nextAction}</strong>
                  <p>正式动作仍需要人工审批、真实广告后台操作和执行回读。</p>
                </div>
              </div>
              {selectedDecisionSummary.riskWarnings.length > 0 && (
                <p className="blocked-line">风险：{selectedDecisionSummary.riskWarnings.join('；')}</p>
              )}
            </div>
            <div className="detail-grid">
              <div><span>数据范围</span><strong><ScopeText scope={data?.scope || scope} /></strong></div>
              <div><span>数据批次</span><strong>{evidenceBatch(selected, currentBatchId)}</strong></div>
              <div><span>当前值</span><strong>{selected.currentValue || '-'}</strong></div>
              <div><span>建议值</span><strong>{selected.recommendedValue || '-'}</strong></div>
              <div><span>广告组合</span><strong>{selected.evidence?.portfolioName || '-'}</strong></div>
              <div><span>广告活动</span><strong>{selected.evidence?.campaignName || '-'}</strong></div>
              <div><span>广告组</span><strong>{selected.evidence?.adGroupName || '-'}</strong></div>
              <div><span>产品/ASIN</span><strong>{selected.evidence?.asin || '-'}</strong></div>
              <div><span>对象类型</span><strong>{recommendationType(selected)}</strong></div>
              <div><span>对象</span><strong>{recommendationObject(selected)}</strong></div>
              <div><span>指标日期</span><strong>{selected.evidence?.date || '-'}</strong></div>
              <div><span>来源行号</span><strong>{selected.evidence?.sourceRow ?? '-'}</strong></div>
              <div><span>当前指标</span><strong>{formatUsd(selected.evidence?.cost ?? selected.cost)} / {selected.evidence?.clicks ?? selected.clicks} clicks / {selected.evidence?.orders ?? '-'} orders</strong></div>
              <div><span>销售额</span><strong>{formatUsd(selected.evidence?.sales ?? 0)} / ACOS {formatPercent((selected.evidence?.acos ?? selected.acos ?? 0) * 100)}</strong></div>
              <div><span>推荐动作</span><strong>{selected.actionType} {selected.currentValue || '-'} {'→'} {selected.recommendedValue || '-'}</strong></div>
              <div><span>解释来源</span><strong>{sourceLabel(selected)}{selected.evidence?.aiModel ? ` / ${selected.evidence.aiModel}` : ''}</strong></div>
              <div><span>策略诊断</span><strong>{strategyLabel(selected)} / {lifecycleLabel(selected.evidence?.aiLifecycleStage)}</strong></div>
              <div><span>AI 证据充分性</span><strong>{evidenceSufficiencyLabel(selected.evidence?.aiEvidenceSufficiency?.level)}</strong></div>
              <div><span>AI 动态阈值</span><strong>{thresholdSuggestionSummary(selected)}</strong></div>
              <div><span>规则量化</span><strong>{quantLabel(selected.evidence?.quantStatus)} / {lifecycleLabel(selected.evidence?.quantLifecycleStage)}</strong></div>
              <div><span>规则阈值</span><strong>{ruleQuantThresholdSummary(selected)}</strong></div>
              <div><span>复核原因</span><strong>{reviewReason(selected)}</strong></div>
              <div><span>AI/规则合并</span><strong>{decisionLabel(selected)}{selected.evidence?.decisionRequiresReview ? ' / 需人工复核' : ''}</strong></div>
              <div><span>运营事件</span><strong>{selected.evidence?.operationEventCount ?? 0} 条进入诊断上下文</strong></div>
              <div><span>产品配置</span><strong>{selected.evidence?.productContextCount ?? 0} 个进入诊断上下文</strong></div>
              <div><span>产品阶段</span><strong>{productStageLabel(selected.evidence?.productStage)}</strong></div>
              <div><span>产品目标 ACOS / TACOS</span><strong>{optionalPercent(selected.evidence?.productTargetAcos)} / {optionalPercent(selected.evidence?.productTargetTacos)}</strong></div>
              <div><span>目标净利率 / 最低价</span><strong>{optionalPercent(selected.evidence?.productTargetNetMargin)} / {optionalMoney(selected.evidence?.productMinPrice)}</strong></div>
              <div><span>规则阈值</span><strong>{thresholdSummary(ruleConfig)}</strong></div>
              <div><span>执行边界</span><strong>只解释和送审，不执行广告动作</strong></div>
            </div>
            {selected.evidence?.aiStrategySummary && (
              <div className="evidence-check-panel">
                <h3>AI 策略诊断</h3>
                <p className="muted-line">{selected.evidence.aiStrategySummary}</p>
                {selected.evidence.aiStrategyFallbackReason && (
                  <p className="blocked-line">策略诊断兜底：{selected.evidence.aiStrategyFallbackReason}</p>
                )}
                {selected.evidence.aiLifecycleStageReason && (
                  <p className="muted-line">
                    阶段判断：{lifecycleLabel(selected.evidence.aiLifecycleStage)}。{selected.evidence.aiLifecycleStageReason}
                  </p>
                )}
                <p className="muted-line">动态阈值：{thresholdSuggestionSummary(selected)}</p>
                {selected.evidence.aiEvidenceSufficiency && (
                  <div className="business-pill-row">
                    <StatusPill tone={evidenceSufficiencyTone(selected.evidence.aiEvidenceSufficiency.level)}>{evidenceSufficiencyLabel(selected.evidence.aiEvidenceSufficiency.level)}</StatusPill>
                    <StatusPill tone={selected.evidence.aiEvidenceSufficiency.canUseForFormalActions ? 'ready' : 'blocked'}>{selected.evidence.aiEvidenceSufficiency.canUseForFormalActions ? '允许正式建议' : '仅洞察'}</StatusPill>
                    <StatusPill tone="pending">{selected.evidence.aiEvidenceSufficiency.sampleDays} 天</StatusPill>
                    <StatusPill tone="pending">{selected.evidence.aiEvidenceSufficiency.totalClicks} 点击</StatusPill>
                    <StatusPill tone="pending">{formatUsd(selected.evidence.aiEvidenceSufficiency.totalCost)}</StatusPill>
                  </div>
                )}
                {Boolean(selected.evidence.aiEvidenceSufficiency?.blockers?.length) && (
                  <p className="blocked-line">{selected.evidence.aiEvidenceSufficiency?.blockers.join('；')}</p>
                )}
                {Boolean(selected.evidence.aiMainProblems?.length) && (
                  <div className="business-pill-row">
                    {selected.evidence.aiMainProblems?.map((problem) => (
                      <StatusPill key={problem} tone="pending">{problem}</StatusPill>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(selected.evidence?.aiReasoningSteps?.length || selected.evidence?.aiEvidenceRefs?.length || selected.evidence?.aiLifecycleStageEvidenceRefs?.length) ? (
              <div className="evidence-check-panel">
                <h3>AI 判断依据</h3>
                {Boolean(selected.evidence?.aiReasoningSteps?.length) && (
                  <ul className="business-list">
                    {selected.evidence?.aiReasoningSteps?.slice(0, 5).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                )}
                <div className="context-summary-grid">
                  <div>
                    <span>动作引用证据</span>
                    <strong>{selected.evidence?.aiEvidenceRefs?.length || 0} 条</strong>
                    <p>{formatEvidenceRefSummary(selected.evidence?.aiEvidenceRefs, selected.evidence?.aiEvidenceDetails)}</p>
                  </div>
                  <div>
                    <span>阶段引用证据</span>
                    <strong>{selected.evidence?.aiLifecycleStageEvidenceRefs?.length || 0} 条</strong>
                    <p>{formatEvidenceRefSummary(selected.evidence?.aiLifecycleStageEvidenceRefs, selected.evidence?.aiLifecycleStageEvidenceDetails)}</p>
                  </div>
                  <div>
                    <span>证据来源</span>
                    <strong>报表 + 运营事件 + 产品配置</strong>
                    <p>报表文件、来源行、广告活动、广告组和对象指标见上方明细；运营事件和产品目标见下方关联区。</p>
                  </div>
                </div>
                {Boolean(selected.evidence?.aiEvidenceDetails?.length || selected.evidence?.aiLifecycleStageEvidenceDetails?.length) && (
                  <div className="evidence-check-panel">
                    <h3>引用证据详情</h3>
                    <div className="context-summary-grid">
                      {[
                        ...(selected.evidence?.aiEvidenceDetails || []),
                        ...(selected.evidence?.aiLifecycleStageEvidenceDetails || []),
                      ].filter((item, index, all) => all.findIndex((other) => other.evidenceId === item.evidenceId) === index).slice(0, 6).map((item) => (
                        <div key={item.evidenceId}>
                          <span>{evidenceTypeLabel(item.type)}</span>
                          <strong>{item.label}</strong>
                          <p>{evidenceContextLine(item)}</p>
                          <p>{evidenceAdObjectLine(item)}</p>
                          {item.metrics && <p>{evidenceMetricLine(item)}</p>}
                          {item.event && <p>{evidenceEventLine(item)}</p>}
                          {item.product && <p>{evidenceProductLine(item)}</p>}
                          {item.timeline && <p>{evidenceTimelineLine(item)}</p>}
                          {item.timeline?.recentDaily?.length ? <p className="muted-line">最近日级：{evidenceTimelineDailyLine(item)}</p> : null}
                          {item.sourceFile && <code title={item.sourceFile}>{item.sourceFile}</code>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            <div className="evidence-check-panel">
              <h3>关联运营事件</h3>
              {selectedOperationEvents.length > 0 ? (
                <div className="context-summary-grid">
                  {selectedOperationEvents.map((event) => (
                    <div key={event.id}>
                      <span>{event.eventDate} / {operationEventTypeLabel(event.eventType)}</span>
                      <strong>{event.title}</strong>
                      <p>{event.impactExpectation || '影响待观察'} / {event.asin || event.campaignName || '当前范围'}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-line">
                  {selected.evidence?.operationEventCount
                    ? `${selected.evidence.operationEventCount} 条运营事件进入了整体诊断，但没有精确绑定到当前建议对象。`
                    : '当前建议没有关联运营事件，AI 和规则只参考广告数据。'}
                </p>
              )}
            </div>
            {Boolean(selected.evidence?.quantReasons?.length) && (
              <div className="evidence-check-panel">
                <h3>规则量化依据</h3>
                <p className="muted-line">{ruleQuantThresholdSummary(selected)}</p>
                <ul className="business-list">
                  {selected.evidence?.quantReasons?.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            )}
            <p className="muted-line">{selected.evidence?.aiExplanation || selected.reason}</p>
            {selected.evidence?.aiActionFallbackReason && <p className="blocked-line">单条解释兜底：{selected.evidence.aiActionFallbackReason}</p>}
            {Boolean(selected.evidence?.decisionReasons?.length) && (
              <ul className="business-list">
                {selected.evidence?.decisionReasons?.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
            {Boolean(selected.evidence?.decisionRiskWarnings?.length) && (
              <ul className="business-list">
                {selected.evidence?.decisionRiskWarnings?.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
            {Boolean(evidenceSourceFiles(selected).length) && (
              <div className="source-file-list">
                <span>来源文件</span>
                {evidenceSourceFiles(selected).map((file) => (
                  <code key={file} title={file}>{file}</code>
                ))}
              </div>
            )}
            {Boolean(selected.evidence?.aiRiskWarnings?.length) && (
              <ul className="business-list">
                {selected.evidence?.aiRiskWarnings?.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
            </ProgressiveDetails>
          </Panel>
        )}
      </div>
    </div>
  );
}
