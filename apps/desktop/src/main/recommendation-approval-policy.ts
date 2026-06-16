import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';

function normalizedRiskLevel(riskLevel: unknown): string {
  return String(riskLevel || '').trim().toLowerCase();
}

function nonEmpty(value: unknown): boolean {
  const text = String(value || '').trim();
  return Boolean(text && text !== '-');
}

function recommendationObjectName(recommendation: ActionRecommendation): string {
  return recommendation.evidence?.searchTerm
    || recommendation.evidence?.targeting
    || recommendation.entityName
    || '';
}

export function getRecommendationApprovalMissingFields(recommendation: ActionRecommendation): string[] {
  const missing: string[] = [];
  const requireField = (value: unknown, label: string) => {
    if (!nonEmpty(value)) missing.push(label);
  };

  requireField(recommendation.storeName, '店铺');
  requireField(recommendation.marketplaceCode, '站点');
  requireField(recommendation.evidence?.batchId, '来源批次');
  requireField(recommendation.evidence?.date, '指标日期');
  requireField(recommendation.evidence?.campaignName, '广告活动');
  requireField(recommendation.evidence?.adGroupName, '广告组');
  requireField(recommendation.entityType || recommendation.evidence?.matchType, '对象类型');
  requireField(recommendationObjectName(recommendation), '关键词/搜索词/投放对象');
  requireField(recommendation.actionType, '动作');
  requireField(recommendation.currentValue, '当前值');
  requireField(recommendation.recommendedValue, '建议值');
  if (!recommendation.evidence?.sourceFiles?.length) missing.push('来源文件');

  return missing;
}

export function getRecommendationApprovalBlockers(recommendation: ActionRecommendation): string[] {
  const agreement = recommendation.evidence?.decisionAgreement;
  const riskLevel = normalizedRiskLevel(recommendation.riskLevel);
  const blockers: string[] = [];
  const missingFields = getRecommendationApprovalMissingFields(recommendation);
  if (missingFields.length > 0) blockers.push(`缺少审批字段：${missingFields.join('、')}`);
  if (recommendation.status === 'needs_review') blockers.push('建议已进入复核队列');
  if (agreement === 'ai_only') blockers.push('AI-only 建议');
  if (agreement === 'conflict') blockers.push('AI/规则冲突');
  if (recommendation.evidence?.decisionRequiresReview === true) blockers.push('AI/规则合并标记需复核');
  if (recommendation.evidence?.quantReviewRequired === true) blockers.push('规则量化要求人工复核');
  if (riskLevel === 'forbidden' || riskLevel === 'high' || riskLevel.includes('forbidden')) {
    blockers.push('高风险或禁止执行风险等级');
  }
  return blockers;
}

export function assertRecommendationApprovalPolicy(recommendation: ActionRecommendation): void {
  const blockers = getRecommendationApprovalBlockers(recommendation);
  if (blockers.length > 0) {
    throw new Error(`审批被阻断：${blockers.join('、')}，不能走普通批准；请先完成专门复核或重新生成规则确认后的建议。`);
  }
}
