import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';

export interface RecommendationApprovalPolicyOptions {
  allowedSourceFiles?: string[];
}

export type RecommendationDecisionStatus = 'approved' | 'rejected';

export interface RecommendationDecisionInput {
  [key: string]: unknown;
  approvedBy?: unknown;
  rejectedBy?: unknown;
  note?: unknown;
}

export interface ApplyRecommendationDecisionInput {
  recommendation: ActionRecommendation;
  targetStatus: RecommendationDecisionStatus;
  decision: RecommendationDecisionInput;
  approvalOptions?: RecommendationApprovalPolicyOptions;
  persist: (status: RecommendationDecisionStatus, evidencePatch: Record<string, unknown>) => void;
}

export interface RecommendationDecisionRequest {
  id: number;
  expectedRevision: unknown;
  decision: RecommendationDecisionInput;
}

export function normalizeRecommendationDecisionRequest(input: unknown): RecommendationDecisionRequest {
  if (typeof input === 'number') {
    return { id: input, expectedRevision: undefined, decision: {} };
  }
  const request = input && typeof input === 'object'
    ? input as Record<string, unknown>
    : {};
  return {
    id: Number(request.id || 0),
    expectedRevision: request.expectedRevision,
    decision: request.decision && typeof request.decision === 'object'
      ? request.decision as RecommendationDecisionInput
      : {},
  };
}

export function assertRecommendationDecisionRevision(
  recommendation: ActionRecommendation,
  expectedRevision: unknown,
): number {
  if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('审批被阻断：缺少有效建议版本，请刷新列表后重试。');
  }
  if ((recommendation.revision ?? 0) !== expectedRevision) {
    throw new Error('审批状态冲突：建议内容已更新，请刷新后重试。');
  }
  return expectedRevision;
}

function normalizedRiskLevel(riskLevel: unknown): string {
  return String(riskLevel || '').trim().toLowerCase();
}

function nonEmpty(value: unknown): boolean {
  const text = String(value || '').trim();
  return Boolean(text && text !== '-');
}

export function assertRecommendationDecisionTransition(
  recommendation: ActionRecommendation,
  targetStatus: RecommendationDecisionStatus,
  decision: RecommendationDecisionInput,
): void {
  if (targetStatus === 'approved' && recommendation.status !== 'pending') {
    throw new Error(`审批被阻断：建议当前状态 ${recommendation.status} 不允许转为 ${targetStatus}。`);
  }
  if (targetStatus === 'rejected' && recommendation.status !== 'pending' && recommendation.status !== 'needs_review') {
    throw new Error(`审批被阻断：建议当前状态 ${recommendation.status} 不允许转为 ${targetStatus}。`);
  }
  if (targetStatus === 'approved' && !nonEmpty(decision.approvedBy)) {
    throw new Error('审批被阻断：批准前必须填写审批人。');
  }
  if (targetStatus === 'rejected' && !nonEmpty(decision.rejectedBy)) {
    throw new Error('审批被阻断：拒绝前必须填写处理人。');
  }
  if (targetStatus === 'rejected' && !nonEmpty(decision.note)) {
    throw new Error('审批被阻断：拒绝前必须填写拒绝原因。');
  }
}

export function applyRecommendationDecision(input: ApplyRecommendationDecisionInput): void {
  assertRecommendationDecisionTransition(input.recommendation, input.targetStatus, input.decision);
  if (input.targetStatus === 'approved') {
    assertRecommendationApprovalPolicy(input.recommendation, input.approvalOptions);
  }
  input.persist(input.targetStatus, {
    approvalDecision: {
      ...input.decision,
      decision: input.targetStatus,
    },
  });
}

