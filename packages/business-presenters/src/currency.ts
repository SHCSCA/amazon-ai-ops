/**
 * Supported currency codes. Currently USD only because V1 is Amazon US only,
 * but the type is open so future marketplaces can extend without API churn.
 */
export type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD';

export const usdCurrency: Currency = 'USD';

export function isSupportedCurrency(value: unknown): value is Currency {
  return value === 'USD' || value === 'EUR' || value === 'GBP'
    || value === 'JPY' || value === 'CAD' || value === 'AUD';
}
