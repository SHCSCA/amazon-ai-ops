import { BusinessDataConfigurationNotice } from '../components/business-data-configuration';
import { rendererRuntimeLog } from '../runtime-log';
import { usePageOperation } from './use-page-operation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import type { PriorityDataTableColumn } from '../components/workspace';
import { buildDecisionEvidenceSummary } from '../evidence-display';
import type { RecommendationView } from '../types';
import { toUserFacingError } from '../user-facing-error';
import { buildApprovalStampFeedback } from './approval-page';
import { runRecommendationWorkflowMutation } from './recommendations-page';
import {
  applyDecisionsFocusHandoff,
  countDecisionsWorkspaceRows,
  decisionsWorkspaceSubviewDefinition,
  filterDecisionsWorkspaceRows,
} from './decisions-workspace-model';
import type {
  DecisionsFocusHandoff,
  DecisionsWorkspaceSubview,
} from './decisions-workspace-model';
import {
  DECISIONS_TABLE_COLUMN_DEFINITIONS,
} from "./decisions-constants";
import {
  type DecisionsPageProps,
  type DecisionQueueState,
  type DecisionsReviewFormState,
  type DecisionSubmission,
  type DecisionsLoadRequestGuard,
  type DecisionEligibilityContext,
} from "./decisions-contracts";
import {
  createDecisionsLoadRequestGuard,
  resolveDecisionsCurrentBatchId,
  decisionsQueryKey,
  activateDecisionsQueryKey,
  decisionsAuthorityQueryState,
  decisionsRowsForPublishedQuery,
  buildDecisionsRecommendationGateIssues,
  decisionsInteractionLocked,
  beginDecisionsLoadRequest,
  loadDecisionsAuthoritativeRows,
  isLatestDecisionsLoadRequest,
  invalidateDecisionsLoadRequests,
} from "./decisions-query";
import {
  clearDecisionsHandoffStorage,
  decisionsHandoffMatchesQuery,
  readDecisionsHandoff,
  selectDecisionsBatchHandoffRows,
  decisionObjectName,
  decisionActionLabel,
  decisionRiskLabel,
  decisionsPrimaryQueueTask,
} from "./decisions-presentation";
import {
  decisionEligibilitySummary,
} from "./decisions-eligibility";
import {
  createDecisionsReviewFormState,
  decisionsReviewBlockers,
  decisionsTargetBindingBlockers,
} from "./decisions-review-forms";
import {
  requestSubviewDecisionsPageAction,
  handleTabKeyDownDecisionsPageAction,
  closeInspectorDecisionsPageAction,
  openDecisionInspectorDecisionsPageAction,
  setBlockedFeedbackDecisionsPageAction,
} from "./decisions-navigation-actions";
import {
  discoverSelectedWritableTargetDecisionsPageAction,
  bindSelectedWritableTargetDecisionsPageAction,
} from "./decisions-target-actions";
import {
  reviewSelectedRecommendationsDecisionsPageAction,
  resolveSelectedReviewDecisionsPageAction,
} from "./decisions-review-actions";
import {
  generateRecommendationsDecisionsPageAction,
  submitDecisionDecisionsPageAction,
} from "./decisions-submission-actions";
import {
  type DecisionsPageActionContext,
} from "./decisions-ports";
import {
  renderDecisionsPageView,
} from "./decisions-view";

