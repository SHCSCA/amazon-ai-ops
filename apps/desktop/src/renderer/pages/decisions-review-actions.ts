import { rendererRuntimeLog } from '../runtime-log';
import type { ResolveRecommendationReviewResult } from '@amazon-ai-ops/shared-types';
import { toUserFacingError } from '../user-facing-error';
import { normalizeDecisionsFocusHandoff } from './decisions-workspace-model';
import {
  DECISIONS_HANDOFF_STORAGE_KEY,
} from "./decisions-constants";
import {
  isDecisionsQueryKeyActive,
} from "./decisions-query";
import {
  clearDecisionsHandoffStorage,
  selectDecisionsBatchHandoffRows,
} from "./decisions-presentation";
import {
  buildDecisionsReviewRequest,
  createDecisionsReviewFormState,
} from "./decisions-review-forms";
import {
  isConfirmedDecisionsReviewResolution,
  isDecisionsVersionConflict,
} from "./decisions-target-proof";
import {
  type DecisionsPageActionContext,
} from "./decisions-ports";

export async function reviewSelectedRecommendationsDecisionsPageAction(this: DecisionsPageActionContext): Promise<void> {
  const {
    isOperationCurrent,
    mutationLocked,
    selectedRecommendationIds,
    setPageMessage,
    queryKey,
    setHandoffBusy,
    setDecisionFeedback,
    loadRows,
    loadRequestGuardRef,
    setSelectedRecommendationIds,
    setHandoff,
    handoffQueryKeyRef,
    eligibilityContext,
    currentBatchId,
    scope,
    requestSubview,
  } = this;

    if (mutationLocked) return;
    const selectedIds = new Set(selectedRecommendationIds);
    if (!selectedIds.size) {
      setPageMessage('请先勾选至少 1 条证据完整、可以批准的待判断建议。');
      return;
    }

    const operationQueryKey = queryKey;
    setHandoffBusy(true);
    setDecisionFeedback(null);
    setPageMessage(null);
    try {
      const refreshedRows = await loadRows({ announceWorkflow: true, clearMessage: false });
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      if (!refreshedRows) {
        setSelectedRecommendationIds(new Set());
        setHandoff(null);
        handoffQueryKeyRef.current = null;
        clearDecisionsHandoffStorage();
        setPageMessage('批量复核已停止：未能确认最新权威队列，未切换到待审批。');
        return;
      }

      const matchedRows = selectDecisionsBatchHandoffRows(
        refreshedRows,
        selectedIds,
        { ...eligibilityContext, locked: false },
      );
      const ids = matchedRows.map((row) => String(row.id));
      if (!ids.length) {
        setSelectedRecommendationIds(new Set());
        setHandoff(null);
        handoffQueryKeyRef.current = null;
        clearDecisionsHandoffStorage();
        setPageMessage('批量复核已停止：刷新后所选建议均不再具备审批资格，未切换到待审批。');
        return;
      }

      const handoffValue = {
        ids,
        count: ids.length,
        batchId: currentBatchId,
        scope: {
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
        },
        createdAt: new Date().toISOString(),
      };
      try {
        window.sessionStorage?.setItem(DECISIONS_HANDOFF_STORAGE_KEY, JSON.stringify(handoffValue));
      } catch (caught) {
      rendererRuntimeLog.error('renderer.decisions_review_actions.failed', { error: caught });
        // 会话存储仅作兼容提示，内存交接仍使用权威数据行。
      }
      handoffQueryKeyRef.current = queryKey;
      setHandoff(normalizeDecisionsFocusHandoff(handoffValue));
      requestSubview('approval', { allowLocked: true });
      setPageMessage(`已重新确认并送入待审批 ${ids.length} 项；队列未过滤，首条匹配建议已置顶。`);
    } catch (caught) {
      rendererRuntimeLog.error('renderer.decisions_review_actions.failed', { error: caught });
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      const message = toUserFacingError(caught, '批量复核失败');
      setSelectedRecommendationIds(new Set());
      setHandoff(null);
      handoffQueryKeyRef.current = null;
      clearDecisionsHandoffStorage();
      setPageMessage(`批量复核已停止：${message}。未切换到待审批。`);
    } finally {
      if (isOperationCurrent()) setHandoffBusy(false);
    }
  }

