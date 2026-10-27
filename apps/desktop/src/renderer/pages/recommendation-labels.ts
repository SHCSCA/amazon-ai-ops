import { localizeProductStage,localizeQuantStatus } from '@amazon-ai-ops/business-presenters';
import { formatPercent,formatUsd } from '../formatters';
import type { RecommendationView,SettingsRuleConfig } from '../types';
import { toUserFacingError } from '../user-facing-error';
import {
recommendationCanEnterFormalApproval,
recommendationHasEvidenceBlocker,
recommendationRequiresManualReview,
} from './recommendation-evidence';

export function errorMessage(caught: unknown, fallback: string): string {
  return `${fallback}: ${toUserFacingError(caught, fallback)}`;
}

export function recommendationObject(rec: RecommendationView): string {
  return rec.evidence?.searchTerm || rec.evidence?.targeting || rec.entityName || '-';
}

export function sourceLabel(rec: RecommendationView): string {
  if (rec.evidence?.explanationSource === 'ai') return 'DeepSeek AI';
  if (rec.evidence?.explanationSource === 'rule' || rec.evidence?.aiActionFallbackReason) return '规则解释兜底';
  if (rec.evidence?.aiFallbackReason) return '规则兜底';
  return '规则';
}

export function strategyLabel(rec: RecommendationView): string {
  if (rec.evidence?.aiStrategySource === 'ai') return 'AI 策略诊断';
  if (rec.evidence?.aiStrategySource === 'rule' || rec.evidence?.aiStrategyFallbackReason) return '规则策略兜底';
  return '未诊断';
}

export function lifecycleLabel(stage?: string): string {
  return localizeProductStage(stage);
}

export function decisionLabel(rec: RecommendationView): string {
  const labels: Record<string, string> = {
    aligned: '规则+AI 一致',
    conflict: '规则/AI 冲突',
    ai_only: 'AI 独立洞察',
    rule_only: '规则独立建议',
  };
  return labels[String(rec.evidence?.decisionAgreement || '')] || '未合并';
}

export function decisionTone(rec: RecommendationView): 'ready' | 'pending' | 'blocked' | 'warning' {
  if (rec.evidence?.decisionAgreement === 'aligned') return 'ready';
  if (rec.evidence?.decisionAgreement === 'conflict') return 'blocked';
  if (rec.evidence?.decisionAgreement === 'ai_only') return 'warning';
  if (rec.evidence?.decisionRequiresReview) return 'warning';
  return 'pending';
}

export function quantLabel(status?: string): string {
  const label = localizeQuantStatus(status);
  return label === '样本不足' && status ? '未量化' : label;
}

export function quantTone(status?: string): 'ready' | 'pending' | 'blocked' | 'warning' {
  if (status === 'waste') return 'blocked';
  if (status === 'scale' || status === 'healthy') return 'ready';
  if (status === 'watch') return 'warning';
  return 'pending';
}

export function thresholdReviewSuffix(thresholds: NonNullable<RecommendationView['evidence']>['aiThresholdSuggestions']): string {
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

export function ruleQuantThresholdSummary(rec: RecommendationView): string {
  const thresholds = rec.evidence?.quantThresholds;
  if (!thresholds) return '暂无规则阈值';
  return [
    `目标 ACOS ${formatPercent(Number(thresholds.targetAcos || 0) * 100)}`,
    `高风险 ${formatPercent(Number(thresholds.highAcosThreshold || 0) * 100)}`,
    `无订单 ${Number(thresholds.noOrderClickThreshold || 0)} 点击`,
    `止损 ${formatUsd(thresholds.minSpend)}`,
  ].join(' / ');
}

export function reviewReason(rec: RecommendationView): string {
  if (rec.evidence?.decisionAgreement === 'conflict') return 'AI 与规则冲突，必须人工复核';
  if (rec.evidence?.decisionAgreement === 'ai_only') return 'AI 独立洞察，必须人工复核';
  if (rec.evidence?.quantReviewRequired) return '规则量化要求人工复核';
  if (rec.status === 'needs_review') return '已进入复核队列';
  return '可进入普通审批';
}

export function recommendationSendStatusText(rec: RecommendationView, currentBatchId?: string, allowedSourceFiles?: string[]): string {
  if (recommendationHasEvidenceBlocker(rec, currentBatchId, allowedSourceFiles)) return '证据不足，不能送审';
  if (recommendationRequiresManualReview(rec, currentBatchId, allowedSourceFiles)) return reviewReason(rec);
  if (recommendationCanEnterFormalApproval(rec, currentBatchId, allowedSourceFiles)) return '证据完整，可送审';
  return reviewReason(rec);
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

export function recommendationType(rec: RecommendationView): string {
  return rec.entityType || rec.evidence?.matchType || '-';
}

export function riskTone(riskLevel?: string): 'ready' | 'pending' | 'blocked' | 'warning' {
  const normalized = String(riskLevel || '').toLowerCase();
  if (normalized.includes('high') || normalized.includes('approval')) return 'warning';
  if (normalized.includes('block')) return 'blocked';
  return 'pending';
}

export function eventMatchesRecommendation(event: { asin?: string; campaignName?: string; adGroupName?: string }, rec: RecommendationView): boolean {
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

export function operationEventTypeLabel(type?: string): string {
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

export function thresholdSummary(config: SettingsRuleConfig | null): string {
  if (!config) return '正在读取规则阈值';
  return `目标 ACOS ${formatPercent(config.targetAcos * 100)} / 高 ACOS ${formatPercent(config.highAcosThreshold * 100)} / 无订单 ${config.noOrderClickThreshold} 点击 / 最低花费 ${formatUsd(config.minSpend)}`;
}