export function DecisionsPage({ activeSubview }: DecisionsPageProps) {
  const decisionsActionContext: DecisionsPageActionContext = {
    get isOperationCurrent() { return () => false; },
    get interactionLocked() { return interactionLocked; },
    get setSubview() { return setSubview; },
    get setSelectedId() { return setSelectedId; },
    get setApproverName() { return setApproverName; },
    get setApprovalNote() { return setApprovalNote; },
    get setReviewForm() { return setReviewForm; },
    get setDecisionFeedback() { return setDecisionFeedback; },
    get setPageMessage() { return setPageMessage; },
    get setSelectedRecommendationIds() { return setSelectedRecommendationIds; },
    get requestSubview() { return requestSubview; },
    get tabRefs() { return tabRefs; },
    get selected() { return selected; },
    get mutationLocked() { return mutationLocked; },
    get authorityQueryState() { return authorityQueryState; },
    get setBlockedFeedback() { return setBlockedFeedback; },
    get queryKey() { return queryKey; },
    get setDiscoveringTarget() { return setDiscoveringTarget; },
    get loadRequestGuardRef() { return loadRequestGuardRef; },
    get selectedRecommendationIds() { return selectedRecommendationIds; },
    get setHandoffBusy() { return setHandoffBusy; },
    get loadRows() { return loadRows; },
    get setHandoff() { return setHandoff; },
    get handoffQueryKeyRef() { return handoffQueryKeyRef; },
    get eligibilityContext() { return eligibilityContext; },
    get currentBatchId() { return currentBatchId; },
    get scope() { return scope; },
    get recommendationGateIssues() { return recommendationGateIssues; },
    get setGenerating() { return setGenerating; },
    get reloadPipeline() { return reloadPipeline; },
    get targetBindingBlockers() { return targetBindingBlockers; },
    get setSubmittingTargetBinding() { return setSubmittingTargetBinding; },
    get reviewForm() { return reviewForm; },
    get reviewBlockers() { return reviewBlockers; },
    get setSubmittingReview() { return setSubmittingReview; },
    get focusReturnOverrideRef() { return focusReturnOverrideRef; },
    get subview() { return subview; },
    get selectedEligibility() { return selectedEligibility; },
    get approverName() { return approverName; },
    get approvalNote() { return approvalNote; },
    get setSubmittingDecision() { return setSubmittingDecision; },
    get setQueue() { return setQueue; },
  };
const {
    data,
    error: pipelineError,
    loading: pipelineLoading,
    configurationRequired,
    reload: reloadPipeline,
    scope,
  } = useBusinessDataPipeline();

const [subview, setSubview] = useState<DecisionsWorkspaceSubview>(activeSubview);

const [queue, setQueue] = useState<DecisionQueueState>({
    rows: [],
    loading: true,
    stale: false,
    error: null,
    loadedAt: null,
    publishedQueryKey: null,
  });

const [selectedId, setSelectedId] = useState<number | null>(null);

const [handoff, setHandoff] = useState<DecisionsFocusHandoff | null>(null);

const [approverName, setApproverName] = useState('');

const [approvalNote, setApprovalNote] = useState('');

const [reviewForm, setReviewForm] = useState<DecisionsReviewFormState>(
    () => createDecisionsReviewFormState(),
  );

const [submittingDecision, setSubmittingDecision] = useState<DecisionSubmission | null>(null);

const [submittingReview, setSubmittingReview] = useState(false);

const [submittingTargetBinding, setSubmittingTargetBinding] = useState(false);

const [discoveringTarget, setDiscoveringTarget] = useState(false);

const [generating, setGenerating] = useState(false);

const [handoffBusy, setHandoffBusy] = useState(false);

const [selectedRecommendationIds, setSelectedRecommendationIds] = useState<Set<string>>(
    () => new Set(),
  );

const [pageMessage, setPageMessage] = useState<string | null>(null);

const [decisionFeedback, setDecisionFeedback] = useState<ReturnType<typeof buildApprovalStampFeedback> | null>(null);

const tabRefs = useRef<Partial<Record<DecisionsWorkspaceSubview, HTMLButtonElement | null>>>({});

const loadRequestGuardRef = useRef<DecisionsLoadRequestGuard>(createDecisionsLoadRequestGuard());

const handoffQueryKeyRef = useRef<string | null>(null);

const activeQueryKeyRef = useRef<string | null>(null);

const focusReturnOverrideRef = useRef<HTMLButtonElement | null>(null);

const currentBatchId = resolveDecisionsCurrentBatchId({
    scopeBatchId: scope.batchId,
    latestBatchId: data?.collection.latestBatch?.id,
    sourceBatchIds: data?.collection.sourceBatchIds,
  });

const currentRealReportSourceFiles = useMemo(
    () => (data?.collection.realReportFiles || [])
      .map((file) => file.artifactDisplayName || file.fileName || file.displayName)
      .filter(Boolean),
    [data?.collection.realReportFiles],
  );

const queryFilter = useMemo(() => ({
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    batchId: currentBatchId,
  }), [
    currentBatchId,
    scope.asin,
    scope.dateFrom,
    scope.dateTo,
    scope.marketplaceCode,
    scope.storeName,
  ]);

const scopeQueryKey = useMemo(() => decisionsQueryKey(queryFilter), [queryFilter]);
const pageAuthority = usePageOperation(scopeQueryKey);
const pageOperation = usePageOperation(JSON.stringify([scopeQueryKey, selectedId]));
const queryKey = pageAuthority.contextKey;

useEffect(() => {
  setGenerating(false); setHandoffBusy(false); setSubmittingDecision(null);
  setSubmittingReview(false); setSubmittingTargetBinding(false); setDiscoveringTarget(false);
}, [pageOperation.contextKey]);

activateDecisionsQueryKey(loadRequestGuardRef.current, queryKey);

if (activeQueryKeyRef.current === null) {
    activeQueryKeyRef.current = queryKey;
  } else if (activeQueryKeyRef.current !== queryKey) {
    clearDecisionsHandoffStorage();
    activeQueryKeyRef.current = queryKey;
    handoffQueryKeyRef.current = null;
  }

const handoffMatchesCurrentQuery = decisionsHandoffMatchesQuery(
    handoffQueryKeyRef.current,
    queryKey,
  );

const handoffForCurrentQuery = handoffMatchesCurrentQuery ? handoff : null;

const authorityQueryState = decisionsAuthorityQueryState({
    publishedQueryKey: queue.publishedQueryKey,
    currentQueryKey: queryKey,
    loading: queue.loading || pageOperation.busy,
    stale: queue.stale,
  });

const publishedRows = useMemo(
    () => decisionsRowsForPublishedQuery(queue.rows, queue.publishedQueryKey, queryKey),
    [queryKey, queue.publishedQueryKey, queue.rows],
  );

const recommendationGateIssues = useMemo(
    () => buildDecisionsRecommendationGateIssues({ data, currentBatchId, pipelineLoading }),
    [currentBatchId, data, pipelineLoading],
  );

const transactionLocked = decisionsInteractionLocked({
    loading: queue.loading,
    generating,
    handoffBusy,
    submitting: Boolean(submittingDecision) || submittingReview || submittingTargetBinding || discoveringTarget,
  });

const interactionLocked = transactionLocked || !authorityQueryState.matchesCurrentQuery;

const mutationLocked = !pageOperation.hasAuthority || transactionLocked
    || authorityQueryState.mutationLocked
    || pipelineLoading;

const loadRows = useCallback(async (options: {
    announceWorkflow?: boolean;
    clearMessage?: boolean;
  } = {}): Promise<RecommendationView[] | null> => {
    if (!pageAuthority.hasAuthority) {
      setQueue(current => ({ ...current, loading: false, stale: true, error: pageAuthority.blockedReason }));
      return null;
    }
    const request = beginDecisionsLoadRequest(loadRequestGuardRef.current, queryKey);
    if (!request) return null;
    setQueue((current) => ({
      ...current,
      loading: true,
      stale: current.rows.length > 0 ? true : current.stale,
      error: null,
    }));
    if (options.clearMessage !== false) setPageMessage(null);
    try {
      if (typeof window === 'undefined') throw new Error('当前环境无法读取桌面权威队列。');
      const getRecommendations = (window as any).electronAPI?.getRecommendations;
      if (typeof getRecommendations !== 'function') throw new Error('建议权威读取接口未暴露。');
      const task = () => loadDecisionsAuthoritativeRows(getRecommendations, queryFilter);
      const rows = options.announceWorkflow
        ? await runRecommendationWorkflowMutation('refresh', task, undefined, pageAuthority.capture())
        : await task();
      if (!isLatestDecisionsLoadRequest(loadRequestGuardRef.current, request)) return null;
      setQueue({
        rows,
        loading: false,
        stale: false,
        error: null,
        loadedAt: new Date().toISOString(),
        publishedQueryKey: queryKey,
      });
      setSelectedRecommendationIds((current) => {
        const authoritativeIds = new Set(rows.map((row) => String(row.id)));
        return new Set(Array.from(current).filter((id) => authoritativeIds.has(id)));
      });
      return rows;
    } catch (caught) {
      rendererRuntimeLog.error('renderer.decisions_workspace.failed', { error: caught });
      if (!isLatestDecisionsLoadRequest(loadRequestGuardRef.current, request)) return null;
      const message = toUserFacingError(caught, '读取建议与审批权威队列失败');
      setQueue((current) => ({
        ...current,
        loading: false,
        stale: true,
        error: message,
      }));
      setPageMessage(`读取失败：${message}`);
      return null;
    }
  }, [queryFilter, queryKey]);

useEffect(() => {
    setSubview(activeSubview);
    if (subview !== activeSubview) {
      setSelectedId(null);
      setApproverName('');
      setApprovalNote('');
      setReviewForm(createDecisionsReviewFormState());
      setDecisionFeedback(null);
      setPageMessage(null);
      setSelectedRecommendationIds(new Set());
    }
    // 仅在外部意图变化时读取视图，保留已完成内部切换的成功提示。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 保持外部意图的触发边界。
  }, [activeSubview]);

useEffect(() => {
    setSelectedId(null);
    setHandoff(null);
    handoffQueryKeyRef.current = null;
    setApproverName('');
    setApprovalNote('');
    setReviewForm(createDecisionsReviewFormState());
    setDecisionFeedback(null);
    setPageMessage(null);
    setSelectedRecommendationIds(new Set());
  }, [queryKey]);

useEffect(() => {
    const storedHandoff = readDecisionsHandoff();
    handoffQueryKeyRef.current = storedHandoff ? queryKey : null;
    setHandoff(storedHandoff);
  }, []);

useEffect(() => {
    void loadRows();
    return () => invalidateDecisionsLoadRequests(loadRequestGuardRef.current);
  }, [loadRows]);

const subviewDefinition = decisionsWorkspaceSubviewDefinition(subview);

const counts = useMemo(() => countDecisionsWorkspaceRows(publishedRows), [publishedRows]);

const visibleRows = useMemo(
    () => filterDecisionsWorkspaceRows(publishedRows, subview),
    [publishedRows, subview],
  );

const orderedRowsResult = useMemo(
    () => applyDecisionsFocusHandoff(visibleRows, handoffForCurrentQuery),
    [handoffForCurrentQuery, visibleRows],
  );

const orderedRows = orderedRowsResult.rows;

const selected = useMemo(
    () => publishedRows.find((row) => row.id === selectedId) || null,
    [publishedRows, selectedId],
  );

const eligibilityContext = useMemo<DecisionEligibilityContext>(() => ({
    scope: {
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
    },
    currentBatchId,
    allowedSourceFiles: currentRealReportSourceFiles,
    stale: authorityQueryState.stale || Boolean(pipelineError),
    locked: mutationLocked,
  }), [
    currentBatchId,
    currentRealReportSourceFiles,
    pipelineError,
    mutationLocked,
    authorityQueryState.stale,
    scope.marketplaceCode,
    scope.storeName,
  ]);

const selectedEligibility = useMemo(
    () => selected ? decisionEligibilitySummary(selected, eligibilityContext) : null,
    [eligibilityContext, selected],
  );

const reviewBlockers = useMemo(() => (
    selected?.status === 'needs_review'
      ? decisionsReviewBlockers({
        row: selected,
        scope: {
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
        },
        currentBatchId,
        allowedSourceFiles: currentRealReportSourceFiles,
        form: reviewForm,
      })
      : []
  ), [
    currentBatchId,
    currentRealReportSourceFiles,
    reviewForm,
    scope.asin,
    scope.dateFrom,
    scope.dateTo,
    scope.marketplaceCode,
    scope.storeName,
    selected,
  ]);

const targetBindingBlockers = useMemo(() => (
    selected?.status === 'pending' && !selected.evidence?.writableTarget
      ? decisionsTargetBindingBlockers({
        row: selected,
        scope: {
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
        },
        currentBatchId,
        allowedSourceFiles: currentRealReportSourceFiles,
        form: reviewForm,
      })
      : []
  ), [
    currentBatchId,
    currentRealReportSourceFiles,
    reviewForm,
    scope.asin,
    scope.dateFrom,
    scope.dateTo,
    scope.marketplaceCode,
    scope.storeName,
    selected,
  ]);

const selectedEvidenceSummary = useMemo(
    () => buildDecisionEvidenceSummary(selected?.evidence),
    [selected],
  );

const batchSelectableRows = useMemo(() => {
    if (subview !== 'recommendations') return [];
    return selectDecisionsBatchHandoffRows(
      publishedRows,
      new Set(publishedRows.map((row) => String(row.id))),
      eligibilityContext,
    );
  }, [eligibilityContext, publishedRows, subview]);

const batchSelectableIdSet = useMemo(
    () => new Set(batchSelectableRows.map((row) => String(row.id))),
    [batchSelectableRows],
  );

const selectedBatchRows = useMemo(
    () => batchSelectableRows.filter((row) => selectedRecommendationIds.has(String(row.id))),
    [batchSelectableRows, selectedRecommendationIds],
  );

const batchSelectableIdKey = batchSelectableRows.map((row) => String(row.id)).join('|');

useEffect(() => {
    setSelectedRecommendationIds((current) => {
      const next = new Set(Array.from(current).filter((id) => batchSelectableIdSet.has(id)));
      if (next.size === current.size && Array.from(next).every((id) => current.has(id))) return current;
      return next;
    });
  }, [batchSelectableIdKey, batchSelectableIdSet]);

useEffect(() => {
    if (
      !handoffForCurrentQuery
      || queue.loading
      || !authorityQueryState.matchesCurrentQuery
    ) return;
    const focused = orderedRowsResult.focusedRowId
      ? orderedRows.find((row) => String(row.id) === orderedRowsResult.focusedRowId)
      : null;
    if (focused) {
      setSelectedId(focused.id);
    }
    setHandoff(null);
    handoffQueryKeyRef.current = null;
    clearDecisionsHandoffStorage();
  }, [
    authorityQueryState.matchesCurrentQuery,
    handoffForCurrentQuery,
    orderedRows,
    orderedRowsResult.focusedRowId,
    queue.loading,
  ]);

const columns = useMemo<Array<PriorityDataTableColumn<RecommendationView>>>(() => (
    DECISIONS_TABLE_COLUMN_DEFINITIONS.map((definition) => ({
      ...definition,
      width: definition.key === 'change' ? '18%' : undefined,
      cell: (row: RecommendationView) => {
        if (definition.key === 'action') {
          const rowId = String(row.id);
          const batchSelectable = subview === 'recommendations' && batchSelectableIdSet.has(rowId);
          return (
            <div className="decisions-selection-control">
              {batchSelectable && (
                <input
                  aria-label={`选择建议 #${row.id}：${decisionObjectName(row)}`}
                  checked={selectedRecommendationIds.has(rowId)}
                  className="decisions-selection-checkbox"
                  aria-describedby={interactionLocked ? "decisions-operation-lock-reason" : undefined}
                  disabled={interactionLocked}
                  onChange={(event) => {
                    if (interactionLocked) return;
                    const checked = event.currentTarget.checked;
                    setSelectedRecommendationIds((current) => {
                      const next = new Set(current);
                      if (checked) next.add(rowId);
                      else next.delete(rowId);
                      return next;
                    });
                  }}
                  type="checkbox"
                />
              )}
              <div className="decisions-table-cell decisions-table-cell--action">
                <strong>{decisionActionLabel(row.actionType)}</strong>
                <small>{decisionRiskLabel(row.riskLevel)}</small>
              </div>
            </div>
          );
        }
        if (definition.key === 'object') {
          return (
            <div className="decisions-table-cell">
              <strong>{decisionObjectName(row)}</strong>
              <small>{row.entityType || row.evidence?.matchType || '广告对象'}</small>
            </div>
          );
        }
        if (definition.key === 'change') {
          return (
            <div className="decisions-value-change" aria-label={`当前 ${row.currentValue || '-'}，建议 ${row.recommendedValue || '-'}`}>
              <span>{row.currentValue || '-'}</span>
              <span aria-hidden="true">→</span>
              <strong>{row.recommendedValue || '-'}</strong>
            </div>
          );
        }
        if (definition.key === 'evidence') {
          const summary = buildDecisionEvidenceSummary(row.evidence);
          return (
            <div className="decisions-table-cell decisions-table-cell--evidence" data-evidence-tone={summary.tone}>
              <strong>{summary.statusLabel}</strong>
              <small>{summary.headline}</small>
            </div>
          );
        }
        const eligibility = decisionEligibilitySummary(row, eligibilityContext);
        return (
          <div className="decisions-table-cell decisions-table-cell--decision" data-decision-tone={eligibility.tone}>
            <strong>{eligibility.label}</strong>
            <small>{eligibility.detail}</small>
          </div>
        );
      },
    }))
  ), [
    batchSelectableIdSet,
    eligibilityContext,
    interactionLocked,
    selectedRecommendationIds,
    subview,
  ]);

async function runCurrentDecisionAction(task: (context: DecisionsPageActionContext) => Promise<void>): Promise<void> {
  if (!pageOperation.hasAuthority) { setPageMessage(pageOperation.blockedReason); return; }
  const ticket = pageOperation.begin();
  if (!ticket) return;
  const context: DecisionsPageActionContext = Object.create(decisionsActionContext, {
    isOperationCurrent: { value: ticket.isCurrent },
  });
  try { await task(context); } finally { ticket.finish(); }
}

function requestSubview(nextSubview: DecisionsWorkspaceSubview, options: { allowLocked?: boolean } = {}): void {
    return requestSubviewDecisionsPageAction.call(decisionsActionContext, nextSubview, options);
  }

function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, currentSubview: DecisionsWorkspaceSubview): void {
    return handleTabKeyDownDecisionsPageAction.call(decisionsActionContext, event, currentSubview);
  }

