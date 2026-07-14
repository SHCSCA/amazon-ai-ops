import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import {
  PageFrame,
  PriorityDataTable,
  SummaryStrip,
  TaskBanner,
  WorkbenchPanel,
  WorkspaceState,
} from '../components/workspace';
import type { PriorityDataTableColumn } from '../components/workspace';
import { ResponsiveInspector } from '../components/workspace/responsive-inspector';
import { buildDecisionEvidenceSummary } from '../evidence-display';
import { formatPercent, formatUsd } from '../formatters';
import { buildRecommendationGateIssues, resolveRecommendationBatchId } from '../recommendation-readiness';
import { realReportCoverageCount } from '../report-coverage';
import type { BusinessDataPipeline, OperationScope, RecommendationView } from '../types';
import { toUserFacingError } from '../user-facing-error';
import {
  approvalBlockers,
  approvalMissing,
  approvalSubmitBlockers,
  buildApprovalDecisionPayload,
  buildApprovalStampFeedback,
  buildRecommendationDecisionRequest,
  runApprovalWorkflowMutation,
} from './approval-page';
import {
  recommendationCanEnterFormalApproval,
  recommendationHasEvidenceBlocker,
  recommendationNeedsOperatorResolution,
  runRecommendationWorkflowMutation,
} from './recommendations-page';
import {
  DECISIONS_WORKSPACE_SUBVIEWS,
  applyDecisionsFocusHandoff,
  countDecisionsWorkspaceRows,
  decisionsWorkspaceSubviewDefinition,
  filterDecisionsWorkspaceRows,
  normalizeDecisionsFocusHandoff,
} from './decisions-workspace-model';
import type {
  DecisionsFocusHandoff,
  DecisionsWorkspaceStatus,
  DecisionsWorkspaceSubview,
} from './decisions-workspace-model';

const DECISIONS_HANDOFF_STORAGE_KEY = 'amazon-ai-ops:approval-selection';

export const DECISIONS_AUTHORITATIVE_STATUSES = [
  'pending',
  'needs_review',
  'approved',
  'rejected',
] as const satisfies readonly DecisionsWorkspaceStatus[];

export const DECISIONS_TABLE_COLUMN_DEFINITIONS = [
  { key: 'action', header: '动作', priority: 'anchor' },
  { key: 'object', header: '对象', priority: 'primary' },
  { key: 'change', header: '当前 → 建议', priority: 'primary' },
  { key: 'evidence', header: '证据', priority: 'primary' },
  { key: 'decision', header: '决策', priority: 'action' },
] as const;

type GetRecommendations = (
  filter: Record<string, unknown>,
) => Promise<unknown>;

export type DecisionEligibilityContext = {
  scope: Pick<OperationScope, 'storeName' | 'marketplaceCode'>;
  currentBatchId?: string;
  allowedSourceFiles?: string[];
  stale: boolean;
  locked?: boolean;
};

export type DecisionEligibilitySummary = {
  label: string;
  detail: string;
  tone: 'confirmed' | 'attention' | 'blocked' | 'neutral';
  canApprove: boolean;
  canReject: boolean;
  readOnly: boolean;
  blockers: string[];
};

type DecisionQueueState = {
  rows: RecommendationView[];
  loading: boolean;
  stale: boolean;
  error: string | null;
  loadedAt: string | null;
  publishedQueryKey: string | null;
};

type DecisionSubmission = 'approved' | 'rejected';

export type DecisionsLoadRequestGuard = {
  sequence: number;
  queryKey: string;
};

export type DecisionsLoadRequest = {
  sequence: number;
  queryKey: string;
};

export function decisionsQueryKey(filter: Record<string, unknown>): string {
  return [
    filter.dateFrom,
    filter.dateTo,
    filter.storeName,
    filter.marketplaceCode,
    filter.asin,
    filter.batchId,
  ].map((value) => String(value || '').trim()).join('|');
}

export function createDecisionsLoadRequestGuard(queryKey = ''): DecisionsLoadRequestGuard {
  return { sequence: 0, queryKey };
}

