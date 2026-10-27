import type { RecommendationView } from '../types';

export function sourceFiles(rec: RecommendationView): string {
  return rec.evidence?.sourceFiles?.length ? rec.evidence.sourceFiles.join(', ') : '-';
}

export function isRealReportSourceFile(sourceRef: unknown): boolean {
  return /\.(xlsx|xls|csv)$/i.test(String(sourceRef || '').trim().split(/[?#]/)[0]);
}

export function normalizeSourceFile(sourceRef: unknown): string {
  return String(sourceRef || '').trim().replace(/\\/g, '/').toLowerCase();
}

export function sameSourceFiles(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => Array.isArray(value)
    ? Array.from(new Set(value.map(normalizeSourceFile).filter(Boolean))).sort()
    : [];
  const leftFiles = normalize(left);
  const rightFiles = normalize(right);
  return leftFiles.length === rightFiles.length
    && leftFiles.every((sourceRef, index) => sourceRef === rightFiles[index]);
}

export function sameTimestamp(left: unknown, right: unknown): boolean {
  const leftTimestamp = Date.parse(String(left || '').trim());
  const rightTimestamp = Date.parse(String(right || '').trim());
  return Number.isFinite(leftTimestamp)
    && Number.isFinite(rightTimestamp)
    && leftTimestamp === rightTimestamp;
}

export function sameWritableTarget(
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
