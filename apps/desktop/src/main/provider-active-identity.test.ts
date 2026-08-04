import { describe, expect, it } from 'vitest';
import {
  assertProviderActiveIdentity,
  readLingxingStableExternalAccountIdEvidence,
  requireLingxingTypedStableIdentityEnrollment,
} from './provider-active-identity';

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
    })).toThrowError('领星稳定店铺身份无法从受信页面唯一读取，登录已阻断。');
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

  it('never accepts an Ads account label without stable Profile ID evidence', () => {
    expect(() => assertProviderActiveIdentity({
      connection: {
        provider: 'amazon_ads',
        accountLabel: 'operator@example.com',
        externalAccountId: 'profile-100',
      },
      pageUrl: 'https://ads.lingxing.com/campaigns',
      domObservations: [{
        probeId: 'current-account-label',
        value: 'operator@example.com',
      }],
    })).toThrowError('amazon_ads 当前账户身份与当前店铺连接不匹配，浏览器会话已拒绝。');
  });

  it('accepts matching Ads Profile ID evidence with an additional matching label', () => {
    expect(() => assertProviderActiveIdentity({
      connection: {
        provider: 'amazon_ads',
        accountLabel: 'operator@example.com',
        externalAccountId: 'profile-100',
      },
      pageUrl: 'https://ads.lingxing.com/campaigns',
      domObservations: [
        { probeId: 'current-profile-id', value: ' PROFILE-100 ' },
        { probeId: 'current-account-label', value: ' Operator@Example.Com ' },
      ],
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

  it('enrolls a unique Lingxing seller/store identity only after matching typed credentials', () => {
    expect(requireLingxingTypedStableIdentityEnrollment({
      accountLabel: 'operator@example.com',
      collectionStoreName: 'US Main Store',
      credentialSubmission: {
        credentialSource: 'typed',
        credentialsSubmitted: true,
        username: ' OPERATOR@EXAMPLE.COM ',
      },
      pageUrl: 'https://erp.lingxing.com/erp/home?seller_id=SELLER-100',
      domObservations: [
        { probeId: 'current-store-id', value: 'seller-100' },
        { probeId: 'current-store-name', value: 'US Main Store' },
      ],
    })).toBe('seller-100');
  });

  it('rejects saved credentials for first Lingxing stable-identity enrollment', () => {
    expect(() => requireLingxingTypedStableIdentityEnrollment({
      accountLabel: 'operator@example.com',
      collectionStoreName: 'US Main Store',
      credentialSubmission: {
        credentialSource: 'saved',
        credentialsSubmitted: true,
        username: 'operator@example.com',
      },
      pageUrl: 'https://erp.lingxing.com/erp/home?seller_id=seller-100',
      domObservations: [],
    })).toThrow(/必须使用与连接账号一致的本次手动登录凭证/);
  });

  it('rejects conflicting Lingxing seller/store evidence', () => {
    expect(() => readLingxingStableExternalAccountIdEvidence({
      pageUrl: 'https://erp.lingxing.com/erp/home?seller_id=seller-100',
      domObservations: [{ probeId: 'active-store-id', value: 'store-200' }],
    })).toThrow(/冲突的稳定店铺身份/);
  });

  it('does not treat account_id or the download-center display name as a stable identity', () => {
    expect(() => readLingxingStableExternalAccountIdEvidence({
      pageUrl: 'https://erp.lingxing.com/erp/home?account_id=operator%40example.com',
      domObservations: [{ probeId: 'current-account-label', value: 'US Main Store' }],
    })).toThrow(/无法从受信页面唯一读取/);
  });

  it('keeps account_id separate when seller/store identity and typed username are exact', () => {
    expect(() => assertProviderActiveIdentity({
      connection: {
        provider: 'lingxing',
        accountLabel: 'operator@example.com',
        externalAccountId: 'seller-100',
      },
      pageUrl: 'https://erp.lingxing.com/erp/home?account_id=unrelated-999&seller_id=seller-100',
      domObservations: [],
      credentialSubmission: {
        credentialSource: 'typed',
        credentialsSubmitted: true,
        username: 'operator@example.com',
      },
    })).not.toThrow();
  });

  it('rejects same-account enrollment when the visible store name is another configured store', () => {
    expect(() => requireLingxingTypedStableIdentityEnrollment({
      accountLabel: 'operator@example.com',
      collectionStoreName: 'US Main Store',
      credentialSubmission: {
        credentialSource: 'typed',
        credentialsSubmitted: true,
        username: 'operator@example.com',
      },
      pageUrl: 'https://erp.lingxing.com/erp/home?seller_id=seller-200',
      domObservations: [{ probeId: 'current-store-name', value: 'US Secondary Store' }],
    })).toThrow(/当前可见店铺名称与配置的下载中心店铺名称不一致/);
  });
});
