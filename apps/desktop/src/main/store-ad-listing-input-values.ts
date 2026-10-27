import { canonicalizeAmazonAsin, inspectAmazonAsin } from '@amazon-ai-ops/shared-types';
import { type StoreScopedAdObjectKind, StoreScopedAdListingError } from "./store-ad-listing-contracts";

export function normalizeAdObjectKind(value: unknown): StoreScopedAdObjectKind {
  if (value === undefined) return 'campaign';
  if (value === 'campaign' || value === 'ad_group' || value === 'target' || value === 'search_term') {
    return value;
  }
  throw invalid('kind must be campaign, ad_group, target, or search_term');
}

export function keywordFactKey(asin: string | undefined, keyword: string): string {
  return `${asin ?? ''}\u0000${keyword.toLocaleLowerCase()}`;
}

export function normalizeKeyword(value: unknown): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  if (!normalized) throw invalid('keyword must not be empty');
  return normalized;
}

export function normalizeAsin(value: unknown): string {
  const inspection = inspectAmazonAsin(value);
  if (!inspection.canonical) throw invalid('ASIN must not be empty');
  return inspection.canonical;
}

export function normalizeAsinForWrite(value: unknown): string {
  try {
    return canonicalizeAmazonAsin(value);
  } catch {
    throw invalid('ASIN must be exactly 10 ASCII letters or digits');
  }
}

export function optionalAsin(value: unknown): string | undefined {
  return value === undefined || value === null || String(value).trim() === ''
    ? undefined
    : normalizeAsin(value);
}

export function isSqliteConstraint(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && String((error as { code?: unknown }).code).startsWith('SQLITE_CONSTRAINT');
}

export function optionalIsoDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw invalid(`${label} must be YYYY-MM-DD`);
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw invalid(`${label} must be a real calendar date`);
  }
  return normalized;
}

export function optionalText(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid(`${label} must be text`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw invalid(`${label} is longer than ${maxLength} characters`);
  return normalized;
}

export function boundedOptionalText(value: unknown, maxLength: number): string | undefined {
  const normalized = nonEmptyString(value);
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export function normalizeStringArray(
  value: unknown,
  label: string,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`${label} must be an array of text`);
  if (value.length > maxItems) throw invalid(`${label} cannot contain more than ${maxItems} items`);
  return value.map((item, index) => {
    if (typeof item !== 'string') throw invalid(`${label}[${index}] must be text`);
    const normalized = item.trim();
    if (normalized.length > maxItemLength) {
      throw invalid(`${label}[${index}] is longer than ${maxItemLength} characters`);
    }
    return normalized;
  }).filter(Boolean);
}

export function parseStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .slice(0, maxItems)
      .map((item) => item.trim().slice(0, maxItemLength))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function positiveLimit(value: unknown, defaultValue: number, max: number): number {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > max) {
    throw invalid(`limit must be an integer from 1 to ${max}`);
  }
  return normalized;
}

export function positiveInteger(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) throw invalid(`${label} must be a positive integer`);
  return normalized;
}

export function nonNegativeInteger(value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw invalid(`${label} must be a non-negative integer`);
  }
  return normalized;
}

export function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw invalid(`${label} contains unsupported fields: ${unknown.join(', ')}`);
}

export function finiteNumber(value: unknown): number {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized : 0;
}

export function safeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export function normalizeIdentity(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase();
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function invalid(message: string): StoreScopedAdListingError {
  return new StoreScopedAdListingError('INVALID_INPUT', message);
}

export function identityMismatch(message: string): StoreScopedAdListingError {
  return new StoreScopedAdListingError('STORE_IDENTITY_MISMATCH', message);
}

export function notFound(label: string): StoreScopedAdListingError {
  return new StoreScopedAdListingError('OBJECT_NOT_FOUND', `${label} was not found in the active store`);
}

export function writeFailed(message: string): StoreScopedAdListingError {
  return new StoreScopedAdListingError('WRITE_FAILED', message);
}