function closeInspector(): void {
    return closeInspectorDecisionsPageAction.call(decisionsActionContext);
  }

function openDecisionInspector(row: RecommendationView): void {
    return openDecisionInspectorDecisionsPageAction.call(decisionsActionContext, row);
  }

function setBlockedFeedback(row: RecommendationView, message: string): void {
    return setBlockedFeedbackDecisionsPageAction.call(decisionsActionContext, row, message);
  }

function discoverSelectedWritableTarget(): Promise<void> {
    return runCurrentDecisionAction(context => discoverSelectedWritableTargetDecisionsPageAction.call(context));
  }

function reviewSelectedRecommendations(): Promise<void> {
    return runCurrentDecisionAction(context => reviewSelectedRecommendationsDecisionsPageAction.call(context));
  }

function generateRecommendations(): Promise<void> {
    return runCurrentDecisionAction(context => generateRecommendationsDecisionsPageAction.call(context));
  }

function bindSelectedWritableTarget(): Promise<void> {
    return runCurrentDecisionAction(context => bindSelectedWritableTargetDecisionsPageAction.call(context));
  }

function resolveSelectedReview(): Promise<void> {
    return runCurrentDecisionAction(context => resolveSelectedReviewDecisionsPageAction.call(context));
  }

function submitDecision(decision: DecisionSubmission): Promise<void> {
    return runCurrentDecisionAction(context => submitDecisionDecisionsPageAction.call(context, decision));
  }

