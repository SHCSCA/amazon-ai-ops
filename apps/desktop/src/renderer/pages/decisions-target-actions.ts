import { rendererRuntimeLog } from '../runtime-log';
import type { BindRecommendationWritableTargetResult } from '@amazon-ai-ops/shared-types';
import { formatUsd } from '../formatters';
import { toUserFacingError } from '../user-facing-error';
import {
  isDecisionsQueryKeyActive,
} from "./decisions-query";
import {
  decisionObjectName,
  buildDecisionsTargetBindingFeedback,
  stampTargetName,
} from "./decisions-presentation";
import {
  buildDecisionsTargetBindingRequest,
  createDecisionsReviewFormState,
} from "./decisions-review-forms";
import {
  isConfirmedDecisionsTargetBinding,
  isDecisionsVersionConflict,
} from "./decisions-target-proof";
import {
  type DecisionsPageActionContext,
} from "./decisions-ports";

export async function discoverSelectedWritableTargetDecisionsPageAction(this: DecisionsPageActionContext): Promise<void> {
  const {
    isOperationCurrent,
    selected,
    mutationLocked,
    authorityQueryState,
    setBlockedFeedback,
    queryKey,
    setDiscoveringTarget,
    setDecisionFeedback,
    setPageMessage,
    loadRequestGuardRef,
    setReviewForm,
  } = this;

    if (
      !selected
      || selected.status !== 'pending'
      || selected.evidence?.writableTarget
      || mutationLocked
    ) return;
    if (authorityQueryState.stale) {
      setBlockedFeedback(selected, '权威队列数据已过期，刷新成功前不能从 Ads 页面识别对象。');
      return;
    }

    const currentRow = selected;
    const operationQueryKey = queryKey;
    setDiscoveringTarget(true);
    setDecisionFeedback(null);
    setPageMessage(null);
    try {
      if (typeof window === 'undefined') throw new Error('当前环境无法读取 Ads 页面。');
      const api = (window as any).electronAPI;
      const discoverRecommendationTarget = api?.executionAuthority?.discoverRecommendationTarget;
      if (typeof api?.getActiveStoreContext !== 'function'
        || typeof discoverRecommendationTarget !== 'function') {
        throw new Error('Ads 对象只读识别接口未暴露。');
      }
      const context = await api.getActiveStoreContext();
      if (!isOperationCurrent()) return;
      if (!context) throw new Error('当前店铺上下文不可用。');
      const result = await discoverRecommendationTarget({
        context,
        recommendationId: currentRow.id,
      });
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      const writableTarget = result?.writableTarget;
      const pageIdentity = result?.pageIdentity;
      if (Number(result?.recommendationId) !== currentRow.id
        || Number(result?.recommendationRevision) !== currentRow.revision
        || writableTarget?.entityType !== 'keyword'
        || String(writableTarget?.entityId || '').trim() !== String(pageIdentity?.keywordId || '').trim()
        || !Number.isInteger(Number(writableTarget?.sourceRow))
        || Number(writableTarget?.sourceRow) <= 0) {
        throw new Error('Ads 页面识别结果与当前建议版本不一致。');
      }
      setReviewForm((current) => ({
        ...current,
        entityType: writableTarget.entityType,
        entityId: String(writableTarget.entityId || ''),
        sourceFile: String(writableTarget.sourceFile || ''),
        sourceRow: String(writableTarget.sourceRow),
        identitySource: 'ads_ui',
        identityProofPath: String(writableTarget.identityProofPath || ''),
        verificationNote: String(writableTarget.verificationNote || ''),
      }));
      setPageMessage(
        `已从当前店铺 Ads 页面识别 ${decisionObjectName(currentRow)}，页面竞价 `
        + `${formatUsd(Number(pageIdentity.bidCents || 0) / 100)}；已填入核验表单，`
        + '不会自动绑定、批准或执行。',
      );
    } catch (caught) {
      rendererRuntimeLog.error('renderer.decisions_target_actions.failed', { error: caught });
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      const message = toUserFacingError(caught, '从 Ads 页面识别对象失败');
      setBlockedFeedback(currentRow, `Ads 对象识别失败：${message}`);
    } finally {
      if (isOperationCurrent()) setDiscoveringTarget(false);
    }
  }

