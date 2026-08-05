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

  it('requires only the store-scoped Lingxing selector before opening the visible browsers', () => {
    expect(() => requireBrowserLoginProviderConnections([])).toThrow(/领星连接/);
    expect(() => requireBrowserLoginProviderConnections([
      connection('lingxing', { accountLabel: 'operator@example.com' }),
      amazonAds,
    ])).toThrow(/同时配置登录账号与下载中心店铺名称映射/);
    expect(requireBrowserLoginProviderConnections([lingxing])).toEqual({
      lingxing,
      amazon_ads: undefined,
      lingxingIdentityReadiness: 'configured',
      amazonAdsIdentityReadiness: 'enrollment_pending',
    });
    const pendingAds = connection('amazon_ads', { accountLabel: '等待自动识别' });
    expect(requireBrowserLoginProviderConnections([lingxing, pendingAds])).toEqual({
      lingxing,
      amazon_ads: pendingAds,
      lingxingIdentityReadiness: 'configured',
      amazonAdsIdentityReadiness: 'enrollment_pending',
    });
  });

  it('returns the exact authoritative connections when both identities are present', () => {
    expect(requireBrowserLoginProviderConnections([amazonAds, lingxing])).toEqual({
      lingxing,
      amazon_ads: amazonAds,
      lingxingIdentityReadiness: 'configured',
      amazonAdsIdentityReadiness: 'configured',
    });
  });

  it('requires canonical persisted mappings and compares Ads profile identity canonically', () => {
    const unbound = { ...lingxing, normalizedExternalAccountId: undefined };
    expect(() => requireBrowserLoginProviderConnections([
      unbound,
      amazonAds,
    ])).toThrow(/稳定店铺身份未通过持久映射校验/);
    expect(requireBrowserLoginProviderConnections([
      lingxing,
      amazonAds,
    ])).toEqual({
      lingxing,
      amazon_ads: amazonAds,
      lingxingIdentityReadiness: 'configured',
      amazonAdsIdentityReadiness: 'configured',
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
    ])).toEqual({
      lingxing: pending,
      amazon_ads: amazonAds,
      lingxingIdentityReadiness: 'enrollment_pending',
      amazonAdsIdentityReadiness: 'configured',
    });
  });

  it('rejects a corrupted persisted Ads identity but never compares a Renderer-supplied ID', () => {
    const corruptedAds = { ...amazonAds, normalizedExternalAccountId: 'different-profile' };
    expect(() => requireBrowserLoginProviderConnections([lingxing, corruptedAds]))
      .toThrow(/广告账户身份未通过持久校验/);
  });
});
