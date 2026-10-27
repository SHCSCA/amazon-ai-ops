import { mainRuntimeModuleContracts, mainRuntimeModuleContract, mainRuntimeFunctionContract, mainRuntimeVariableContract, mainRuntimeSectionContract } from './main-runtime-source.test-support';
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  assertLingxingAdsSelectedStoreTags,
  bindPendingLingxingAdsNewPageAdoption,
  bindPendingLingxingAdsPageCloseOnlyLiveness,
  dismissLingxingAdsChangeAnnouncements,
  discoverLingxingAdsKeywordTarget,
  ensureLingxingErpAuthenticated,
  ensureLingxingAdsHeaderStore,
  findTrustedLingxingProviderReplacementPage,
  isLingxingProviderExplicitlyLoggedOutPage,
  isTrustedLingxingProviderUrl,
  navigateToLingxingAdsCampaignKeywordTarget,
  findTrustedLingxingProviderPageAfterPendingNavigation,
  resolveLingxingStableIdentityFromAdsProfile,
  resolveLingxingStableIdentityFromVerifiedContinuation,
  openLingxingAdsFromErp,
  readLingxingAdsPageStateAfterNavigation,
  readLingxingAdsProfileEvidence,
  resolveLingxingKeywordTargetRows,
  restoreAuthenticatedLingxingErpPage,
  selectOnlyLingxingAdsStore,
  selectLingxingAdsProfileEvidence,
} from './lingxing-ads-sso';

