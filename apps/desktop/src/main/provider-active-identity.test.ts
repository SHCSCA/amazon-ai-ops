import { describe, expect, it } from 'vitest';
import { assertProviderActiveIdentity } from './provider-active-identity';

describe('provider active identity', () => {
  it('does not accept an expected identity merely embedded in a URL path or unknown query value', () => {
    expect(() => assertProviderActiveIdentity({
      connection: {
        provider: 'lingxing',
        accountLabel: 'operator@example.com',
        externalAccountId: 'store-100',
      },
      pageUrl: 'https://erp.lingxing.com/erp/operator@example.com?redirect=store-100',
      domObservations: [],
    })).toThrowError('lingxing 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。');
  });

  it('accepts only an exact normalized Ads profile_id from the trusted Ads origin', () => {
    expect(() => assertProviderActiveIdentity({
      connection: {
        provider: 'amazon_ads',
        externalAccountId: ' ADS-ACCOUNT-100 ',
      },
      pageUrl: 'https://ads.lingxing.com/campaigns?profile_id=ads-account-100',
      domObservations: [],
    })).not.toThrow();
  });

  it('accepts an exact normalized value from a whitelisted current DOM attribute', () => {
    expect(() => assertProviderActiveIdentity({
      connection: {
        provider: 'lingxing',
        accountLabel: 'Operator @ Example',
      },
      pageUrl: 'https://erp.lingxing.com/erp/home',
      domObservations: [{
        probeId: 'current-account-label',
        value: '  operator   @   example ',
      }],
    })).not.toThrow();
  });

  it.each([
    {
      name: 'unknown DOM probe',
      pageUrl: 'https://erp.lingxing.com/erp/home',
      domObservations: [{ probeId: 'page-account-label', value: 'operator@example.com' }],
    },
    {
      name: 'provider-incompatible DOM probe',
      pageUrl: 'https://erp.lingxing.com/erp/home',
      domObservations: [{ probeId: 'current-profile-id', value: 'operator@example.com' }],
    },
    {
      name: 'allowed parameter substring',
      pageUrl: 'https://erp.lingxing.com/erp/home?account_id=prefix-operator%40example.com-suffix',
      domObservations: [],
    },
    {
      name: 'untrusted origin',
      pageUrl: 'https://example.invalid/?account_id=operator%40example.com',
      domObservations: [],
    },
  ])('rejects an exact-looking identity from a non-authoritative source: $name', ({
    pageUrl,
    domObservations,
  }) => {
    expect(() => assertProviderActiveIdentity({
      connection: {
        provider: 'lingxing',
        accountLabel: 'operator@example.com',
      },
      pageUrl,
      domObservations,
    })).toThrowError('lingxing 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。');
  });

  it('rejects conflicting active candidates instead of accepting the one matching value', () => {
    expect(() => assertProviderActiveIdentity({
      connection: {
        provider: 'amazon_ads',
        accountLabel: 'operator@example.com',
        externalAccountId: 'profile-100',
      },
      pageUrl: 'https://ads.lingxing.com/?profile_id=profile-100',
      domObservations: [{
        probeId: 'current-account-label',
        value: 'different@example.com',
      }],
    })).toThrowError('amazon_ads 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。');
  });

  it('fails closed on a duplicated allowed URL identity parameter', () => {
    expect(() => assertProviderActiveIdentity({
      connection: {
        provider: 'amazon_ads',
        externalAccountId: 'profile-100',
      },
      pageUrl: 'https://ads.lingxing.com/?profile_id=profile-other&profile_id=profile-100',
      domObservations: [{
        probeId: 'current-profile-id',
        value: 'profile-100',
      }],
    })).toThrowError('amazon_ads 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。');
  });

  it('fails closed when a whitelisted active DOM attribute is malformed', () => {
    expect(() => assertProviderActiveIdentity({
      connection: {
        provider: 'amazon_ads',
        externalAccountId: 'profile-100',
      },
      pageUrl: 'https://ads.lingxing.com/?profile_id=profile-100',
      domObservations: [{
        probeId: 'current-profile-id',
        value: 'profile-100\u0000spoof',
      }],
    })).toThrowError('amazon_ads 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。');
  });

  it('permits the request username only for Lingxing typed credentials actually submitted', () => {
    const base = {
      connection: {
        provider: 'lingxing' as const,
        accountLabel: 'operator@example.com',
      },
      pageUrl: 'https://erp.lingxing.com/erp/home',
      domObservations: [],
    };

    expect(() => assertProviderActiveIdentity({
      ...base,
      credentialSubmission: {
        credentialSource: 'typed',
        credentialsSubmitted: true,
        username: ' OPERATOR@EXAMPLE.COM ',
      },
    })).not.toThrow();
    expect(() => assertProviderActiveIdentity({
      ...base,
      credentialSubmission: {
        credentialSource: 'typed',
        credentialsSubmitted: false,
        username: 'operator@example.com',
      },
    })).toThrowError();
    expect(() => assertProviderActiveIdentity({
      ...base,
      credentialSubmission: {
        credentialSource: 'saved',
        credentialsSubmitted: true,
        username: 'operator@example.com',
      },
    })).toThrowError();
  });

  it('never permits an ERP credential username to establish an Ads identity', () => {
    expect(() => assertProviderActiveIdentity({
      connection: {
        provider: 'amazon_ads',
        accountLabel: 'operator@example.com',
      },
      pageUrl: 'https://ads.lingxing.com/',
      domObservations: [],
      credentialSubmission: {
        credentialSource: 'typed',
        credentialsSubmitted: true,
        username: 'operator@example.com',
      },
    })).toThrowError('amazon_ads 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。');
  });
});
