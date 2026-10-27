import type { AppRoute,RecommendationView } from '../types';
import type { WorkflowEventTarget } from '../workflow-invalidation';
import { runWorkflowInvalidatingMutation } from '../workflow-invalidation';
import {
recommendationCanEnterFormalApproval,
recommendationHasEvidenceBlocker,
recommendationRequiresManualReview,
} from './recommendation-evidence';

export const APPROVAL_SELECTION_STORAGE_KEY = 'amazon-ai-ops:approval-selection';

export function runRecommendationWorkflowMutation<T>(
  action: 'generate' | 'refresh',
  task: () => Promise<T>,
  target?: WorkflowEventTarget,
  canInvalidate: () => boolean = () => true,
): Promise<T> {
  return runWorkflowInvalidatingMutation(
    action === 'generate' ? 'recommendations-generated' : 'recommendations-refreshed',
    task,
    target,
    canInvalidate,
  );
}

export type RecommendationBucketFilter = 'all' | 'blocked' | 'review' | 'ready';

export function recommendationMatchesBucketFilter(
  rec: RecommendationView,
  filter: RecommendationBucketFilter,
  currentBatchId?: string,
  allowedSourceFiles?: string[],
): boolean {
  if (filter === 'all') return true;
  if (filter === 'blocked') return recommendationHasEvidenceBlocker(rec, currentBatchId, allowedSourceFiles);
  if (filter === 'review') return recommendationRequiresManualReview(rec, currentBatchId, allowedSourceFiles);
  if (filter === 'ready') return recommendationCanEnterFormalApproval(rec, currentBatchId, allowedSourceFiles);
  return true;
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
      readbackLabel: approvedCount > 0 ? '去结果核对' : '审批后回读',
    };
  }
  if (input.recommendationCount > 0 && (input.manualReviewCount > 0 || input.evidenceBlockedCount > 0)) {
    return {
      approvalDisabled: true,
      readbackDisabled: true,
      approvalLabel: '先处理复核/证据',
      readbackLabel: '等待可送审动作',
    };
  }
  return {
    approvalDisabled: true,
    readbackDisabled: true,
    approvalLabel: '等待建议',
    readbackLabel: '等待可送审动作',
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
      title: `建议动作未开放：可送审 0，需复核 ${manualReviewCount}，缺证据 ${evidenceBlockedCount}`,
      detail: `当前真实报表 ${realReportCount}/8 类，导入指标 ${importedRowCount} 行，可行动指标 ${actionableMetricRows} 行。下一步：补齐真实数据或回到广告表现复核。`,
      disabled: false,
    };
  }

  if (formalApprovalCount > 0) {
    return {
      label: '去审批中心',
      action: 'navigate',
      route: 'approval',
      title: `建议动作：可送审 ${formalApprovalCount}，需复核 ${manualReviewCount}，缺证据 ${evidenceBlockedCount}`,
      detail: `当前共有 ${recommendationCount} 条待处理建议。下一步：选择证据完整的动作送到审批中心；真实执行和回读仍在后续页面完成。`,
      disabled: false,
    };
  }

  if (recommendationCount > 0 && (manualReviewCount > 0 || evidenceBlockedCount > 0)) {
    return {
      label: '补齐证据或复核',
      action: 'navigate',
      route: 'ad-quant',
      title: `建议动作：可送审 0，需复核 ${manualReviewCount}，缺证据 ${evidenceBlockedCount}`,
      detail: `当前共有 ${recommendationCount} 条建议，但没有证据完整、可送审的动作。下一步：补齐证据或回到广告表现复核输入。`,
      disabled: false,
    };
  }

  return {
    label: '生成优化建议',
    action: 'generate',
    title: `建议动作：可送审 ${formalApprovalCount}，需复核 ${manualReviewCount}，缺证据 ${evidenceBlockedCount}`,
    detail: `真实报表 ${realReportCount}/8 类，导入指标 ${importedRowCount} 行，可行动指标 ${actionableMetricRows} 行。下一步：生成可解释的广告动作建议。`,
    disabled: Boolean(input.generating || input.pipelineLoading),
  };
}

export function recommendationBatchSelectionState(input: {
  selectableCount: number;
  selectedCount: number;
}): {
  actionLabel: string;
  ariaStatus: string;
  countClassName: string;
  countLabel: string;
  helperText: string;
  disabled: boolean;
  tone: 'ready' | 'pending' | 'blocked';
} {
  const selectableCount = Math.max(0, Number(input.selectableCount || 0));
  const selectedCount = Math.min(selectableCount, Math.max(0, Number(input.selectedCount || 0)));
  const countLabel = `${selectedCount}/${selectableCount} 项已选择`;
  const countClassName = selectedCount > 0
    ? 'recommendation-selection-count recommendation-selection-count-active'
    : 'recommendation-selection-count';
  if (selectableCount <= 0) {
    return {
      actionLabel: '等待可送审动作',
      ariaStatus: '当前没有可送到审批中心的动作。',
      countClassName,
      countLabel,
      helperText: '当前建议池没有证据完整、可进入审批中心的动作。',
      disabled: true,
      tone: 'blocked',
    };
  }
  if (selectedCount <= 0) {
    return {
      actionLabel: `提交 0/${selectableCount} 项到审批中心`,
      ariaStatus: `当前有 ${selectableCount} 条可送审动作，尚未选择。`,
      countClassName,
      countLabel,
      helperText: '勾选可送审动作后，再带入审批中心逐条确认。',
      disabled: true,
      tone: 'pending',
    };
  }
  return {
    actionLabel: `提交 ${selectedCount} 项到审批中心`,
    ariaStatus: `已选择 ${selectedCount} 条可送审动作，提交后仍需审批中心逐条确认。`,
    countClassName,
    countLabel,
    helperText: `已选择 ${selectedCount}/${selectableCount} 条可送审动作；这里只传递审批上下文，不执行广告动作。`,
    disabled: false,
    tone: 'ready',
  };
}

export interface RecommendationActionButtonInput {
  active: boolean;
  baseClassName: string;
  busyLabel: string;
  disabled?: boolean;
  idleLabel: string;
}

export interface RecommendationActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export function recommendationActionButtonView(input: RecommendationActionButtonInput): RecommendationActionButtonView {
  return {
    ariaBusy: input.active ? true : undefined,
    className: [input.baseClassName, input.active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(input.disabled || input.active),
    label: input.active ? input.busyLabel : input.idleLabel,
    showSpinner: input.active,
  };
}

export type RecommendationListStatus = 'pending' | 'needs_review';

export function recommendationStatusFiltersForPage(): RecommendationListStatus[] {
  return ['pending', 'needs_review'];
}
