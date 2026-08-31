import type { Currency } from './currency';
import { usdCurrency } from './currency';

/**
 * Format a numeric value as currency.
 *
 * Defaults to USD because the production app currently restricts V1 to the
 * US marketplace, but the function accepts any Intl-recognized currency code
 * for future expansion.
 */
export function money(value: unknown, currency: Currency = usdCurrency): string {
  if (typeof value === 'number' && !Number.isFinite(value)) return '—';
  const numeric = Number(value);
  if (value === null || value === undefined) return '—';
  if (!Number.isFinite(numeric)) return String(value);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return String(value);
  }
}