export function activateDecisionsQueryKey(
  guard: DecisionsLoadRequestGuard,
  queryKey: string,
): void {
  if (guard.queryKey === queryKey) return;
  guard.queryKey = queryKey;
  guard.sequence += 1;
}

export function beginDecisionsLoadRequest(
  guard: DecisionsLoadRequestGuard,
  queryKey = guard.queryKey,
): DecisionsLoadRequest | null {
  if (queryKey !== guard.queryKey) return null;
  guard.sequence += 1;
  return { sequence: guard.sequence, queryKey };
}

export function invalidateDecisionsLoadRequests(guard: DecisionsLoadRequestGuard): void {
  guard.sequence += 1;
}

export function isLatestDecisionsLoadRequest(
  guard: DecisionsLoadRequestGuard,
  request: DecisionsLoadRequest | null,
): boolean {
  return Boolean(
    request
    && guard.sequence === request.sequence
    && guard.queryKey === request.queryKey,
  );
}

export function isDecisionsQueryKeyActive(
  guard: DecisionsLoadRequestGuard,
  queryKey: string,
): boolean {
  return guard.queryKey === queryKey;
}

export function decisionsAuthorityQueryState(input: {
  publishedQueryKey: string | null;
  currentQueryKey: string;
  loading: boolean;
  stale: boolean;
}): {
  matchesCurrentQuery: boolean;
  loading: boolean;
  stale: boolean;
  mutationLocked: boolean;
} {
  const matchesCurrentQuery = Boolean(
    input.publishedQueryKey
    && input.publishedQueryKey === input.currentQueryKey,
  );
  const loading = input.loading || !matchesCurrentQuery;
  const stale = input.stale || !matchesCurrentQuery;
  return {
    matchesCurrentQuery,
    loading,
    stale,
    mutationLocked: loading || stale,
  };
}

export function decisionsRowsForPublishedQuery<T>(
  rows: readonly T[],
  publishedQueryKey: string | null,
  currentQueryKey: string,
): T[] {
  return publishedQueryKey === currentQueryKey ? [...rows] : [];
}

export const resolveDecisionsCurrentBatchId = resolveRecommendationBatchId;

export function buildDecisionsRecommendationGateIssues(input: {
  data: BusinessDataPipeline | null;
  currentBatchId?: string;
  pipelineLoading: boolean;
}): string[] {
  if (input.pipelineLoading) return ['当前范围的数据状态尚未读取完成'];
  if (!input.data) {
    return ['当前范围的数据状态不可用'];
  }
  const realReportFileCount = realReportCoverageCount(input.data.collection);
  const importedRowCount = input.data.collection.fileAudit?.importedRowCount
    ?? input.data.quant.importedRows
    ?? 0;
  return buildRecommendationGateIssues({
    requiredReportCount: 8,
    realReportFileCount,
    realReportFilesLength: input.data.collection.realReportFiles.length,
    importedRowCount,
    quantImportedRows: input.data.quant.importedRows,
    hasImportedMetrics: input.data.quant.hasImportedMetrics,
    currentBatchId: input.currentBatchId,
    collectionBlockers: input.data.collection.blockers || [],
    quantBlockers: input.data.quant.blockers || [],
  });
}

export function buildDecisionsGenerationRequest(
  scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin'>,
  currentBatchId?: string,
) {
  return {
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    batchId: currentBatchId,
    limit: 300,
  };
}

const ACTION_LABELS: Record<string, string> = {
  add_negative_broad: '添加广泛否定',
  add_negative_exact: '添加精准否定',
  add_negative_phrase: '添加词组否定',
  archive_campaign: '归档广告活动',
  create_campaign: '新建广告活动',
  lower_bid: '降低出价',
  raise_bid: '提高出价',
  pause_keyword: '暂停关键词',
  pause_target: '暂停投放对象',
  resume_target: '恢复投放对象',
  negative_keyword: '添加否定词',
  add_negative_keyword: '添加否定词',
  adjust_campaign_budget: '调整活动预算',
  increase_campaign_budget: '提高活动预算',
  decrease_campaign_budget: '降低活动预算',
  enable_keyword: '启用关键词',
};

