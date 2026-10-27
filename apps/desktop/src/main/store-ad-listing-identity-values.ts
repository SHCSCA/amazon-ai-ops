import {
  type StoreScopedAdObjectKind,
  type StableAdEntityAuthority,
  type StableAdEntityAuthorityRow,
  type CanonicalKeywordIdentity,
} from "./store-ad-listing-contracts";
import { normalizeIdentity, nonEmptyString } from "./store-ad-listing-input-values";

export function adObjectKey(
  kind: StoreScopedAdObjectKind,
  campaignName: string | undefined,
  adGroupName: string | undefined,
  name: string,
  reportType?: string,
  matchType?: string,
): string {
  const parts = reportType
    ? [kind, reportType, campaignName ?? '', adGroupName ?? '', name, ...(matchType ? [matchType] : [])]
    : [kind, campaignName ?? '', adGroupName ?? '', name];
  return parts
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function stableAdEntityPathKey(
  reportType: unknown,
  campaignName: unknown,
  adGroupName: unknown,
  entityName: unknown,
  matchType?: unknown,
): string {
  return [reportType, campaignName, adGroupName, entityName, matchType]
    .map(normalizeIdentity)
    .join('\u0000');
}

export function readableTargetName(
  rawName: string,
  reportType: string | undefined,
  matchType: string | undefined,
): string {
  if (reportType !== 'keyword' || !matchType) return rawName;
  const label = keywordMatchTypeLabel(matchType);
  return `${rawName}（${label}）`;
}

export function keywordMatchTypeLabel(matchType: string): string {
  const normalized = normalizeIdentity(matchType);
  if (normalized === 'exact' || normalized === 'exact match' || normalized === '精准') {
    return '精准匹配';
  }
  if (normalized === 'phrase' || normalized === 'phrase match' || normalized === '词组') {
    return '词组匹配';
  }
  if (normalized === 'broad' || normalized === 'broad match' || normalized === '广泛') {
    return '广泛匹配';
  }
  return '其他匹配方式';
}

export function uniqueStableAdEntityAuthority(
  candidates: readonly StableAdEntityAuthority[] | undefined,
  sourceMetricIds: unknown,
  sourceRowCount: number,
): StableAdEntityAuthority | undefined {
  if (!candidates?.length || typeof sourceMetricIds !== 'string') return undefined;
  const metricIds = sourceMetricIds.split(',').map(Number);
  if (!Number.isSafeInteger(sourceRowCount) || sourceRowCount < 1 || metricIds.length !== sourceRowCount
    || metricIds.some(id => !Number.isSafeInteger(id) || id < 1)
    || new Set(metricIds).size !== metricIds.length) return undefined;
  const covered: StableAdEntityAuthority[] = [];
  for (const metricId of metricIds) {
    const proofs = candidates.filter(candidate => candidate.metricId === metricId);
    if (proofs.length !== 1) return undefined;
    covered.push(proofs[0]);
  }
  // 每个实际源行都要独立证明；同名、日期计数和重复 proof 均不能补足缺口。
  if (new Set(covered.map(proof => proof.authorityId)).size !== covered.length
    || new Set(covered.map(proof => proof.entityId)).size !== 1
    || new Set(covered.map(proof => proof.currentEntityRevision)).size !== 1) return undefined;
  const currentRevision = covered[0].currentEntityRevision;
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 1) return undefined;
  const current = covered.filter(proof => proof.entityRevision === currentRevision);
  return current.length === 1 ? current[0] : undefined;
}

export function canonicalKeywordIdentityFromRow(
  row: StableAdEntityAuthorityRow,
): CanonicalKeywordIdentity | undefined {
  const adsAccountId = nonEmptyString(row.ads_account_id);
  const campaignId = nonEmptyString(row.campaign_id);
  const adGroupId = nonEmptyString(row.ad_group_id);
  const keywordId = nonEmptyString(row.keyword_id);
  const objectRevision = Number(row.object_revision);
  if (
    !adsAccountId
    || !campaignId
    || !adGroupId
    || !keywordId
    || !Number.isInteger(objectRevision)
    || objectRevision < 1
  ) return undefined;
  return { adsAccountId, campaignId, adGroupId, keywordId, objectRevision };
}
