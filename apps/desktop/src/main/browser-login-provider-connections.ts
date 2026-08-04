import type { StoreConnection } from '@amazon-ai-ops/shared-types';
import {
  normalizeLingxingCollectionStoreName,
  normalizeProviderExternalAccountId,
} from '@amazon-ai-ops/shared-types';

export type LingxingBrowserIdentityReadiness = 'configured' | 'enrollment_pending';

export type BrowserLoginProviderConnections = Readonly<{
  lingxing: StoreConnection;
  amazon_ads: StoreConnection;
  lingxingIdentityReadiness: LingxingBrowserIdentityReadiness;
}>;

export function requireBrowserLoginProviderConnections(
  connections: readonly StoreConnection[],
  expectedAmazonAdsProfileId: string,
): BrowserLoginProviderConnections {
  const lingxing = connections.find((connection) => connection.provider === 'lingxing');
  const amazonAds = connections.find((connection) => connection.provider === 'amazon_ads');
  if (!lingxing) {
    throw new Error('当前店铺必须先配置领星连接，浏览器登录已拒绝。');
  }
  const lingxingCollectionStoreName = normalizeLingxingCollectionStoreName(
    lingxing.collectionStoreName,
  );
  if (!lingxing.accountLabel?.trim() || !lingxingCollectionStoreName) {
    throw new Error('领星连接必须同时配置登录账号与下载中心店铺名称映射，浏览器登录已拒绝。');
  }
  if (lingxing.normalizedCollectionStoreName !== lingxingCollectionStoreName) {
    throw new Error('领星下载中心店铺名称映射未通过持久校验，浏览器登录已拒绝。');
  }
  const lingxingExternalId = normalizeProviderExternalAccountId(
    'lingxing',
    lingxing.externalAccountId,
  );
  let lingxingIdentityReadiness: LingxingBrowserIdentityReadiness;
  if (!lingxingExternalId && !lingxing.normalizedExternalAccountId) {
    lingxingIdentityReadiness = 'enrollment_pending';
  } else if (lingxingExternalId
    && lingxing.normalizedExternalAccountId === lingxingExternalId) {
    lingxingIdentityReadiness = 'configured';
  } else {
    throw new Error('领星稳定店铺身份未通过持久映射校验，浏览器登录已拒绝。');
  }
  if (!amazonAds) {
    throw new Error('当前店铺必须先配置 Amazon Ads Profile 连接，浏览器登录已拒绝。');
  }
  const adsExternalId = normalizeProviderExternalAccountId(
    'amazon_ads',
    amazonAds.externalAccountId,
  );
  if (!adsExternalId) {
    throw new Error('Amazon Ads 连接缺少 Profile ID，不能验证浏览器会话归属。');
  }
  if (amazonAds.normalizedExternalAccountId !== adsExternalId) {
    throw new Error('Amazon Ads Profile ID 未通过持久映射校验，浏览器登录已拒绝。');
  }
  const expectedAdsExternalId = normalizeProviderExternalAccountId(
    'amazon_ads',
    expectedAmazonAdsProfileId,
  );
  if (!expectedAdsExternalId || adsExternalId !== expectedAdsExternalId) {
    throw new Error('Amazon Ads Profile ID 与当前 Main 店铺权限不一致，浏览器登录已拒绝。');
  }
  return { lingxing, amazon_ads: amazonAds, lingxingIdentityReadiness };
}
