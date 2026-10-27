import type {
  BindRecommendationWritableTargetRequest,
  BindRecommendationWritableTargetResult,
  ResolveRecommendationReviewRequest,
  ResolveRecommendationReviewResult,
  WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import type { RecommendationView } from '../types';
import { toUserFacingError } from '../user-facing-error';

export function sameDecisionsWritableTarget(
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

export function sameDecisionsTargetBindingScope(
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

export function sameDecisionsSourceFiles(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const file = (value: unknown) => String(value ?? '').trim().replace(/\\/g, '/').toLowerCase();
  return left.every((value, index) => file(value) === file(right[index]));
}

export function decisionsTargetMatchesBindingRequest(
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

export function decisionsTargetMatchesRecommendationEvidence(
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

export function decisionsTargetMatchesReviewRequest(
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

export function hasOnlyQuantReviewBlocker(value: unknown): boolean {
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
    && result.status === 'verified'
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
