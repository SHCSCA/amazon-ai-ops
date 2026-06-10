import { describe, expect, it } from 'vitest';
import {
  getLingxingSessionNavigationPlan,
  isLingxingAdsLoggedInPage,
  isDirectAdsStartUrl,
  LINGXING_ERP_HOME_URL,
  LINGXING_ERP_LOGIN_URL,
} from './lingxing-session-flow';

describe('Lingxing session navigation plan', () => {
  it('starts from ERP and enters Ads through the ERP advertising entry', () => {
    const plan = getLingxingSessionNavigationPlan();

    expect(plan).toEqual({
      initialUrl: LINGXING_ERP_LOGIN_URL,
      erpHomeUrl: LINGXING_ERP_HOME_URL,
      adsEntryMode: 'erp_ads_entry',
    });
    expect(isDirectAdsStartUrl(plan.initialUrl)).toBe(false);
    expect(isDirectAdsStartUrl(plan.erpHomeUrl)).toBe(false);
  });

  it('recognizes direct Ads URLs as invalid login start URLs', () => {
    expect(isDirectAdsStartUrl('https://ads.lingxing.com/home')).toBe(true);
    expect(isDirectAdsStartUrl('https://ads.lingxing.com/ak_download/download_center/download_report_log/index')).toBe(true);
    expect(isDirectAdsStartUrl('https://erp.lingxing.com/erp/home')).toBe(false);
  });

  it('recognizes an existing logged-in Ads dashboard as reusable', () => {
    expect(isLingxingAdsLoggedInPage({
      url: 'https://ads.lingxing.com/home',
      title: '仪表盘',
      bodyText: '实时广告 广告销售额 ACoS 广告活动',
    })).toBe(true);
  });

  it('does not treat an Ads login page as reusable', () => {
    expect(isLingxingAdsLoggedInPage({
      url: 'https://ads.lingxing.com/restartLogin',
      title: '登录',
      bodyText: '账号登录 微信登录',
    })).toBe(false);
  });
});
