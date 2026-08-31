/**
 * Format a numeric value as a percentage.
 *
 * Accepts values either as a fraction (0.25) or as a percent (25) and returns
 * a display string such as "25%". Strips the trailing ".0" so "25.0%" reads
 * as "25%". Returns "—" for non-finite or null values to make empty cells
 * explicit in dense tables.
 */
export function percent(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const normalized = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return `${normalized.toFixed(1).replace(/\.0$/, '')}%`;
}