describe('openLingxingAdsFromErp', () => {
  it('recovers when the first authenticated Ads state read loses its execution context to navigation', async () => {
    const click = vi.fn(async () => undefined);
    const evaluate = vi.fn()
      .mockRejectedValueOnce(new Error('Execution context was destroyed'))
      .mockResolvedValue('领星广告系统 返回ERP 广告活动 ACoS');
    const adsPage = {
      url: () => 'https://ads.lingxing.com/home',
      title: vi.fn(async () => '仪表盘'),
      evaluate,
      isClosed: vi.fn(() => false),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      waitForURL: vi.fn(async () => undefined),
      bringToFront: vi.fn(async () => undefined),
    };
    const erpPage = {
      url: () => 'https://erp.lingxing.com/erp/home',
      waitForTimeout: vi.fn(async () => undefined),
      getByRole: vi.fn(() => ({
        first: () => ({ isVisible: vi.fn(async () => true), click }),
      })),
    };
    const context = {
      pages: vi.fn(() => [erpPage]),
      waitForEvent: vi.fn(async () => adsPage),
    };
    const controller = {
      getPage: () => erpPage,
      getContext: () => context,
      setActivePage: vi.fn(),
    };

    await expect(openLingxingAdsFromErp(controller as never)).resolves.toBe(adsPage);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(adsPage.waitForLoadState).toHaveBeenNthCalledWith(
      2,
      'domcontentloaded',
      { timeout: 5_000 },
    );
    expect(adsPage.waitForTimeout).toHaveBeenCalledWith(250);
    expect(controller.setActivePage).toHaveBeenCalledWith(adsPage);
  });

  it('waits for the current ERP sidebar Ads entry to become visible after the home shell renders', async () => {
    const click = vi.fn(async () => undefined);
    const isVisible = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const adsPage = {
      url: () => 'https://ads.lingxing.com/home',
      title: vi.fn(async () => '仪表盘'),
      evaluate: vi.fn(async () => '领星广告系统 返回ERP 广告活动 ACoS'),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      waitForURL: vi.fn(async () => undefined),
      bringToFront: vi.fn(async () => undefined),
    };
    const erpPage = {
      url: () => 'https://erp.lingxing.com/erp/home',
      waitForTimeout: vi.fn(async () => undefined),
      getByRole: vi.fn(() => ({
        first: () => ({ isVisible, click }),
      })),
    };
    const context = {
      pages: vi.fn(() => [erpPage]),
      waitForEvent: vi.fn(async () => adsPage),
    };
    const controller = {
      getPage: () => erpPage,
      getContext: () => context,
      setActivePage: vi.fn(),
    };

    await expect(openLingxingAdsFromErp(controller as never)).resolves.toBe(adsPage);
    expect(isVisible).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledOnce();
  });

  it('reports a Chinese next step when the opened Ads browser is immediately closed', async () => {
    const adsPage = {
      url: () => 'https://ads.lingxing.com/home',
      title: vi.fn(async () => '领星广告'),
      evaluate: vi.fn(async () => '领星广告系统'),
      isClosed: vi.fn(() => true),
      waitForLoadState: vi.fn(async () => { throw new Error('Target page, context or browser has been closed'); }),
      waitForURL: vi.fn(async () => { throw new Error('Target page, context or browser has been closed'); }),
    };
    const erpPage = {
      url: () => 'https://erp.lingxing.com/erp/home',
      waitForTimeout: vi.fn(async () => undefined),
      getByRole: vi.fn(() => ({
        first: () => ({ isVisible: vi.fn(async () => true), click: vi.fn(async () => undefined) }),
      })),
    };
    const context = {
      pages: vi.fn(() => [erpPage]),
      waitForEvent: vi.fn(async () => adsPage),
    };
    const controller = {
      getPage: () => erpPage,
      getContext: () => context,
      setActivePage: vi.fn(),
    };

    await expect(openLingxingAdsFromErp(controller as never))
      .rejects.toThrow('Ads 可见浏览器已关闭；ERP 已连接，可继续只读采集，请点击“重试 Ads”恢复广告身份识别。');
  });

  it('uses the visible ERP Ads menu and takes ownership of the authenticated popup', async () => {
    const click = vi.fn(async () => undefined);
    const adsPage = {
      url: () => 'https://ads.lingxing.com/home',
      title: vi.fn(async () => '仪表盘'),
      evaluate: vi.fn(async () => '领星广告系统 返回ERP 广告活动 ACoS'),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      waitForURL: vi.fn(async () => undefined),
      bringToFront: vi.fn(async () => undefined),
    };
    const erpPage = {
      url: () => 'https://erp.lingxing.com/erp/home',
      waitForTimeout: vi.fn(async () => undefined),
      getByRole: vi.fn(() => ({
        first: () => ({
          isVisible: vi.fn(async () => true),
          click,
        }),
      })),
    };
    const context = {
      pages: vi.fn(() => [erpPage]),
      waitForEvent: vi.fn(async () => adsPage),
    };
    const setActivePage = vi.fn();
    const controller = {
      getPage: () => erpPage,
      getContext: () => context,
      setActivePage,
    };

    const result = await openLingxingAdsFromErp(controller as never);

    expect(click).toHaveBeenCalledOnce();
    expect(context.waitForEvent).toHaveBeenCalledWith('page', { timeout: 45_000 });
    expect(setActivePage).toHaveBeenCalledWith(adsPage);
    expect(result).toBe(adsPage);
  });

  it('recovers from a stale Ads restartLogin tab by using the still-authenticated ERP tab', async () => {
    const adsPage = {
      url: () => 'https://ads.lingxing.com/home',
      title: vi.fn(async () => '仪表盘'),
      evaluate: vi.fn(async () => '领星广告系统 返回ERP 广告活动 ACoS'),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      waitForURL: vi.fn(async () => undefined),
      bringToFront: vi.fn(async () => undefined),
    };
    const staleAdsPage = {
      url: () => 'https://ads.lingxing.com/restartLogin',
      title: vi.fn(async () => '登录'),
      evaluate: vi.fn(async () => '您尚未登录 账号登录'),
    };
    const erpPage = {
      url: () => 'https://erp.lingxing.com/erp/home',
      waitForTimeout: vi.fn(async () => undefined),
      getByRole: vi.fn(() => ({
        first: () => ({
          isVisible: vi.fn(async () => true),
          click: vi.fn(async () => undefined),
        }),
      })),
    };
    const context = {
      pages: vi.fn(() => [erpPage, staleAdsPage]),
      waitForEvent: vi.fn(async () => adsPage),
    };
    const controller = {
      getPage: () => staleAdsPage,
      getContext: () => context,
      setActivePage: vi.fn(),
    };

    await expect(openLingxingAdsFromErp(controller as never)).resolves.toBe(adsPage);
    expect(erpPage.getByRole).toHaveBeenCalledWith('menuitem', { name: /广告/ });
  });

  it('ignores a transient restartLogin popup until the ERP entry exposes an authenticated Ads page', async () => {
    let popupOpened = false;
    let authenticatedPageAvailable = false;
    const authenticatedAdsPage = {
      url: () => 'https://ads.lingxing.com/home',
      title: vi.fn(async () => '仪表盘'),
      evaluate: vi.fn(async () => '领星广告系统 返回ERP 广告活动 ACoS'),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      waitForURL: vi.fn(async () => undefined),
      bringToFront: vi.fn(async () => undefined),
    };
    const restartLoginPage = {
      url: () => 'https://ads.lingxing.com/restartLogin',
      title: vi.fn(async () => '您尚未登录'),
      evaluate: vi.fn(async () => '您尚未登录 请从领星ERP进入到广告系统'),
      isClosed: vi.fn(() => false),
      waitForLoadState: vi.fn(async () => undefined),
      waitForURL: vi.fn(async () => undefined),
    };
    const click = vi.fn(async () => {
      popupOpened = true;
    });
    const erpPage = {
      url: () => 'https://erp.lingxing.com/erp/home',
      waitForTimeout: vi.fn(async () => {
        authenticatedPageAvailable = true;
      }),
      getByRole: vi.fn(() => ({
        first: () => ({ isVisible: vi.fn(async () => true), click }),
      })),
    };
    const context = {
      pages: vi.fn(() => [
        erpPage,
        ...(popupOpened ? [restartLoginPage] : []),
        ...(authenticatedPageAvailable ? [authenticatedAdsPage] : []),
      ]),
      waitForEvent: vi.fn(async () => restartLoginPage),
    };
    const setActivePage = vi.fn();
    const controller = {
      getPage: () => erpPage,
      getContext: () => context,
      setActivePage,
    };

    await expect(openLingxingAdsFromErp(controller as never)).resolves.toBe(authenticatedAdsPage);
    expect(click).toHaveBeenCalledOnce();
    expect(setActivePage).toHaveBeenCalledWith(authenticatedAdsPage);
  });

  it('rejects a logged-out download-center shell even when it renders the current store selector', async () => {
    const loggedOutAdsPage = {
      url: () => 'https://ads.lingxing.com/ak_download/download_center/download_report_log/index',
      title: vi.fn(async () => '您尚未登录~'),
      evaluate: vi.fn(async () => '您尚未登录~ 下载中心 创建报告 ORBIT-US 美国'),
      isClosed: vi.fn(() => false),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      waitForURL: vi.fn(async () => undefined),
      bringToFront: vi.fn(async () => undefined),
    };
    const erpPage = {
      url: () => 'https://erp.lingxing.com/erp/home',
      waitForTimeout: vi.fn(async () => undefined),
      getByRole: vi.fn(() => ({
        first: () => ({
          isVisible: vi.fn(async () => true),
          click: vi.fn(async () => undefined),
        }),
      })),
    };
    const context = {
      pages: vi.fn(() => [erpPage]),
      waitForEvent: vi.fn(async () => loggedOutAdsPage),
    };
    const controller = {
      getPage: () => erpPage,
      getContext: () => context,
      setActivePage: vi.fn(),
    };

    await expect(openLingxingAdsFromErp(controller as never))
      .rejects.toThrow('领星 ERP 已登录，但 Ads SSO 未建立；请保留窗口并重新从 ERP 左侧“广告”入口进入。');
    expect(controller.setActivePage).not.toHaveBeenCalled();
  });

  it('accepts an ERP menu that navigates the current tab instead of opening a popup', async () => {
    let url = 'https://erp.lingxing.com/erp/home';
    const click = vi.fn(async () => { url = 'https://ads.lingxing.com/home'; });
    const page = {
      url: () => url,
      title: vi.fn(async () => '领星广告'),
      evaluate: vi.fn(async () => '领星广告系统 返回ERP 广告活动 ACoS'),
      getByRole: vi.fn(() => ({ first: () => ({ isVisible: vi.fn(async () => true), click }) })),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      waitForURL: vi.fn(async () => undefined),
      bringToFront: vi.fn(async () => undefined),
    };
    const context = {
      pages: vi.fn(() => [page]),
      waitForEvent: vi.fn(() => new Promise(() => undefined)),
    };
    const controller = {
      getPage: () => page,
      getContext: () => context,
      setActivePage: vi.fn(),
    };

    await expect(openLingxingAdsFromErp(controller as never)).resolves.toBe(page);
    expect(click).toHaveBeenCalledOnce();
    expect(controller.setActivePage).toHaveBeenCalledWith(page);
  });

  it('restores the authenticated ERP tab after an Ads download-center failure', async () => {
    const loggedOutAdsPage = {
      url: () => 'https://ads.lingxing.com/restartLogin',
      isClosed: vi.fn(() => false),
    };
    const erpPage = {
      url: () => 'https://erp.lingxing.com/erp/home',
      title: vi.fn(async () => '领星ERP - 跨境电商管理系统'),
      evaluate: vi.fn(async () => '首页 产品 销售 广告'),
      isClosed: vi.fn(() => false),
      bringToFront: vi.fn(async () => undefined),
    };
    const context = { pages: vi.fn(() => [loggedOutAdsPage, erpPage]) };
    const controller = {
      getPage: () => loggedOutAdsPage,
      getContext: () => context,
      setActivePage: vi.fn(),
    };

    await expect(restoreAuthenticatedLingxingErpPage(controller as never)).resolves.toBe(true);
    expect(controller.setActivePage).toHaveBeenCalledWith(erpPage);
    expect(erpPage.bringToFront).toHaveBeenCalledOnce();
  });
});
