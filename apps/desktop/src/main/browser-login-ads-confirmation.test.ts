import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { normalizeBrowserLoginAdsIdentityConfirmation } from './browser-login-ads-confirmation';

const storeContext = normalizeStoreContextEnvelope({
  browserProfileId: 'profile-login',
  businessDate: '2026-07-29',
  businessTimezone: 'America/Los_Angeles',
  currency: 'USD',
  marketplace: 'US',
  sessionGeneration: 4,
  storeId: 'store-login',
});

describe('browser login Ads identity confirmation', () => {
  it('accepts only an opaque token with the exact Store authority envelope', () => {
    expect(normalizeBrowserLoginAdsIdentityConfirmation({
      confirmationToken: '01234567-89ab-cdef-0123-456789abcdef',
      storeContext,
    })).toEqual({
      confirmationToken: '01234567-89ab-cdef-0123-456789abcdef',
      storeContext,
    });
  });

  it.each([
    ['', /确认令牌/],
    ['profile-100<script>', /确认令牌/],
  ])('rejects an invalid or identity-shaped token', (confirmationToken, message) => {
    expect(() => normalizeBrowserLoginAdsIdentityConfirmation({ confirmationToken, storeContext }))
      .toThrow(message);
  });
});
