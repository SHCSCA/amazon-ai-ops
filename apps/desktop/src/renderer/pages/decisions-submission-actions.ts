import { rendererRuntimeLog } from '../runtime-log';
import { toUserFacingError } from '../user-facing-error';
import {
  buildApprovalStampFeedback,
  runApprovalWorkflowMutation,
} from './approval-page';
import { runRecommendationWorkflowMutation } from './recommendations-page';
import {
  type DecisionSubmission,
} from "./decisions-contracts";
import {
  buildDecisionsGenerationRequest,
  isDecisionsQueryKeyActive,
} from "./decisions-query";
import {
  stampTargetName,
} from "./decisions-presentation";
import {
  buildDecisionsDecisionRequest,
  createDecisionsReviewFormState,
} from "./decisions-review-forms";
import {
  isDecisionsVersionConflict,
} from "./decisions-target-proof";
import {
  type DecisionsPageActionContext,
} from "./decisions-ports";

export async function generateRecommendationsDecisionsPageAction(this: DecisionsPageActionContext): Promise<void> {
  const {
    isOperationCurrent,
    mutationLocked,
    recommendationGateIssues,
    setPageMessage,
    queryKey,
    setGenerating,
    setDecisionFeedback,
    scope,
    currentBatchId,
    loadRequestGuardRef,
    reloadPipeline,
    loadRows,
  } = this;

    if (mutationLocked) return;
    if (recommendationGateIssues.length) {
      setPageMessage(`建议生成被锁定：${recommendationGateIssues.join('；')}。`);
      return;
    }
    const operationQueryKey = queryKey;
    setGenerating(true);
    setDecisionFeedback(null);
    setPageMessage(null);
    try {
      if (typeof window === 'undefined') throw new Error('当前环境无法生成优化建议。');
      const generate = (window as any).electronAPI?.generateRecommendations;
      if (typeof generate !== 'function') throw new Error('建议生成接口未暴露。');
      const result = await runRecommendationWorkflowMutation<any>(
        'generate',
        () => generate(buildDecisionsGenerationRequest(scope, currentBatchId)),
        undefined, isOperationCurrent,
      );
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;

      reloadPipeline();
      const refreshedRows = await loadRows({ clearMessage: false });
      if (!isOperationCurrent() || !refreshedRows || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;

      const generated = Math.max(0, Number(result?.generated || 0));
      const refreshed = Math.max(0, Number(result?.refreshedDuplicates || 0));
      setPageMessage(`建议生成完成：新增 ${generated} 条，刷新 ${refreshed} 条；已重新读取四个权威状态。`);
    } catch (caught) {
      rendererRuntimeLog.error('renderer.decisions_submission_actions.failed', { error: caught });
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      const message = toUserFacingError(caught, '生成优化建议失败');
      setPageMessage(`生成失败：${message}`);
    } finally {
      if (isOperationCurrent()) setGenerating(false);
    }
  }

export async function submitDecisionDecisionsPageAction(this: DecisionsPageActionContext,
  decision: DecisionSubmission): Promise<void> {
  const {
    isOperationCurrent,
    selected,
    selectedEligibility,
    mutationLocked,
    reviewForm,
    approverName,
    approvalNote,
    authorityQueryState,
    setBlockedFeedback,
    queryKey,
    setSubmittingDecision,
    setDecisionFeedback,
    setPageMessage,
    currentBatchId,
    scope,
    loadRequestGuardRef,
    loadRows,
    focusReturnOverrideRef,
    tabRefs,
    subview,
    setSelectedId,
    setApproverName,
    setApprovalNote,
    setReviewForm,
    setQueue,
  } = this;

    if (!selected || !selectedEligibility || mutationLocked) return;
    const decisionOperator = selected.status === 'needs_review'
      ? reviewForm.reviewedBy
      : approverName;
    const decisionNote = selected.status === 'needs_review'
      ? reviewForm.rationale
      : approvalNote;
    if (authorityQueryState.stale) {
      setBlockedFeedback(selected, '权威队列数据已过期，刷新成功前不能提交任何决定。');
      return;
    }
    if (decision === 'approved' && !selectedEligibility.canApprove) {
      setBlockedFeedback(selected, selectedEligibility.blockers.join('、') || '该建议未通过普通批准安全门。');
      return;
    }
    if (decision === 'rejected' && !selectedEligibility.canReject) {
      setBlockedFeedback(selected, '当前建议状态不能再次拒绝。');
      return;
    }
    if (!decisionOperator.trim()) {
      setBlockedFeedback(selected, decision === 'approved' ? '批准前必须填写审批人。' : '拒绝前必须填写处理人。');
      return;
    }
    if (decision === 'rejected' && !decisionNote.trim()) {
      setBlockedFeedback(selected, '拒绝前必须填写拒绝原因。');
      return;
    }

    const currentRow = selected;
    const operationQueryKey = queryKey;
    const state = decision === 'approved' ? 'approving' : 'rejecting';
    setSubmittingDecision(decision);
    setDecisionFeedback(buildApprovalStampFeedback({
      state,
      recommendationId: currentRow.id,
      targetName: stampTargetName(currentRow),
    }));
    setPageMessage(null);

    try {
      if (typeof window === 'undefined') throw new Error('当前环境无法提交建议决定。');
      const api = (window as any).electronAPI;
      const mutate = decision === 'approved'
        ? api?.approveRecommendation
        : api?.rejectRecommendation;
      if (typeof mutate !== 'function') {
        throw new Error(decision === 'approved' ? '批准建议接口未暴露。' : '拒绝建议接口未暴露。');
      }
      const request = buildDecisionsDecisionRequest({
        decision,
        approverName: decisionOperator,
        approvalNote: decisionNote,
        currentBatchId,
        row: currentRow,
        scope: {
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
        },
      });
      await runApprovalWorkflowMutation(
        decision === 'approved' ? 'approve' : 'reject',
        () => mutate(request),
        undefined, isOperationCurrent,
      );
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      const refreshedRows = await loadRows({ clearMessage: false });
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      if (!refreshedRows) {
        setBlockedFeedback(
          currentRow,
          '决定已提交，但权威刷新失败；当前数据已锁定，请刷新确认后再继续。',
        );
        return;
      }

      const feedback = buildApprovalStampFeedback({
        state: decision,
        recommendationId: currentRow.id,
        targetName: stampTargetName(currentRow),
      });
      setPageMessage(`${feedback.title}。${decision === 'approved' ? '已批准，尚不代表已执行。' : feedback.detail}`);
      setDecisionFeedback(feedback);
      focusReturnOverrideRef.current = tabRefs.current[subview] ?? null;
      setSelectedId(null);
      setApproverName('');
      setApprovalNote('');
      setReviewForm(createDecisionsReviewFormState());
    } catch (caught) {
      rendererRuntimeLog.error('renderer.decisions_submission_actions.failed', { error: caught });
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      const message = toUserFacingError(caught, decision === 'approved' ? '批准建议失败' : '拒绝建议失败');
      const conflict = isDecisionsVersionConflict(caught);
      setBlockedFeedback(
        currentRow,
        conflict
          ? `版本冲突：${message}。已刷新最新权威行，表单内容已保留。`
          : `${decision === 'approved' ? '批准' : '拒绝'}失败：${message}。当前旧数据已锁定。`,
      );
      if (conflict) {
        const refreshedRows = await loadRows({ clearMessage: false });
        if (isOperationCurrent() && refreshedRows?.some((row) => row.id === currentRow.id)) setSelectedId(currentRow.id);
      } else {
        setQueue((current) => ({ ...current, stale: true, error: message }));
      }
    } finally {
      if (isOperationCurrent()) setSubmittingDecision(null);
    }
  }
