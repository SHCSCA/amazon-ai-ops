import type {
  ActionRecommendation,
  BindRecommendationWritableTargetRequest,
  BindRecommendationWritableTargetResult,
  WritableAdTargetBinding,
  WritableAdTargetEvidence,
  WritableAdTargetReviewInput,
} from '@amazon-ai-ops/shared-types';
import {
  getRecommendationApprovalBlockers,
  getRecommendationApprovalMissingFields,
} from './recommendation-approval-policy';
import {
  getRecommendationWritableTargetOwnershipBlockers,
  type RecommendationMetricSourceAuthority,
} from './recommendation-writable-target-policy';

export interface BindRecommendationWritableTargetInput {
  recommendation: ActionRecommendation;
  request: BindRecommendationWritableTargetRequest;
  allowedSourceFiles: string[];
  sourceAuthority: RecommendationMetricSourceAuthority;
  boundAt: string;
  resolveWritableTarget: (
    candidate: WritableAdTargetReviewInput,
    context: { boundBy: string; boundAt: string },
  ) => WritableAdTargetEvidence;
  persist: (evidencePatch: {
    writableTarget: WritableAdTargetEvidence;
    writableTargetBinding: WritableAdTargetBinding;
  }) => boolean;
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
  throw new Error(`Ads 对象核验被阻断：${reason}`);
}

function approvalBlockersWithoutWritableTarget(
  recommendation: ActionRecommendation,
  allowedSourceFiles: string[],
  sourceAuthority: RecommendationMetricSourceAuthority,
): string[] {
  const missing = getRecommendationApprovalMissingFields(recommendation)
    .filter((label) => label !== 'Ads 可写对象');
  const blockers = getRecommendationApprovalBlockers(recommendation, {
    allowedSourceFiles,
    sourceAuthority,
  })
    .filter((blocker) => !blocker.startsWith('缺少审批字段：'));
  return [
    ...(missing.length ? [`缺少审批字段：${missing.join('、')}`] : []),
    ...blockers,
  ];
}

function assertLockedScope(
  recommendation: ActionRecommendation,
  request: BindRecommendationWritableTargetRequest,
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
  const sourceFiles = recommendation.evidence?.sourceFiles || [];
  if (!sourceFiles.length || sourceFiles.some((filePath) => !allowed.has(normalizedPath(filePath)))) {
    fail('建议来源文件不属于当前真实报表批次。');
  }
  const sourceRow = Number(recommendation.evidence?.sourceRow);
  if (!Number.isInteger(sourceRow) || sourceRow <= 0) {
    fail('建议缺少可追溯的原始来源行。');
  }
}

export function bindRecommendationWritableTarget(
  input: BindRecommendationWritableTargetInput,
): BindRecommendationWritableTargetResult {
  const { recommendation, request } = input;
  if (!Number.isInteger(request.recommendationId) || request.recommendationId <= 0 || recommendation.id !== request.recommendationId) {
    fail('建议不存在或标识无效。');
  }
  if (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 0) {
    fail('缺少有效建议版本。');
  }
  if ((recommendation.revision ?? 0) !== request.expectedRevision) {
    throw new Error('Ads 对象核验状态冲突：建议内容已更新，请刷新后重试。');
  }
  if (recommendation.status !== 'pending') {
    fail(`建议当前状态 ${recommendation.status} 不能核验 Ads 对象。`);
  }
  if (recommendation.actionType !== 'lower_bid' || recommendation.evidence?.quantReviewRequired === true) {
    fail('当前入口仅支持无需量化复核的降低竞价待审批建议。');
  }
  if (recommendation.evidence?.writableTarget || recommendation.evidence?.writableTargetBinding) {
    fail('当前建议已经存在 Ads 可写对象或绑定审计，不能覆盖既有权威记录。');
  }

  const boundBy = text(request.binding?.boundBy);
  const note = text(request.binding?.note);
  const boundAt = text(input.boundAt);
  if (!boundBy || !note || !Number.isFinite(Date.parse(boundAt))) {
    fail('核验人、绑定说明和有效时间均为必填。');
  }
  assertLockedScope(recommendation, request, input.allowedSourceFiles);
  const preBindingBlockers = approvalBlockersWithoutWritableTarget(
    recommendation,
    input.allowedSourceFiles,
    input.sourceAuthority,
  );
  if (preBindingBlockers.length > 0) {
    fail(`仍有不可由对象核验解除的审批阻断：${preBindingBlockers.join('、')}。`);
  }

  const writableTarget = input.resolveWritableTarget(request.binding.writableTarget, {
    boundBy,
    boundAt,
  });
  const ownershipBlockers = getRecommendationWritableTargetOwnershipBlockers(
    recommendation,
    writableTarget,
    input.sourceAuthority,
  );
  if (ownershipBlockers.length > 0) fail(`${ownershipBlockers.join('、')}。`);
  const candidate: ActionRecommendation = {
    ...recommendation,
    evidence: { ...recommendation.evidence, writableTarget },
  };
  const remainingBlockers = getRecommendationApprovalBlockers(candidate, {
    allowedSourceFiles: input.allowedSourceFiles,
    sourceAuthority: input.sourceAuthority,
  });
  if (remainingBlockers.length > 0) {
    fail(`核验后仍有不可解除的审批阻断：${remainingBlockers.join('、')}。`);
  }

  const fromRevision = request.expectedRevision;
  const boundRevision = fromRevision + 1;
  const normalizedBoundAt = new Date(Date.parse(boundAt)).toISOString();
  const writableTargetBinding: WritableAdTargetBinding = {
    schemaVersion: 1,
    fromRevision,
    boundRevision,
    boundBy,
    boundAt: normalizedBoundAt,
    note,
    scope: {
      dateFrom: text(request.scope.dateFrom),
      dateTo: text(request.scope.dateTo),
      storeName: text(request.scope.storeName),
      marketplaceCode: text(request.scope.marketplaceCode),
      asin: text(request.scope.asin),
      batchId: text(request.scope.batchId),
    },
    metricSource: {
      batchId: text(recommendation.evidence?.batchId),
      sourceFiles: [...(recommendation.evidence?.sourceFiles || [])],
      sourceRow: Number(recommendation.evidence?.sourceRow),
    },
    writableTarget,
  };
  const persisted = input.persist({ writableTarget, writableTargetBinding });
  if (!persisted) {
    throw new Error('Ads 对象核验状态冲突：建议已被其他操作更新，请刷新后重试。');
  }
  return {
    ok: true,
    recommendationId: request.recommendationId,
    status: 'bound',
    revision: boundRevision,
    boundAt: normalizedBoundAt,
  };
}