function positiveNumber(value: unknown): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function parseExecutableNumber(value: unknown): number | undefined {
  const text = String(value || '').trim();
  if (!text || /[%％]/.test(text)) return undefined;
  const parsed = Number(text.replace(/^\$/, '').replace(/\s*usd$/i, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function recommendationObjectName(recommendation: ActionRecommendation): string {
  return recommendation.evidence?.searchTerm
    || recommendation.evidence?.targeting
    || recommendation.entityName
    || '';
}

function isRealReportSourceFile(filePath: unknown): boolean {
  const normalized = String(filePath || '').trim().toLowerCase().split(/[?#]/)[0];
  return /\.(xlsx|xls|csv)$/.test(normalized);
}

function normalizeSourceFile(filePath: unknown): string {
  return String(filePath || '').trim().replace(/\\/g, '/').toLowerCase();
}

export function getRecommendationApprovalMissingFields(recommendation: ActionRecommendation): string[] {
  const missing: string[] = [];
  const requireField = (value: unknown, label: string) => {
    if (!nonEmpty(value)) missing.push(label);
  };

  requireField(recommendation.storeName, '店铺');
  requireField(recommendation.marketplaceCode, '站点');
  requireField(recommendation.asin || recommendation.evidence?.asin, 'ASIN');
  requireField(recommendation.evidence?.batchId, '来源批次');
  requireField(recommendation.evidence?.date, '指标日期');
  requireField(recommendation.evidence?.campaignName, '广告活动');
  requireField(recommendation.evidence?.adGroupName, '广告组');
  requireField(recommendation.entityType || recommendation.evidence?.matchType, '对象类型');
  requireField(recommendationObjectName(recommendation), '关键词/搜索词/投放对象');
  requireField(recommendation.actionType, '动作');
  requireField(recommendation.currentValue, '当前值');
  requireField(recommendation.recommendedValue, '建议值');
  const sourceFiles = recommendation.evidence?.sourceFiles || [];
  if (!sourceFiles.length) missing.push('来源文件');
  if (sourceFiles.length && !sourceFiles.every(isRealReportSourceFile)) missing.push('真实来源报表');
  if (!positiveNumber(recommendation.evidence?.sourceRow)) missing.push('来源行号');

  return missing;
}

export function getRecommendationApprovalBlockers(
  recommendation: ActionRecommendation,
  options: RecommendationApprovalPolicyOptions = {},
): string[] {
  const agreement = recommendation.evidence?.decisionAgreement;
  const aiActionParticipated = agreement === 'aligned' || agreement === 'ai_only';
  const riskLevel = normalizedRiskLevel(recommendation.riskLevel);
  const blockers: string[] = [];
  const missingFields = getRecommendationApprovalMissingFields(recommendation);
  if (missingFields.length > 0) blockers.push(`缺少审批字段：${missingFields.join('、')}`);
  blockers.push(...getExecutableValueBlockers(recommendation));
  if (recommendation.status === 'needs_review') blockers.push('建议已进入复核队列');
  if (agreement === 'ai_only') blockers.push('AI-only 建议');
  if (agreement === 'conflict') blockers.push('AI/规则冲突');
  if (recommendation.evidence?.aiInsightOnly === true) blockers.push('AI 洞察未进入正式建议池');
  if (recommendation.evidence?.aiStrategySource === 'ai'
    && aiActionParticipated
    && (!Array.isArray(recommendation.evidence?.aiEvidenceRefs) || recommendation.evidence.aiEvidenceRefs.length === 0)
  ) {
    blockers.push('AI 建议缺少可回查证据引用');
  }
  if (recommendation.evidence?.aiStrategySource === 'ai'
    && aiActionParticipated
    && Array.isArray(recommendation.evidence?.aiEvidenceRefs)
    && recommendation.evidence.aiEvidenceRefs.length > 0
  ) {
    const details = Array.isArray(recommendation.evidence?.aiEvidenceDetails)
      ? recommendation.evidence.aiEvidenceDetails
      : [];
    const detailIds = new Set(details.map((detail) => String(detail?.evidenceId || '').trim()).filter(Boolean));
    const allRefsResolved = recommendation.evidence.aiEvidenceRefs.every((ref) => detailIds.has(String(ref || '').trim()));
    if (!details.length || !allRefsResolved) blockers.push('AI 建议缺少可展示的证据详情');
  }
  const sourceFiles = recommendation.evidence?.sourceFiles || [];
  const allowedSourceFiles = options.allowedSourceFiles || [];
  if (sourceFiles.length > 0 && allowedSourceFiles.length > 0) {
    const allowed = new Set(allowedSourceFiles.map(normalizeSourceFile));
    const allSourcesCurrent = sourceFiles.every((file) => allowed.has(normalizeSourceFile(file)));
    if (!allSourcesCurrent) blockers.push('来源文件不属于当前数据批次真实报表');
  }
  if (recommendation.evidence?.decisionRequiresReview === true) blockers.push('AI/规则合并标记需复核');
  if (aiActionParticipated && recommendation.evidence?.aiLifecycleStageRequiresReview === true) blockers.push('AI 阶段判断需要人工复核');
  if (recommendation.evidence?.quantReviewRequired === true) blockers.push('规则量化要求人工复核');
  if (riskLevel === 'forbidden' || riskLevel === 'high' || riskLevel.includes('forbidden')) {
    blockers.push('高风险或禁止执行风险等级');
  }
  return blockers;
}

function getExecutableValueBlockers(recommendation: ActionRecommendation): string[] {
  const action = String(recommendation.actionType || '').trim();
  const currentValue = parseExecutableNumber(recommendation.currentValue);
  const recommendedValue = parseExecutableNumber(recommendation.recommendedValue);

  if (action === 'lower_bid' || action === 'raise_bid') {
    if (recommendedValue === undefined) return ['出价建议值必须是可执行的正数金额'];
    if (currentValue === undefined) return ['当前出价必须是可回查的正数金额'];
    if (action === 'lower_bid' && recommendedValue >= currentValue) {
      return ['降价动作的建议出价必须低于当前出价'];
    }
    if (action === 'raise_bid' && recommendedValue <= currentValue) {
      return ['提价动作的建议出价必须高于当前出价'];
    }
  }

  if (action === 'adjust_campaign_budget') {
    if (recommendedValue === undefined) return ['预算建议值必须是可执行的正数金额'];
  }

  return [];
}

export function assertRecommendationApprovalPolicy(
  recommendation: ActionRecommendation,
  options: RecommendationApprovalPolicyOptions = {},
): void {
  const blockers = getRecommendationApprovalBlockers(recommendation, options);
  if (blockers.length > 0) {
    throw new Error(`审批被阻断：${blockers.join('、')}，不能走普通批准；请先完成专门复核或重新生成规则确认后的建议。`);
  }
}
