import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import { DecisionActionStrip, FormTable, FormTableRow, PageHeader, Panel, StatusPill } from '../components/ui';
import { useOverlayFocusScope } from '../components/workspace/overlay-focus-scope';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { buildDecisionEvidenceSummary, formatEvidenceRefSummary } from '../evidence-display';
import { formatPercent, formatUsd } from '../formatters';
import type { AiEvidenceDisplayItemView, RecommendationView } from '../types';
import { toUserFacingError } from '../user-facing-error';
import { runWorkflowInvalidatingMutation } from '../workflow-invalidation';
import type { WorkflowEventTarget } from '../workflow-invalidation';

type ApprovalTab = 'pending' | 'needs_review' | 'approved' | 'rejected';
type ApprovalFeedbackState = 'approving' | 'approved' | 'rejecting' | 'rejected' | 'blocked';
export type ApprovalDecisionButtonMode = 'approved' | 'rejected';
type ApprovalQueueExitDecision = ApprovalDecisionButtonMode;
type ApprovalQueueExitState = { id: number; decision: ApprovalQueueExitDecision } | null;
const APPROVAL_SELECTION_STORAGE_KEY = 'amazon-ai-ops:approval-selection';
export const APPROVAL_QUEUE_EXIT_ANIMATION_MS = 180;

export function runApprovalWorkflowMutation<T>(
  decision: 'approve' | 'reject',
  task: () => Promise<T>,
  target?: WorkflowEventTarget,
): Promise<T> {
  return runWorkflowInvalidatingMutation(
    decision === 'approve' ? 'approval-approved' : 'approval-rejected',
    task,
    target,
  );
}

const TAB_LABELS: Record<ApprovalTab, string> = {
  pending: '待审批',
  needs_review: '复核队列',
  approved: '已批准待执行',
  rejected: '已拒绝',
};

function errorMessage(caught: unknown, fallback: string): string {
  return `${fallback}: ${toUserFacingError(caught, fallback)}`;
}

function objectName(rec: RecommendationView): string {
  return rec.evidence?.searchTerm || rec.evidence?.targeting || rec.entityName || '-';
}

export function approvalRowsAfterDecision(rows: RecommendationView[], recommendationId: number): RecommendationView[] {
  return rows.filter((row) => row.id !== recommendationId);
}

export function approvalDecisionFocusReturnTarget<T>(
  trigger: T | null,
  completedDecisionTarget: T | null,
): T | null {
  return completedDecisionTarget ?? trigger;
}

export function buildRecommendationDecisionRequest(
  recommendation: Pick<RecommendationView, 'id' | 'revision'>,
  decision: Record<string, unknown>,
) {
  return {
    id: recommendation.id,
    expectedRevision: recommendation.revision,
    decision,
  };
}

export function refreshedApprovalSelection(
  current: RecommendationView | null,
  refreshedRows: RecommendationView[],
): RecommendationView | null {
  if (!current) return null;
  return refreshedRows.find((row) => row.id === current.id) ?? null;
}

export function approvalQueueRowClass(row: RecommendationView, exiting: ApprovalQueueExitState): string {
  if (!exiting || row.id !== exiting.id) return '';
  return `approval-row-exiting approval-row-exiting-${exiting.decision}`;
}

function sourceFiles(rec: RecommendationView): string {
  return rec.evidence?.sourceFiles?.length ? rec.evidence.sourceFiles.join(', ') : '-';
}

