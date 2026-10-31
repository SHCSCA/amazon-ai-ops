import type { ActionRecommendation, AdDailyMetrics, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { AiEvidenceItem, AiReasonedDecision } from '@amazon-ai-ops/ai-adapter';
import { adDecisionIdentityKey, type AdDecisionIdentity } from '@amazon-ai-ops/rules-engine';

export interface AdDecisionScope {
  storeContext?: StoreContextEnvelope;
  dateFrom: string;
  dateTo: string;
  storeId: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  batchId?: string;
}

// 来源坐标只标识本批报表对象，不制造 Ads 原生 ID 或授权。
export function recommendationDecisionIdentity(
  recommendation: ActionRecommendation,
  scope?: AdDecisionScope,
): AdDecisionIdentity | undefined {
  if (scope?.storeContext && (scope.storeContext.storeId !== scope.storeId || scope.storeContext.marketplace !== scope.marketplaceCode)) return undefined;
  const evidence = recommendation.evidence;
  if (!scope || !evidence || recommendation.storeName !== scope.storeName
    || recommendation.marketplaceCode !== scope.marketplaceCode || (scope.asin && recommendation.asin !== scope.asin)
    || evidence.batchId !== scope.batchId || evidence.asin !== recommendation.asin
    || evidence.sourceFiles?.length !== 1 || !evidence.date || evidence.date < scope.dateFrom || evidence.date > scope.dateTo) return undefined;
  const hasOtherStore = (value: object) => 'storeId' in value && value.storeId !== scope.storeId;
  if (hasOtherStore(recommendation)) return undefined;
  const identity: AdDecisionIdentity = {
    kind: 'report_object', storeId: scope.storeId, storeName: scope.storeName, marketplaceCode: scope.marketplaceCode,
    asin: recommendation.asin, batchId: scope.batchId || '', reportType: evidence.reportType, sourceFile: evidence.sourceFiles[0],
    sourceRow: evidence.sourceRow!, metricDate: evidence.date, dateFrom: scope.dateFrom, dateTo: scope.dateTo,
    campaignName: evidence.campaignName || '', adGroupName: evidence.adGroupName, matchType: evidence.matchType,
  };
  if (!adDecisionIdentityKey({ ...recommendation, identity })) return undefined;
  const target = evidence.writableTarget;
  const binding = evidence.writableTargetBinding;
  const observation = evidence.bidObservation;
  if (!target && !binding && !observation) return identity;
  // 已有原生凭证不能因报表比较而忽略矛盾；执行时仍须独立校验当前归属与会话。
  if (recommendation.entityType !== 'target' || !target || !binding || !binding.scope
    || !binding.metricSource || !binding.writableTarget) return undefined;
  if ([binding.scope, binding.writableTarget, target].some(hasOtherStore)) return undefined;
  if (!Number.isSafeInteger(recommendation.revision) || !Number.isSafeInteger(binding.fromRevision)
    || !Number.isSafeInteger(binding.boundRevision) || binding.fromRevision < 0
    || binding.schemaVersion !== 1 || binding.boundRevision !== recommendation.revision
    || binding.fromRevision + 1 !== binding.boundRevision) return undefined;
  if (binding.scope.dateFrom !== scope.dateFrom || binding.scope.dateTo !== scope.dateTo
    || binding.scope.storeName !== scope.storeName || binding.scope.marketplaceCode !== scope.marketplaceCode
    || binding.scope.asin !== recommendation.asin || binding.scope.batchId !== scope.batchId
    || binding.metricSource.batchId !== scope.batchId) return undefined;
  if (JSON.stringify(binding.metricSource.sourceFiles) !== JSON.stringify(evidence.sourceFiles)
    || binding.metricSource.sourceRow !== evidence.sourceRow) return undefined;
  if (target.sourceFile !== identity.sourceFile || target.sourceRow !== identity.sourceRow
    || target.metricDate !== identity.metricDate || target.entityName !== recommendation.entityName
    || target.campaignName !== identity.campaignName || target.adGroupName !== identity.adGroupName) return undefined;
  if (!['ads_ui', 'ads_api'].includes(target.identitySource)
    || !['keyword', 'auto_targeting', 'product_targeting'].includes(target.entityType)
    || !target.entityId?.trim() || !target.identityProofPath?.trim() || !target.verifiedBy?.trim() || !target.verificationNote?.trim()
    || !binding.boundBy?.trim() || !binding.note?.trim()) return undefined;
  if (Object.keys(target).some((key) => target[key as keyof typeof target]
    !== binding.writableTarget[key as keyof typeof target])) return undefined;
  const verified = Date.parse(target.verifiedAt);
  const bound = Date.parse(binding.boundAt);
  const metricDate = Date.parse(target.metricDate);
  if (![verified, bound, metricDate].every(Number.isFinite) || verified < metricDate || bound < verified || bound > Date.now()) return undefined;
  const contextKeys: Array<keyof StoreContextEnvelope> = ['storeId', 'marketplace', 'currency', 'browserProfileId', 'businessDate', 'businessTimezone', 'sessionGeneration'];
  if (observation && (!scope.storeContext || !observation.storeContext
    || contextKeys.some((key) => observation.storeContext[key] !== scope.storeContext![key]) || observation.storeContext.storeId !== scope.storeId
    || ('storeName' in observation.storeContext && observation.storeContext.storeName !== scope.storeName)
    || ('marketplaceCode' in observation.storeContext && observation.storeContext.marketplaceCode !== scope.marketplaceCode)
    || observation.keywordId !== target.entityId || !observation.campaignId || !observation.adGroupId
    || !observation.adsAccountId || !observation.identityProofPath
    || Date.parse(observation.observedAt) < verified || Date.parse(observation.observedAt) > Date.now()
    || !Number.isFinite(Date.parse(observation.observedAt)))) return undefined;
  return { ...identity, nativeEntityId: target.entityId, nativeEntityType: target.entityType,
    campaignId: observation?.campaignId, adGroupId: observation?.adGroupId };
}

// AI 只能引用当前输入的原始证据，不能自行声明或补齐对象身份。
export function resolveAiDecisionIdentity(
  candidate: AiReasonedDecision,
  recommendations: ActionRecommendation[],
  metrics: AdDailyMetrics[],
  evidencePack: AiEvidenceItem[],
  scope: AdDecisionScope,
): AdDecisionIdentity | undefined {
  if (!Array.isArray(candidate.evidenceRefs) || !candidate.evidenceRefs.length) return undefined;
  const identities: AdDecisionIdentity[] = [];
  for (const ref of new Set(candidate.evidenceRefs)) {
    const evidenceMatches = evidencePack.filter((item) => item.evidenceId === ref);
    if (evidenceMatches.length !== 1) return undefined;
    const evidence = evidenceMatches[0];
    if (evidence.type !== 'metric') continue;
    if ('storeId' in evidence && evidence.storeId !== scope.storeId) return undefined;
    if (evidence.storeName !== scope.storeName || evidence.marketplaceCode !== scope.marketplaceCode
      || evidence.batchId !== scope.batchId || !evidence.sourceFile || !evidence.sourceRow) return undefined;
    const rows = metrics.filter((metric) => metric.sourceFile === evidence.sourceFile && metric.sourceRow === evidence.sourceRow
      && metric.batchId === scope.batchId && metric.storeName === scope.storeName && metric.marketplaceCode === scope.marketplaceCode);
    if (rows.length !== 1) return undefined;
    const row = rows[0];
    if ('storeId' in row && row.storeId !== scope.storeId) return undefined;
    if ((evidence.reportType || 'unknown_report') !== (row.reportType || 'unknown_report')) return undefined;
    const evidenceType = row.searchTerm ? 'search_term' : row.targeting ? 'target' : row.adGroupName ? 'ad_group' : 'campaign';
    const evidenceName = row.searchTerm || row.targeting || row.adGroupName || row.campaignName;
    if (evidence.entityType !== evidenceType || evidence.entityName !== evidenceName
      || evidence.dateRange !== `${row.date}~${row.date}`) return undefined;
    if (evidence.asin !== row.asin || evidence.campaignName !== row.campaignName || evidence.adGroupName !== row.adGroupName
      || (scope.asin && row.asin !== scope.asin)) return undefined;
    const matches = recommendations.filter((rec) => rec.entityType === candidate.entityType && rec.entityName === candidate.entityName
      && rec.asin === row.asin && rec.evidence.campaignName === row.campaignName && rec.evidence.adGroupName === row.adGroupName
      && rec.evidence.matchType === row.matchType && rec.evidence.date === row.date && rec.evidence.reportType === row.reportType
      && rec.evidence.sourceFiles?.length === 1 && rec.evidence.sourceFiles[0] === row.sourceFile
      && rec.evidence.sourceRow === row.sourceRow && metricObjectName(row, rec.entityType) === rec.entityName);
    if (matches.length > 1 || (matches.length === 0 && recommendations.some((rec) =>
      rec.evidence.sourceFiles?.includes(row.sourceFile) && rec.evidence.sourceRow === row.sourceRow
      && rec.evidence.batchId === row.batchId))) return undefined;
    const identity = matches.length === 1 ? recommendationDecisionIdentity(matches[0], scope) : reportMetricIdentity(row, candidate, scope);
    if (!identity) return undefined;
    identities.push(identity);
  }
  if (!identities.length) return undefined;
  const keys = identities.map((identity) => adDecisionIdentityKey({ ...candidate, identity }));
  return keys.every((key) => key && key === keys[0]) ? identities[0] : undefined;
}

function reportMetricIdentity(row: AdDailyMetrics, candidate: AiReasonedDecision, scope: AdDecisionScope): AdDecisionIdentity | undefined {
  const name = metricObjectName(row, candidate.entityType);
  if (!name || name !== candidate.entityName || row.date < scope.dateFrom || row.date > scope.dateTo) return undefined;
  const identity: AdDecisionIdentity = { kind: 'report_object', storeId: scope.storeId, storeName: row.storeName,
    marketplaceCode: row.marketplaceCode, asin: row.asin, batchId: row.batchId || '', reportType: row.reportType, sourceFile: row.sourceFile,
    sourceRow: row.sourceRow!, metricDate: row.date, dateFrom: scope.dateFrom, dateTo: scope.dateTo,
    campaignName: row.campaignName, adGroupName: row.adGroupName, matchType: row.matchType };
  return adDecisionIdentityKey({ ...candidate, identity }) ? identity : undefined;
}

function metricObjectName(row: AdDailyMetrics, type: string): string | undefined {
  return type === 'target' ? row.targeting : type === 'search_term' ? row.searchTerm
    : type === 'ad_group' ? row.adGroupName : type === 'campaign' ? row.campaignName : undefined;
}
