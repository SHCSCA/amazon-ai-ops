import { describe, expect, it } from 'vitest';
import type { StoreConnection } from '@amazon-ai-ops/shared-types';
import { requireBrowserLoginProviderConnections } from './browser-login-provider-connections';

function connection(
  provider: StoreConnection['provider'],
  identity: Pick<StoreConnection, 'accountLabel' | 'externalAccountId'> = {},
): StoreConnection {
  return {
    id: `cap-${provider}` as StoreConnection['id'],
    storeId: 'store-us' as StoreConnection['storeId'],
    provider,
    status: 'not_configured',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    ...identity,
  };
}

describe('browser login provider connection authority', () => {
  const lingxing = connection('lingxing', { accountLabel: 'operator@example.com' });
  const amazonAds = connection('amazon_ads', { externalAccountId: '1234567890' });

  it('requires both provider mappings and an explicit Ads Profile ID', () => {
    expect(() => requireBrowserLoginProviderConnections([], '1234567890')).toThrow(/领星连接/);
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
    });
  });
});
