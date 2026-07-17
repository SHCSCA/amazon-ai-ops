import type {
  ActionRecommendation,
  WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';

const WRITABLE_AD_ENTITY_TYPES = new Set([
  'keyword',
  'auto_targeting',
  'product_targeting',
]);

export interface RecommendationMetricSourceAuthority {
  reportType: string;
  entityName: string;
  campaignName: string;
  adGroupName: string;
  metricDate: string;
  sourceFile: string;
  sourceRow: number;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalized(value: unknown): string {
  return text(value).toLowerCase();
}

function normalizedPath(value: unknown): string {
  return text(value).replace(/\\/g, '/').toLowerCase();
}

function expectedRecommendationObjectName(recommendation: ActionRecommendation): string {
  return normalized(
    recommendation.evidence?.searchTerm
      || recommendation.evidence?.targeting
      || recommendation.entityName,
  );
}

function expectedWritableEntityType(
  recommendation: ActionRecommendation,
  sourceAuthority?: RecommendationMetricSourceAuthority,
): { expectedType?: string; blocker?: string } {
  if (sourceAuthority) {
    const authoritativeReportType = normalized(sourceAuthority.reportType);
    if (WRITABLE_AD_ENTITY_TYPES.has(authoritativeReportType)) {
      return { expectedType: authoritativeReportType };
    }
    return { blocker: `当前建议来源报表类型 ${authoritativeReportType || 'unknown'} 不能唯一映射到 Ads 可写对象` };
  }
  return { blocker: '缺少当前数据库来源权威，不能确认 Ads 可写对象归属' };
}

/**
 * Verifies that a canonical writable Ads row is the same business object as the
 * recommendation. Database row authority alone is insufficient because another
 * keyword or target can legitimately exist inside the same campaign/ad group.
 */
export function getRecommendationWritableTargetOwnershipBlockers(
  recommendation: ActionRecommendation,
  writableTarget: WritableAdTargetEvidence,
  sourceAuthority?: RecommendationMetricSourceAuthority,
): string[] {
  const blockers: string[] = [];
  const expectedCampaignName = normalized(sourceAuthority?.campaignName || recommendation.evidence?.campaignName);
  const expectedAdGroupName = normalized(sourceAuthority?.adGroupName || recommendation.evidence?.adGroupName);
  if (
    (expectedCampaignName && normalized(writableTarget.campaignName) !== expectedCampaignName)
    || (expectedAdGroupName && normalized(writableTarget.adGroupName) !== expectedAdGroupName)
  ) {
    blockers.push('核验到的 Ads 对象不属于当前建议的 campaign / ad group');
  }

  const expectedEntityName = normalized(sourceAuthority?.entityName)
    || expectedRecommendationObjectName(recommendation);
  if (expectedEntityName && normalized(writableTarget.entityName) !== expectedEntityName) {
    blockers.push('核验到的 Ads 对象名称与当前建议对象不一致');
  }

  const entityTypeExpectation = expectedWritableEntityType(recommendation, sourceAuthority);
  if (entityTypeExpectation.blocker) {
    blockers.push(entityTypeExpectation.blocker);
  } else if (
    entityTypeExpectation.expectedType
    && normalized(writableTarget.entityType) !== entityTypeExpectation.expectedType
  ) {
    blockers.push('核验到的 Ads 对象类型与当前建议来源不一致');
  }

  if (sourceAuthority && (
    normalizedPath(writableTarget.sourceFile) !== normalizedPath(sourceAuthority.sourceFile)
    || Number(writableTarget.sourceRow) !== Number(sourceAuthority.sourceRow)
  )) {
    blockers.push('核验到的 Ads 对象来源行与当前建议来源权威不一致');
  }

  return blockers;
}
