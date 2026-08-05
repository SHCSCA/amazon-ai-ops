import type { StoreConnection } from '@amazon-ai-ops/shared-types';
import {
  normalizeLingxingCollectionStoreName,
  normalizeProviderExternalAccountId,
} from '@amazon-ai-ops/shared-types';

export type LingxingBrowserIdentityReadiness = 'configured' | 'enrollment_pending';
export type AmazonAdsBrowserIdentityReadiness = 'configured' | 'enrollment_pending';

export type BrowserLoginProviderConnections = Readonly<{
  lingxing: StoreConnection;
  amazon_ads: StoreConnection | undefined;
  lingxingIdentityReadiness: LingxingBrowserIdentityReadiness;
  amazonAdsIdentityReadiness: AmazonAdsBrowserIdentityReadiness;
}>;

export function requireBrowserLoginProviderConnections(
  connections: readonly StoreConnection[],
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
  const adsExternalId = amazonAds
    ? normalizeProviderExternalAccountId('amazon_ads', amazonAds.externalAccountId)
    : undefined;
  let amazonAdsIdentityReadiness: AmazonAdsBrowserIdentityReadiness;
  if (!amazonAds || (!adsExternalId && !amazonAds.normalizedExternalAccountId)) {
    amazonAdsIdentityReadiness = 'enrollment_pending';
  } else if (adsExternalId && amazonAds.normalizedExternalAccountId === adsExternalId) {
    amazonAdsIdentityReadiness = 'configured';
  } else {
    throw new Error('Amazon Ads 广告账户身份未通过持久校验，浏览器登录已拒绝。');
  }
  return {
    lingxing,
    amazon_ads: amazonAds,
    lingxingIdentityReadiness,
    amazonAdsIdentityReadiness,
  };
}
