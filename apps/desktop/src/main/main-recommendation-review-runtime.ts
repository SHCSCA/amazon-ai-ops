import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import type { BindRecommendationWritableTargetRequest, BindRecommendationWritableTargetResult, ResolveRecommendationReviewRequest, ResolveRecommendationReviewResult, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { applyRecommendationDecision, assertRecommendationDecisionRevision, normalizeRecommendationDecisionRequest } from './recommendation-approval-policy';
import { resolveWritableAdTargetAuthority } from './writable-ad-target-resolution';
import { resolveRecommendationReview } from './recommendation-review-resolution';
import { bindRecommendationWritableTarget } from './recommendation-writable-target-binding';
import { type RecommendationMetricSourceAuthority } from './recommendation-writable-target-policy';
import { assertRecommendationMetricSourceAuthority } from './recommendation-metric-source-authority';
import { resolveBusinessStoreAuthority } from './main-business-scope-runtime';
import { loadPersistedLingxingBatch } from './main-report-diagnostic-read-model-runtime';
import { getBusinessRecommendationGate } from './main-business-metrics-runtime';
import { assertRecommendationWritableTargetCurrent } from './main-ad-readback-authority-runtime';
import type { BusinessBatchResult } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function assertRecommendationCurrentDataGate(recommendationId: number): {
  recommendation: ActionRecommendation;
  storeId: StoreContextEnvelope['storeId'];
  allowedSourceFiles: string[];
  sourceAuthority: RecommendationMetricSourceAuthority;
} {
  const mainRuntimeContext = getMainRuntimeContext();
  const { context, store } = resolveBusinessStoreAuthority();
  const recommendation = mainRuntimeContext.state.recommendationRepo?.findByIdForStore(context.storeId, recommendationId);
  if (!recommendation) {
    throw new Error('审批被阻断：建议不存在，请刷新后重试。');
  }
  const batchId = recommendation.evidence?.batchId;
  if (!batchId) {
    throw new Error('审批被阻断：该建议缺少当前数据批次 evidence.batchId，请基于真实报表重新生成建议。');
  }
  let batchResult: BusinessBatchResult;
  try {
    batchResult = loadPersistedLingxingBatch(batchId);
  } catch {
    throw new Error(`审批被阻断：建议绑定的数据批次不存在或不可读取：${batchId}`);
  }
  const scope = {
    storeId: context.storeId,
    dateFrom: batchResult.batch.dateStart,
    dateTo: batchResult.batch.dateEnd,
    storeName: store.displayName,
    marketplaceCode: 'US' as const,
    asin: recommendation.asin,
    batchId,
    storeContext: context,
  };
  const gate = getBusinessRecommendationGate(scope, 'approval');
  const sourceAuthority = assertRecommendationWritableTargetCurrent(
    recommendation,
    scope,
    gate.metricSource.sourceFiles,
  );
  return {
    recommendation,
    storeId: context.storeId,
    allowedSourceFiles: gate.metricSource.sourceFiles,
    sourceAuthority,
  };
}

export function resolveLockedRecommendationBatchScope(
  recommendation: ActionRecommendation,
  rendererScope: { dateFrom?: string; dateTo?: string; batchId?: string } | undefined,
): {
  dateFrom: string;
  dateTo: string;
  storeName: string;
  marketplaceCode: string;
  asin: string;
  batchId: string;
} {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) {
    throw new Error('BATCH_UNAVAILABLE: Ads 对象核验被阻断：本地权威数据库尚未初始化。');
  }
  const { context } = resolveBusinessStoreAuthority();
  const batchId = String(recommendation.evidence?.batchId ?? '').trim();
  if (!batchId) {
    throw new Error('SCOPE_BATCH_MISMATCH: Ads 对象核验被阻断：建议缺少锁定报表批次。');
  }
  const batch = mainRuntimeContext.state.db.prepare(`
    SELECT id AS batchId, date_start AS dateFrom, date_end AS dateTo
    FROM lingxing_report_batches
    WHERE store_id = ? AND id = ? AND status = 'completed'
  `).get(context.storeId, batchId) as {
    batchId: string;
    dateFrom: string;
    dateTo: string;
  } | undefined;
  if (!batch || !String(batch.dateFrom || '').trim() || !String(batch.dateTo || '').trim()) {
    throw new Error('BATCH_UNAVAILABLE: Ads 对象核验被阻断：建议锁定批次不可用。');
  }
  const dateFrom = String(rendererScope?.dateFrom ?? '').trim();
  const dateTo = String(rendererScope?.dateTo ?? '').trim();
  const requestedBatch = String(rendererScope?.batchId ?? '').trim();
  if (dateFrom && dateFrom !== batch.dateFrom) {
    throw new Error('SCOPE_DATE_MISMATCH: Ads 对象核验被阻断：请求日期必须等于锁定批次日期，不能使用顶栏范围。');
  }
  if (dateTo && dateTo !== batch.dateTo) {
    throw new Error('SCOPE_DATE_MISMATCH: Ads 对象核验被阻断：请求日期必须等于锁定批次日期，不能使用顶栏范围。');
  }
  if (requestedBatch && requestedBatch !== batch.batchId) {
    throw new Error('SCOPE_BATCH_MISMATCH: Ads 对象核验被阻断：建议与当前锁定范围或批次不一致，请刷新后重试。');
  }
  return {
    dateFrom: batch.dateFrom,
    dateTo: batch.dateTo,
    storeName: recommendation.storeName,
    marketplaceCode: recommendation.marketplaceCode,
    asin: recommendation.asin || '',
    batchId: batch.batchId,
  };
}

