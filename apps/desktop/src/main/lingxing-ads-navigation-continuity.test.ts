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

describe('Lingxing Ads navigation continuity', () => {
  it('treats same-origin provider login paths and visible login DOM as an immediate identity loss', () => {
    expect(isTrustedLingxingProviderUrl('lingxing', 'https://erp.lingxing.com/login'))
      .toBe(false);
    expect(isTrustedLingxingProviderUrl('amazon_ads', 'https://ads.lingxing.com/login/index'))
      .toBe(false);
    expect(isLingxingProviderExplicitlyLoggedOutPage('lingxing', {
      url: 'https://erp.lingxing.com/erp/home',
      title: '领星 ERP',
      bodyText: '',
      hasAccountInput: true,
    })).toBe(true);
    expect(isLingxingProviderExplicitlyLoggedOutPage('amazon_ads', {
      url: 'https://ads.lingxing.com/dashboard',
      title: '领星广告',
      bodyText: '您尚未登录，请从领星 ERP 进入',
    })).toBe(true);
    expect(isLingxingProviderExplicitlyLoggedOutPage('amazon_ads', {
      url: 'https://ads.lingxing.com/dashboard',
      title: '领星广告',
      bodyText: '广告活动 ACoS',
    })).toBe(false);
  });

  it('wires verified-provider liveness to recheck same-origin login DOM after navigation', () => {
    const mainSource = mainRuntimeModuleContract('main-browser-login-runtime.ts');
    const livenessSource = mainRuntimeSectionContract('function bindCompletedLoginPageLiveness', 'async function degradeVisibleLoginProvider');

    expect(livenessSource).toContain('isLingxingProviderExplicitlyLoggedOutPage(provider, pageState)');
    expect(livenessSource).toContain('providerStateInspectionPending = true');
    expect(livenessSource).toContain("page.on('domcontentloaded'");
    expect(livenessSource).toContain("degradeVisibleLoginProvider(provider, runtimeId, context, '页面已退回登录状态。')");
    expect(livenessSource).toContain('const adoptedPageState = await readLingxingPageState(replacementPage);');
    expect(livenessSource.indexOf('isLingxingProviderExplicitlyLoggedOutPage(provider, adoptedPageState)'))
      .toBeLessThan(livenessSource.indexOf('continuePendingAmazonAdsIdentityRecognition(runtimeId, context)'));
  });

  it('continues an adopted authenticated Ads page without requiring a saved password', () => {
    const mainSource = mainRuntimeModuleContract('main-browser-login-runtime.ts');
    const continuationSource = mainRuntimeSectionContract('async function continuePendingAmazonAdsIdentityRecognition', 'function bindCompletedLoginPageLiveness');
    const currentRetryCheckSource = mainRuntimeSectionContract('function isCurrentAmazonAdsRetryContinuation', 'function assertCurrentAmazonAdsRetryAuthority');

    expect(continuationSource).toContain('username: connections.lingxing.accountLabel');
    expect(continuationSource).not.toContain('readSavedLoginCredentialStatus(');
    expect(continuationSource).not.toContain('saved.passwordAvailable');
    expect(currentRetryCheckSource).not.toContain('readSavedLoginCredentialStatus(');
    expect(currentRetryCheckSource).not.toContain('saved.passwordAvailable');
  });

  it('wires bounded pending Ads new-page adoption into the retained identity retry claim', () => {
    const mainSource = mainRuntimeModuleContract('main-browser-login-runtime.ts');
    const continuationSource = mainRuntimeSectionContract('async function continuePendingAmazonAdsIdentityRecognition', 'function bindCompletedLoginPageLiveness');
    const livenessSource = mainRuntimeSectionContract('function bindCompletedLoginPageLiveness', 'async function degradeVisibleLoginProvider');

    expect(livenessSource).toContain('bindPendingLingxingAdsNewPageAdoption({');
    expect(livenessSource).toContain('context: pendingAdsBrowserContext');
    expect(livenessSource).toContain('controller.setActivePage?.(replacementPage)');
    expect(livenessSource).toContain(
      'continuePendingAmazonAdsIdentityRecognition(runtimeId, context)',
    );
    expect(livenessSource).toContain('onUnsafeCandidates: (reason) => degradeVisibleLoginProvider(');
    expect(continuationSource).toContain('pendingAmazonAdsIdentityRetry');
    expect(continuationSource).toContain('isCurrentAmazonAdsRetryContinuation(request, activeContext)');
    expect(continuationSource).toContain('executeCurrentAmazonAdsRetryContinuation(');
    expect(continuationSource).not.toContain('handleBrowserLogin(');
    expect(continuationSource).not.toContain('runUserVisibleBrowserTransition(');
    expect(continuationSource).not.toContain('publishCandidate(');
  });

  it('wires current-store recommendation target discovery through the execution authority bridge', () => {
    const mainSource = mainRuntimeModuleContract('main-browser-login-runtime.ts');

    expect(mainRuntimeModuleContract('main-ipc-registration-runtime.ts')).toContain("registerTrackedIpcHandler('execution-authority:discover-recommendation-target'");
    expect(mainRuntimeModuleContract('main-operator-browser-runtime.ts')).toContain("withLegacyOperatorBrowserLease(\n    'amazon_ads',\n    `discover-recommendation-target:");
    expect(mainRuntimeModuleContract('main-operator-browser-runtime.ts')).toContain('state.recommendationRepo.findByIdForStore(context.storeId, recommendationId)');
    expect(mainRuntimeModuleContract('main-operator-browser-runtime.ts')).toContain('recommendationAsin = canonicalizeAmazonAsin(recommendation.asin)');
    expect(mainRuntimeModuleContract('main-operator-browser-runtime.ts')).toContain("const recommendationMatchType = String(evidence?.matchType ?? '').normalize('NFKC').trim()");
    expect(mainRuntimeModuleContract('main-operator-browser-runtime.ts')).toContain('navigateToLingxingAdsCampaignKeywordTarget(page, {');
    expect(mainRuntimeModuleContract('main-operator-browser-runtime.ts')).toContain('discoverLingxingAdsKeywordTarget(page, {');
    expect(mainRuntimeModuleContract('main-operator-browser-runtime.ts')).toContain('matchType: recommendationMatchType');
    expect(mainRuntimeModuleContract('main-operator-browser-runtime.ts')).toContain('recommendationAsin,\n        recommendationMatchType,');
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('execution-authority:discover-recommendation-target-bypass'); }
  });

  it('binds an existing report row by report type instead of a newly generated name', () => {
    const mainSource = mainRuntimeModuleContract('main-browser-login-runtime.ts');
    const waitForReady = mainRuntimeSectionContract('async waitForReportReady(report, dateRange, createdReportIdentity)', 'async downloadReport(report, downloadDir, dateRange, createdReportIdentity)');

    expect(mainRuntimeModuleContract('main-download-automation-runtime.ts')).toContain(
      'generatedReportName: createdReportIdentity?.externalReportName ?? report.displayName',
    );
    expect(waitForReady).toContain(
      'const context = existingReport ? existingReportContext(report, dateRange, createdReportIdentity) : reportContext',
    );
  });

  it('routes the production report download through the authenticated canceled-download recovery', () => {
    const mainSource = mainRuntimeModuleContract('main-browser-login-runtime.ts');
    const downloadReport = mainRuntimeSectionContract('async downloadReport(report, downloadDir, dateRange, createdReportIdentity)', 'async startAttemptTrace(report, dateRange, attemptIndex)');

    expect(downloadReport).toContain('saveLingxingReportDownload({');
    expect(downloadReport).toContain('request: page.request');
    expect(downloadReport).not.toContain('download.saveAs(');
  });

  it('retries an explicit stale execution context and reads the replacement document', async () => {
    const snapshot = {
      url: 'https://ads.lingxing.com/ak_download/download_center/download_report_log/index',
      title: '下载中心',
      bodyText: '下载中心\n创建报告',
    };
    const evaluate = vi.fn()
      .mockRejectedValueOnce(new Error('Execution context was destroyed, most likely because of a navigation'))
      .mockResolvedValueOnce(snapshot);
    const waitForLoadState = vi.fn().mockResolvedValue(undefined);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const page = {
      evaluate,
      waitForLoadState,
      waitForTimeout,
      isClosed: () => false,
    };

    await expect(readLingxingAdsPageStateAfterNavigation(page as never)).resolves.toEqual(snapshot);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 5_000 });
    expect(waitForTimeout).toHaveBeenCalledWith(250);
  });

  it('does not retry an unknown evaluate failure or a closed browser', async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error('Target page, context or browser has been closed'));
    const waitForLoadState = vi.fn();
    const page = {
      evaluate,
      waitForLoadState,
      waitForTimeout: vi.fn(),
      isClosed: () => true,
    };

    await expect(readLingxingAdsPageStateAfterNavigation(page as never))
      .rejects.toThrow('Target page, context or browser has been closed');
    expect(evaluate).toHaveBeenCalledOnce();
    expect(waitForLoadState).not.toHaveBeenCalled();
  });

  it('adopts only a same-provider trusted replacement page', () => {
    const fakePage = (url: string, closed = false) => ({
      url: () => url,
      isClosed: () => closed,
    });
    const closing = fakePage('https://ads.lingxing.com/dashboard');
    const erpPage = fakePage('https://erp.lingxing.com/erp/home');
    const restartLogin = fakePage('https://ads.lingxing.com/restartLogin');
    const closedAds = fakePage('https://ads.lingxing.com/dashboard', true);
    const downloadCenter = fakePage('https://ads.lingxing.com/ak_download/download_center/download_report_log/index');

    expect(findTrustedLingxingProviderReplacementPage(
      'amazon_ads',
      closing as never,
      [closing, erpPage, restartLogin, closedAds, downloadCenter] as never,
    )).toBe(downloadCenter);
    expect(findTrustedLingxingProviderReplacementPage(
      'amazon_ads',
      closing as never,
      [closing, erpPage, restartLogin, closedAds] as never,
    )).toBeNull();
  });

  it('keeps a pending Ads page when its replacement document becomes trusted after navigation', async () => {
    vi.useFakeTimers();
    try {
      let currentUrl = 'about:blank';
      const observedPage = {
        url: () => currentUrl,
        isClosed: () => false,
      };
      const recovery = findTrustedLingxingProviderPageAfterPendingNavigation(
        'amazon_ads',
        observedPage as never,
        () => [observedPage] as never,
      );

      currentUrl = 'https://ads.lingxing.com/ak_download/download_center/download_report_log/index';
      await vi.advanceTimersByTimeAsync(100);

      await expect(recovery).resolves.toBe(observedPage);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adopts a trusted Ads replacement that appears shortly after the pending page closes', async () => {
    vi.useFakeTimers();
    try {
      const observedPage = {
        url: () => 'https://ads.lingxing.com/dashboard',
        isClosed: () => true,
      };
      const replacementPage = {
        url: () => 'https://ads.lingxing.com/ak_download/download_center/download_report_log/index',
        isClosed: () => false,
      };
      let candidates = [observedPage];
      const recovery = findTrustedLingxingProviderPageAfterPendingNavigation(
        'amazon_ads',
        observedPage as never,
        () => candidates as never,
      );

      candidates = [observedPage, replacementPage];
      await vi.advanceTimersByTimeAsync(100);

      await expect(recovery).resolves.toBe(replacementPage);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never adopts restartLogin, ERP, closed, or cross-origin pages for pending Ads', async () => {
    vi.useFakeTimers();
    try {
      const fakePage = (url: string, closed = false) => ({
        url: () => url,
        isClosed: () => closed,
      });
      const observedPage = fakePage('https://ads.lingxing.com/restartLogin');
      const recovery = findTrustedLingxingProviderPageAfterPendingNavigation(
        'amazon_ads',
        observedPage as never,
        () => [
          observedPage,
          fakePage('https://erp.lingxing.com/erp/home'),
          fakePage('https://ads.lingxing.com/dashboard', true),
          fakePage('https://example.com/ads'),
        ] as never,
      );

      await vi.advanceTimersByTimeAsync(500);

      await expect(recovery).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('degrades a pending Ads controller closed while its active page is still ERP', async () => {
    vi.useFakeTimers();
    try {
      let closed = false;
      let closeListener: (() => void) | undefined;
      const erpPage = {
        url: () => 'https://erp.lingxing.com/erp/home',
        isClosed: () => closed,
        once: vi.fn((event: string, listener: () => void): unknown => {
          if (event === 'close') closeListener = listener;
          return erpPage;
        }),
      };
      const onTrustedReplacement = vi.fn();
      const onClosed = vi.fn();

      bindPendingLingxingAdsPageCloseOnlyLiveness({
        page: erpPage as never,
        readCandidates: () => [erpPage] as never,
        onTrustedReplacement,
        onClosed,
      });

      expect(erpPage.once).toHaveBeenCalledWith('close', expect.any(Function));
      closed = true;
      closeListener?.();
      await vi.advanceTimersByTimeAsync(500);

      expect(onTrustedReplacement).not.toHaveBeenCalled();
      expect(onClosed).toHaveBeenCalledOnce();
      expect(onClosed).toHaveBeenCalledWith('可见浏览器已关闭。');
    } finally {
      vi.useRealTimers();
    }
  });

  it('adopts one trusted Ads page that appears while the pending controller ERP page remains open', async () => {
    vi.useFakeTimers();
    try {
      const erpPage = {
        url: () => 'https://erp.lingxing.com/erp/home',
        isClosed: () => false,
      };
      let candidateUrl = 'about:blank';
      let candidateVisible = false;
      const adsCandidate = {
        url: () => candidateUrl,
        isClosed: () => false,
      };
      let pageListener: ((page: unknown) => void) | undefined;
      const context = {
        on: vi.fn((event: string, listener: (page: unknown) => void): unknown => {
          if (event === 'page') pageListener = listener;
          return context;
        }),
        off: vi.fn((): unknown => context),
      };
      const onTrustedPage = vi.fn();
      const onUnsafeCandidates = vi.fn();

      bindPendingLingxingAdsNewPageAdoption({
        observedPage: erpPage as never,
        context: context as never,
        readCandidates: () => (candidateVisible ? [erpPage, adsCandidate] : [erpPage]) as never,
        onTrustedPage,
        onUnsafeCandidates,
      });

      await vi.advanceTimersByTimeAsync(500);
      expect(onTrustedPage).not.toHaveBeenCalled();
      candidateVisible = true;
      candidateUrl = 'https://ads.lingxing.com/ak_download/download_center/download_report_log/index';
      pageListener?.(adsCandidate);
      await vi.advanceTimersByTimeAsync(500);

      expect(onTrustedPage).toHaveBeenCalledOnce();
      expect(onTrustedPage).toHaveBeenCalledWith(adsCandidate);
      expect(onUnsafeCandidates).not.toHaveBeenCalled();
      expect(context.off).toHaveBeenCalledWith('page', expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps pending Ads new-page adoption active beyond the former fixed fifteen-second window', async () => {
    vi.useFakeTimers();
    try {
      const erpPage = {
        url: () => 'https://erp.lingxing.com/erp/home',
        isClosed: () => false,
      };
      let candidateVisible = false;
      const adsCandidate = {
        url: () => 'https://ads.lingxing.com/dashboard',
        isClosed: () => false,
      };
      let pageListener: ((page: unknown) => void) | undefined;
      const context = {
        on: vi.fn((event: string, listener: (page: unknown) => void): unknown => {
          if (event === 'page') pageListener = listener;
          return context;
        }),
        off: vi.fn((): unknown => context),
      };
      const onTrustedPage = vi.fn();

      bindPendingLingxingAdsNewPageAdoption({
        observedPage: erpPage as never,
        context: context as never,
        readCandidates: () => (candidateVisible ? [erpPage, adsCandidate] : [erpPage]) as never,
        onTrustedPage,
        onUnsafeCandidates: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(15_500);
      expect(context.off).not.toHaveBeenCalled();
      candidateVisible = true;
      pageListener?.(adsCandidate);
      await vi.advanceTimersByTimeAsync(500);

      expect(onTrustedPage).toHaveBeenCalledOnce();
      expect(onTrustedPage).toHaveBeenCalledWith(adsCandidate);
      expect(context.off).toHaveBeenCalledWith('page', expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed instead of choosing between multiple trusted pending Ads pages', async () => {
    vi.useFakeTimers();
    try {
      const erpPage = {
        url: () => 'https://erp.lingxing.com/erp/home',
        isClosed: () => false,
      };
      const firstAdsPage = {
        url: () => 'https://ads.lingxing.com/dashboard',
        isClosed: () => false,
      };
      const secondAdsPage = {
        url: () => 'https://ads.lingxing.com/ak_download/download_center/download_report_log/index',
        isClosed: () => false,
      };
      let pageListener: ((page: unknown) => void) | undefined;
      const context = {
        on: vi.fn((event: string, listener: (page: unknown) => void): unknown => {
          if (event === 'page') pageListener = listener;
          return context;
        }),
        off: vi.fn((): unknown => context),
      };
      const onTrustedPage = vi.fn();
      const onUnsafeCandidates = vi.fn();

      bindPendingLingxingAdsNewPageAdoption({
        observedPage: erpPage as never,
        context: context as never,
        readCandidates: () => [erpPage, firstAdsPage, secondAdsPage] as never,
        onTrustedPage,
        onUnsafeCandidates,
      });

      pageListener?.(firstAdsPage);
      await vi.advanceTimersByTimeAsync(500);

      expect(onTrustedPage).not.toHaveBeenCalled();
      expect(onUnsafeCandidates).toHaveBeenCalledOnce();
      expect(onUnsafeCandidates).toHaveBeenCalledWith(
        '领星 Ads 同一隔离浏览器出现多个可信页面，无法唯一继续当前店铺识别，操作已阻断。',
      );
      expect(context.off).toHaveBeenCalledWith('page', expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores restartLogin, ERP, closed, and cross-origin context pages while Ads identity stays pending', async () => {
    vi.useFakeTimers();
    try {
      const erpPage = {
        url: () => 'https://erp.lingxing.com/erp/home',
        isClosed: () => false,
      };
      const invalidPages = [
        { url: () => 'https://ads.lingxing.com/restartLogin', isClosed: () => false },
        { url: () => 'https://erp.lingxing.com/erp/index', isClosed: () => false },
        { url: () => 'https://ads.lingxing.com/dashboard', isClosed: () => true },
        { url: () => 'https://example.com/ads', isClosed: () => false },
      ];
      let pageListener: ((page: unknown) => void) | undefined;
      const context = {
        on: vi.fn((event: string, listener: (page: unknown) => void): unknown => {
          if (event === 'page') pageListener = listener;
          return context;
        }),
        off: vi.fn((): unknown => context),
      };
      const onTrustedPage = vi.fn();
      const onUnsafeCandidates = vi.fn();
      const stop = bindPendingLingxingAdsNewPageAdoption({
        observedPage: erpPage as never,
        context: context as never,
        readCandidates: () => [erpPage, ...invalidPages] as never,
        onTrustedPage,
        onUnsafeCandidates,
      });

      for (const invalidPage of invalidPages) pageListener?.(invalidPage);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(onTrustedPage).not.toHaveBeenCalled();
      expect(onUnsafeCandidates).not.toHaveBeenCalled();
      expect(context.off).not.toHaveBeenCalled();
      stop();
      expect(context.off).toHaveBeenCalledWith('page', expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });
});