const primaryQueueRow = orderedRows[0] ?? null;

const primaryQueueTask = decisionsPrimaryQueueTask(primaryQueueRow);

const taskTitle = primaryQueueTask?.title || (subview === 'recommendations'
    ? '生成第一批可判断建议'
    : subview === 'approval'
      ? '逐条完成待审批决定'
      : '核对已经形成的决定');

const taskTone = authorityQueryState.stale ? 'blocked' : orderedRows.length ? 'attention' : 'confirmed';

const loadedStatus = authorityQueryState.loading
    ? '正在载入权威队列'
    : authorityQueryState.stale
      ? '旧数据已标记过期'
      : `已载入 ${orderedRows.length} 条`;

const operationBlockedReason = !pageOperation.hasAuthority ? pageOperation.blockedReason
  : transactionLocked ? '正在处理当前建议，请等待本次操作完成后重试。'
  : pipelineLoading ? '正在读取当前范围数据，请等待数据载入完成后重试。'
  : '权威队列尚未同步，请点击刷新权威队列，读取成功后再决定。';
const refreshAction = {
    label: '刷新权威队列',
    busy: queue.loading,
    busyLabel: '正在刷新权威队列...',
    disabled: transactionLocked || !pageOperation.hasAuthority,
    disabledReason: operationBlockedReason,
    onClick: () => { void runCurrentDecisionAction(async () => { await loadRows({ announceWorkflow: true }); }); },
  };

