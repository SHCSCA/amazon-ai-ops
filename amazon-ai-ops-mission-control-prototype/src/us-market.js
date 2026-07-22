export const US_MARKETPLACE = "Amazon US";
export const US_REGION = "US";
export const US_CURRENCY = "USD";
export const US_BUSINESS_TIMEZONE = "America/Los_Angeles";

export const US_MARKET_IDENTITY = Object.freeze({
  marketplace: US_MARKETPLACE,
  region: US_REGION,
  currency: US_CURRENCY,
  businessTimezone: US_BUSINESS_TIMEZONE,
  timezone: US_BUSINESS_TIMEZONE,
});

export function withUsMarketIdentity(input = {}) {
  return {
    ...input,
    ...US_MARKET_IDENTITY,
  };
}

export function hasUsMarketIdentity(input = {}) {
  const businessTimezone = input.businessTimezone || input.timezone;
  return input.marketplace === US_MARKETPLACE
    && String(input.region || "").toUpperCase() === US_REGION
    && String(input.currency || "").toUpperCase() === US_CURRENCY
    && businessTimezone === US_BUSINESS_TIMEZONE;
}

export function businessTimezoneOf(store) {
  return store?.businessTimezone || store?.timezone || US_BUSINESS_TIMEZONE;
}
