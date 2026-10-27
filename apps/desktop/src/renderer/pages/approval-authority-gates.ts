import type { RecommendationView } from '../types';
import { objectName } from "./approval-presentation";
import {
  sourceFiles,
  isRealReportSourceFile,
  normalizeSourceFile,
  hasCurrentRecommendationReviewResolution,
} from "./approval-identity-proof";

export function parseExecutableNumber(value: unknown): number | undefined {
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

export function riskRequiresDedicatedReview(riskLevel?: string): boolean {
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

export function approvalValueBlockers(rec: RecommendationView): string[] {
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
