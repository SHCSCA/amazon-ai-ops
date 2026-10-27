import * as path from 'path';
import * as fs from 'fs';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { runtimeLog } from './runtime-log-adapter';
import { assertCurrentAdReadbackEvidenceAuthority } from './ad-readback-authority';
import { assertCurrentWritableAdTargetAuthority } from './writable-ad-target-resolution';
import { getRecommendationWritableTargetOwnershipBlockers, type RecommendationMetricSourceAuthority } from './recommendation-writable-target-policy';
import { assertRecommendationMetricSourceAuthority } from './recommendation-metric-source-authority';
import { getBusinessRecommendationGate } from './main-business-metrics-runtime';
import { getMainRuntimeContext } from './main-runtime-access';

export function assertRecommendationWritableTargetCurrent(
  recommendation: ActionRecommendation | undefined,
  scope: {
    storeId: StoreContextEnvelope['storeId'];
    dateFrom: string;
    dateTo: string;
    storeName: string;
    marketplaceCode: string;
    asin?: string;
    batchId: string;
  },
  allowedSourceFiles: string[],
): RecommendationMetricSourceAuthority {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db || !recommendation?.evidence?.writableTarget) {
    throw new Error('结果核对被阻断：当前建议没有经验证的 Ads 可写对象。');
  }
  const sourceAuthority = assertRecommendationMetricSourceAuthority(mainRuntimeContext.state.db, {
    storeId: scope.storeId,
    recommendation,
    scope: {
      ...scope,
      asin: scope.asin || '',
    },
    allowedSourceFiles,
  });
  const canonicalTarget = assertCurrentWritableAdTargetAuthority(mainRuntimeContext.state.db, {
    storeId: scope.storeId,
    scope,
    target: recommendation.evidence.writableTarget,
    allowedSourceFiles,
    syntheticRecommendationEntityId: recommendation.entityId,
  });
  const ownershipBlockers = getRecommendationWritableTargetOwnershipBlockers(
    recommendation,
    canonicalTarget,
    sourceAuthority,
  );
  if (ownershipBlockers.length > 0) {
    throw new Error(`结果核对被阻断：Ads 可写对象不属于当前建议：${ownershipBlockers.join('、')}。`);
  }
  return sourceAuthority;
}

export function validateCurrentAdReadbackEvidenceAuthority(
  evidencePath: string,
  stage: 'verify' | 'final-readiness',
): { ok: true } | { ok: false; message: string } {
  const mainRuntimeContext = getMainRuntimeContext();
  let evidence: Record<string, any> = {};
  try {
    evidence = JSON.parse(fs.readFileSync(path.resolve(evidencePath), 'utf8')) as Record<string, any>;
    const authority = evidence.authority || {};
    const gate = getBusinessRecommendationGate(authority, 'readback');
    const recommendation = mainRuntimeContext.state.recommendationRepo?.findByIdForStore(
      gate.scope.storeId,
      Number(authority.recommendationId),
    );
    const sourceAuthority = assertRecommendationWritableTargetCurrent(
      recommendation,
      {
        storeId: gate.scope.storeId,
        dateFrom: gate.scope.dateFrom,
        dateTo: gate.scope.dateTo,
        storeName: gate.scope.storeName,
        marketplaceCode: gate.scope.marketplaceCode,
        asin: gate.scope.asin,
        batchId: gate.scope.batchId || '',
      },
      gate.metricSource.sourceFiles,
    );
    assertCurrentAdReadbackEvidenceAuthority({
      evidence,
      recommendation,
      resolvedScope: {
        dateFrom: gate.scope.dateFrom,
        dateTo: gate.scope.dateTo,
        storeName: gate.scope.storeName,
        marketplaceCode: gate.scope.marketplaceCode,
        asin: gate.scope.asin,
        batchId: gate.scope.batchId || '',
      },
      allowedSourceFiles: gate.metricSource.sourceFiles,
      sourceAuthority,
    });
    return { ok: true };
  } catch (caught) {
    const authority = evidence.authority || {};
    runtimeLog.warn('[AdReadbackAuthority]', {
      stage,
      recommendationId: Number(authority.recommendationId) || null,
      revision: Number(authority.recommendationRevision) || 0,
      batchId: String(authority.batchId || ''),
      reason: caught instanceof Error ? caught.message : 'authority check failed',
    });
    return {
      ok: false,
      message: '数据库中的已批准建议或当前范围已变化，请刷新后重新导出并校验。',
    };
  }
}
