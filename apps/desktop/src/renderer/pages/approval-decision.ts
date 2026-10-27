import type { RecommendationView } from '../types';
import {
  type ApprovalFeedbackState,
  type ApprovalDecisionButtonMode,
} from "./approval-contracts";
import { objectName } from "./approval-presentation";
import {
  hasCurrentRecommendationReviewResolution,
  sourceFiles,
} from "./approval-identity-proof";
import { riskRequiresDedicatedReview } from "./approval-authority-gates";

export function approvalDecisionState(input: {
  selected: RecommendationView | null;
  missing: string[];
  blockers: string[];
}): {
  statusLabel: '可以批准' | '不能普通批准' | '需要复核';
  tone: 'ready' | 'blocked' | 'warning';
  title: string;
  detail: string;
  primaryActionLabel: string;
  canApprove: boolean;
} {
  const missing = Array.from(new Set(input.missing.filter(Boolean)));
  const blockers = Array.from(new Set(input.blockers.filter(Boolean)));
  const selected = input.selected;

  if (!selected) {
    return {
      statusLabel: '需要复核',
      tone: 'warning',
      title: '选择一条建议',
      detail: '先从审批队列选择一条建议，再做批准或拒绝。',
      primaryActionLabel: '查看审批队列',
      canApprove: false,
    };
  }

  if (missing.length > 0) {
    return {
      statusLabel: '不能普通批准',
      tone: 'blocked',
      title: `不能普通批准：缺 ${missing.length} 项证据`,
      detail: `缺 ${missing.slice(0, 3).join('、')}${missing.length > 3 ? ' 等证据' : ''}。先补齐当前批次真实来源，再重新审批。`,
      primaryActionLabel: '查看缺失证据',
      canApprove: false,
    };
  }

  const requiresReview = selected.status === 'needs_review'
    || selected.evidence?.decisionAgreement === 'conflict'
    || selected.evidence?.decisionAgreement === 'ai_only'
    || selected.evidence?.decisionRequiresReview === true
    || (selected.evidence?.quantReviewRequired === true && !hasCurrentRecommendationReviewResolution(selected))
    || riskRequiresDedicatedReview(selected.riskLevel);

  if (blockers.length > 0 && requiresReview) {
    return {
      statusLabel: '需要复核',
      tone: 'warning',
      title: '需要复核',
      detail: `${blockers.slice(0, 3).join('、')}。不能把这条建议当作普通批准。`,
      primaryActionLabel: '查看复核要求',
      canApprove: false,
    };
  }

  if (blockers.length > 0) {
    return {
      statusLabel: '不能普通批准',
      tone: 'blocked',
      title: '不能普通批准',
      detail: `${blockers.slice(0, 3).join('、')}。修正动作值或重新生成规则确认后的建议。`,
      primaryActionLabel: '查看阻断详情',
      canApprove: false,
    };
  }

  return {
    statusLabel: '可以批准',
    tone: 'ready',
    title: '可以批准',
    detail: '审批预检通过。填写审批人和备注后可批准；真实广告后台操作和结果核对仍在后续页面逐条完成。',
    primaryActionLabel: '填写审批表单',
    canApprove: true,
  };
}

