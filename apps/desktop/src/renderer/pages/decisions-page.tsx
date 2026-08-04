import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ActionRecommendation,
  BindRecommendationWritableTargetRequest,
  BindRecommendationWritableTargetResult,
  ResolveRecommendationReviewRequest,
  ResolveRecommendationReviewResult,
  WritableAdEntityType,
  WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import { getRecommendationApprovalBlockers as getSharedRecommendationApprovalBlockers } from '@amazon-ai-ops/rules-engine';
import { useBusinessDataPipeline } from '../components/business-data';
import {
  PageFrame,
  PriorityDataTable,
  TaskBanner,
  WorkbenchPanel,
  WorkspaceState,
} from '../components/workspace';
import type { PriorityDataTableColumn } from '../components/workspace';
import { ResponsiveInspector } from '../components/workspace/responsive-inspector';
import { buildDecisionEvidenceSummary } from '../evidence-display';
import { formatPercent, formatUsd } from '../formatters';
import { buildRecommendationGateIssues, resolveRecommendationBatchId } from '../recommendation-readiness';
import { importedReportTypeCoverageCount, realReportCoverageCount } from '../report-coverage';
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
  const importedReportTypeCount = importedReportTypeCoverageCount(input.data.collection);
  const importedRowCount = input.data.collection.fileAudit?.importedRowCount
    ?? input.data.quant.importedRows
    ?? 0;
  return buildRecommendationGateIssues({
    requiredReportCount: 8,
    realReportFileCount,
    realReportFilesLength: input.data.collection.realReportFiles.length,
    importedReportTypeCount,
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

export type DecisionsPrimaryQueueTask = {
  rowId: number;
  title: string;
  description: string;
  actionLabel: string;
};

export function decisionsPrimaryQueueTask(
  row: RecommendationView | null | undefined,
): DecisionsPrimaryQueueTask | null {
  if (!row) return null;
  const objectName = decisionObjectName(row);
  const actionName = decisionActionLabel(row.actionType);

  if (row.status === 'needs_review') {
    return {
      rowId: Number(row.id),
      title: '先处理首条需人工复核建议',
      description: `${actionName} · ${objectName}。先核对真实证据与唯一 Ads 对象，再决定是否回到待审批。`,
      actionLabel: '复核首条建议与 Ads 对象',
    };
  }

  if (row.status === 'pending' && !row.evidence?.writableTarget) {
    return {
      rowId: Number(row.id),
      title: '先核验首条建议的 Ads 对象',
      description: `${actionName} · ${objectName}。先绑定当前建议对应的唯一 Ads 对象；核验不会批准建议，也不会执行 Ads。`,
      actionLabel: '核验首条 Ads 对象',
    };
  }

  if (row.status === 'pending') {
    return {
      rowId: Number(row.id),
      title: '先完成首条待审批判断',
      description: `${actionName} · ${objectName}。核对证据、对象与版本后，再显式批准或拒绝。`,
      actionLabel: '打开首条待审批建议',
    };
  }

  return {
    rowId: Number(row.id),
    title: '查看首条已决策记录',
    description: `${actionName} · ${objectName}。当前记录只读；批准不等于已经执行。`,
    actionLabel: '查看首条决定',
  };
}

export function buildDecisionsTargetBindingFeedback(
  recommendationId: number,
  targetName: string,
): ReturnType<typeof buildApprovalStampFeedback> {
  return {
    label: '仍待审批',
    title: `对象已核验 · 仍待审批 #${recommendationId}`,
    detail: `${targetName} 已写入不可覆盖的对象绑定审计；建议仍保持待审批，尚未批准，也未执行 Ads。`,
    tone: 'ready',
  };
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

function decisionsPolicyEntityType(row: RecommendationView): ActionRecommendation['entityType'] {
  const entityType = String(row.entityType || row.evidence?.matchType || '').trim();
  if (entityType === 'search_term' || entityType === 'campaign' || entityType === 'ad_group') {
    return entityType;
  }
  return 'target';
}

function decisionsPolicyStatus(row: RecommendationView): ActionRecommendation['status'] {
  const status = String(row.status || '').trim();
  return ['pending', 'needs_review', 'approved', 'rejected', 'executed', 'expired'].includes(status)
    ? status as ActionRecommendation['status']
    : 'expired';
}

function decisionsPolicyOwnershipBlockers(row: RecommendationView): string[] {
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

function decisionsPolicyRecommendation(
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

export type DecisionsReviewFormState = {
  reviewedBy: string;
  rationale: string;
  entityType: WritableAdEntityType | '';
  entityId: string;
  sourceFile: string;
  sourceRow: string;
  identitySource: 'ads_ui' | 'ads_api' | '';
  identityProofPath: string;
  verificationNote: string;
};

export function createDecisionsReviewFormState(
  row?: RecommendationView | null,
): DecisionsReviewFormState {
  const entityType = ['keyword', 'auto_targeting', 'product_targeting'].includes(String(row?.entityType || ''))
    ? row?.entityType as WritableAdEntityType
    : '';
  const evidenceSourceFiles = row?.evidence?.sourceFiles || [];
  const matchingSourceFile = evidenceSourceFiles.length === 1 ? evidenceSourceFiles[0] : '';
  return {
    reviewedBy: '',
    rationale: '',
    entityType,
    // Recommendation entity IDs may be synthetic. Never prefill an authority ID.
    entityId: '',
    sourceFile: matchingSourceFile,
    // The writable Ads object can come from a different report row than the recommendation.
    // Require the operator to enter that row explicitly instead of inheriting sourceRow.
    sourceRow: '',
    identitySource: 'ads_ui',
    identityProofPath: '',
    verificationNote: '',
  };
}

export function buildDecisionsReviewRequest(input: {
  row: RecommendationView;
  scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin'>;
  currentBatchId?: string;
  form: DecisionsReviewFormState;
}): ResolveRecommendationReviewRequest {
  const trim = (value: unknown) => String(value ?? '').trim();
  return {
    recommendationId: input.row.id,
    expectedRevision: input.row.revision,
    scope: {
      dateFrom: trim(input.scope.dateFrom),
      dateTo: trim(input.scope.dateTo),
      storeName: trim(input.scope.storeName),
      marketplaceCode: trim(input.scope.marketplaceCode),
      asin: trim(input.scope.asin),
      batchId: trim(input.currentBatchId),
    },
    review: {
      reviewedBy: trim(input.form.reviewedBy),
      rationale: trim(input.form.rationale),
      writableTarget: {
        entityType: input.form.entityType as WritableAdEntityType,
        entityId: trim(input.form.entityId),
        sourceFile: trim(input.form.sourceFile),
        sourceRow: Number(input.form.sourceRow),
        identitySource: input.form.identitySource as 'ads_ui' | 'ads_api',
        identityProofPath: trim(input.form.identityProofPath),
        verificationNote: trim(input.form.verificationNote),
      },
    },
  };
}

export function buildDecisionsTargetBindingRequest(input: {
  row: RecommendationView;
  scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin'>;
  currentBatchId?: string;
  form: DecisionsReviewFormState;
}): BindRecommendationWritableTargetRequest {
  const trim = (value: unknown) => String(value ?? '').trim();
  return {
    recommendationId: input.row.id,
    expectedRevision: input.row.revision,
    scope: {
      dateFrom: trim(input.scope.dateFrom),
      dateTo: trim(input.scope.dateTo),
      storeName: trim(input.scope.storeName),
      marketplaceCode: trim(input.scope.marketplaceCode),
      asin: trim(input.scope.asin),
      batchId: trim(input.currentBatchId),
    },
    binding: {
      boundBy: trim(input.form.reviewedBy),
      note: trim(input.form.rationale),
      writableTarget: {
        entityType: input.form.entityType as WritableAdEntityType,
        entityId: trim(input.form.entityId),
        sourceFile: trim(input.form.sourceFile),
        sourceRow: Number(input.form.sourceRow),
        identitySource: input.form.identitySource as 'ads_ui' | 'ads_api',
        identityProofPath: trim(input.form.identityProofPath),
        verificationNote: trim(input.form.verificationNote),
      },
    },
  };
}

type DecisionsWritableTargetFormInput = {
  row: RecommendationView;
  scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin'>;
  currentBatchId?: string;
  allowedSourceFiles?: string[];
  form: DecisionsReviewFormState;
};

function decisionsWritableTargetFormBlockers(input: DecisionsWritableTargetFormInput): string[] {
  const blockers: string[] = [];
  const trim = (value: unknown) => String(value ?? '').trim();
  const normalizePath = (value: unknown) => trim(value).replace(/\\/g, '/').toLowerCase();
  const supportedTypes = new Set<WritableAdEntityType>(['keyword', 'auto_targeting', 'product_targeting']);
  const batchId = trim(input.currentBatchId);
  const evidenceBatchId = trim(input.row.evidence?.batchId);
  const asin = trim(input.scope.asin).toUpperCase();
  const evidenceAsin = trim(input.row.evidence?.asin).toUpperCase();
  const allowedFiles = new Set((input.allowedSourceFiles || []).map(normalizePath).filter(Boolean));

  if (
    !trim(input.scope.dateFrom)
    || !trim(input.scope.dateTo)
    || !trim(input.scope.storeName)
    || !trim(input.scope.marketplaceCode)
    || !asin
    || !batchId
    || batchId !== evidenceBatchId
    || (evidenceAsin && evidenceAsin !== asin)
  ) {
    blockers.push('建议与当前锁定范围或批次不一致');
  }
  if (!Number.isInteger(input.row.revision) || input.row.revision < 0) {
    blockers.push('缺少当前建议版本');
  }
  const evidenceSourceFiles = input.row.evidence?.sourceFiles || [];
  if (
    evidenceSourceFiles.length === 0
    || evidenceSourceFiles.some((sourceRef) => !allowedFiles.has(normalizePath(sourceRef)))
  ) {
    blockers.push('建议来源证据不属于当前锁定批次');
    blockers.push('建议来源未能与不透明报表工件对应（旧路径证据已阻断）');
  }
  const evidenceSourceRow = Number(input.row.evidence?.sourceRow);
  if (!Number.isInteger(evidenceSourceRow) || evidenceSourceRow <= 0) {
    blockers.push('建议缺少可追溯的原始来源行');
  }
  if (!trim(input.form.reviewedBy)) blockers.push('缺少复核人');
  if (!trim(input.form.rationale)) blockers.push('缺少复核依据');

  if (!input.form.entityType || !supportedTypes.has(input.form.entityType)) {
    blockers.push('缺少可写 Ads 对象类型');
  }
  const entityId = trim(input.form.entityId);
  if (!entityId) blockers.push('缺少可写 Ads 对象 ID');
  if (entityId && input.row.entityId && entityId.toLowerCase() === trim(input.row.entityId).toLowerCase()) {
    blockers.push('可写对象 ID 仍是建议生成用的合成标识，无法唯一定位 Ads 对象');
  }

  const sourceFile = normalizePath(input.form.sourceFile);
  if (!sourceFile || !allowedFiles.has(sourceFile)) {
    blockers.push('可写对象来源文件不属于当前锁定批次');
    blockers.push('可写对象来源未能与不透明报表工件对应');
  }
  const sourceRow = Number(input.form.sourceRow);
  if (!Number.isInteger(sourceRow) || sourceRow <= 0) blockers.push('缺少唯一来源行');
  if (!['ads_ui', 'ads_api'].includes(input.form.identitySource)) blockers.push('缺少 Ads 身份核验来源');
  if (!trim(input.form.identityProofPath)) blockers.push('缺少 Ads 身份核验证据路径');
  if (!trim(input.form.verificationNote)) blockers.push('缺少 Ads 身份核验说明');
  return blockers;
}

export function decisionsReviewBlockers(input: {
  row: RecommendationView;
  scope: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'asin'>;
  currentBatchId?: string;
  allowedSourceFiles?: string[];
  form: DecisionsReviewFormState;
}): string[] {
  const blockers = decisionsWritableTargetFormBlockers(input);
  if (input.row.status !== 'needs_review') blockers.push('当前建议不在需复核状态');
  if (input.row.actionType !== 'lower_bid' || input.row.evidence?.quantReviewRequired !== true) {
    blockers.push('当前仅支持规则量化触发的降低竞价复核');
  }
  return Array.from(new Set(blockers));
}

export function decisionsTargetBindingBlockers(input: DecisionsWritableTargetFormInput): string[] {
  const blockers = decisionsWritableTargetFormBlockers(input);
  if (input.row.status !== 'pending') blockers.push('当前建议不在待审批状态');
  if (input.row.actionType !== 'lower_bid') blockers.push('当前入口仅支持降低竞价建议');
  if (input.row.evidence?.quantReviewRequired === true) {
    blockers.push('需量化复核的建议必须先走受控复核');
  }
  if (input.row.evidence?.writableTarget || input.row.evidence?.writableTargetBinding) {
    blockers.push('当前建议已存在 Ads 可写对象或绑定审计');
  }
  blockers.push(
    ...approvalMissing(
      input.row,
      input.scope,
      input.currentBatchId,
      input.allowedSourceFiles,
    ).filter((label) => label !== 'Ads 可写对象'),
    ...approvalBlockers(input.row),
  );
  return Array.from(new Set(blockers));
}

function sameDecisionsWritableTarget(
  left: WritableAdTargetEvidence | undefined,
  right: WritableAdTargetEvidence | undefined,
): boolean {
  if (!left || !right) return false;
  const text = (value: unknown) => String(value ?? '').trim().toLowerCase();
  const file = (value: unknown) => text(value).replace(/\\/g, '/');
  return left.entityType === right.entityType
    && text(left.entityId) === text(right.entityId)
    && text(left.entityName) === text(right.entityName)
    && text(left.campaignName) === text(right.campaignName)
    && text(left.adGroupName) === text(right.adGroupName)
    && text(left.metricDate) === text(right.metricDate)
    && file(left.sourceFile) === file(right.sourceFile)
    && Number(left.sourceRow) === Number(right.sourceRow)
    && left.identitySource === right.identitySource
    && text(left.verifiedBy) === text(right.verifiedBy)
    && Date.parse(String(left.verifiedAt || '')) === Date.parse(String(right.verifiedAt || ''))
    && text(left.verificationNote) === text(right.verificationNote)
    && file(left.identityProofPath) === file(right.identityProofPath);
}

function sameDecisionsTargetBindingScope(
  left: BindRecommendationWritableTargetRequest['scope'] | undefined,
  right: BindRecommendationWritableTargetRequest['scope'] | undefined,
): boolean {
  if (!left || !right) return false;
  const text = (value: unknown) => String(value ?? '').trim();
  return text(left.dateFrom) === text(right.dateFrom)
    && text(left.dateTo) === text(right.dateTo)
    && text(left.storeName) === text(right.storeName)
    && text(left.marketplaceCode) === text(right.marketplaceCode)
    && text(left.asin) === text(right.asin)
    && text(left.batchId) === text(right.batchId);
}

function sameDecisionsSourceFiles(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const file = (value: unknown) => String(value ?? '').trim().replace(/\\/g, '/').toLowerCase();
  return left.every((value, index) => file(value) === file(right[index]));
}

function decisionsTargetMatchesBindingRequest(
  target: WritableAdTargetEvidence | undefined,
  request: BindRecommendationWritableTargetRequest,
): boolean {
  if (!target) return false;
  const requested = request.binding.writableTarget;
  const text = (value: unknown) => String(value ?? '').trim();
  const file = (value: unknown) => text(value).replace(/\\/g, '/').toLowerCase();
  return target.entityType === requested.entityType
    && text(target.entityId) === text(requested.entityId)
    && file(target.sourceFile) === file(requested.sourceFile)
    && Number(target.sourceRow) === Number(requested.sourceRow)
    && target.identitySource === requested.identitySource
    && file(target.identityProofPath) === file(requested.identityProofPath)
    && text(target.verificationNote) === text(requested.verificationNote)
    && text(target.verifiedBy) === text(request.binding.boundBy);
}

function decisionsTargetMatchesRecommendationEvidence(
  row: RecommendationView,
  target: WritableAdTargetEvidence,
): boolean {
  const text = (value: unknown) => String(value ?? '').trim().toLowerCase();
  const expectedEntityName = row.evidence?.searchTerm
    || row.evidence?.targeting
    || row.entityName;
  return text(target.entityName) === text(expectedEntityName)
    && text(target.campaignName) === text(row.evidence?.campaignName)
    && text(target.adGroupName) === text(row.evidence?.adGroupName)
    && text(target.metricDate) === text(row.evidence?.date);
}

function decisionsTargetMatchesReviewRequest(
  target: WritableAdTargetEvidence | undefined,
  request: ResolveRecommendationReviewRequest,
): boolean {
  if (!target) return false;
  const requested = request.review.writableTarget;
  const text = (value: unknown) => String(value ?? '').trim();
  const file = (value: unknown) => text(value).replace(/\\/g, '/').toLowerCase();
  return target.entityType === requested.entityType
    && text(target.entityId) === text(requested.entityId)
    && file(target.sourceFile) === file(requested.sourceFile)
    && Number(target.sourceRow) === Number(requested.sourceRow)
    && target.identitySource === requested.identitySource
    && file(target.identityProofPath) === file(requested.identityProofPath)
    && text(target.verificationNote) === text(requested.verificationNote)
    && text(target.verifiedBy) === request.review.reviewedBy;
}

function hasOnlyQuantReviewBlocker(value: unknown): boolean {
  return Array.isArray(value)
    && value.length === 1
    && value[0] === 'quant_review_required';
}

export function isConfirmedDecisionsReviewResolution(
  submittedRow: RecommendationView,
  request: ResolveRecommendationReviewRequest,
  result: ResolveRecommendationReviewResult,
  refreshedRow: RecommendationView | undefined,
): boolean {
  const resolution = refreshedRow?.evidence?.reviewResolution;
  const target = refreshedRow?.evidence?.writableTarget;
  if (!refreshedRow || !resolution || !target) return false;
  return submittedRow.id === request.recommendationId
    && submittedRow.id === result.recommendationId
    && submittedRow.status === 'needs_review'
    && submittedRow.revision === request.expectedRevision
    && submittedRow.evidence?.quantReviewRequired === true
    && result.ok === true
    && result.previousStatus === 'needs_review'
    && result.status === 'pending'
    && result.revision === request.expectedRevision + 1
    && hasOnlyQuantReviewBlocker(result.resolvedBlockers)
    && refreshedRow.id === result.recommendationId
    && refreshedRow.status === 'pending'
    && refreshedRow.revision === result.revision
    && resolution.schemaVersion === 1
    && resolution.fromStatus === 'needs_review'
    && resolution.fromRevision === request.expectedRevision
    && resolution.resolvedRevision === request.expectedRevision + 1
    && resolution.resolvedRevision === result.revision
    && Date.parse(resolution.reviewedAt) === Date.parse(result.reviewedAt)
    && Date.parse(target.verifiedAt) === Date.parse(result.reviewedAt)
    && resolution.reviewedBy === request.review.reviewedBy
    && resolution.rationale === request.review.rationale
    && hasOnlyQuantReviewBlocker(resolution.resolvedBlockers)
    && sameDecisionsTargetBindingScope(resolution.scope, request.scope)
    && String(resolution.metricSource?.batchId || '').trim() === request.scope.batchId
    && String(resolution.metricSource?.batchId || '').trim() === String(submittedRow.evidence?.batchId || '').trim()
    && String(resolution.metricSource?.batchId || '').trim() === String(refreshedRow.evidence?.batchId || '').trim()
    && sameDecisionsSourceFiles(resolution.metricSource?.sourceFiles, submittedRow.evidence?.sourceFiles)
    && sameDecisionsSourceFiles(resolution.metricSource?.sourceFiles, refreshedRow.evidence?.sourceFiles)
    && Number(resolution.metricSource?.sourceRow) === Number(submittedRow.evidence?.sourceRow)
    && Number(resolution.metricSource?.sourceRow) === Number(refreshedRow.evidence?.sourceRow)
    && decisionsTargetMatchesReviewRequest(target, request)
    && decisionsTargetMatchesRecommendationEvidence(submittedRow, target)
    && decisionsTargetMatchesRecommendationEvidence(refreshedRow, target)
    && sameDecisionsWritableTarget(resolution.writableTarget, target);
}

export function isConfirmedDecisionsTargetBinding(
  row: RecommendationView | undefined,
  result: BindRecommendationWritableTargetResult,
  request: BindRecommendationWritableTargetRequest,
): boolean {
  const binding = row?.evidence?.writableTargetBinding;
  const target = row?.evidence?.writableTarget;
  if (!row || !binding || !target) return false;
  return result.ok === true
    && result.status === 'pending'
    && request.recommendationId === result.recommendationId
    && row.id === result.recommendationId
    && row.status === 'pending'
    && row.revision === result.revision
    && binding.schemaVersion === 1
    && binding.fromRevision === request.expectedRevision
    && binding.boundRevision === request.expectedRevision + 1
    && binding.boundRevision === result.revision
    && Date.parse(binding.boundAt) === Date.parse(result.boundAt)
    && Date.parse(target.verifiedAt) === Date.parse(result.boundAt)
    && sameDecisionsTargetBindingScope(binding.scope, request.scope)
    && String(binding.metricSource?.batchId || '').trim() === request.scope.batchId
    && String(binding.metricSource?.batchId || '').trim() === String(row.evidence?.batchId || '').trim()
    && sameDecisionsSourceFiles(binding.metricSource?.sourceFiles, row.evidence?.sourceFiles)
    && Number(binding.metricSource?.sourceRow) === Number(row.evidence?.sourceRow)
    && String(binding.boundBy || '').trim() === request.binding.boundBy
    && String(binding.note || '').trim() === request.binding.note
    && decisionsTargetMatchesBindingRequest(target, request)
    && decisionsTargetMatchesRecommendationEvidence(row, target)
    && sameDecisionsWritableTarget(binding.writableTarget, target);
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

function DecisionsWritableTargetForm(props: {
  disabled: boolean;
  form: DecisionsReviewFormState;
  mode: 'binding' | 'review';
  sourceFiles: string[];
  setForm: React.Dispatch<React.SetStateAction<DecisionsReviewFormState>>;
}) {
  const { disabled, form, mode, setForm, sourceFiles } = props;
  return (
    <fieldset className="decisions-review-form" disabled={disabled}>
      <legend>{mode === 'review' ? '人工复核与 Ads 可写对象身份' : 'Ads 可写对象身份核验'}</legend>
      <label>
        <span>{mode === 'review' ? '复核人' : '核验人'}</span>
        <input
          autoComplete="name"
          onChange={(event) => setForm((current) => ({
            ...current,
            reviewedBy: event.target.value,
          }))}
          placeholder="填写姓名"
          value={form.reviewedBy}
        />
      </label>
      <label>
        <span>{mode === 'review' ? '复核依据 / 拒绝原因' : '对象绑定说明'}</span>
        <textarea
          onChange={(event) => setForm((current) => ({
            ...current,
            rationale: event.target.value,
          }))}
          placeholder={mode === 'review'
            ? '说明如何核对 Ads 对象；拒绝时写明具体原因'
            : '说明为何该 Ads 对象与当前建议唯一对应'}
          rows={3}
          value={form.rationale}
        />
      </label>
      <label>
        <span>可写对象类型</span>
        <select
          onChange={(event) => setForm((current) => ({
            ...current,
            entityType: event.target.value as DecisionsReviewFormState['entityType'],
          }))}
          value={form.entityType}
        >
          <option value="">请选择唯一类型</option>
          <option value="keyword">关键词</option>
          <option value="auto_targeting">自动投放</option>
          <option value="product_targeting">商品投放</option>
        </select>
      </label>
      <label>
        <span>Ads 对象 ID</span>
        <input
          autoComplete="off"
          onChange={(event) => setForm((current) => ({
            ...current,
            entityId: event.target.value,
          }))}
          placeholder="填写 Ads UI / API 中的真实对象 ID"
          value={form.entityId}
        />
      </label>
      <label>
        <span>来源文件</span>
        <select
          onChange={(event) => setForm((current) => ({
            ...current,
            sourceFile: event.target.value,
          }))}
          value={form.sourceFile}
        >
          <option value="">请选择当前批次报表</option>
          {sourceFiles.map((sourceRef) => (
            <option key={sourceRef} value={sourceRef}>{sourceRef}</option>
          ))}
        </select>
      </label>
      <label>
        <span>唯一来源行</span>
        <input
          inputMode="numeric"
          min="1"
          onChange={(event) => setForm((current) => ({
            ...current,
            sourceRow: event.target.value,
          }))}
          placeholder="例如 611"
          step="1"
          type="number"
          value={form.sourceRow}
        />
      </label>
      <label>
        <span>身份核验来源</span>
        <select
          onChange={(event) => setForm((current) => ({
            ...current,
            identitySource: event.target.value as DecisionsReviewFormState['identitySource'],
          }))}
          value={form.identitySource}
        >
          <option value="ads_ui">Ads UI</option>
          <option value="ads_api">Ads API</option>
        </select>
      </label>
      <label className="decisions-review-form__wide">
        <span>身份核验证据路径</span>
        <input
          autoComplete="off"
          onChange={(event) => setForm((current) => ({
            ...current,
            identityProofPath: event.target.value,
          }))}
          placeholder="填写本地截图、JSON 或导出证据的完整路径"
          value={form.identityProofPath}
        />
      </label>
      <label className="decisions-review-form__wide">
        <span>身份核验说明</span>
        <textarea
          onChange={(event) => setForm((current) => ({
            ...current,
            verificationNote: event.target.value,
          }))}
          placeholder="说明活动、广告组、对象名称与 ID 的核对过程"
          rows={3}
          value={form.verificationNote}
        />
      </label>
    </fieldset>
  );
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
  const [reviewForm, setReviewForm] = useState<DecisionsReviewFormState>(
    () => createDecisionsReviewFormState(),
  );
  const [submittingDecision, setSubmittingDecision] = useState<DecisionSubmission | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [submittingTargetBinding, setSubmittingTargetBinding] = useState(false);
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
    submitting: Boolean(submittingDecision) || submittingReview || submittingTargetBinding,
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
      setReviewForm(createDecisionsReviewFormState());
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
    setReviewForm(createDecisionsReviewFormState());
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
    setReviewForm(createDecisionsReviewFormState());
  }

  function openDecisionInspector(row: RecommendationView): void {
    if (interactionLocked) return;
    setSelectedId(row.id);
    setApproverName('');
    setApprovalNote('');
    setReviewForm(createDecisionsReviewFormState(row));
    setDecisionFeedback(null);
    setPageMessage(null);
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

  async function bindSelectedWritableTarget(): Promise<void> {
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
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;

      const refreshedRows = await loadRows({ clearMessage: false });
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
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
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
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
        if (refreshedRows?.some((row) => row.id === currentRow.id)) setSelectedId(currentRow.id);
      }
    } finally {
      setSubmittingTargetBinding(false);
    }
  }

  async function resolveSelectedReview(): Promise<void> {
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
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;

      const refreshedRows = await loadRows({ clearMessage: false });
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
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
      if (!isDecisionsQueryKeyActive(loadRequestGuardRef.current, operationQueryKey)) return;
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
        if (refreshedRows?.some((row) => row.id === currentRow.id)) setSelectedId(currentRow.id);
      }
    } finally {
      setSubmittingReview(false);
    }
  }

  async function submitDecision(decision: DecisionSubmission): Promise<void> {
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
      setReviewForm(createDecisionsReviewFormState());
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
      ? '请先勾选证据完整、可以批准的待审批建议'
      : undefined,
    onClick: () => { void reviewSelectedRecommendations(); },
  };
  const generationAction = {
      actionId: 'generate-recommendations',
      label: '生成优化建议',
      busy: generating,
      busyLabel: '正在生成优化建议...',
      disabled: recommendationGateIssues.length > 0 || mutationLocked,
      disabledReason: recommendationGateIssues.length
        ? recommendationGateIssues.join('；')
        : undefined,
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

  return (
    <div
      className="decisions-workspace"
      data-inspector-open={selected ? 'true' : undefined}
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
            description={primaryQueueTask?.description
              || `${subviewDefinition.description} 每个状态最多已载入 100 条。`}
            tone={taskTone}
            status={<span>{loadedStatus}</span>}
            primaryAction={primaryTaskAction}
            secondaryActions={selected ? undefined : subview === 'recommendations'
              ? primaryQueueRow
                ? [generationAction, refreshAction]
                : [refreshAction]
              : primaryQueueRow
                ? [refreshAction]
                : undefined}
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
          {DECISIONS_WORKSPACE_SUBVIEWS.map((candidate) => {
            const activePanel = candidate === subview;
            return (
              <div
                aria-labelledby={`decisions-tab-${candidate}`}
                hidden={!activePanel}
                id={`decisions-panel-${candidate}`}
                key={candidate}
                role="tabpanel"
                tabIndex={activePanel ? 0 : -1}
              >
                {activePanel && (
                  <>
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
                aria-label="可审批建议选择与批量复核"
                className="decisions-selection-status"
                role="group"
              >
                <span aria-live="polite" role="status">
                  已选 {selectedBatchRows.length}/{batchSelectableRows.length} 条可审批建议
                </span>
                {selectedBatchRows.length > 0 && (
                  <button
                    aria-busy={batchHandoffAction.busy || undefined}
                    className="secondary-button decisions-selection-action"
                    disabled={batchHandoffAction.disabled}
                    onClick={batchHandoffAction.onClick}
                    title={batchHandoffAction.disabledReason}
                    type="button"
                  >
                    {batchHandoffAction.busy ? batchHandoffAction.busyLabel : batchHandoffAction.label}
                  </button>
                )}
              </div>
            )}
            {queue.loading && !publishedRows.length ? (
              <WorkspaceState kind="loading" description="正在同步待审批、需复核、已批准、已拒绝四类权威状态。" />
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
                onRowSelect={openDecisionInspector}
                rowAriaLabel={(row) => `${decisionActionLabel(row.actionType)}，${decisionObjectName(row)}，${decisionStatusLabel(row.status)}；按 Enter 或空格查看详情`}
              />
            )}
                  </>
                )}
              </div>
            );
          })}
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
            ) : selected.status === 'needs_review' ? (
              <section aria-labelledby="decisions-inspector-form-title">
                <h3 id="decisions-inspector-form-title">确认受控复核</h3>
                <p className="decisions-review-safety-note">
                  此操作只会把建议从“需复核”恢复为“待审批”，不会批准建议，也不会执行 Ads 动作。
                </p>
                <dl aria-label="当前锁定复核范围" className="decisions-review-scope">
                  <div><dt>日期</dt><dd>{scope.dateFrom} → {scope.dateTo}</dd></div>
                  <div><dt>店铺 / 站点</dt><dd>{scope.storeName} / {scope.marketplaceCode}</dd></div>
                  <div><dt>ASIN</dt><dd>{scope.asin || '未锁定'}</dd></div>
                  <div><dt>批次</dt><dd>{currentBatchId || '未锁定'}</dd></div>
                  <div><dt>建议版本</dt><dd>rev {selected.revision}</dd></div>
                </dl>
                <fieldset className="decisions-review-form" disabled={mutationLocked}>
                  <legend>人工复核与 Ads 可写对象身份</legend>
                  <label>
                    <span>复核人</span>
                    <input
                      autoComplete="name"
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        reviewedBy: event.target.value,
                      }))}
                      placeholder="填写姓名"
                      value={reviewForm.reviewedBy}
                    />
                  </label>
                  <label>
                    <span>复核依据 / 拒绝原因</span>
                    <textarea
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        rationale: event.target.value,
                      }))}
                      placeholder="说明如何核对 Ads 对象；拒绝时写明具体原因"
                      rows={3}
                      value={reviewForm.rationale}
                    />
                  </label>
                  <label>
                    <span>可写对象类型</span>
                    <select
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        entityType: event.target.value as DecisionsReviewFormState['entityType'],
                      }))}
                      value={reviewForm.entityType}
                    >
                      <option value="">请选择唯一类型</option>
                      <option value="keyword">关键词</option>
                      <option value="auto_targeting">自动投放</option>
                      <option value="product_targeting">商品投放</option>
                    </select>
                  </label>
                  <label>
                    <span>Ads 对象 ID</span>
                    <input
                      autoComplete="off"
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        entityId: event.target.value,
                      }))}
                      placeholder="填写 Ads UI / API 中的真实对象 ID"
                      value={reviewForm.entityId}
                    />
                  </label>
                  <label>
                    <span>来源文件</span>
                    <select
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        sourceFile: event.target.value,
                      }))}
                      value={reviewForm.sourceFile}
                    >
                      <option value="">请选择当前批次报表</option>
                      {currentRealReportSourceFiles.map((sourceRef) => (
                        <option key={sourceRef} value={sourceRef}>{sourceRef}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>唯一来源行</span>
                    <input
                      inputMode="numeric"
                      min="1"
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        sourceRow: event.target.value,
                      }))}
                      placeholder="例如 611"
                      step="1"
                      type="number"
                      value={reviewForm.sourceRow}
                    />
                  </label>
                  <label>
                    <span>身份核验来源</span>
                    <select
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        identitySource: event.target.value as DecisionsReviewFormState['identitySource'],
                      }))}
                      value={reviewForm.identitySource}
                    >
                      <option value="ads_ui">Ads UI</option>
                      <option value="ads_api">Ads API</option>
                    </select>
                  </label>
                  <label className="decisions-review-form__wide">
                    <span>身份核验证据路径</span>
                    <input
                      autoComplete="off"
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        identityProofPath: event.target.value,
                      }))}
                      placeholder="填写本地截图或导出证据的完整路径"
                      value={reviewForm.identityProofPath}
                    />
                  </label>
                  <label className="decisions-review-form__wide">
                    <span>身份核验说明</span>
                    <textarea
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        verificationNote: event.target.value,
                      }))}
                      placeholder="说明活动、广告组、对象名称与 ID 的核对过程"
                      rows={3}
                      value={reviewForm.verificationNote}
                    />
                  </label>
                </fieldset>
                {reviewBlockers.length > 0 && (
                  <div className="decisions-review-blockers" role="status" aria-live="polite">
                    <strong>复核仍被锁定</strong>
                    <ul>{reviewBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                  </div>
                )}
                {decisionFeedback && (
                  <div className={feedbackClass(decisionFeedback.tone)} role="status" aria-live="polite">
                    <strong>{decisionFeedback.title}</strong>
                    <span>{decisionFeedback.detail}</span>
                  </div>
                )}
                <div aria-label="受控复核动作" className="decisions-decision-actions" role="group">
                  <button
                    aria-busy={submittingReview || undefined}
                    className="primary-button"
                    disabled={reviewBlockers.length > 0 || mutationLocked}
                    onClick={() => { void resolveSelectedReview(); }}
                    type="button"
                  >
                    {submittingReview ? '正在确认复核...' : '确认复核，回到待审批'}
                  </button>
                  <button
                    aria-busy={submittingDecision === 'rejected' || undefined}
                    className="secondary-button danger-button"
                    disabled={!selectedEligibility.canReject || mutationLocked}
                    onClick={() => { void submitDecision('rejected'); }}
                    type="button"
                  >
                    {submittingDecision === 'rejected' ? '处理中...' : '拒绝建议'}
                  </button>
                </div>
              </section>
            ) : selected.status === 'pending' && !selected.evidence?.writableTarget ? (
              <section aria-labelledby="decisions-inspector-form-title">
                <h3 id="decisions-inspector-form-title">核验 Ads 对象，保持待审批</h3>
                <p className="decisions-review-safety-note">
                  此步骤只绑定当前建议对应的唯一 Ads 可写对象并生成不可覆盖的审计记录；不会批准建议，也不会执行 Ads 动作。
                </p>
                <dl aria-label="当前锁定对象核验范围" className="decisions-review-scope">
                  <div><dt>日期</dt><dd>{scope.dateFrom} → {scope.dateTo}</dd></div>
                  <div><dt>店铺 / 站点</dt><dd>{scope.storeName} / {scope.marketplaceCode}</dd></div>
                  <div><dt>ASIN</dt><dd>{scope.asin || '未锁定'}</dd></div>
                  <div><dt>批次</dt><dd>{currentBatchId || '未锁定'}</dd></div>
                  <div><dt>当前版本</dt><dd>rev {selected.revision}</dd></div>
                </dl>
                <DecisionsWritableTargetForm
                  disabled={mutationLocked}
                  form={reviewForm}
                  mode="binding"
                  setForm={setReviewForm}
                  sourceFiles={currentRealReportSourceFiles}
                />
                {targetBindingBlockers.length > 0 && (
                  <div className="decisions-review-blockers" role="status" aria-live="polite">
                    <strong>对象核验仍被锁定</strong>
                    <ul>{targetBindingBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                  </div>
                )}
                {decisionFeedback && (
                  <div className={feedbackClass(decisionFeedback.tone)} role="status" aria-live="polite">
                    <strong>{decisionFeedback.title}</strong>
                    <span>{decisionFeedback.detail}</span>
                  </div>
                )}
                <div aria-label="Ads 对象核验动作" className="decisions-decision-actions" role="group">
                  <button
                    aria-busy={submittingTargetBinding || undefined}
                    className="primary-button"
                    disabled={targetBindingBlockers.length > 0 || mutationLocked}
                    onClick={() => { void bindSelectedWritableTarget(); }}
                    type="button"
                  >
                    {submittingTargetBinding ? '正在核验 Ads 对象...' : '确认对象绑定（仍待审批）'}
                  </button>
                  <button
                    aria-busy={submittingDecision === 'rejected' || undefined}
                    className="secondary-button danger-button"
                    disabled={!selectedEligibility.canReject || mutationLocked}
                    onClick={() => { void submitDecision('rejected'); }}
                    type="button"
                  >
                    {submittingDecision === 'rejected' ? '处理中...' : '拒绝建议'}
                  </button>
                </div>
              </section>
            ) : (
              <section aria-labelledby="decisions-inspector-form-title">
                <h3 id="decisions-inspector-form-title">人工决定</h3>
                <div className="decisions-decision-form">
                  <label>
                    <span>审批人 / 处理人</span>
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
                  <button
                    aria-busy={submittingDecision === 'approved' || undefined}
                    className="primary-button"
                    disabled={!selectedEligibility.canApprove || mutationLocked}
                    onClick={() => { void submitDecision('approved'); }}
                    type="button"
                  >
                    {submittingDecision === 'approved' ? '处理中...' : '批准建议（不执行 Ads）'}
                  </button>
                  <button
                    aria-busy={submittingDecision === 'rejected' || undefined}
                    className="secondary-button danger-button"
                    disabled={!selectedEligibility.canReject || mutationLocked}
                    onClick={() => { void submitDecision('rejected'); }}
                    type="button"
                  >
                    {submittingDecision === 'rejected' ? '处理中...' : '拒绝建议'}
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
