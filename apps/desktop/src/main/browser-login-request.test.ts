import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { normalizeBrowserLoginRequest } from './browser-login-request';

const storeContext = normalizeStoreContextEnvelope({
  browserProfileId: 'profile-login',
  businessDate: '2026-07-29',
  businessTimezone: 'America/Los_Angeles',
  currency: 'USD',
  marketplace: 'US',
  sessionGeneration: 4,
  storeId: 'store-login',
});

describe('browser login request authority boundary', () => {
  it('normalizes a typed request while retaining its exact store and Ads authority', () => {
    expect(normalizeBrowserLoginRequest({
      amazonAdsProfileId: '  1234567890  ',
      credentialSource: 'typed',
      password: 'typed-password',
      rememberPassword: false,
      storeContext,
      username: '  operator@example.com  ',
    })).toEqual({
      amazonAdsProfileId: '1234567890',
      credentialSource: 'typed',
      password: 'typed-password',
      rememberPassword: false,
      storeContext,
      username: 'operator@example.com',
    });
  });

  it('accepts Main-managed saved credentials only with the same authority envelope', () => {
    expect(normalizeBrowserLoginRequest({
      amazonAdsProfileId: '1234567890',
      credentialSource: 'saved',
      rememberPassword: true,
      storeContext,
      username: 'operator@example.com',
    })).toEqual({
      amazonAdsProfileId: '1234567890',
      credentialSource: 'saved',
      rememberPassword: true,
      storeContext,
      username: 'operator@example.com',
    });
  });

  it('rejects session-reset authority on a saved-credential request', () => {
    expect(() => normalizeBrowserLoginRequest({
      amazonAdsProfileId: '1234567890',
      credentialSource: 'saved',
      rememberPassword: true,
      resetLingxingSessionForEnrollment: true,
      storeContext,
      username: 'operator@example.com',
    })).toThrow(/必须使用本次手动输入/);
  });

  it('retains an explicit typed-login confirmation for store-bound Lingxing session reset', () => {
    expect(normalizeBrowserLoginRequest({
      amazonAdsProfileId: '1234567890',
      resetLingxingSessionForEnrollment: true,
      credentialSource: 'typed',
      password: 'typed-password',
      rememberPassword: true,
      storeContext,
      username: 'operator@example.com',
    })).toMatchObject({
      resetLingxingSessionForEnrollment: true,
      credentialSource: 'typed',
      storeContext,
    });
  });

  it.each([
    ['missing store context', { storeContext: undefined }, /store context/i],
    ['missing Ads Profile ID', { amazonAdsProfileId: '' }, /Profile ID/],
    ['overlong Ads Profile ID', { amazonAdsProfileId: 'a'.repeat(257) }, /Profile ID/],
    ['control character in Ads Profile ID', { amazonAdsProfileId: 'profile\u0000id' }, /Profile ID/],
    ['invalid credential source', { credentialSource: 'renderer-secret' }, /凭证来源/],
    ['missing typed password', { password: '' }, /领星密码/],
    ['invalid session reset confirmation', { resetLingxingSessionForEnrollment: 'yes' }, /重置确认值/],
  ])('rejects %s', (_label, patch, message) => {
    expect(() => normalizeBrowserLoginRequest({
      amazonAdsProfileId: '1234567890',
      credentialSource: 'typed',
      password: 'typed-password',
      rememberPassword: false,
      storeContext,
      username: 'operator@example.com',
      ...patch,
    })).toThrow(message);
  });
});