export async function bindSelectedWritableTargetDecisionsPageAction(this: DecisionsPageActionContext): Promise<void> {
  const {
    isOperationCurrent,
    selected,
    mutationLocked,
    authorityQueryState,
    setBlockedFeedback,
    targetBindingBlockers,
    queryKey,
    setSubmittingTargetBinding,
    setDecisionFeedback,
    setPageMessage,
    scope,
    currentBatchId,
    reviewForm,
    loadRequestGuardRef,
    loadRows,
    setReviewForm,
    setApproverName,
    setApprovalNote,
    setSelectedId,
  } = this;

    if (
      !selected
      || selected.status !== 'pending'
      || selected.evidence?.writableTarget
      || mutationLocked
    ) return;
    if (authorityQueryState.stale) {
      setBlockedFeedback(selected, '权威队列数据已过期，刷新成功前不能核验 Ads 对象。');
      return;
    }
    if (targetBindingBlockers.length > 0) {
      setBlockedFeedback(selected, `Ads 对象核验仍被阻断：${targetBindingBlockers.join('、')}。`);
      return;
    }

    const currentRow = selected;
    const operationQueryKey = queryKey;
    setSubmittingTargetBinding(true);
    setDecisionFeedback(null);
    setPageMessage(null);
    try {
      if (typeof window === 'undefined') throw new Error('当前环境无法核验 Ads 可写对象。');
      const api = (window as any).electronAPI;
      const bindWritableTarget = api?.bindRecommendationWritableTarget;
      if (typeof bindWritableTarget !== 'function') throw new Error('Ads 对象核验接口未暴露。');
      const bindingRequest = buildDecisionsTargetBindingRequest({
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
      const result = await bindWritableTarget(bindingRequest) as BindRecommendationWritableTargetResult;
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;

      const refreshedRows = await loadRows({ clearMessage: false });
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      if (!refreshedRows) {
        setBlockedFeedback(currentRow, 'Ads 对象核验已提交，但权威刷新失败；当前数据已锁定，请刷新确认后再继续。');
        return;
      }
      const refreshed = refreshedRows.find((row) => row.id === currentRow.id);
      if (!isConfirmedDecisionsTargetBinding(refreshed, result, bindingRequest)) {
        setBlockedFeedback(currentRow, '核验提交后没有读到匹配的 rev+1 绑定审计；建议仍不可批准。');
        return;
      }

      setPageMessage('Ads 对象已核验并重新读取权威版本；建议仍保持待审批，需另行填写审批人并显式批准。');
      setDecisionFeedback(buildDecisionsTargetBindingFeedback(
        currentRow.id,
        stampTargetName(currentRow),
      ));
      setReviewForm(createDecisionsReviewFormState());
      setApproverName('');
      setApprovalNote('');
      setSelectedId(currentRow.id);
    } catch (caught) {
      rendererRuntimeLog.error('renderer.decisions_target_actions.failed', { error: caught });
      if (!isOperationCurrent() || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      const message = toUserFacingError(caught, '核验 Ads 可写对象失败');
      const conflict = isDecisionsVersionConflict(caught);
      setBlockedFeedback(
        currentRow,
        conflict
          ? `版本冲突：${message}。已刷新最新权威行，核验表单内容已保留。`
          : `Ads 对象核验失败：${message}。建议仍保持待审批且不可批准。`,
      );
      if (conflict) {
        const refreshedRows = await loadRows({ clearMessage: false });
        if (isOperationCurrent() && refreshedRows?.some((row) => row.id === currentRow.id)) setSelectedId(currentRow.id);
      }
    } finally {
      if (isOperationCurrent()) setSubmittingTargetBinding(false);
    }
  }