export async function resolveSelectedReviewDecisionsPageAction(this: DecisionsPageActionContext): Promise<void> {
  const {
    isOperationCurrent,
    selected,
    mutationLocked,
    authorityQueryState,
    setBlockedFeedback,
    reviewBlockers,
    queryKey,
    setSubmittingReview,
    setDecisionFeedback,
    setPageMessage,
    scope,
    currentBatchId,
    reviewForm,
    loadRequestGuardRef,
    loadRows,
    focusReturnOverrideRef,
    tabRefs,
    subview,
    setSelectedId,
    setReviewForm,
    setApproverName,
    setApprovalNote,
  } = this;

    if (!selected || selected.status !== 'needs_review' || mutationLocked) return;
    if (authorityQueryState.stale) {
      setBlockedFeedback(selected, '权威队列数据已过期，刷新成功前不能确认复核。');
      return;
    }
    if (reviewBlockers.length > 0) {
      setBlockedFeedback(selected, `复核仍被阻断：${reviewBlockers.join('、')}。`);
      return;
    }

    const currentRow = selected;
    const operationQueryKey = queryKey;
    setSubmittingReview(true);
    setDecisionFeedback(null);
    setPageMessage(null);
    try {
      if (typeof window === 'undefined') throw new Error('当前环境无法确认建议复核。');
      const api = (window as any).electronAPI;
      const resolveReview = api?.resolveRecommendationReview;
      if (typeof resolveReview !== 'function') throw new Error('确认建议复核接口未暴露。');
      const reviewRequest = buildDecisionsReviewRequest({
        row: currentRow,
        scope: {
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
        },
        currentBatchId,
        form: reviewForm,
      });
      const result = await resolveReview(reviewRequest) as ResolveRecommendationReviewResult;
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;

      const refreshedRows = await loadRows({ clearMessage: false });
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      if (!refreshedRows) {
        setBlockedFeedback(currentRow, '复核已提交，但权威刷新失败；当前数据已锁定，请刷新确认后再继续。');
        return;
      }
      const refreshed = refreshedRows.find((row) => row.id === currentRow.id);
      if (!isConfirmedDecisionsReviewResolution(currentRow, reviewRequest, result, refreshed)) {
        setBlockedFeedback(currentRow, '复核提交后没有读到匹配的 rev+1 复核审计；建议未确认进入待审批。');
        return;
      }

      setPageMessage('复核已确认，建议已回到待审批；本操作没有批准建议，也没有执行 Ads 动作。');
      focusReturnOverrideRef.current = tabRefs.current[subview] ?? null;
      setSelectedId(null);
      setReviewForm(createDecisionsReviewFormState());
      setApproverName('');
      setApprovalNote('');
    } catch (caught) {
      rendererRuntimeLog.error('renderer.decisions_review_actions.failed', { error: caught });
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      const message = toUserFacingError(caught, '确认建议复核失败');
      const conflict = isDecisionsVersionConflict(caught);
      setBlockedFeedback(
        currentRow,
        conflict
          ? `版本冲突：${message}。已刷新最新权威行，复核表单内容已保留。`
          : `确认复核失败：${message}。建议仍停留在需复核状态。`,
      );
      if (conflict) {
        const refreshedRows = await loadRows({ clearMessage: false });
        if (isOperationCurrent() && refreshedRows?.some((row) => row.id === currentRow.id)) setSelectedId(currentRow.id);
      }
    } finally {
      if (isOperationCurrent()) setSubmittingReview(false);
    }
  }
