/**
 * Domain normalization helpers.
 *
 * Used by repositories (Mission/Decision/Grant/Execution/Experiment/Memory)
 * to validate operator input and SQLite-read columns before they enter the
 * domain state machine. All helpers throw a `DomainNormalizationError` on
 * invalid input so callers can wrap them in repository-specific errors.
 *
 * @module domain-normalization
 */

export class DomainNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainNormalizationError';
  }
}

/**
 * Normalize an opaque domain identifier (mission id, policy version id, etc).
 * Trims whitespace, rejects empty and overlong values, and strips control
 * characters that should never appear in an authority id.
 */
export function normalizeDomainIdentifier(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new DomainNormalizationError(`${label} is required.`);
  if (normalized.length > 200) throw new DomainNormalizationError(`${label} is too long (max 200).`);
  if (/[\u0000-\u001f]/.test(normalized)) {
    throw new DomainNormalizationError(`${label} contains control characters.`);
  }
  return normalized;
}

/**
 * Normalize free-text domain field (title, notes, reason, evidence text).
 * Returns trimmed text truncated to `maxLength` (default 2000) and rejects
 * control characters so they cannot reach audit/evidence stores.
 */
export function normalizeDomainText(
  value: unknown,
  label: string,
  maxLength = 2000,
): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new DomainNormalizationError(`${label} is required.`);
  if (normalized.length > maxLength) {
    throw new DomainNormalizationError(`${label} is too long (max ${maxLength}).`);
  }
  if (/[\u0000-\u001f]/.test(normalized)) {
    throw new DomainNormalizationError(`${label} contains control characters.`);
  }
  return normalized;
}

/**
 * Normalize a string-list field (allowed action types, entity ids, keywords).
 * Trims every entry, removes duplicates and blanks, and enforces size limits.
 */
export interface NormalizeDomainStringListOptions {
  required?: boolean;
  maxItems?: number;
  maxLength?: number;
}

export function normalizeDomainStringList(
  value: unknown,
  label: string,
  options: NormalizeDomainStringListOptions = {},
): string[] {
  const required = options.required ?? false;
  const maxItems = options.maxItems ?? 100;
  const maxLength = options.maxLength ?? 500;

  if (value === null || value === undefined) {
    if (required) throw new DomainNormalizationError(`${label} is required.`);
    return [];
  }

  const source: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').map((part) => part.trim()).filter(Boolean)
      : (() => {
          throw new DomainNormalizationError(`${label} must be an array or comma-separated string.`);
        })();

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of source) {
    const trimmed = String(entry ?? '').trim();
    if (!trimmed) continue;
    if (trimmed.length > maxLength) {
      throw new DomainNormalizationError(`${label} entry exceeds ${maxLength} characters.`);
    }
    if (/[\u0000-\u001f]/.test(trimmed)) {
      throw new DomainNormalizationError(`${label} entry contains control characters.`);
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length > maxItems) {
      throw new DomainNormalizationError(`${label} has more than ${maxItems} entries.`);
    }
  }

  if (required && result.length === 0) {
    throw new DomainNormalizationError(`${label} is required.`);
  }
  return result;
}

/**
 * Normalize a domain revision number. Must be a non-negative safe integer.
 */
export function normalizeDomainRevision(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new DomainNormalizationError(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

/**
 * Normalize an ISO-8601 timestamp string. Returns the canonical ISO form.
 */
export function normalizeDomainTimestamp(value: unknown, label: string): string {
  const candidate = String(value ?? '').trim();
  if (!candidate) throw new DomainNormalizationError(`${label} is required.`);
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) {
    throw new DomainNormalizationError(`${label} must be an ISO-8601 timestamp.`);
  }
  return new Date(parsed).toISOString();
}
