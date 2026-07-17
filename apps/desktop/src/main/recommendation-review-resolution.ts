import type {
  ActionRecommendation,
  RecommendationReviewResolution,
  ResolveRecommendationReviewRequest,
  ResolveRecommendationReviewResult,
  WritableAdTargetEvidence,
  WritableAdTargetReviewInput,
} from '@amazon-ai-ops/shared-types';
import { getRecommendationApprovalBlockers } from './recommendation-approval-policy';
import {
  getRecommendationWritableTargetOwnershipBlockers,
  type RecommendationMetricSourceAuthority,
} from './recommendation-writable-target-policy';

export interface ResolveRecommendationReviewInput {
  recommendation: ActionRecommendation;
  request: ResolveRecommendationReviewRequest;
  allowedSourceFiles: string[];
  sourceAuthority: RecommendationMetricSourceAuthority;
  reviewedAt: string;
  resolveWritableTarget: (
    candidate: WritableAdTargetReviewInput,
    context: { reviewedBy: string; reviewedAt: string },
  ) => WritableAdTargetEvidence;
  persist: (status: 'pending', evidencePatch: Record<string, unknown>) => boolean;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalized(value: unknown): string {
  return text(value).toLowerCase();
}

function normalizedAsin(value: unknown): string {
  return text(value).toUpperCase();
}

function normalizedPath(value: unknown): string {
  return text(value).replace(/\\/g, '/').toLowerCase();
}

function fail(reason: string): never {
  throw new Error(`复核被阻断：${reason}`);
}

function assertCurrentReviewScope(
  recommendation: ActionRecommendation,
  request: ResolveRecommendationReviewRequest,
  allowedSourceFiles: string[],
): void {
  const scope = request.scope;
  if (
    normalized(recommendation.storeName) !== normalized(scope.storeName)
    || normalized(recommendation.marketplaceCode) !== normalized(scope.marketplaceCode)
    || normalizedAsin(recommendation.asin || recommendation.evidence?.asin) !== normalizedAsin(scope.asin)
    || text(recommendation.evidence?.batchId) !== text(scope.batchId)
    || !text(scope.dateFrom)
    || !text(scope.dateTo)
  ) {
    fail('建议与当前锁定范围或批次不一致，请刷新后重试。');
  }
  const allowed = new Set(allowedSourceFiles.map(normalizedPath));
  const sourceFiles = Array.isArray(recommendation.evidence?.sourceFiles)
    ? recommendation.evidence.sourceFiles
    : [];
  if (!sourceFiles.length || sourceFiles.some((filePath) => !allowed.has(normalizedPath(filePath)))) {
    fail('建议来源文件不属于当前真实报表批次。');
  }
  const sourceRow = Number(recommendation.evidence?.sourceRow);
  if (!Number.isInteger(sourceRow) || sourceRow <= 0) {
    fail('建议缺少可追溯的原始来源行。');
  }
}

export function resolveRecommendationReview(
  input: ResolveRecommendationReviewInput,
): ResolveRecommendationReviewResult {
  const { recommendation, request } = input;
  if (!Number.isInteger(request.recommendationId) || request.recommendationId <= 0 || recommendation.id !== request.recommendationId) {
    fail('建议不存在或标识无效。');
  }
  if (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 0) {
    fail('缺少有效建议版本。');
  }
  if ((recommendation.revision ?? 0) !== request.expectedRevision) {
    throw new Error('复核状态冲突：建议内容已更新，请刷新后重试。');
  }
  if (recommendation.status !== 'needs_review') {
    fail(`建议当前状态 ${recommendation.status} 不能确认复核。`);
  }
  if (recommendation.actionType !== 'lower_bid') {
    fail('首个受控复核仅支持有边界的降低竞价动作。');
  }
  if (recommendation.evidence?.quantReviewRequired !== true) {
    fail('当前建议不是可处理的规则量化复核。');
  }
  const reviewedBy = text(request.review?.reviewedBy);
  const rationale = text(request.review?.rationale);
  const reviewedAt = text(input.reviewedAt);
  if (!reviewedBy || !rationale || !Number.isFinite(Date.parse(reviewedAt))) {
    fail('复核人、复核依据和有效时间均为必填。');
  }

  assertCurrentReviewScope(recommendation, request, input.allowedSourceFiles);
  const writableTarget = input.resolveWritableTarget(request.review.writableTarget, {
    reviewedBy,
    reviewedAt,
  });
  const ownershipBlockers = getRecommendationWritableTargetOwnershipBlockers(
    recommendation,
    writableTarget,
    input.sourceAuthority,
  );
  if (ownershipBlockers.length > 0) fail(`${ownershipBlockers.join('、')}。`);
  const reviewCandidate: ActionRecommendation = {
    ...recommendation,
    evidence: {
      ...recommendation.evidence,
      writableTarget,
    },
  };
  const unresolved = getRecommendationApprovalBlockers(reviewCandidate, {
    allowedSourceFiles: input.allowedSourceFiles,
    sourceAuthority: input.sourceAuthority,
  }).filter((blocker) => blocker !== '建议已进入复核队列' && blocker !== '规则量化要求人工复核');
  if (unresolved.length > 0) {
    fail(`仍有不可解除的审批阻断：${unresolved.join('、')}。`);
  }

  const fromRevision = request.expectedRevision;
  const resolvedRevision = fromRevision + 1;
  const resolution: RecommendationReviewResolution = {
    schemaVersion: 1,
    fromStatus: 'needs_review',
    fromRevision,
    resolvedRevision,
    reviewedBy,
    reviewedAt: new Date(Date.parse(reviewedAt)).toISOString(),
    rationale,
    resolvedBlockers: ['quant_review_required'],
    scope: {
      dateFrom: text(request.scope.dateFrom),
      dateTo: text(request.scope.dateTo),
      storeName: text(request.scope.storeName),
      marketplaceCode: text(request.scope.marketplaceCode),
      asin: text(request.scope.asin),
      batchId: text(request.scope.batchId),
    },
    metricSource: {
      batchId: text(recommendation.evidence.batchId),
      sourceFiles: [...(recommendation.evidence.sourceFiles || [])],
      sourceRow: Number(recommendation.evidence.sourceRow),
    },
    writableTarget,
  };
  const persisted = input.persist('pending', {
    writableTarget,
    reviewResolution: resolution,
  });
  if (!persisted) {
    throw new Error('复核状态冲突：建议已被其他操作更新，请刷新后重试。');
  }

  return {
    ok: true,
    recommendationId: request.recommendationId,
    previousStatus: 'needs_review',
    status: 'pending',
    revision: resolvedRevision,
    reviewedAt: resolution.reviewedAt,
    resolvedBlockers: ['quant_review_required'],
  };
}
