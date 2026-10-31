import type { ActionRecommendation, AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import type { AiEvidenceItem } from '@amazon-ai-ops/ai-adapter';
import { recommendationDecisionIdentity } from './ad-decision-identity';

export function reportIdentityFixture(original: ActionRecommendation, metricEvidence?: AiEvidenceItem) {
  const date = metricEvidence?.dateRange?.split('~')[0] || '2026-06-10';
  const scope = { storeId: 'ISOLATED_FIXTURE_STORE', storeName: original.storeName, marketplaceCode: original.marketplaceCode,
    asin: original.asin, batchId: 'batch_1', dateFrom: date, dateTo: date };
  const recommendation: ActionRecommendation = { ...original, evidence: { ...original.evidence,
    date, asin: original.asin, batchId: scope.batchId, matchType: 'exact', reportType: 'fixture_report',
    sourceFiles: [metricEvidence?.sourceFile || 'ISOLATED_FIXTURE.csv'], sourceRow: metricEvidence?.sourceRow || 1,
    targeting: original.entityType === 'target' ? original.entityName : '',
    searchTerm: original.entityType === 'search_term' ? original.entityName : '',
  } };
  const metric: AdDailyMetrics = { ...recommendation.evidence, date, storeName: original.storeName,
    marketplaceCode: original.marketplaceCode, asin: original.asin, msku: original.msku,
    campaignName: recommendation.evidence.campaignName || '', adGroupName: recommendation.evidence.adGroupName || '',
    targeting: recommendation.evidence.targeting || '', searchTerm: recommendation.evidence.searchTerm || '',
    matchType: 'exact', sourceFile: recommendation.evidence.sourceFiles![0] };
  const evidence: AiEvidenceItem = { ...metricEvidence, evidenceId: metricEvidence?.evidenceId || 'metric_1', type: 'metric',
    label: 'ISOLATED_FIXTURE', dateRange: `${date}~${date}`, batchId: scope.batchId, reportType: 'fixture_report',
    sourceFile: metric.sourceFile, sourceRow: metric.sourceRow, storeName: metric.storeName, marketplaceCode: metric.marketplaceCode,
    asin: metric.asin, campaignName: metric.campaignName, adGroupName: metric.adGroupName,
    entityType: original.entityType, entityName: original.entityName };
  return { recommendation, metric, evidence, scope, identity: recommendationDecisionIdentity(recommendation, scope) };
}