export function handleBindRecommendationWritableTarget(
  input: BindRecommendationWritableTargetRequest,
): BindRecommendationWritableTargetResult {
  const mainRuntimeContext = getMainRuntimeContext();
  const request = input || {} as BindRecommendationWritableTargetRequest;
  if (!Number.isInteger(request.recommendationId) || request.recommendationId <= 0) {
    throw new Error('Ads 对象核验被阻断：缺少有效 recommendation id。');
  }
  if (!mainRuntimeContext.state.db || !mainRuntimeContext.state.recommendationRepo) {
    throw new Error('Ads 对象核验被阻断：本地权威数据库尚未初始化。');
  }
  const { context } = resolveBusinessStoreAuthority();
  const recommendation = mainRuntimeContext.state.recommendationRepo.findByIdForStore(context.storeId, request.recommendationId);
  if (!recommendation) {
    throw new Error('Ads 对象核验被阻断：建议不存在，请刷新后重试。');
  }
  const lockedScope = resolveLockedRecommendationBatchScope(recommendation, request.scope);
  const gate = getBusinessRecommendationGate({
    dateFrom: lockedScope.dateFrom,
    dateTo: lockedScope.dateTo,
    storeName: lockedScope.storeName,
    marketplaceCode: lockedScope.marketplaceCode,
    asin: lockedScope.asin,
    batchId: lockedScope.batchId,
    storeContext: context,
  }, 'approval');
  const resolvedScope = {
    dateFrom: lockedScope.dateFrom,
    dateTo: lockedScope.dateTo,
    storeName: lockedScope.storeName,
    marketplaceCode: lockedScope.marketplaceCode,
    asin: lockedScope.asin,
    batchId: lockedScope.batchId,
  };
  const scopedRequest = { ...request, scope: resolvedScope };
  const sourceAuthority = assertRecommendationMetricSourceAuthority(mainRuntimeContext.state.db, {
    storeId: context.storeId,
    recommendation,
    scope: resolvedScope,
    allowedSourceFiles: gate.metricSource.sourceFiles,
  });
  const boundAt = new Date().toISOString();
  const result = bindRecommendationWritableTarget({
    recommendation,
    request: scopedRequest,
    lockedBatch: {
      dateFrom: lockedScope.dateFrom,
      dateTo: lockedScope.dateTo,
      batchId: lockedScope.batchId,
    },
    allowedSourceFiles: gate.metricSource.sourceFiles,
    sourceAuthority,
    boundAt,
    resolveWritableTarget: (candidate, bindingContext) => resolveWritableAdTargetAuthority(mainRuntimeContext.state.db!, {
      storeId: context.storeId,
      scope: resolvedScope,
      candidate,
      allowedSourceFiles: gate.metricSource.sourceFiles,
      syntheticRecommendationEntityId: recommendation.entityId,
      verifiedBy: bindingContext.boundBy,
      verifiedAt: bindingContext.boundAt,
    }),
    persist: (evidencePatch) => mainRuntimeContext.state.recommendationRepo!.bindWritableTargetIfCurrentForStore(
      context.storeId,
      request.recommendationId,
      request.expectedRevision,
      evidencePatch,
    ),
  });
  mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
  return result;
}

