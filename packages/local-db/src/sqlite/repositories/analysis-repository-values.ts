import { ANALYSIS_PROPOSAL_MATCH_TYPES,normalizeBusinessDate,normalizeStoreContextEnvelope,type AnalysisAuthorizationEligibility,type AnalysisProposalBlockerCode,type AnalysisProposalMatchType,type AnalysisProposalSource,type StoreContextEnvelope,type VerifiedAdEntityType } from '@amazon-ai-ops/shared-types';
import { createHash } from 'crypto';
import { normalizeVerifiedDomainTimestamp } from '@amazon-ai-ops/shared-types';
import {
AnalysisAuthorityRepositoryError,
} from './analysis-repository-contracts';

export function eligibility(blockers: readonly AnalysisProposalBlockerCode[]): AnalysisAuthorizationEligibility {
  const unique = [...new Set(blockers)];
  return { eligible: unique.length === 0, blockers: unique };
}

export function proposalSource(evidence: Record<string, unknown>): AnalysisProposalSource {
  if (evidence.aiFallbackReason || evidence.aiStrategyFallbackReason || evidence.aiActionFallbackReason) {
    return 'rule_fallback';
  }
  const decisionSource = String(evidence.decisionSource ?? '');
  if (decisionSource === 'ai') return 'ai';
  if (decisionSource === 'rule_ai'
    && evidence.decisionAgreement === 'aligned'
    && evidence.decisionRequiresReview !== true) {
    return 'rule_ai';
  }
  return 'rule';
}

export function recommendationEntityType(
  evidence: Record<string, unknown>,
  recommendation: Record<string, unknown>,
): VerifiedAdEntityType {
  const writable = objectValue(evidence.writableTarget);
  const candidate = String(writable?.entityType ?? evidence.reportType ?? '').trim();
  if (candidate === 'keyword' || candidate === 'auto_targeting' || candidate === 'product_targeting') {
    return candidate;
  }
  const entityType = String(recommendation.entity_type ?? '');
  if (entityType === 'target' && evidence.searchTerm) return 'keyword';
  throw new AnalysisAuthorityRepositoryError(
    'UNSUPPORTED_ACTION',
    `Recommendation entity type ${candidate || entityType || 'unknown'} is not a stable V1 writable target.`,
  );
}

export function recommendationMatchType(
  evidence: Record<string, unknown>,
): AnalysisProposalMatchType | undefined {
  return canonicalProposalMatchType(evidence.matchType);
}

export function canonicalProposalMatchType(value: unknown): AnalysisProposalMatchType | undefined {
  const candidate = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  return ANALYSIS_PROPOSAL_MATCH_TYPES.includes(candidate as AnalysisProposalMatchType)
    ? candidate as AnalysisProposalMatchType
    : undefined;
}

export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

export function normalizeContextInput(input: StoreContextEnvelope): StoreContextEnvelope {
  try {
    return normalizeStoreContextEnvelope(input);
  } catch (error) {
    throw new AnalysisAuthorityRepositoryError(
      'INVALID_CONTEXT',
      error instanceof Error ? error.message : 'StoreContextEnvelope is invalid.',
    );
  }
}

export function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

export function aggregateHashes(values: readonly string[]): string {
  const hashes = [...new Set(values.map((value) => sha256Of(value, 'fileHash').toLowerCase()))].sort();
  if (hashes.length === 1) return hashes[0];
  return hashObject(hashes);
}

export function hashObject(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function parseJson<T = unknown>(value: string, fallback?: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    if (fallback !== undefined) return fallback;
    throw invalid('Durable analysis JSON could not be parsed.');
  }
}

export function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function idOf(value: unknown, field: string): string {
  return textOf(value, field, 180);
}

export function textOf(value: unknown, field: string, maxLength: number): string {
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue || normalizedValue.length > maxLength) {
    throw invalid(`${field} must contain 1..${maxLength} characters.`);
  }
  return normalizedValue;
}

export function optionalText(value: unknown): string | undefined {
  const normalizedValue = String(value ?? '').trim();
  return normalizedValue || undefined;
}

export function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function dateOf(value: unknown, field: string): string {
  const normalizedValue = textOf(value, field, 10);
  try {
    return normalizeBusinessDate(normalizedValue);
  } catch {
    throw invalid(`${field} must be YYYY-MM-DD.`);
  }
}

export function timestampOf(value: unknown, field: string): string {
  try { return normalizeVerifiedDomainTimestamp(value, field); }
  catch { throw invalid(`${field} must be an ISO timestamp.`); }
}

export function sha256Of(value: unknown, field: string): string {
  const normalizedValue = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedValue)) throw invalid(`${field} must be a SHA-256 digest.`);
  return normalizedValue;
}

export function entityTypeOf(value: unknown): VerifiedAdEntityType {
  const normalizedValue = String(value ?? '').trim();
  if (!['keyword', 'auto_targeting', 'product_targeting'].includes(normalizedValue)) {
    throw invalid('Unsupported verified Ads entity type.');
  }
  return normalizedValue as VerifiedAdEntityType;
}

export function identitySourceOf(value: unknown): 'ads_ui' | 'ads_api' {
  const normalizedValue = String(value ?? '').trim();
  if (!['ads_ui', 'ads_api'].includes(normalizedValue)) throw invalid('Unsupported Ads identity source.');
  return normalizedValue as 'ads_ui' | 'ads_api';
}

export function finite(value: unknown, field: string): number {
  const normalizedValue = Number(value);
  if (!Number.isFinite(normalizedValue)) throw invalid(`${field} must be finite.`);
  return normalizedValue;
}

export function positiveInteger(value: unknown, field: string): number {
  const normalizedValue = finite(value, field);
  if (!Number.isSafeInteger(normalizedValue) || normalizedValue <= 0) {
    throw invalid(`${field} must be a positive integer.`);
  }
  return normalizedValue;
}

export function nonNegative(value: unknown): number {
  const normalizedValue = Number(value);
  if (!Number.isSafeInteger(normalizedValue) || normalizedValue < 0) {
    throw invalid('Expected a non-negative integer from durable authority.');
  }
  return normalizedValue;
}

export function positiveOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return positiveInteger(value, 'sourceRow');
}

export function usdCents(value: unknown, field: string): number {
  const amount = finite(value, field);
  const cents = Math.round(amount * 100);
  if (cents <= 0 || Math.abs(cents / 100 - amount) > 0.000001) {
    throw invalid(`${field} must be a positive USD value with no more than two decimals.`);
  }
  return cents;
}

export function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function invalid(message: string): AnalysisAuthorityRepositoryError {
  return new AnalysisAuthorityRepositoryError('INVALID_INPUT', message);
}

export function notFound(message: string): AnalysisAuthorityRepositoryError {
  return new AnalysisAuthorityRepositoryError('NOT_FOUND', message);
}

export function referenceConflict(message: string): AnalysisAuthorityRepositoryError {
  return new AnalysisAuthorityRepositoryError('REFERENCE_CONFLICT', message);
}

export function stateConflict(message: string): AnalysisAuthorityRepositoryError {
  return new AnalysisAuthorityRepositoryError('STATE_CONFLICT', message);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