const batchHandoffAction = {
    label: `复核所选 ${selectedBatchRows.length} 项`,
    busy: handoffBusy,
    busyLabel: '正在复核所选建议...',
    disabled: selectedBatchRows.length === 0 || mutationLocked,
    disabledReason: selectedBatchRows.length === 0
      ? '请先勾选证据完整、可以批准的待审批建议'
      : operationBlockedReason,
    onClick: () => { void reviewSelectedRecommendations(); },
  };

const generationAction = {
      actionId: 'generate-recommendations',
      label: '生成优化建议',
      busy: generating,
      busyLabel: '正在生成优化建议...',
      disabled: recommendationGateIssues.length > 0 || mutationLocked,
      disabledReason: configurationRequired ? '当前店铺运行配置待创建，当前业务数据尚未读取；请先打开店铺配置。' : recommendationGateIssues.length
        ? recommendationGateIssues.join('；')
        : operationBlockedReason,
      onClick: () => { void generateRecommendations(); },
    };

const primaryTaskAction = primaryQueueRow && primaryQueueTask
    ? {
        actionId: 'open-controlled-review-inspector',
        label: primaryQueueTask.actionLabel,
        disabled: interactionLocked,
        disabledReason: interactionLocked ? '正在确认最新权威队列，请稍候' : undefined,
        onClick: () => openDecisionInspector(primaryQueueRow),
      }
    : subview === 'recommendations'
      ? generationAction
      : refreshAction;
  return <>{configurationRequired && <BusinessDataConfigurationNotice />}{renderDecisionsPageView({
    selected,
    operationBlockedReason,
    subview,
    taskTitle,
    primaryQueueTask,
    subviewDefinition,
    taskTone,
    loadedStatus,
    primaryTaskAction,
    primaryQueueRow,
    generationAction,
    refreshAction,
    interactionLocked,
    requestSubview,
    handleTabKeyDown,
    tabRefs,
    counts,
    authorityQueryState,
    queue,
    pipelineError,
    pageMessage,
    selectedBatchRows,
    batchSelectableRows,
    batchHandoffAction,
    publishedRows,
    orderedRows,
    transactionLocked,
    loadRows,
    columns,
    selectedId,
    openDecisionInspector,
    selectedEligibility,
    closeInspector,
    focusReturnOverrideRef,
    selectedEvidenceSummary,
    scope,
    currentBatchId,
    mutationLocked,
    setReviewForm,
    reviewForm,
    currentRealReportSourceFiles,
    reviewBlockers,
    decisionFeedback,
    submittingReview,
    resolveSelectedReview,
    submittingDecision,
    submitDecision,
    discoveringTarget,
    discoverSelectedWritableTarget,
    targetBindingBlockers,
    submittingTargetBinding,
    bindSelectedWritableTarget,
    setApproverName,
    approverName,
    setApprovalNote,
    approvalNote,
  })}</>;
}