export function handleResolveRecommendationReview(input: ResolveRecommendationReviewRequest): ResolveRecommendationReviewResult {
  const mainRuntimeContext = getMainRuntimeContext();
  const request = input || {} as ResolveRecommendationReviewRequest;
  if (!Number.isInteger(request.recommendationId) || request.recommendationId <= 0) {
    throw new Error('复核被阻断：缺少有效 recommendation id。');
  }
  if (!mainRuntimeContext.state.db || !mainRuntimeContext.state.recommendationRepo) {
    throw new Error('复核被阻断：本地权威数据库尚未初始化。');
  }
  const { context } = resolveBusinessStoreAuthority();
  const recommendation = mainRuntimeContext.state.recommendationRepo.findByIdForStore(context.storeId, request.recommendationId);
  if (!recommendation) {
    throw new Error('复核被阻断：建议不存在，请刷新后重试。');
  }
  const lockedScope = resolveLockedRecommendationBatchScope(recommendation, request.scope);
  const gate = getBusinessRecommendationGate({
    dateFrom: lockedScope.dateFrom,
    dateTo: lockedScope.dateTo,
    storeName: lockedScope.storeName,
    marketplaceCode: lockedScope.marketplaceCode,
    asin: lockedScope.asin,
    batchId: lockedScope.batchId,
    storeContext: context,
  }, 'approval');
  const resolvedScope = {
    dateFrom: lockedScope.dateFrom,
    dateTo: lockedScope.dateTo,
    storeName: lockedScope.storeName,
    marketplaceCode: lockedScope.marketplaceCode,
    asin: lockedScope.asin,
    batchId: lockedScope.batchId,
  };
  const scopedRequest = { ...request, scope: resolvedScope };
  const sourceAuthority = assertRecommendationMetricSourceAuthority(mainRuntimeContext.state.db, {
    storeId: context.storeId,
    recommendation,
    scope: resolvedScope,
    allowedSourceFiles: gate.metricSource.sourceFiles,
  });
  const reviewedAt = new Date().toISOString();
  const result = resolveRecommendationReview({
    recommendation,
    request: scopedRequest,
    allowedSourceFiles: gate.metricSource.sourceFiles,
    sourceAuthority,
    reviewedAt,
    resolveWritableTarget: (candidate, reviewContext) => resolveWritableAdTargetAuthority(mainRuntimeContext.state.db!, {
      storeId: context.storeId,
      scope: resolvedScope,
      candidate,
      allowedSourceFiles: gate.metricSource.sourceFiles,
      syntheticRecommendationEntityId: recommendation.entityId,
      verifiedBy: reviewContext.reviewedBy,
      verifiedAt: reviewContext.reviewedAt,
    }),
    persist: (status, evidencePatch) => mainRuntimeContext.state.recommendationRepo!.updateStatusWithEvidenceIfCurrentForStore(
      context.storeId,
      request.recommendationId,
      'needs_review',
      request.expectedRevision,
      status,
      evidencePatch,
    ),
  });
  mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
  return result;
}

