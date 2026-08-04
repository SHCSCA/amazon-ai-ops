export const AMAZON_ASIN_PATTERN = /^[A-Z0-9]{10}$/;

export interface AmazonAsinInspection {
  canonical: string;
  valid: boolean;
}

/**
 * Produces the stable comparison form used by store-owned Amazon objects.
 * Historical rows are deliberately not rejected here so callers can expose
 * them as invalid/read-only instead of making old data disappear.
 */
export function inspectAmazonAsin(value: unknown): AmazonAsinInspection {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const valid = /^[A-Za-z0-9]{10}$/.test(trimmed);
  const canonical = trimmed.toUpperCase();
  return {
    canonical,
    valid: valid && AMAZON_ASIN_PATTERN.test(canonical),
  };
}

/** Strict write boundary for new or updated Amazon objects. */
export function canonicalizeAmazonAsin(value: unknown): string {
  const inspection = inspectAmazonAsin(value);
  if (!inspection.valid) {
    throw new TypeError('ASIN must be exactly 10 ASCII letters or digits');
  }
  return inspection.canonical;
}
