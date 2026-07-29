import type { StoreConnection } from '@amazon-ai-ops/shared-types';

export type BrowserLoginProviderConnections = Readonly<{
  lingxing: StoreConnection;
  amazon_ads: StoreConnection;
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
  if (!lingxing.accountLabel?.trim() && !lingxing.externalAccountId?.trim()) {
    throw new Error('lingxing 连接缺少账号标识，不能验证浏览器会话归属。');
  }
  if (!amazonAds) {
    throw new Error('当前店铺必须先配置 Amazon Ads Profile 连接，浏览器登录已拒绝。');
  }
  if (!amazonAds.externalAccountId?.trim()) {
    throw new Error('Amazon Ads 连接缺少 Profile ID，不能验证浏览器会话归属。');
  }
  if (amazonAds.externalAccountId.trim() !== expectedAmazonAdsProfileId) {
    throw new Error('Amazon Ads Profile ID 与当前 Main 店铺权限不一致，浏览器登录已拒绝。');
  }
  return { lingxing, amazon_ads: amazonAds };
}