export async function handleApproveRecommendation(input: any): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  const { id, expectedRevision: requestedRevision, decision } = normalizeRecommendationDecisionRequest(input);
  if (!id) throw new Error('批准建议失败：缺少 recommendation id。');
  const { recommendation, storeId, allowedSourceFiles, sourceAuthority } = assertRecommendationCurrentDataGate(id);
  const expectedRevision = assertRecommendationDecisionRevision(recommendation, requestedRevision);
  applyRecommendationDecision({
    recommendation,
    targetStatus: 'approved',
    decision,
    approvalOptions: { allowedSourceFiles, sourceAuthority },
    persist: (status, evidencePatch) => {
      const updated = mainRuntimeContext.state.recommendationRepo?.updateStatusWithEvidenceIfCurrentForStore(
        storeId,
        id,
        recommendation.status,
        expectedRevision,
        status,
        evidencePatch,
      );
      if (!updated) {
        throw new Error('审批状态冲突：建议状态已变化，请刷新后重试。');
      }
    },
  });
}

export async function handleRejectRecommendation(input: any): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  const { id, expectedRevision: requestedRevision, decision } = normalizeRecommendationDecisionRequest(input);
  if (!id) throw new Error('拒绝建议失败：缺少 recommendation id。');
  const { context } = resolveBusinessStoreAuthority();
  const recommendation = mainRuntimeContext.state.recommendationRepo?.findByIdForStore(context.storeId, id);
  if (!recommendation) {
    throw new Error('拒绝建议失败：建议不存在，请刷新后重试。');
  }
  const expectedRevision = assertRecommendationDecisionRevision(recommendation, requestedRevision);
  applyRecommendationDecision({
    recommendation,
    targetStatus: 'rejected',
    decision,
    persist: (status, evidencePatch) => {
      const updated = mainRuntimeContext.state.recommendationRepo?.updateStatusWithEvidenceIfCurrentForStore(
        context.storeId,
        id,
        recommendation.status,
        expectedRevision,
        status,
        evidencePatch,
      );
      if (!updated) {
        throw new Error('审批状态冲突：建议状态已变化，请刷新后重试。');
      }
    },
  });
}

export function handleGetRecommendations(filter: any = []): any[] {
  const mainRuntimeContext = getMainRuntimeContext();
  const request = Array.isArray(filter) ? {} : (filter || {});
  const { context } = resolveBusinessStoreAuthority(request.storeContext);
  const limit = Number.isFinite(Number(request.limit)) ? Math.max(1, Math.min(500, Number(request.limit))) : 100;
  const status = typeof request.status === 'string' && request.status.trim() ? request.status.trim() : undefined;
  const hasFullScope = Boolean(
    typeof request.dateFrom === 'string' && request.dateFrom.trim()
      && typeof request.dateTo === 'string' && request.dateTo.trim()
      && typeof request.storeName === 'string' && request.storeName.trim()
      && typeof request.marketplaceCode === 'string' && request.marketplaceCode.trim(),
  );
  if (!hasFullScope) {
    return [];
  }

  let gate: ReturnType<typeof getBusinessRecommendationGate>;
  try {
    gate = getBusinessRecommendationGate({
      dateFrom: request.dateFrom,
      dateTo: request.dateTo,
      storeName: request.storeName,
      marketplaceCode: request.marketplaceCode,
      asin: request.asin,
      batchId: request.batchId,
      storeContext: context,
    }, 'recommendation-list');
  } catch {
    return [];
  }

  if (mainRuntimeContext.state.recommendationRepo) {
    const normalizedFilter = {
      marketplaceCode: gate.scope.marketplaceCode,
      asin: gate.scope.asin,
      status,
      dateFrom: gate.scope.dateFrom,
      dateTo: gate.scope.dateTo,
      page: 0,
      pageSize: limit,
    };
    return mainRuntimeContext.state.recommendationRepo
      .findByFilterForStore(context.storeId, normalizedFilter)
      .items
      .filter((item) => item.evidence?.batchId === gate.scope.batchId);
  }

  return [];
}
