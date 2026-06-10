export const LINGXING_ERP_LOGIN_URL = 'https://erp.lingxing.com/';
export const LINGXING_ERP_HOME_URL = 'https://erp.lingxing.com/erp/home';

export type LingxingAdsEntryMode = 'erp_ads_entry';

export type LingxingSessionNavigationPlan = {
  initialUrl: string;
  erpHomeUrl: string;
  adsEntryMode: LingxingAdsEntryMode;
};

export type LingxingPageState = {
  url: string;
  title?: string;
  bodyText?: string;
};

export function getLingxingSessionNavigationPlan(): LingxingSessionNavigationPlan {
  return {
    initialUrl: LINGXING_ERP_LOGIN_URL,
    erpHomeUrl: LINGXING_ERP_HOME_URL,
    adsEntryMode: 'erp_ads_entry',
  };
}

export function isDirectAdsStartUrl(url: string): boolean {
  return /^https:\/\/ads\.lingxing\.com\//i.test(url);
}

export function isLingxingAdsLoggedInPage(state: LingxingPageState): boolean {
  const bodyText = state.bodyText || '';
  const looksLoggedOut = bodyText.includes('账号登录')
    || bodyText.includes('微信登录')
    || state.url.includes('login')
    || state.url.includes('/restartLogin');
  if (!isDirectAdsStartUrl(state.url) || looksLoggedOut) return false;

  return [
    '领星广告系统',
    '下载中心',
    '广告组合',
    '返回ERP',
    '实时广告',
    '广告销售额',
    '广告活动',
    'ACoS',
  ].some((marker) => bodyText.includes(marker));
}