export function decisionActionLabel(actionType: unknown): string {
  const normalized = String(actionType || '').trim();
  if (!normalized) return '待确认动作';
  return ACTION_LABELS[normalized] || normalized.replace(/_/g, ' ');
}

export function nextDecisionsTab(
  activeSubview: DecisionsWorkspaceSubview,
  key: string,
): DecisionsWorkspaceSubview | null {
  if (key === 'Home') return DECISIONS_WORKSPACE_SUBVIEWS[0];
  if (key === 'End') return DECISIONS_WORKSPACE_SUBVIEWS[DECISIONS_WORKSPACE_SUBVIEWS.length - 1];
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;

  const currentIndex = DECISIONS_WORKSPACE_SUBVIEWS.indexOf(activeSubview);
  const delta = key === 'ArrowRight' ? 1 : -1;
  const nextIndex = (
    currentIndex + delta + DECISIONS_WORKSPACE_SUBVIEWS.length
  ) % DECISIONS_WORKSPACE_SUBVIEWS.length;
  return DECISIONS_WORKSPACE_SUBVIEWS[nextIndex];
}

function asRecommendationRows(value: unknown): RecommendationView[] {
  return Array.isArray(value)
    ? value.filter((row): row is RecommendationView => Boolean(
      row
      && typeof row === 'object'
      && Number.isFinite(Number((row as RecommendationView).id)),
    ))
    : [];
}

export async function loadDecisionsAuthoritativeRows(
  getRecommendations: GetRecommendations,
  filter: Record<string, unknown>,
): Promise<RecommendationView[]> {
  const groups = await Promise.all(DECISIONS_AUTHORITATIVE_STATUSES.map(async (status) => ({
    status,
    rows: asRecommendationRows(await getRecommendations({
      ...filter,
      status,
      limit: 100,
    })).filter((row) => row.status === status),
  })));

  const merged: RecommendationView[] = [];
  const indexById = new Map<number, number>();
  for (const group of groups) {
    for (const row of group.rows) {
      const id = Number(row.id);
      const existingIndex = indexById.get(id);
      if (existingIndex === undefined) {
        indexById.set(id, merged.length);
        merged.push(row);
        continue;
      }

      const current = merged[existingIndex];
      if (Number(row.revision || 0) >= Number(current.revision || 0)) {
        merged[existingIndex] = row;
      }
    }
  }
  return merged;
}

function uniqueMessages(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
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
  const submitBlockers = approvalSubmitBlockers(
    row,
    context.scope,
    context.currentBatchId,
    context.allowedSourceFiles,
  );
  const blockers = uniqueMessages([
    ...missing,
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

  const canApprove = canEnterFormalApproval
    && !evidenceBlocked
    && !needsOperatorResolution
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

export function decisionsInteractionLocked(input: {
  loading?: boolean;
  generating?: boolean;
  handoffBusy?: boolean;
  submitting?: boolean;
}): boolean {
  return Boolean(input.loading || input.generating || input.handoffBusy || input.submitting);
}

export function selectDecisionsBatchHandoffRows(
  rows: readonly RecommendationView[],
  selectedIds: ReadonlySet<string>,
  context: DecisionEligibilityContext,
): RecommendationView[] {
  const unlockedContext = { ...context, locked: false };
  return rows.filter((row) => (
    row.status === 'pending'
    && selectedIds.has(String(row.id))
    && decisionEligibilitySummary(row, unlockedContext).canApprove
  ));
}

export function decisionsHandoffMatchesQuery(
  handoffQueryKey: string | null,
  currentQueryKey: string,
): boolean {
  return Boolean(handoffQueryKey && handoffQueryKey === currentQueryKey);
}

export function clearDecisionsHandoffStorage(
  storage?: Pick<Storage, 'removeItem'>,
): void {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);
    target?.removeItem(DECISIONS_HANDOFF_STORAGE_KEY);
  } catch {
    // Session storage is a best-effort compatibility hint only.
  }
}

export function buildDecisionsDecisionRequest(input: {
  decision: DecisionSubmission;
  approverName: string;
  approvalNote: string;
  currentBatchId?: string;
  row: RecommendationView;
  scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin'>;
}) {
  const decision = buildApprovalDecisionPayload({
    decision: input.decision,
    approverName: input.approverName,
    approvalNote: input.approvalNote,
    currentBatchId: input.currentBatchId,
    selected: input.row,
    scope: input.scope,
  });
  return buildRecommendationDecisionRequest(input.row, decision);
}

export function isDecisionsVersionConflict(caught: unknown): boolean {
  const message = toUserFacingError(caught, '提交建议决定失败');
  return /版本冲突|状态冲突|状态已变化|expectedRevision|revision/i.test(message);
}

function decisionObjectName(row: RecommendationView): string {
  return row.evidence?.searchTerm
    || row.evidence?.targeting
    || row.entityName
    || '未命名对象';
}

function decisionStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '待处理',
    needs_review: '需复核',
    approved: '已批准',
    rejected: '已拒绝',
  };
  return labels[status] || '状态未知';
}