export function buildApprovalDecisionPayload(input: {
  decision: 'approved' | 'rejected';
  approverName: string;
  approvalNote: string;
  currentBatchId?: string;
  selected: RecommendationView | null;
  scope: {
    dateFrom?: string;
    dateTo?: string;
    storeName?: string;
    marketplaceCode?: string;
    asin?: string;
  };
}) {
  const { decision, selected, scope } = input;
  return {
    decision,
    approvedBy: decision === 'approved' ? input.approverName.trim() : undefined,
    rejectedBy: decision === 'rejected' ? input.approverName.trim() || undefined : undefined,
    decidedAt: new Date().toISOString(),
    note: input.approvalNote.trim(),
    batchId: input.currentBatchId,
    recommendationId: selected?.id,
    actionType: selected?.actionType,
    portfolioName: selected?.evidence?.portfolioName,
    campaignName: selected?.evidence?.campaignName,
    adGroupName: selected?.evidence?.adGroupName,
    asin: selected?.evidence?.asin,
    entityType: selected?.entityType || selected?.evidence?.matchType,
    entityName: selected ? objectName(selected) : '',
    currentValue: selected?.currentValue,
    recommendedValue: selected?.recommendedValue,
    sourceBatchId: selected?.evidence?.batchId,
    metricDate: selected?.evidence?.date,
    sourceRow: selected?.evidence?.sourceRow,
    sourceFiles: selected?.evidence?.sourceFiles || [],
    explanationSource: selected?.evidence?.explanationSource,
    aiModel: selected?.evidence?.aiModel,
    aiStrategySource: selected?.evidence?.aiStrategySource,
    aiLifecycleStage: selected?.evidence?.aiLifecycleStage,
    aiStrategySummary: selected?.evidence?.aiStrategySummary,
    aiStrategyFallbackReason: selected?.evidence?.aiStrategyFallbackReason,
    aiActionFallbackReason: selected?.evidence?.aiActionFallbackReason,
    aiThresholdSuggestions: selected?.evidence?.aiThresholdSuggestions,
    productContextCount: selected?.evidence?.productContextCount,
    productStage: selected?.evidence?.productStage,
    productTargetAcos: selected?.evidence?.productTargetAcos,
    productTargetTacos: selected?.evidence?.productTargetTacos,
    productTargetNetMargin: selected?.evidence?.productTargetNetMargin,
    productMinPrice: selected?.evidence?.productMinPrice,
    decisionAgreement: selected?.evidence?.decisionAgreement,
    decisionSource: selected?.evidence?.decisionSource,
    decisionReasons: selected?.evidence?.decisionReasons || [],
    decisionRiskWarnings: selected?.evidence?.decisionRiskWarnings || [],
    quantReasons: selected?.evidence?.quantReasons || [],
    quantThresholds: selected?.evidence?.quantThresholds,
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
    },
  };
}

export function buildApprovalStampFeedback(input: {
  state: ApprovalFeedbackState;
  recommendationId?: number;
  targetName?: string;
  message?: string;
}): {
  label: string;
  title: string;
  detail: string;
  tone: 'ready' | 'blocked' | 'pending';
} {
  const target = input.targetName ? ` / ${input.targetName}` : '';
  const id = input.recommendationId ? `#${input.recommendationId}` : '';
  if (input.state === 'approving') {
    return {
      label: 'SEALING',
      title: `正在建立审批契约 ${id}`.trim(),
      detail: `正在写入人工审批记录${target}，按钮已锁定，真实广告后台操作仍需进入结果核对。`,
      tone: 'pending',
    };
  }
  if (input.state === 'approved') {
    return {
      label: 'PASSED',
      title: `审批已通过 ${id}`.trim(),
      detail: input.message || `建议已进入待执行队列${target}，下一步到结果核对补审批凭证、执行前后截图和回读值。`,
      tone: 'ready',
    };
  }
  if (input.state === 'rejecting') {
    return {
      label: 'BLOCKING',
      title: `正在记录拒绝 ${id}`.trim(),
      detail: `正在写入拒绝原因${target}，该建议不会进入结果核对。`,
      tone: 'pending',
    };
  }
  if (input.state === 'rejected') {
    return {
      label: 'REJECTED',
      title: `建议已拦截 ${id}`.trim(),
      detail: input.message || `拒绝原因已写入建议证据${target}，该建议不会进入执行队列。`,
      tone: 'blocked',
    };
  }
  return {
    label: 'BLOCKED',
    title: `审批被阻断 ${id}`.trim(),
    detail: input.message || '审批前置条件不完整，请补齐证据、审批人或拒绝原因后再提交。',
    tone: 'blocked',
  };
}

export function approvalDecisionButtonView({
  mode,
  submittingDecision,
  blocked,
}: {
  mode: ApprovalDecisionButtonMode;
  submittingDecision: ApprovalDecisionButtonMode | null;
  blocked: boolean;
}): {
  label: string;
  disabled: boolean;
  ariaBusy: boolean;
  className: string;
} {
  const isApprove = mode === 'approved';
  const isCurrent = submittingDecision === mode;
  const disabled = Boolean(submittingDecision) || (isApprove && blocked);
  const baseClass = isApprove
    ? blocked ? 'secondary-button' : 'primary-button'
    : 'secondary-button danger-button';
  return {
    label: isCurrent ? '处理中...' : isApprove ? blocked ? '暂不能批准' : '批准，进入结果核对' : '拒绝',
    disabled,
    ariaBusy: isCurrent,
    className: [baseClass, isCurrent ? 'button-loading' : ''].filter(Boolean).join(' '),
  };
}