function isRealReportSourceFile(sourceRef: unknown): boolean {
  return /\.(xlsx|xls|csv)$/i.test(String(sourceRef || '').trim().split(/[?#]/)[0]);
}

function normalizeSourceFile(sourceRef: unknown): string {
  return String(sourceRef || '').trim().replace(/\\/g, '/').toLowerCase();
}

function sameSourceFiles(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => Array.isArray(value)
    ? Array.from(new Set(value.map(normalizeSourceFile).filter(Boolean))).sort()
    : [];
  const leftFiles = normalize(left);
  const rightFiles = normalize(right);
  return leftFiles.length === rightFiles.length
    && leftFiles.every((sourceRef, index) => sourceRef === rightFiles[index]);
}

function sameTimestamp(left: unknown, right: unknown): boolean {
  const leftTimestamp = Date.parse(String(left || '').trim());
  const rightTimestamp = Date.parse(String(right || '').trim());
  return Number.isFinite(leftTimestamp)
    && Number.isFinite(rightTimestamp)
    && leftTimestamp === rightTimestamp;
}

function sameWritableTarget(
  left: NonNullable<RecommendationView['evidence']>['writableTarget'],
  right: NonNullable<RecommendationView['evidence']>['writableTarget'],
): boolean {
  if (!left || !right) return false;
  const normalizedText = (value: unknown) => String(value || '').trim().toLowerCase();
  return left.entityType === right.entityType
    && left.entityId === right.entityId
    && normalizedText(left.entityName) === normalizedText(right.entityName)
    && normalizedText(left.campaignName) === normalizedText(right.campaignName)
    && normalizedText(left.adGroupName) === normalizedText(right.adGroupName)
    && String(left.metricDate || '').trim() === String(right.metricDate || '').trim()
    && normalizeSourceFile(left.sourceFile) === normalizeSourceFile(right.sourceFile)
    && Number(left.sourceRow) === Number(right.sourceRow)
    && left.identitySource === right.identitySource
    && String(left.verifiedBy || '').trim() === String(right.verifiedBy || '').trim()
    && sameTimestamp(left.verifiedAt, right.verifiedAt)
    && String(left.verificationNote || '').trim() === String(right.verificationNote || '').trim()
    && normalizeSourceFile(left.identityProofPath) === normalizeSourceFile(right.identityProofPath);
}

export function hasCurrentRecommendationReviewResolution(rec: RecommendationView): boolean {
  const resolution = rec.evidence?.reviewResolution;
  const writableTarget = rec.evidence?.writableTarget;
  if (rec.status !== 'pending' || !resolution || !writableTarget) return false;
  const nonEmpty = (value: unknown) => Boolean(String(value || '').trim());
  return resolution.schemaVersion === 1
    && resolution.fromStatus === 'needs_review'
    && Number.isInteger(resolution.fromRevision)
    && resolution.fromRevision >= 0
    && resolution.fromRevision + 1 === resolution.resolvedRevision
    && resolution.resolvedRevision === rec.revision
    && resolution.resolvedBlockers.length === 1
    && resolution.resolvedBlockers[0] === 'quant_review_required'
    && nonEmpty(resolution.reviewedBy)
    && Number.isFinite(Date.parse(String(resolution.reviewedAt || '').trim()))
    && nonEmpty(resolution.rationale)
    && String(resolution.scope.asin || '').trim().toUpperCase() === String(rec.evidence?.asin || '').trim().toUpperCase()
    && String(resolution.scope.batchId || '').trim() === String(rec.evidence?.batchId || '').trim()
    && String(resolution.metricSource.batchId || '').trim() === String(rec.evidence?.batchId || '').trim()
    && Number(resolution.metricSource.sourceRow) === Number(rec.evidence?.sourceRow)
    && sameSourceFiles(resolution.metricSource.sourceFiles, rec.evidence?.sourceFiles)
    && sameWritableTarget(resolution.writableTarget, writableTarget);
}

function parseExecutableNumber(value: unknown): number | undefined {
  const text = String(value || '').trim();
  if (!text || /[%％]/.test(text)) return undefined;
  const parsed = Number(text.replace(/^\$/, '').replace(/\s*usd$/i, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function approvalMissing(
  rec: RecommendationView | null,
  scope: { storeName: string; marketplaceCode: string },
  currentBatchId?: string,
  allowedSourceFiles?: string[],
): string[] {
  if (!rec) return [];
  const missing: string[] = [];
  const requireValue = (value: unknown, label: string) => {
    const text = String(value || '').trim();
    if (!text || text === '-') missing.push(label);
  };
  const requirePositiveNumber = (value: unknown, label: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) missing.push(label);
  };
  requireValue(scope.storeName, '店铺');
  requireValue(scope.marketplaceCode, '站点');
  requireValue(currentBatchId, '当前批次');
  requireValue(rec.evidence?.asin, 'ASIN');
  requireValue(rec.evidence?.batchId, '来源批次');
  if (rec.evidence?.batchId && currentBatchId && rec.evidence.batchId !== currentBatchId) missing.push('来源批次不一致');
  requireValue(rec.evidence?.date, '指标日期');
  const recommendationSourceFiles = rec.evidence?.sourceFiles || [];
  if (!recommendationSourceFiles.length) missing.push('来源文件');
  if (recommendationSourceFiles.length && !recommendationSourceFiles.every(isRealReportSourceFile)) missing.push('真实来源报表');
  if (recommendationSourceFiles.length && Array.isArray(allowedSourceFiles) && allowedSourceFiles.length === 0) {
    missing.push('当前批次真实报表文件未加载');
  }
  if (recommendationSourceFiles.length && Array.isArray(allowedSourceFiles) && allowedSourceFiles.length > 0) {
    const allowed = new Set(allowedSourceFiles.map(normalizeSourceFile));
    const allSourcesCurrent = recommendationSourceFiles.every((file) => allowed.has(normalizeSourceFile(file)));
    if (!allSourcesCurrent) {
      missing.push('来源文件不属于当前数据批次真实报表');
      missing.push('未能与当前批次的不透明报表工件对应（旧路径证据已阻断）');
    }
  }
  requirePositiveNumber(rec.evidence?.sourceRow, '来源行号');
  requireValue(rec.evidence?.campaignName, '广告活动');
  requireValue(rec.evidence?.adGroupName, '广告组');
  requireValue(rec.entityType || rec.evidence?.matchType, '对象类型');
  requireValue(objectName(rec), '对象');
  requireValue(rec.actionType, '动作');
  requireValue(rec.currentValue, '当前值');
  requireValue(rec.recommendedValue, '建议值');
  const writableTarget = rec.evidence?.writableTarget;
  if (!writableTarget) {
    missing.push('Ads 可写对象');
  } else {
    requireValue(writableTarget.entityType, '可写对象类型');
    requireValue(writableTarget.entityId, '可写对象 ID');
    requireValue(writableTarget.entityName, '可写对象名称');
    requireValue(writableTarget.campaignName, '可写对象广告活动');
    requireValue(writableTarget.adGroupName, '可写对象广告组');
    requireValue(writableTarget.metricDate, '可写对象指标日期');
    requireValue(writableTarget.sourceFile, '可写对象来源文件');
    requirePositiveNumber(writableTarget.sourceRow, '可写对象来源行号');
    requireValue(writableTarget.identitySource, '可写对象身份来源');
    requireValue(writableTarget.verifiedBy, '可写对象核验人');
    requireValue(writableTarget.verifiedAt, '可写对象核验时间');
    requireValue(writableTarget.verificationNote, '可写对象核验说明');
    requireValue(writableTarget.identityProofPath, '可写对象身份凭证');
  }
  return missing;
}

function riskRequiresDedicatedReview(riskLevel?: string): boolean {
  const normalized = String(riskLevel || '').trim().toLowerCase();
  return normalized === 'forbidden' || normalized === 'high' || normalized.includes('forbidden');
}

export function approvalBlockers(rec: RecommendationView | null): string[] {
  if (!rec) return [];
  const blockers: string[] = [];
  const agreement = rec.evidence?.decisionAgreement;
  const aiActionParticipated = agreement === 'aligned' || agreement === 'ai_only';
  blockers.push(...approvalValueBlockers(rec));
  if (rec.status === 'needs_review') blockers.push('建议已进入复核队列');
  if (agreement === 'ai_only') blockers.push('AI 独立洞察不能直接批准');
  if (agreement === 'conflict') blockers.push('AI 与规则冲突');
  if (rec.evidence?.aiInsightOnly === true) blockers.push('该建议缺少 AI 可回查证据，仅作为洞察展示，不能审批');
  if (rec.evidence?.aiStrategySource === 'ai' && aiActionParticipated && !rec.evidence?.aiEvidenceRefs?.length) blockers.push('AI 建议缺少可回查证据引用');
  if (rec.evidence?.aiStrategySource === 'ai' && aiActionParticipated && rec.evidence?.aiEvidenceRefs?.length) {
    const details = Array.isArray(rec.evidence.aiEvidenceDetails) ? rec.evidence.aiEvidenceDetails : [];
    const detailIds = new Set(details.map((detail) => String(detail?.evidenceId || '').trim()).filter(Boolean));
    const allRefsResolved = rec.evidence.aiEvidenceRefs.every((ref) => detailIds.has(String(ref || '').trim()));
    if (!details.length || !allRefsResolved) blockers.push('AI 建议缺少可展示的证据详情');
  }
  if (rec.evidence?.decisionRequiresReview === true) blockers.push('AI/规则合并标记需复核');
  if (aiActionParticipated && rec.evidence?.aiLifecycleStageRequiresReview === true) {
    blockers.push('AI 阶段判断需要人工复核');
    blockers.push(...(rec.evidence.aiLifecycleStageInvalidReasons || []).filter(Boolean));
  }
  if (rec.evidence?.quantReviewRequired === true && !hasCurrentRecommendationReviewResolution(rec)) {
    blockers.push('规则量化要求人工复核');
  }
  if (riskRequiresDedicatedReview(rec.riskLevel)) blockers.push('高风险或禁止执行风险等级');
  return blockers;
}

export function approvalSubmitBlockers(
  rec: RecommendationView | null,
  scope: { storeName: string; marketplaceCode: string },
  currentBatchId?: string,
  allowedSourceFiles?: string[],
): string[] {
  if (!rec) return ['未选择建议'];
  return Array.from(new Set([
    ...approvalMissing(rec, scope, currentBatchId, allowedSourceFiles),
    ...approvalBlockers(rec),
  ]));
}

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

export function parseApprovalSelectionIntent(value: unknown): {
  ids: string[];
  count: number;
  batchId?: string;
} | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { ids?: unknown; count?: unknown; batchId?: unknown };
  const ids = Array.isArray(record.ids)
    ? Array.from(new Set(record.ids.map((id) => String(id || '').trim()).filter(Boolean)))
    : [];
  if (!ids.length) return null;
  return {
    ids,
    count: Math.max(ids.length, Number(record.count || ids.length) || ids.length),
    batchId: typeof record.batchId === 'string' ? record.batchId : undefined,
  };
}

function approvalValueBlockers(rec: RecommendationView): string[] {
  const action = String(rec.actionType || '').trim();
  const currentValue = parseExecutableNumber(rec.currentValue);
  const recommendedValue = parseExecutableNumber(rec.recommendedValue);

  if (action === 'lower_bid' || action === 'raise_bid') {
    if (recommendedValue === undefined) return ['出价建议值必须是可执行的正数金额'];
    if (currentValue === undefined) return ['当前出价必须是可回查的正数金额'];
    if (action === 'lower_bid' && recommendedValue >= currentValue) return ['降价动作的建议出价必须低于当前出价'];
    if (action === 'raise_bid' && recommendedValue <= currentValue) return ['提价动作的建议出价必须高于当前出价'];
  }

  if (action === 'adjust_campaign_budget' && recommendedValue === undefined) {
    return ['预算建议值必须是可执行的正数金额'];
  }

  return [];
}

function quantSummary(rec: RecommendationView): string {
  const status = rec.evidence?.quantStatus || '未量化';
  const stage = rec.evidence?.quantLifecycleStage || '未知阶段';
  const severity = rec.evidence?.quantSeverity || '未知风险';
  return `${status} / ${stage} / ${severity}`;
}

function decisionLabel(rec: RecommendationView): string {
  const labels: Record<string, string> = {
    aligned: '规则+AI 一致',
    conflict: '规则/AI 冲突',
    ai_only: 'AI 独立洞察',
    rule_only: '规则独立建议',
  };
  return labels[String(rec.evidence?.decisionAgreement || 'rule_only')] || String(rec.evidence?.decisionAgreement || '规则独立建议');
}

export function strategyLabel(rec: RecommendationView): string {
  if (rec.evidence?.aiStrategySource === 'ai') return 'AI 阶段诊断';
  if (rec.evidence?.aiStrategySource === 'rule') return '规则策略兜底';
  return '未诊断';
}

function thresholdSummary(rec: RecommendationView): string {
  const thresholds = rec.evidence?.quantThresholds;
  if (!thresholds) return '暂无规则量化阈值';
  return [
    `目标 ACOS ${formatPercent(Number(thresholds.targetAcos || 0) * 100)}`,
    `高 ACOS ${formatPercent(Number(thresholds.highAcosThreshold || 0) * 100)}`,
    `无订单 ${Number(thresholds.noOrderClickThreshold || 0)} 点击`,
    `止损 ${formatUsd(thresholds.minSpend)}`,
  ].join(' / ');
}

function aiThresholdReviewSuffix(thresholds: NonNullable<RecommendationView['evidence']>['aiThresholdSuggestions']): string {
  const reviewReasons = Object.values(thresholds || {})
    .filter((item) => item?.requiresReview)
    .flatMap((item) => item.reviewReasons?.length ? item.reviewReasons : ['AI 动态阈值需要人工复核。']);
  return reviewReasons.length ? ` / 需复核：${Array.from(new Set(reviewReasons)).slice(0, 2).join('；')}` : '';
}

export function aiThresholdSummary(rec: RecommendationView): string {
  const thresholds = rec.evidence?.aiThresholdSuggestions;
  if (!thresholds) return '暂无 AI 动态阈值';
  const parts = [
    thresholds.targetAcos ? `目标 ACOS ${formatPercent(Number(thresholds.targetAcos.value) * 100)}` : '',
    thresholds.highAcosThreshold ? `高 ACOS ${formatPercent(Number(thresholds.highAcosThreshold.value) * 100)}` : '',
    thresholds.noOrderClickThreshold ? `无订单 ${Number(thresholds.noOrderClickThreshold.value)} 点击` : '',
    thresholds.minSpend ? `最低花费 ${formatUsd(Number(thresholds.minSpend.value))}` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(' / ')}${aiThresholdReviewSuffix(thresholds)}` : '暂无 AI 动态阈值';
}

function compactList(values?: string[]): string {
  return values?.length ? values.join('；') : '无';
}

function optionalPercent(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? formatPercent(numeric * 100) : '-';
}

function optionalMoney(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? formatUsd(numeric) : '-';
}

function evidenceTypeLabel(type?: string): string {
  const labels: Record<string, string> = {
    metric: '报表指标',
    timeline: '时间线',
    operation_event: '运营事件',
    product_context: '产品配置',
    rule_candidate: '规则候选',
  };
  return labels[String(type || '')] || String(type || '未知证据');
}

function evidenceMetricLine(item: AiEvidenceDisplayItemView): string {
  if (!item.metrics) return '无指标值';
  return [
    `${formatUsd(item.metrics.cost || 0)} / ${formatUsd(item.metrics.sales || 0)}`,
    `${Number(item.metrics.orders || 0)} 单`,
    `${Number(item.metrics.clicks || 0)} 点击`,
    `ACOS ${formatPercent(Number(item.metrics.acos || 0) * 100)}`,
  ].join(' / ');
}

function evidenceContextLine(item: AiEvidenceDisplayItemView): string {
  return [
    item.batchId ? `批次 ${item.batchId}` : '',
    item.reportType ? `报表 ${item.reportType}` : '',
    item.dateRange ? `日期 ${item.dateRange}` : '',
    item.sourceRow ? `行 ${item.sourceRow}` : '',
  ].filter(Boolean).join(' / ') || '无来源上下文';
}

function productStageLabel(stage?: string): string {
  const labels: Record<string, string> = {
    cold_start: '冷启动',
    keyword_exploration: '关键词探索',
    stable_conversion: '稳定转化',
    scaling: '放量',
    profit_harvesting: '利润收割',
    clearance: '清货',
    declining_repair: '衰退修复',
    launch: '新品启动',
    growth: '增长期',
    stabilize: '稳定期',
    harvest: '利润收割',
  };
  return labels[String(stage || '')] || String(stage || '未配置');
}

export function ApprovalPage() {
  const { data, scope } = useBusinessDataPipeline();
  const [tab, setTab] = useState<ApprovalTab>('pending');
  const [rows, setRows] = useState<RecommendationView[]>([]);
  const [selected, setSelected] = useState<RecommendationView | null>(null);
  const [approverName, setApproverName] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submittingDecision, setSubmittingDecision] = useState<'approved' | 'rejected' | null>(null);
  const [decisionFeedback, setDecisionFeedback] = useState<ReturnType<typeof buildApprovalStampFeedback> | null>(null);
  const [exitingDecision, setExitingDecision] = useState<ApprovalQueueExitState>(null);
  const [batchSelectionHint, setBatchSelectionHint] = useState<string | null>(null);
  const pendingSelectionIntentRef = useRef<ReturnType<typeof parseApprovalSelectionIntent>>(null);
  const exitTimerRef = useRef<number | null>(null);
  const approvalQueueFocusRef = useRef<HTMLDivElement | null>(null);
  const completedDecisionFocusTargetRef = useRef<HTMLElement | null>(null);
  const currentBatchId = scope.batchId || data?.collection.latestBatch?.id;
  const currentRealReportSourceFiles = useMemo(
    () => (data?.collection.realReportFiles || [])
      .map((file) => file.artifactDisplayName || file.fileName || file.displayName)
      .filter(Boolean),
    [data?.collection.realReportFiles],
  );
  const selectedMissing = useMemo(
    () => approvalMissing(selected, scope, currentBatchId, currentRealReportSourceFiles),
    [currentBatchId, currentRealReportSourceFiles, scope.marketplaceCode, scope.storeName, selected],
  );
  const selectedBlockers = useMemo(() => approvalBlockers(selected), [selected]);
  const selectedSubmitBlockers = useMemo(
    () => approvalSubmitBlockers(selected, scope, currentBatchId, currentRealReportSourceFiles),
    [currentBatchId, currentRealReportSourceFiles, scope.marketplaceCode, scope.storeName, selected],
  );
  const selectedDecisionSummary = useMemo(
    () => buildDecisionEvidenceSummary(selected?.evidence),
    [selected],
  );
  const selectedApprovalDecision = useMemo(
    () => approvalDecisionState({
      selected,
      missing: selectedMissing,
      blockers: selectedBlockers,
    }),
    [selected, selectedBlockers, selectedMissing],
  );
  const approveButton = approvalDecisionButtonView({
    mode: 'approved',
    submittingDecision,
    blocked: selectedSubmitBlockers.length > 0,
  });
  const rejectButton = approvalDecisionButtonView({
    mode: 'rejected',
    submittingDecision,
    blocked: false,
  });

  function decisionPayload(decision: 'approved' | 'rejected') {
    return buildApprovalDecisionPayload({
      decision,
      approverName,
      approvalNote,
      currentBatchId,
      selected,
      scope: {
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
        asin: scope.asin,
      },
    });
  }

  const filter = useMemo(() => ({
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    batchId: currentBatchId,
    status: tab,
    limit: 100,
  }), [currentBatchId, scope.asin, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName, tab]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage?.getItem(APPROVAL_SELECTION_STORAGE_KEY);
      const parsed = raw ? parseApprovalSelectionIntent(JSON.parse(raw)) : null;
      if (!parsed) return;
      pendingSelectionIntentRef.current = parsed;
      setBatchSelectionHint(`来自优化建议批量提交 ${parsed.count} 项；审批中心会逐条重新校验证据和安全边界。`);
      window.sessionStorage?.removeItem(APPROVAL_SELECTION_STORAGE_KEY);
    } catch {
      pendingSelectionIntentRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
  }, []);

  function scheduleDecisionQueueExit(recommendationId: number, decision: ApprovalQueueExitDecision) {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    setExitingDecision({ id: recommendationId, decision });
    exitTimerRef.current = window.setTimeout(() => {
      setRows((current) => approvalRowsAfterDecision(current, recommendationId));
      setExitingDecision(null);
      exitTimerRef.current = null;
      void loadRows({ clearMessage: false });
    }, APPROVAL_QUEUE_EXIT_ANIMATION_MS);
  }

  async function loadRows(options: { clearMessage?: boolean } = {}) {
    setLoading(true);
    if (options.clearMessage !== false) setMessage(null);
    try {
      const nextRows = await (window as any).electronAPI?.getRecommendations?.(filter);
      const normalizedRows = Array.isArray(nextRows) ? nextRows : [];
      setRows(normalizedRows);
      const pendingIntent = pendingSelectionIntentRef.current;
      if (pendingIntent && tab === 'pending') {
        const matched = normalizedRows.find((row) => pendingIntent.ids.includes(String(row.id)));
        if (matched) {
          setSelected(matched);
          pendingSelectionIntentRef.current = null;
          window.setTimeout(showApprovalQueue, 0);
        } else {
          setSelected(null);
          setBatchSelectionHint(`来自优化建议批量提交 ${pendingIntent.count} 项，但当前审批队列没有匹配到这些建议；可能已处理或范围已变化。`);
          pendingSelectionIntentRef.current = null;
        }
      } else {
        setSelected((current) => refreshedApprovalSelection(current, normalizedRows));
      }
    } catch (caught) {
      setMessage(errorMessage(caught, '加载审批队列失败'));
    } finally {
      setLoading(false);
    }
  }

  async function approveSelected() {
    if (!selected) return;
    if (selectedMissing.length > 0) {
      const blocked = `审批阻断：建议缺少 ${selectedMissing.join('、')}，不能推进到结果核对。`;
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: selected.id,
        targetName: objectName(selected),
      }));
      setMessage(blocked);
      return;
    }
    if (selectedBlockers.length > 0) {
      const blocked = `审批阻断：${selectedBlockers.join('、')}，不能走普通批准；需要先完成专门复核或重新生成规则确认后的建议。`;
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: selected.id,
        targetName: objectName(selected),
      }));
      setMessage(blocked);
      return;
    }
    if (!approverName.trim()) {
      const blocked = '批准前必须填写审批人。';
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: selected.id,
        targetName: objectName(selected),
      }));
      setMessage(blocked);
      return;
    }
    const currentSelected = selected;
    const targetName = objectName(currentSelected);
    setSubmittingDecision('approved');
    setDecisionFeedback(buildApprovalStampFeedback({
      state: 'approving',
      recommendationId: currentSelected.id,
      targetName,
    }));
    try {
      const approve = (window as any).electronAPI?.approveRecommendation;
      if (typeof approve !== 'function') {
        throw new Error('批准建议接口未暴露。');
      }
      await runApprovalWorkflowMutation('approve', () => approve(buildRecommendationDecisionRequest(
        currentSelected,
        decisionPayload('approved'),
      )));
      const approvedMessage = `已批准建议 #${currentSelected.id}，审批人和备注已写入建议证据。审批范围：${scope.storeName} / ${scope.marketplaceCode} / ${currentSelected.evidence?.campaignName || '-'} / ${currentSelected.evidence?.adGroupName || '-'} / ${targetName}。`;
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'approved',
        recommendationId: currentSelected.id,
        targetName,
      }));
      setMessage(approvedMessage);
      scheduleDecisionQueueExit(currentSelected.id, 'approved');
      completedDecisionFocusTargetRef.current = approvalQueueFocusRef.current;
      setSelected(null);
      setApproverName('');
      setApprovalNote('');
    } catch (caught) {
      const failed = errorMessage(caught, '批准建议失败');
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: currentSelected.id,
        targetName,
      }));
      setMessage(failed);
    } finally {
      setSubmittingDecision(null);
    }
  }

  async function rejectSelected() {
    if (!selected) return;
    if (!approverName.trim()) {
      const blocked = '拒绝前必须填写处理人。';
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: selected.id,
        targetName: objectName(selected),
      }));
      setMessage(blocked);
      return;
    }
    if (!approvalNote.trim()) {
      const blocked = '拒绝前必须填写拒绝原因。';
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: selected.id,
        targetName: objectName(selected),
      }));
      setMessage(blocked);
      return;
    }
    const currentSelected = selected;
    const targetName = objectName(currentSelected);
    setSubmittingDecision('rejected');
    setDecisionFeedback(buildApprovalStampFeedback({
      state: 'rejecting',
      recommendationId: currentSelected.id,
      targetName,
    }));
    try {
      const reject = (window as any).electronAPI?.rejectRecommendation;
      if (typeof reject !== 'function') {
        throw new Error('拒绝建议接口未暴露。');
      }
      await runApprovalWorkflowMutation('reject', () => reject(buildRecommendationDecisionRequest(
        currentSelected,
        decisionPayload('rejected'),
      )));
      const rejectedMessage = `已拒绝建议 #${currentSelected.id}，拒绝原因已写入建议证据${approvalNote ? `：${approvalNote}` : ''}`;
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'rejected',
        recommendationId: currentSelected.id,
        targetName,
      }));
      setMessage(rejectedMessage);
      scheduleDecisionQueueExit(currentSelected.id, 'rejected');
      completedDecisionFocusTargetRef.current = approvalQueueFocusRef.current;
      setSelected(null);
      setApproverName('');
      setApprovalNote('');
    } catch (caught) {
      const failed = errorMessage(caught, '拒绝建议失败');
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: currentSelected.id,
        targetName,
      }));
      setMessage(failed);
    } finally {
      setSubmittingDecision(null);
    }
  }

  function showApprovalQueue() {
    const details = document.getElementById('approval-queue-details') as HTMLDetailsElement | null;
    if (details) details.open = true;
    document.getElementById('approval-queue-panel')?.scrollIntoView({ block: 'start' });
  }

  function showSelectedDecisionTarget() {
    const decisionDetails = document.getElementById('approval-decision-details');
    if (!selectedApprovalDecision.canApprove) {
      const details = decisionDetails?.querySelector('details') as HTMLDetailsElement | null;
      if (details) details.open = true;
    }
    document.getElementById(selectedApprovalDecision.canApprove ? 'approval-form' : 'approval-decision-details')?.scrollIntoView({ block: 'start' });
  }

  function closeApprovalDecisionModal() {
    if (submittingDecision) return;
    setSelected(null);
    setApproverName('');
    setApprovalNote('');
  }

  const approvalDecisionDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    dismissDisabled: Boolean(submittingDecision),
    onDismiss: closeApprovalDecisionModal,
    open: Boolean(selected),
    resolveFocusReturnTarget: (trigger) => {
      const target = approvalDecisionFocusReturnTarget(
        trigger,
        completedDecisionFocusTargetRef.current,
      );
      completedDecisionFocusTargetRef.current = null;
      return target;
    },
  });

  useEffect(() => {
    if (!currentBatchId) {
      setRows([]);
      setSelected(null);
      return;
    }
    loadRows();
  }, [currentBatchId, filter]);

  return (
    <div>
      <PageHeader
        eyebrow="广告"
        title={PAGE_HEADER_TITLES.approval}
        description="逐条确认动作是否允许执行：批准、拒绝，或因缺证据和范围不匹配退回复核。"
      />

      <div className="business-stack">
        <div id="approval-queue-panel" ref={approvalQueueFocusRef} tabIndex={-1}>
        <Panel title="审批队列" tone={rows.length ? 'warning' : 'blocked'}>
          <div className="approval-workbench-head">
            <div>
              <strong>{TAB_LABELS[tab]} {rows.length} 条</strong>
              <p>先选择一条动作，再批准或拒绝；本页只记录人工决策，不执行广告。</p>
            </div>
            <div className="approval-workbench-status">
              <StatusPill tone={currentBatchId ? 'ready' : 'warning'}>{currentBatchId || '批次待确认'}</StatusPill>
              <StatusPill tone="warning">只审批，不执行</StatusPill>
            </div>
          </div>
          {batchSelectionHint && (
            <div className="approval-batch-handoff" role="status">
              <StatusPill tone="ready">来自优化建议</StatusPill>
              <span>{batchSelectionHint}</span>
            </div>
          )}
          {decisionFeedback && (
            <div
              aria-live="polite"
              className={`approval-stamp-feedback approval-stamp-feedback-${decisionFeedback.tone}`}
              role="status"
            >
              <strong>{decisionFeedback.label}</strong>
              <span>{decisionFeedback.title}</span>
              <p>{decisionFeedback.detail}</p>
            </div>
          )}
          <div className="tab-row">
            {(Object.keys(TAB_LABELS) as ApprovalTab[]).map((item) => (
              <button
                aria-pressed={tab === item}
                className={tab === item ? 'tab-button tab-button-active' : 'tab-button'}
                key={item}
                onClick={() => {
                  setTab(item);
                  setSelected(null);
                  setDecisionFeedback(null);
                }}
                type="button"
              >
                {TAB_LABELS[item]}
              </button>
            ))}
          </div>
          <div className="table-wrap">
              <table className="business-table approval-table">
              <thead>
                <tr>
                  <th>动作</th>
                  <th>广告组合</th>
                  <th>广告活动</th>
                  <th>广告组</th>
                  <th>ASIN</th>
                  <th>对象</th>
                  <th>当前/建议</th>
                  <th>花费</th>
                  <th>风险</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr className={approvalQueueRowClass(row, exitingDecision)} key={row.id}>
                    <td>{row.actionType}</td>
                    <td>{row.evidence?.portfolioName || '-'}</td>
                    <td>{row.evidence?.campaignName || '-'}</td>
                    <td>{row.evidence?.adGroupName || '-'}</td>
                    <td>{row.evidence?.asin || '-'}</td>
                    <td>{objectName(row)}</td>
                    <td>{row.currentValue || '-'} {'→'} {row.recommendedValue || '-'}</td>
                    <td>{formatUsd(row.evidence?.cost ?? row.cost)}</td>
                    <td>
                      <div>{row.riskLevel}</div>
                      <div className="table-subtext">{approvalBlockers(row).length ? approvalBlockers(row).join(' / ') : '普通审批可处理'}</div>
                    </td>
                    <td>
                      <button
                        className="secondary-button compact-button"
                        onClick={() => {
                          completedDecisionFocusTargetRef.current = null;
                          setSelected(row);
                          setApproverName('');
                          setApprovalNote('');
                          setDecisionFeedback(null);
                        }}
                        type="button"
                      >
                        处理
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={10}>{loading ? '加载中...' : `${TAB_LABELS[tab]}队列为空。`}</td>
                  </tr>
                )}
              </tbody>
              </table>
          </div>
        </Panel>
        </div>

        <ProgressiveDetails title="审批边界和处理要求">
        <Panel title="审批安全边界" tone="warning">
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">不会批量自动写入。每个动作必须绑定店铺、站点、广告活动、广告组、对象和动作，并保留审批与回读证据。</p>
            </div>
            <StatusPill tone="pending">仅审批，不执行</StatusPill>
          </div>
        </Panel>

        <Panel title="审批处理要求">
          <div className="context-summary-grid">
            <div>
              <span>本页职责</span>
              <strong>只做人工决策</strong>
              <p>批准或拒绝规则确认后的建议；AI 独立洞察和冲突建议先进入复核队列。</p>
            </div>
            <div>
              <span>批准前确认</span>
              <strong>范围和动作</strong>
              <p>核对店铺、站点、广告活动、广告组、对象、当前值和建议值。</p>
            </div>
            <div>
              <span>批准后下一步</span>
              <strong>进入结果核对</strong>
              <p>在结果核对页补录审批凭证、执行前/执行后截图、回读值和现场行证明。</p>
            </div>
            <div>
              <span>当前队列</span>
              <strong>{rows.length} 条</strong>
              <p>{TAB_LABELS[tab]}；切换标签只查看状态，不会执行动作。</p>
            </div>
          </div>
        </Panel>
        </ProgressiveDetails>

        {selected && (
          <div
            className="product-config-modal-backdrop approval-decision-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeApprovalDecisionModal();
            }}
            ref={approvalDecisionDialogFocus.overlayRootRef}
            role="presentation"
          >
            <section
              aria-labelledby="approval-decision-modal-title"
              aria-modal="true"
              className="product-config-modal approval-decision-modal"
              onMouseDown={(event) => event.stopPropagation()}
              ref={approvalDecisionDialogFocus.surfaceRef}
              role="dialog"
              tabIndex={-1}
            >
              <header className="product-config-modal-header">
                <div>
                  <span>审批处理</span>
                  <h2 id="approval-decision-modal-title">人工审批决定</h2>
                </div>
                <button
                  className="secondary-button compact-button"
                  disabled={Boolean(submittingDecision)}
                  onClick={closeApprovalDecisionModal}
                  type="button"
                >
                  关闭
                </button>
              </header>
              <div className="product-config-modal-body approval-decision-modal-body">
                <div className="approval-decision-panel">
            <div className="evidence-check-panel">
              <div className="business-split">
                <div>
                  <h3>{selectedApprovalDecision.statusLabel}</h3>
                  <p className={selectedApprovalDecision.canApprove ? 'muted-line' : selectedApprovalDecision.tone === 'blocked' ? 'blocked-line' : 'warning-line'}>
                    {selectedApprovalDecision.detail}
                  </p>
                </div>
                <StatusPill tone={selectedApprovalDecision.tone}>{selectedApprovalDecision.statusLabel}</StatusPill>
              </div>
              <div className="context-summary-grid compact-summary">
                <div>
                  <span>建议对象</span>
                  <strong>{objectName(selected)}</strong>
                  <p>{selected.actionType} / {selected.currentValue || '-'} {'→'} {selected.recommendedValue || '-'}</p>
                </div>
                <div>
                  <span>处理范围</span>
                  <strong>{scope.storeName || '-'} / {scope.marketplaceCode || '-'}</strong>
                  <p>这里只记录人工审批；真实广告后台操作和结果核对在后续页面完成。</p>
                </div>
                <div>
                  <span>阻断概况</span>
                  <strong>缺证据 {selectedMissing.length} / 复核项 {selectedBlockers.length}</strong>
                  <p>{selectedApprovalDecision.canApprove ? '可以批准，批准后进入结果核对。' : '不能直接批准，请查看缺证据或复核要求。'}</p>
                </div>
              </div>
              <DecisionActionStrip
                items={[
                  {
                    label: '批准，进入结果核对',
                    detail: selectedApprovalDecision.canApprove ? '写入待执行队列' : '证据或复核未通过',
                    tone: selectedApprovalDecision.canApprove ? 'ready' : 'pending',
                    disabled: selectedSubmitBlockers.length > 0 || Boolean(submittingDecision),
                    onClick: approveSelected,
                  },
                  {
                    label: '查看复核要求',
                    detail: `缺证据 ${selectedMissing.length} / 复核项 ${selectedBlockers.length}`,
                    tone: selectedApprovalDecision.tone === 'ready' ? 'pending' : selectedApprovalDecision.tone,
                    onClick: showSelectedDecisionTarget,
                  },
                  {
                    label: '拒绝，不进入结果核对',
                    detail: '记录拒绝结果，不进入执行',
                    tone: 'blocked',
                    disabled: Boolean(submittingDecision),
                    onClick: rejectSelected,
                  },
                ]}
              />
            </div>
            <div id="approval-decision-details">
            <ProgressiveDetails title="审批预检、AI/规则关系、阈值和引用证据" defaultOpen={false}>
            <div className="evidence-check-panel">
              <div className="business-split">
                <div>
                  <h3>AI/规则决策摘要</h3>
                  <p className="muted-line">{selectedDecisionSummary.headline}</p>
                </div>
                <StatusPill tone={selectedDecisionSummary.tone}>{selectedDecisionSummary.statusLabel}</StatusPill>
              </div>
              {selectedDecisionSummary.reasons.length > 0 && (
                <ul className="business-list">
                  {selectedDecisionSummary.reasons.slice(0, 3).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
              <div className="context-summary-grid">
                <div>
                  <span>引用证据</span>
                  <strong>{selected.evidence?.aiEvidenceRefs?.length || 0} 条</strong>
                  <p>{selectedDecisionSummary.evidenceSummary}</p>
                </div>
                <div>
                  <span>审批动作</span>
                  <strong>{selectedDecisionSummary.nextAction}</strong>
                  <p>缺证据、AI 独立洞察或规则冲突时不能走普通批准。</p>
                </div>
              </div>
              {selectedDecisionSummary.riskWarnings.length > 0 && (
                <p className="blocked-line">风险：{selectedDecisionSummary.riskWarnings.join('；')}</p>
              )}
            </div>
            <div className="detail-grid">
              <div><span>建议 ID</span><strong>{selected.id}</strong></div>
              <div><span>审批范围</span><strong>{scope.storeName} / {scope.marketplaceCode}</strong></div>
              <div><span>当前批次</span><strong>{currentBatchId || '-'}</strong></div>
              <div><span>来源批次</span><strong>{selected.evidence?.batchId || '-'}</strong></div>
              <div><span>批次校验</span><strong>{selected.evidence?.batchId && currentBatchId && selected.evidence.batchId === currentBatchId ? '来源批次匹配' : '来源批次需核对'}</strong></div>
              <div><span>指标日期</span><strong>{selected.evidence?.date || '-'}</strong></div>
              <div><span>广告组合</span><strong>{selected.evidence?.portfolioName || '-'}</strong></div>
              <div><span>广告活动</span><strong>{selected.evidence?.campaignName || '-'}</strong></div>
              <div><span>广告组</span><strong>{selected.evidence?.adGroupName || '-'}</strong></div>
              <div><span>ASIN</span><strong>{selected.evidence?.asin || '-'}</strong></div>
              <div><span>对象类型</span><strong>{selected.entityType || selected.evidence?.matchType || '-'}</strong></div>
              <div><span>对象</span><strong>{objectName(selected)}</strong></div>
              <div><span>允许动作</span><strong>{selected.actionType}</strong></div>
              <div><span>当前值/建议值</span><strong>{selected.currentValue || '-'} {'→'} {selected.recommendedValue || '-'}</strong></div>
              <div><span>来源文件</span><strong>{sourceFiles(selected)}</strong></div>
              <div><span>审批预检</span><strong>{selectedMissing.length ? `阻断：缺 ${selectedMissing.join('、')}` : '通过'}</strong></div>
              <div><span>AI/规则决策关系</span><strong>{decisionLabel(selected)}</strong></div>
              <div><span>AI 策略诊断</span><strong>{strategyLabel(selected)} / {selected.evidence?.aiLifecycleStage || '阶段待判定'}</strong></div>
              <div><span>AI 动态阈值</span><strong>{aiThresholdSummary(selected)}</strong></div>
              <div><span>产品阶段</span><strong>{productStageLabel(selected.evidence?.productStage)}</strong></div>
              <div><span>产品目标 ACOS / TACOS</span><strong>{optionalPercent(selected.evidence?.productTargetAcos)} / {optionalPercent(selected.evidence?.productTargetTacos)}</strong></div>
              <div><span>目标净利率 / 最低价</span><strong>{optionalPercent(selected.evidence?.productTargetNetMargin)} / {optionalMoney(selected.evidence?.productMinPrice)}</strong></div>
              <div><span>规则量化</span><strong>{quantSummary(selected)}</strong></div>
              <div><span>量化阈值</span><strong>{thresholdSummary(selected)}</strong></div>
              <div><span>来源行号</span><strong>{selected.evidence?.sourceRow || '-'}</strong></div>
              <div><span>普通批准</span><strong>{selectedBlockers.length ? `阻断：${selectedBlockers.join('、')}` : '允许'}</strong></div>
            </div>
            {selected.evidence?.quantReasons?.length ? (
              <p className={selected.evidence.quantReviewRequired ? 'blocked-line' : 'muted-line'}>
                规则量化依据：{selected.evidence.quantReasons.join('；')}
              </p>
            ) : null}
            {selected.evidence?.aiStrategySummary && (
              <div className="evidence-check-panel">
                <h3>AI 策略诊断</h3>
                <p className="muted-line">{selected.evidence.aiStrategySummary}</p>
                {selected.evidence.aiLifecycleStageReason && (
                  <p className={selected.evidence.aiLifecycleStageRequiresReview ? 'warning-line' : 'muted-line'}>
                    阶段判断依据：{selected.evidence.aiLifecycleStageReason}
                  </p>
                )}
                {Boolean(selected.evidence.aiLifecycleStageEvidenceRefs?.length) && (
                  <p className="muted-line">阶段引用证据：{formatEvidenceRefSummary(selected.evidence.aiLifecycleStageEvidenceRefs, selected.evidence.aiLifecycleStageEvidenceDetails)}</p>
                )}
                {selected.evidence.aiLifecycleStageRequiresReview && (
                  <p className="blocked-line">
                    阶段判断需复核：{selected.evidence.aiLifecycleStageInvalidReasons?.join('；') || 'AI 阶段判断缺少有效可回查证据。'}
                  </p>
                )}
                <p className="muted-line">AI 动态阈值：{aiThresholdSummary(selected)}</p>
                <p className="muted-line">AI 主要问题：{compactList(selected.evidence.aiMainProblems)}</p>
                <p className={selected.evidence.aiStrategyRiskWarnings?.length ? 'blocked-line' : 'muted-line'}>
                  AI 风险提示：{compactList(selected.evidence.aiStrategyRiskWarnings)}
                </p>
              </div>
            )}
            {(selected.evidence?.aiReasoningSteps?.length || selected.evidence?.aiEvidenceRefs?.length || selected.evidence?.aiInsightInvalidReasons?.length) ? (
              <div className="evidence-check-panel">
                <h3>AI 判断依据</h3>
                {selected.evidence?.aiInsightOnly && (
                  <p className="blocked-line">该建议缺少 AI 可回查证据，仅作为洞察展示，不能审批。</p>
                )}
                {Boolean(selected.evidence?.aiReasoningSteps?.length) && (
                  <ul className="business-list">
                    {selected.evidence?.aiReasoningSteps?.slice(0, 5).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                )}
                <p className="muted-line">引用证据：{formatEvidenceRefSummary(selected.evidence?.aiEvidenceRefs, selected.evidence?.aiEvidenceDetails)}</p>
                {Boolean(selected.evidence?.aiInsightInvalidReasons?.length) && (
                  <p className="blocked-line">{selected.evidence.aiInsightInvalidReasons?.join('；')}</p>
                )}
                {Boolean(selected.evidence?.aiEvidenceDetails?.length || selected.evidence?.aiLifecycleStageEvidenceDetails?.length) && (
                  <div className="evidence-check-panel">
                    <h3>引用证据详情</h3>
                    <div className="context-summary-grid">
                      {[
                        ...(selected.evidence?.aiEvidenceDetails || []),
                        ...(selected.evidence?.aiLifecycleStageEvidenceDetails || []),
                      ].filter((item, index, all) => all.findIndex((other) => other.evidenceId === item.evidenceId) === index).slice(0, 6).map((item) => (
                        <div key={item.evidenceId}>
                          <span>{evidenceTypeLabel(item.type)}</span>
                          <strong>{item.label}</strong>
                          <p>{evidenceContextLine(item)}</p>
                          <p>{[item.campaignName || '-', item.adGroupName || '-', item.asin || '-', item.entityName || '-'].join(' / ')}</p>
                          {item.metrics && <p>{evidenceMetricLine(item)}</p>}
                          {item.event && <p>{[item.event.eventDate || '-', item.event.eventType || '-', item.event.impactExpectation || '-'].join(' / ')}</p>}
                          {item.sourceFile && <code title={item.sourceFile}>{item.sourceFile}</code>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            {(selected.evidence?.decisionReasons?.length || selected.evidence?.decisionRiskWarnings?.length) ? (
              <div className="evidence-check-panel">
                <h3>AI/规则合并依据</h3>
                <p className="muted-line">决策关系：{decisionLabel(selected)} / 来源：{selected.evidence?.decisionSource || 'rule'}</p>
                <ul className="business-list">
                  {(selected.evidence?.decisionReasons || []).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {Boolean(selected.evidence?.decisionRiskWarnings?.length) && (
                  <p className="blocked-line">合并风险：{selected.evidence?.decisionRiskWarnings?.join('；')}</p>
                )}
              </div>
            ) : null}
            {selectedBlockers.length > 0 && (
              <p className="blocked-line">这条建议不能走普通批准：{selectedBlockers.join('、')}。请在复核队列处理，或重新生成规则确认后的建议。</p>
            )}
            {selectedMissing.length > 0 && (
              <p className="blocked-line">审批证据不完整：缺 {selectedMissing.join('、')}。补齐当前批次真实报表来源后才能批准。</p>
            )}
            </ProgressiveDetails>
            </div>
            <div id="approval-form">
              <FormTable>
                <FormTableRow label="审批/处理人" required>
                <input
                  data-overlay-initial-focus
                  onChange={(event) => setApproverName(event.target.value)}
                  placeholder="负责人姓名"
                  value={approverName}
                />
                </FormTableRow>
                <FormTableRow label="审批时间">
                <input readOnly value={new Date().toISOString()} />
                </FormTableRow>
                <FormTableRow label="审批备注/拒绝原因">
                <textarea value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="记录审批范围、外部审批凭证或拒绝原因" />
                </FormTableRow>
              </FormTable>
            </div>
            <p className="muted-line">审批人、备注、范围和数据批次会写入建议证据；真实广告后台操作和审批凭证路径仍必须在“结果核对”页逐条补齐。</p>
            <div className="action-row">
              <button
                aria-busy={approveButton.ariaBusy}
                className={approveButton.className}
                disabled={approveButton.disabled}
                onClick={approveSelected}
                type="button"
              >
                {approveButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                {approveButton.label}
              </button>
              <button
                aria-busy={rejectButton.ariaBusy}
                className={rejectButton.className}
                disabled={rejectButton.disabled}
                onClick={rejectSelected}
                type="button"
              >
                {rejectButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                {rejectButton.label}
              </button>
            </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {message && <p className={message.includes('失败') || message.includes('必须') ? 'blocked-line' : 'muted-line'}>{message}</p>}
      </div>
    </div>
  );
}
