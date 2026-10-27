import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import { getRecommendationApprovalBlockers as getSharedRecommendationApprovalBlockers } from '@amazon-ai-ops/rules-engine';
import type { RecommendationView } from '../types';
import {
  approvalBlockers,
  approvalMissing,
  approvalSubmitBlockers,
} from './approval-page';
import {
  recommendationCanEnterFormalApproval,
  recommendationHasEvidenceBlocker,
  recommendationNeedsOperatorResolution,
} from './recommendations-page';
import {
  type DecisionEligibilityContext,
  type DecisionEligibilitySummary,
} from "./decisions-contracts";

export function uniqueMessages(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

export function decisionsPolicyEntityType(row: RecommendationView): ActionRecommendation['entityType'] {
  const entityType = String(row.entityType || row.evidence?.matchType || '').trim();
  if (entityType === 'search_term' || entityType === 'campaign' || entityType === 'ad_group') {
    return entityType;
  }
  return 'target';
}

export function decisionsPolicyStatus(row: RecommendationView): ActionRecommendation['status'] {
  const status = String(row.status || '').trim();
  return ['pending', 'needs_review', 'approved', 'rejected', 'executed', 'expired'].includes(status)
    ? status as ActionRecommendation['status']
    : 'expired';
}

export function decisionsPolicyOwnershipBlockers(row: RecommendationView): string[] {
  const target = row.evidence?.writableTarget;
  if (!target) return [];
  const text = (value: unknown) => String(value ?? '').trim().toLowerCase();
  const file = (value: unknown) => text(value).replace(/\\/g, '/');
  const blockers: string[] = [];
  const expectedName = text(row.evidence?.searchTerm || row.evidence?.targeting || row.entityName);
  if (text(target.entityName) !== expectedName) blockers.push('核验到的 Ads 对象名称与当前建议对象不一致');
  if (
    text(target.campaignName) !== text(row.evidence?.campaignName)
    || text(target.adGroupName) !== text(row.evidence?.adGroupName)
  ) {
    blockers.push('核验到的 Ads 对象不属于当前建议的 campaign / ad group');
  }
  if (
    !row.evidence?.sourceFiles?.some((sourceFile) => file(sourceFile) === file(target.sourceFile))
    || Number(target.sourceRow) !== Number(row.evidence?.sourceRow)
  ) {
    blockers.push('核验到的 Ads 对象来源行与当前建议来源权威不一致');
  }
  if (text(target.metricDate) !== text(row.evidence?.date)) {
    blockers.push('核验到的 Ads 对象指标日期与当前建议不一致');
  }

  const sourceName = file(row.evidence?.reportType || target.sourceFile);
  const expectedTargetType = sourceName.includes('product_targeting')
    ? 'product_targeting'
    : sourceName.includes('auto_targeting')
      ? 'auto_targeting'
      : sourceName.includes('keyword')
        ? 'keyword'
        : '';
  if (!expectedTargetType) {
    blockers.push('当前建议来源报表不能唯一映射到 Ads 可写对象');
  } else if (target.entityType !== expectedTargetType) {
    blockers.push('核验到的 Ads 对象类型与当前建议来源不一致');
  }
  return blockers;
}

export function decisionsPolicyRecommendation(
  row: RecommendationView,
  context: DecisionEligibilityContext,
): ActionRecommendation {
  const evidence = row.evidence || {};
  return {
    id: row.id,
    taskId: `renderer-recommendation-${row.id}`,
    storeName: context.scope.storeName,
    marketplaceCode: context.scope.marketplaceCode,
    asin: String(evidence.asin || ''),
    msku: `renderer-${String(evidence.asin || row.id)}`,
    entityType: decisionsPolicyEntityType(row),
    entityId: String(row.entityId || ''),
    entityName: row.entityName,
    actionType: row.actionType as ActionRecommendation['actionType'],
    currentValue: String(row.currentValue || ''),
    recommendedValue: String(row.recommendedValue || ''),
    reason: row.reason,
    evidence: {
      ...evidence,
      impressions: Number(evidence.impressions || 0),
      clicks: Number(evidence.clicks ?? row.clicks ?? 0),
      cost: Number(evidence.cost ?? row.cost ?? 0),
      orders: Number(evidence.orders || 0),
      sales: Number(evidence.sales || 0),
      acos: Number(evidence.acos ?? row.acos ?? 0),
      cpc: Number(evidence.cpc || 0),
      cvr: Number(evidence.cvr || 0),
    } as ActionRecommendation['evidence'],
    confidence: Number(row.confidence || 0),
    riskLevel: row.riskLevel as ActionRecommendation['riskLevel'],
    status: decisionsPolicyStatus(row),
    revision: Number(row.revision || 0),
  };
}

export function decisionsSharedApprovalPolicyBlockers(
  row: RecommendationView,
  context: DecisionEligibilityContext,
): string[] {
  return getSharedRecommendationApprovalBlockers(
    decisionsPolicyRecommendation(row, context),
    {
      allowedSourceFiles: context.allowedSourceFiles,
      writableTargetOwnershipBlockers: decisionsPolicyOwnershipBlockers(row),
    },
  );
}

export function decisionEligibilitySummary(
  row: RecommendationView,
  context: DecisionEligibilityContext,
): DecisionEligibilitySummary {
  const status = String(row.status || '');
  if (status === 'approved' || status === 'rejected') {
    return {
      label: status === 'approved' ? '已批准' : '已拒绝',
      detail: status === 'approved'
        ? '已批准，尚不代表已执行；批准不等于执行，真实广告后台操作和回读仍需单独完成。'
        : '该建议已拒绝；批准不等于执行，当前记录只读。',
      tone: status === 'approved' ? 'confirmed' : 'neutral',
      canApprove: false,
      canReject: false,
      readOnly: true,
      blockers: [],
    };
  }

  if (context.locked) {
    return {
      label: '正在确认权威状态',
      detail: '新的权威读取尚未完成，旧行仅供查看，所有决定暂时锁定。',
      tone: 'attention',
      canApprove: false,
      canReject: false,
      readOnly: false,
      blockers: ['正在确认最新权威状态'],
    };
  }

  if (context.stale) {
    return {
      label: '数据已过期',
      detail: '权威队列刷新失败，所有决定已锁定；刷新成功后才能继续。',
      tone: 'blocked',
      canApprove: false,
      canReject: false,
      readOnly: false,
      blockers: ['权威队列数据已过期'],
    };
  }

  const evidenceBlocked = recommendationHasEvidenceBlocker(
    row,
    context.currentBatchId,
    context.allowedSourceFiles,
  );
  const canEnterFormalApproval = recommendationCanEnterFormalApproval(
    row,
    context.currentBatchId,
    context.allowedSourceFiles,
  );
  const needsOperatorResolution = recommendationNeedsOperatorResolution(
    row,
    context.currentBatchId,
    context.allowedSourceFiles,
  );
  const missing = approvalMissing(
    row,
    context.scope,
    context.currentBatchId,
    context.allowedSourceFiles,
  );
  const reviewBlockers = approvalBlockers(row);
  const sharedPolicyBlockers = decisionsSharedApprovalPolicyBlockers(row, context);
  const submitBlockers = approvalSubmitBlockers(
    row,
    context.scope,
    context.currentBatchId,
    context.allowedSourceFiles,
  );
  const blockers = uniqueMessages([
    ...missing,
    ...sharedPolicyBlockers,
    ...reviewBlockers,
    ...submitBlockers,
  ]);

  if (status === 'needs_review') {
    return {
      label: '需要人工复核',
      detail: blockers[0] || '该建议不能走普通批准，但可以填写理由后拒绝。',
      tone: 'attention',
      canApprove: false,
      canReject: true,
      readOnly: false,
      blockers,
    };
  }

  if (status !== 'pending') {
    return {
      label: '状态不可处理',
      detail: '当前状态不属于统一建议与审批工作区，已按只读方式锁定。',
      tone: 'blocked',
      canApprove: false,
      canReject: false,
      readOnly: true,
      blockers: ['不支持的建议状态'],
    };
  }

  const missingExceptWritableTarget = missing.filter((label) => label !== 'Ads 可写对象');
  if (
    !row.evidence?.writableTarget
    && row.actionType === 'lower_bid'
    && row.evidence?.quantReviewRequired !== true
    && missingExceptWritableTarget.length === 0
    && reviewBlockers.length === 0
  ) {
    return {
      label: '先核验 Ads 对象',
      detail: '真实报表证据已具备；先绑定唯一可写 Ads 对象并重新读取权威版本，再单独进行人工批准。',
      tone: 'attention',
      canApprove: false,
      canReject: true,
      readOnly: false,
      blockers: ['Ads 可写对象尚未核验'],
    };
  }

  const canApprove = canEnterFormalApproval
    && !evidenceBlocked
    && !needsOperatorResolution
    && sharedPolicyBlockers.length === 0
    && blockers.length === 0;
  if (canApprove) {
    return {
      label: '可以批准',
      detail: '真实证据与审批预检已通过；批准后仍需单独执行并回读。',
      tone: 'confirmed',
      canApprove: true,
      canReject: true,
      readOnly: false,
      blockers: [],
    };
  }

  return {
    label: evidenceBlocked ? '证据阻断' : '需要人工复核',
    detail: blockers[0] || '当前建议未通过普通批准安全门。',
    tone: evidenceBlocked ? 'blocked' : 'attention',
    canApprove: false,
    canReject: true,
    readOnly: false,
    blockers,
  };
}
