import { describe, expect, it } from 'vitest';
import type { StoreConnection } from '@amazon-ai-ops/shared-types';
import { requireBrowserLoginProviderConnections } from './browser-login-provider-connections';

function connection(
  provider: StoreConnection['provider'],
  identity: Pick<
    StoreConnection,
    'accountLabel' | 'externalAccountId' | 'collectionStoreName'
  > = {},
): StoreConnection {
  const externalAccountId = identity.externalAccountId;
  const collectionStoreName = identity.collectionStoreName;
  return {
    id: `cap-${provider}` as StoreConnection['id'],
    storeId: 'store-us' as StoreConnection['storeId'],
    provider,
    status: 'not_configured',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    ...identity,
    ...(externalAccountId
      ? { normalizedExternalAccountId: externalAccountId.normalize('NFKC').trim().toLowerCase() }
      : {}),
    ...(collectionStoreName
      ? { normalizedCollectionStoreName: collectionStoreName.normalize('NFKC').trim().toLowerCase() }
      : {}),
  };
}

describe('browser login provider connection authority', () => {
  const lingxing = connection('lingxing', {
    accountLabel: 'operator@example.com',
    externalAccountId: 'seller-001',
    collectionStoreName: 'US Main Store',
  });
  const amazonAds = connection('amazon_ads', { externalAccountId: '1234567890' });

  it('requires both provider mappings and an explicit Ads Profile ID', () => {
    expect(() => requireBrowserLoginProviderConnections([], '1234567890')).toThrow(/领星连接/);
    expect(() => requireBrowserLoginProviderConnections([
      connection('lingxing', { accountLabel: 'operator@example.com' }),
      amazonAds,
    ], '1234567890')).toThrow(/同时配置登录账号与下载中心店铺名称映射/);
    expect(() => requireBrowserLoginProviderConnections([lingxing], '1234567890')).toThrow(/Amazon Ads Profile/);
    expect(() => requireBrowserLoginProviderConnections([
      lingxing,
      connection('amazon_ads', { accountLabel: 'label-without-profile-id' }),
    ], '1234567890')).toThrow(/缺少 Profile ID/);
    expect(() => requireBrowserLoginProviderConnections([
      lingxing,
      amazonAds,
    ], 'different-profile')).toThrow(/Main 店铺权限不一致/);
  });

  it('returns the exact authoritative connections when both identities are present', () => {
    expect(requireBrowserLoginProviderConnections([amazonAds, lingxing], '1234567890')).toEqual({
      lingxing,
      amazon_ads: amazonAds,
      lingxingIdentityReadiness: 'configured',
    });
  });

  it('requires canonical persisted mappings and compares Ads profile identity canonically', () => {
    const unbound = { ...lingxing, normalizedExternalAccountId: undefined };
    expect(() => requireBrowserLoginProviderConnections([
      unbound,
      amazonAds,
    ], '1234567890')).toThrow(/稳定店铺身份未通过持久映射校验/);
    expect(requireBrowserLoginProviderConnections([
      lingxing,
      amazonAds,
    ], ' 1234567890 ')).toEqual({
      lingxing,
      amazon_ads: amazonAds,
      lingxingIdentityReadiness: 'configured',
    });
  });

  it('allows a configured Lingxing selector to enter typed stable-identity enrollment', () => {
    const pending = connection('lingxing', {
      accountLabel: 'operator@example.com',
      collectionStoreName: 'US Main Store',
    });
    expect(requireBrowserLoginProviderConnections([
      pending,
      amazonAds,
    ], '1234567890')).toEqual({
      lingxing: pending,
      amazon_ads: amazonAds,
      lingxingIdentityReadiness: 'enrollment_pending',
    });
  });
});