function decisionRiskLabel(riskLevel: string): string {
  const normalized = String(riskLevel || '').toLowerCase();
  if (normalized === 'blocked' || normalized === 'critical' || normalized === 'forbidden') return '高风险阻断';
  if (normalized === 'high' || normalized === 'approval') return '高风险';
  if (normalized === 'medium') return '中风险';
  return '常规风险';
}

function readDecisionsHandoff(): DecisionsFocusHandoff | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage?.getItem(DECISIONS_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    clearDecisionsHandoffStorage();
    return normalizeDecisionsFocusHandoff(JSON.parse(raw));
  } catch {
    return null;
  }
}

function dispatchDecisionsSubview(subview: DecisionsWorkspaceSubview): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', {
    detail: { workspace: 'decisions', subview },
  }));
}

function stampTargetName(row: RecommendationView): string {
  return decisionObjectName(row);
}

function feedbackClass(tone: 'ready' | 'blocked' | 'pending'): string {
  return `decisions-feedback decisions-feedback--${tone}`;
}

export type DecisionsPageProps = {
  activeSubview: DecisionsWorkspaceSubview;
};

export function DecisionsPage({ activeSubview }: DecisionsPageProps) {
  const {
    data,
    error: pipelineError,
    loading: pipelineLoading,
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
  const [submittingDecision, setSubmittingDecision] = useState<DecisionSubmission | null>(null);
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
    () => (data?.collection.realReportFiles || []).map((file) => file.filePath).filter(Boolean),
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
  const queryKey = useMemo(() => decisionsQueryKey(queryFilter), [queryFilter]);
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
    loading: queue.loading,
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
    submitting: Boolean(submittingDecision),
  });
  const interactionLocked = transactionLocked || !authorityQueryState.matchesCurrentQuery;
  const mutationLocked = transactionLocked
    || authorityQueryState.mutationLocked
    || pipelineLoading;

  const loadRows = useCallback(async (options: {
    announceWorkflow?: boolean;
    clearMessage?: boolean;
  } = {}): Promise<RecommendationView[] | null> => {
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
        ? await runRecommendationWorkflowMutation('refresh', task)
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
      setDecisionFeedback(null);
      setPageMessage(null);
      setSelectedRecommendationIds(new Set());
    }
    // `subview` is intentionally read as the state at the time the external intent changed.
    // Internal tab handoffs already applied to the same state must keep their success message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubview]);

  useEffect(() => {
    setSelectedId(null);
    setHandoff(null);
    handoffQueryKeyRef.current = null;
    setApproverName('');
    setApprovalNote('');
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

  function requestSubview(
    nextSubview: DecisionsWorkspaceSubview,
    options: { allowLocked?: boolean } = {},
  ): void {
    if (interactionLocked && !options.allowLocked) return;
    setSubview(nextSubview);
    setSelectedId(null);
    setApproverName('');
    setApprovalNote('');
    setDecisionFeedback(null);
    setPageMessage(null);
    setSelectedRecommendationIds(new Set());
    dispatchDecisionsSubview(nextSubview);
  }

  function handleTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentSubview: DecisionsWorkspaceSubview,
  ): void {
    if (interactionLocked) return;
    const nextSubview = nextDecisionsTab(currentSubview, event.key);
    if (!nextSubview) return;
    event.preventDefault();
    requestSubview(nextSubview);
    tabRefs.current[nextSubview]?.focus();
  }

  function closeInspector(): void {
    if (interactionLocked) return;
    setSelectedId(null);
    setDecisionFeedback(null);
    setPageMessage(null);
    setApproverName('');
    setApprovalNote('');
  }

  function setBlockedFeedback(row: RecommendationView, message: string): void {
    setDecisionFeedback(buildApprovalStampFeedback({
      state: 'blocked',
      recommendationId: row.id,
      targetName: stampTargetName(row),
      message,
    }));
    setPageMessage(message);
  }

  async function reviewSelectedRecommendations(): Promise<void> {
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
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
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
      } catch {
        // Session storage is a compatibility hint only; the in-memory handoff still uses authority rows.
      }
      handoffQueryKeyRef.current = queryKey;
      setHandoff(normalizeDecisionsFocusHandoff(handoffValue));
      requestSubview('approval', { allowLocked: true });
      setPageMessage(`已重新确认并送入待审批 ${ids.length} 项；队列未过滤，首条匹配建议已置顶。`);
    } catch (caught) {
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      const message = toUserFacingError(caught, '批量复核失败');
      setSelectedRecommendationIds(new Set());
      setHandoff(null);
      handoffQueryKeyRef.current = null;
      clearDecisionsHandoffStorage();
      setPageMessage(`批量复核已停止：${message}。未切换到待审批。`);
    } finally {
      setHandoffBusy(false);
    }
  }

  async function generateRecommendations(): Promise<void> {
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
      );
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;

      reloadPipeline();
      const refreshedRows = await loadRows({ clearMessage: false });
      if (!refreshedRows || !isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;

      const generated = Math.max(0, Number(result?.generated || 0));
      const refreshed = Math.max(0, Number(result?.refreshedDuplicates || 0));
      setPageMessage(`建议生成完成：新增 ${generated} 条，刷新 ${refreshed} 条；已重新读取四个权威状态。`);
    } catch (caught) {
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      const message = toUserFacingError(caught, '生成优化建议失败');
      setPageMessage(`生成失败：${message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function submitDecision(decision: DecisionSubmission): Promise<void> {
    if (!selected || !selectedEligibility || mutationLocked) return;
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
    if (!approverName.trim()) {
      setBlockedFeedback(selected, decision === 'approved' ? '批准前必须填写审批人。' : '拒绝前必须填写处理人。');
      return;
    }
    if (decision === 'rejected' && !approvalNote.trim()) {
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
        approverName,
        approvalNote,
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
      );
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
      const refreshedRows = await loadRows({ clearMessage: false });
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
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
    } catch (caught) {
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
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
        if (refreshedRows?.some((row) => row.id === currentRow.id)) setSelectedId(currentRow.id);
      } else {
        setQueue((current) => ({ ...current, stale: true, error: message }));
      }
    } finally {
      setSubmittingDecision(null);
    }
  }

  const taskTitle = subview === 'recommendations'
    ? '先判断最需要人工处理的建议'
    : subview === 'approval'
      ? '逐条完成待审批决定'
      : '核对已经形成的决定';
  const taskTone = authorityQueryState.stale ? 'blocked' : orderedRows.length ? 'attention' : 'confirmed';
  const loadedStatus = authorityQueryState.loading
    ? '正在载入权威队列'
    : authorityQueryState.stale
      ? '旧数据已标记过期'
      : `已载入 ${orderedRows.length} 条`;
  const refreshAction = {
    label: '刷新权威队列',
    busy: queue.loading,
    busyLabel: '正在刷新权威队列...',
    disabled: transactionLocked,
    onClick: () => { void loadRows({ announceWorkflow: true }); },
  };
  const batchHandoffAction = {
    label: `复核所选 ${selectedBatchRows.length} 项`,
    busy: handoffBusy,
    busyLabel: '正在复核所选建议...',
    disabled: selectedBatchRows.length === 0 || mutationLocked,
    disabledReason: selectedBatchRows.length === 0
      ? '请先勾选证据完整、可以批准的 pending 建议'
      : undefined,
    onClick: () => { void reviewSelectedRecommendations(); },
  };
  const primaryTaskAction = subview === 'recommendations'
    ? {
      label: '生成优化建议',
      busy: generating,
      busyLabel: '正在生成优化建议...',
      disabled: recommendationGateIssues.length > 0 || mutationLocked,
      disabledReason: recommendationGateIssues.length
        ? recommendationGateIssues.join('；')
        : undefined,
      onClick: () => { void generateRecommendations(); },
    }
    : refreshAction;

  return (
    <div
      className="decisions-workspace"
      data-workspace="decisions"
      data-workspace-evidence-root="true"
      data-workspace-subview={subview}
    >
      <PageFrame
        pageId="decisions"
        title="建议与审批"
        description="在同一权威队列内判断、批准或拒绝建议。批准不等于执行；真实广告后台操作与结果回读始终是后续独立步骤。"
        task={(
          <TaskBanner
            eyebrow="当前主任务"
            title={taskTitle}
            description={`${subviewDefinition.description} 每个状态最多已载入 100 条。`}
            tone={taskTone}
            status={<span>{loadedStatus}</span>}
            meta={<ScopeText scope={scope} />}
            primaryAction={primaryTaskAction}
            secondaryActions={subview === 'recommendations'
              ? [refreshAction, batchHandoffAction]
              : undefined}
          />
        )}
        summary={(
          <SummaryStrip
            ariaLabel="建议与审批已载入摘要"
            items={[
              {
                id: 'current',
                label: '当前视图',
                value: subviewDefinition.label,
                detail: `已载入 ${orderedRows.length} 条`,
                tone: authorityQueryState.stale ? 'blocked' : 'neutral',
              },
              {
                id: 'pending',
                label: '待审批',
                value: `已载入 ${counts.approval} 条`,
                detail: 'pending 权威状态',
                tone: counts.approval ? 'attention' : 'neutral',
              },
              {
                id: 'review',
                label: '需复核',
                value: `已载入 ${publishedRows.filter((row) => row.status === 'needs_review').length} 条`,
                detail: '绝不显示批准动作',
                tone: publishedRows.some((row) => row.status === 'needs_review') ? 'attention' : 'neutral',
              },
              {
                id: 'decided',
                label: '已决策',
                value: `已载入 ${counts.decided} 条`,
                detail: '批准与拒绝只读记录',
                tone: 'neutral',
              },
            ]}
          />
        )}
      >
        <div className="decisions-workbench-layout">
          <WorkbenchPanel
          title="建议对象队列"
          description="按风险与真实花费排序；选择一行，在右侧检查器内查看完整证据并做决定。"
          status={<span>{loadedStatus}</span>}
          toolbar={(
            <div aria-label="建议与审批视图" className="decisions-tabs" role="tablist">
              {DECISIONS_WORKSPACE_SUBVIEWS.map((candidate) => {
                const definition = decisionsWorkspaceSubviewDefinition(candidate);
                const selectedTab = candidate === subview;
                return (
                  <button
                    aria-controls={`decisions-panel-${candidate}`}
                    aria-selected={selectedTab}
                    disabled={interactionLocked}
                    id={`decisions-tab-${candidate}`}
                    key={candidate}
                    onClick={() => requestSubview(candidate)}
                    onKeyDown={(event) => handleTabKeyDown(event, candidate)}
                    ref={(element) => { tabRefs.current[candidate] = element; }}
                    role="tab"
                    tabIndex={selectedTab ? 0 : -1}
                    type="button"
                  >
                    {definition.label}（已载入 {counts[candidate]}）
                  </button>
                );
              })}
            </div>
          )}
          footer={(
            <div className="decisions-workbench-footer">
              <span>每个权威状态最多已载入 100 条；数量不是全库总数。</span>
              {authorityQueryState.matchesCurrentQuery && queue.loadedAt && (
                <span>最近读取 {new Date(queue.loadedAt).toLocaleTimeString('zh-CN')}</span>
              )}
            </div>
          )}
        >
          <div
            aria-labelledby={`decisions-tab-${subview}`}
            id={`decisions-panel-${subview}`}
            role="tabpanel"
            tabIndex={0}
          >
            {(queue.error || pipelineError || pageMessage) && (
              <div
                aria-live="polite"
                className={`decisions-page-message${authorityQueryState.stale ? ' decisions-page-message--stale' : ''}`}
                role="status"
              >
                {authorityQueryState.stale && <strong>数据已过期，所有决定已锁定。</strong>}
                <span>{pageMessage || queue.error || pipelineError}</span>
              </div>
            )}
            {subview === 'recommendations' && (
              <div
                aria-live="polite"
                className="decisions-selection-status"
                role="status"
              >
                已选 {selectedBatchRows.length}/{batchSelectableRows.length} 条可审批建议
              </div>
            )}
            {queue.loading && !publishedRows.length ? (
              <WorkspaceState kind="loading" description="正在一次读取 pending、needs_review、approved、rejected 四个权威状态。" />
            ) : !orderedRows.length ? (
              <WorkspaceState
                kind={authorityQueryState.stale ? 'error' : 'empty'}
                description={authorityQueryState.stale
                  ? '权威队列读取失败，旧数据不可用于决定。'
                  : `当前范围没有${subviewDefinition.label}建议。`}
                action={authorityQueryState.stale ? {
                  label: '重新读取权威队列',
                  disabled: transactionLocked,
                  onClick: () => { void loadRows({ announceWorkflow: true }); },
                } : undefined}
              />
            ) : (
              <PriorityDataTable
                caption={`${subviewDefinition.label}建议对象，已载入 ${orderedRows.length} 条`}
                rows={orderedRows}
                columns={columns}
                getRowKey={(row) => row.id}
                selectedRowKey={selectedId}
                onRowSelect={(row) => {
                  if (interactionLocked) return;
                  setSelectedId(row.id);
                  setApproverName('');
                  setApprovalNote('');
                  setDecisionFeedback(null);
                  setPageMessage(null);
                }}
                rowAriaLabel={(row) => `${decisionActionLabel(row.actionType)}，${decisionObjectName(row)}，${decisionStatusLabel(row.status)}；按 Enter 或空格查看详情`}
              />
            )}
          </div>
          </WorkbenchPanel>

          <ResponsiveInspector
        open={Boolean(selected)}
        title={selected ? `#${selected.id} · ${decisionObjectName(selected)}` : '建议详情'}
        description={selectedEligibility?.readOnly
          ? selectedEligibility.detail
          : '先核对动作、真实证据与阻断项，再形成决定。批准不等于执行。'}
        busy={interactionLocked}
        dismissDisabled={interactionLocked}
        onClose={closeInspector}
        resolveFocusReturnTarget={(trigger) => {
          const override = focusReturnOverrideRef.current;
          focusReturnOverrideRef.current = null;
          return override ?? trigger;
        }}
      >
        {selected && selectedEligibility && (
          <div className="decisions-inspector-content">
            <section aria-labelledby="decisions-inspector-summary-title">
              <h3 id="decisions-inspector-summary-title">核心判断</h3>
              <dl className="decisions-inspector-summary">
                <div><dt>动作</dt><dd>{decisionActionLabel(selected.actionType)}</dd></div>
                <div><dt>对象</dt><dd>{decisionObjectName(selected)}</dd></div>
                <div><dt>当前 → 建议</dt><dd>{selected.currentValue || '-'} → {selected.recommendedValue || '-'}</dd></div>
                <div><dt>花费 / ACOS</dt><dd>{formatUsd(selected.cost)} / {formatPercent(Number(selected.acos || 0) * 100)}</dd></div>
                <div><dt>决策资格</dt><dd>{selectedEligibility.label}</dd></div>
              </dl>
              <p>{selected.reason || '没有补充业务理由。'}</p>
            </section>

            <section aria-labelledby="decisions-inspector-evidence-title">
              <h3 id="decisions-inspector-evidence-title">证据与风险</h3>
              <p><strong>{selectedEvidenceSummary.statusLabel}：</strong>{selectedEvidenceSummary.headline}</p>
              <p>{selectedEvidenceSummary.evidenceSummary}</p>
              {selectedEvidenceSummary.reasons.length > 0 && (
                <ul>{selectedEvidenceSummary.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              )}
              {selectedEligibility.blockers.length > 0 && (
                <div className="decisions-blockers">
                  <strong>当前阻断</strong>
                  <ul>{selectedEligibility.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                </div>
              )}
            </section>

            {selectedEligibility.readOnly ? (
              <section aria-label="只读决定状态" className="decisions-readonly-decision">
                <strong>{selected.status === 'approved' ? '已批准，尚不代表已执行。' : '已拒绝，当前决定只读。'}</strong>
                <p>{selectedEligibility.detail}</p>
              </section>
            ) : (
              <section aria-labelledby="decisions-inspector-form-title">
                <h3 id="decisions-inspector-form-title">人工决定</h3>
                <div className="decisions-decision-form">
                  <label>
                    <span>{selected.status === 'needs_review' ? '处理人' : '审批人 / 处理人'}</span>
                    <input
                      autoComplete="name"
                      disabled={mutationLocked}
                      onChange={(event) => setApproverName(event.target.value)}
                      placeholder="填写姓名"
                      value={approverName}
                    />
                  </label>
                  <label>
                    <span>审批备注 / 拒绝原因</span>
                    <textarea
                      disabled={mutationLocked}
                      onChange={(event) => setApprovalNote(event.target.value)}
                      placeholder="拒绝时必须填写具体原因"
                      rows={4}
                      value={approvalNote}
                    />
                  </label>
                </div>
                {decisionFeedback && (
                  <div className={feedbackClass(decisionFeedback.tone)} role="status" aria-live="polite">
                    <strong>{decisionFeedback.title}</strong>
                    <span>{decisionFeedback.detail}</span>
                  </div>
                )}
                <div aria-label="建议决定动作" className="decisions-decision-actions" role="group">
                  {selected.status === 'pending' && (
                    <button
                      aria-busy={submittingDecision === 'approved' || undefined}
                      className="primary-button"
                      disabled={!selectedEligibility.canApprove || mutationLocked}
                      onClick={() => { void submitDecision('approved'); }}
                      type="button"
                    >
                      {submittingDecision === 'approved' ? '处理中...' : '批准，进入结果核对'}
                    </button>
                  )}
                  <button
                    aria-busy={submittingDecision === 'rejected' || undefined}
                    className="secondary-button danger-button"
                    disabled={!selectedEligibility.canReject || mutationLocked}
                    onClick={() => { void submitDecision('rejected'); }}
                    type="button"
                  >
                    {submittingDecision === 'rejected' ? '处理中...' : '拒绝'}
                  </button>
                </div>
              </section>
            )}

            <details className="decisions-technical-disclosure">
              <summary>
                <span>来源与技术明细</span>
                <small>按需展开</small>
              </summary>
              <div className="decisions-technical-details-body">
                <dl className="decisions-technical-details">
                  <div><dt>广告活动</dt><dd>{selected.evidence?.campaignName || '-'}</dd></div>
                  <div><dt>广告组</dt><dd>{selected.evidence?.adGroupName || '-'}</dd></div>
                  <div><dt>来源批次</dt><dd>{selected.evidence?.batchId || '-'}</dd></div>
                  <div><dt>来源行</dt><dd>{selected.evidence?.sourceRow || '-'}</dd></div>
                  <div><dt>来源文件</dt><dd>{selected.evidence?.sourceFiles?.join('；') || '-'}</dd></div>
                  <div><dt>AI 来源</dt><dd>{selected.evidence?.aiModel || selected.evidence?.aiStrategySource || '-'}</dd></div>
                  <div><dt>规则 / AI 理由</dt><dd>{selected.evidence?.decisionReasons?.join('；') || selected.reason || '-'}</dd></div>
                </dl>
              </div>
            </details>
          </div>
        )}
          </ResponsiveInspector>
        </div>
      </PageFrame>
    </div>
  );
}
