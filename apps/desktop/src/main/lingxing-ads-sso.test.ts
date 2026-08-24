import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  assertLingxingAdsSelectedStoreTags,
  dismissLingxingAdsChangeAnnouncements,
  discoverLingxingAdsKeywordTarget,
  ensureLingxingErpAuthenticated,
  ensureLingxingAdsHeaderStore,
  findTrustedLingxingProviderReplacementPage,
  navigateToLingxingAdsCampaignKeywordTarget,
  findTrustedLingxingProviderPageAfterPendingNavigation,
  resolveLingxingStableIdentityFromAdsProfile,
  resolveLingxingStableIdentityFromVerifiedContinuation,
  openLingxingAdsFromErp,
  readLingxingAdsPageStateAfterNavigation,
  readLingxingAdsProfileEvidence,
  restoreAuthenticatedLingxingErpPage,
  selectOnlyLingxingAdsStore,
  selectLingxingAdsProfileEvidence,
} from './lingxing-ads-sso';

describe('discoverLingxingAdsKeywordTarget', () => {
  it('switches the Ads header to one exact US store and verifies the selected label', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <button id="store-control" style="position:fixed;left:20px;top:10px">FT-US 美国</button>
        <div id="menu" style="position:fixed;left:20px;top:50px" hidden><button id="target-store">JF-US 美国</button></div>
        <script>
          document.querySelector('#store-control').onclick = () => { document.querySelector('#menu').hidden = false; };
          document.querySelector('#target-store').onclick = () => {
            document.querySelector('#store-control').textContent = 'JF-US 美国';
            document.querySelector('#menu').hidden = true;
          };
        </script>
      `);

      await ensureLingxingAdsHeaderStore(page, 'JF-US');

      expect(await page.locator('#store-control').innerText()).toBe('JF-US 美国');
    } finally {
      await browser.close();
    }
  });

  it('uses the authenticated current-profile keyword route when the sidebar has no anchor', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.route('https://ads.lingxing.com/**', async (route) => {
        const url = new URL(route.request().url());
        const target = url.pathname === '/ad_report/target/index/index';
        await route.fulfill({
          body: target
            ? '<a href="/ad_report/target/index/index?profile_id=1471859509603819&id=campaign-u07">U07-1P-精准</a>'
            : '<button type="button">广告</button><button type="button">词</button>',
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      });
      await page.goto('https://ads.lingxing.com/ak_download/download_center/download_report_log/index');

      await navigateToLingxingAdsCampaignKeywordTarget(page, {
        externalAccountId: '1471859509603819',
        campaignName: 'U07-1P-精准',
      });

      const url = new URL(page.url());
      expect(url.searchParams.get('profile_id')).toBe('1471859509603819');
      expect(url.searchParams.get('id')).toBe('campaign-u07');
    } finally {
      await browser.close();
    }
  });

  it('accepts the canonical store-scoped keyword route when the sidebar label is composite', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.route('https://ads.lingxing.com/**', async (route) => {
        const url = new URL(route.request().url());
        const target = url.pathname === '/ad_report/target/index/index';
        await route.fulfill({
          body: target
            ? '<a href="/ad_report/target/index/index?profile_id=1471859509603819&id=campaign-u07">U07-1P-精准</a>'
            : '<a href="/ad_report/target/index/index?profile_id=1471859509603819">广告 / 词</a>',
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      });
      await page.goto('https://ads.lingxing.com/ak_download/download_center/download_report_log/index');

      await navigateToLingxingAdsCampaignKeywordTarget(page, {
        externalAccountId: '1471859509603819',
        campaignName: 'U07-1P-精准',
      });

      expect(new URL(page.url()).searchParams.get('id')).toBe('campaign-u07');
    } finally {
      await browser.close();
    }
  });

  it('opens the exact store and campaign keyword page from the Ads sidebar without submitting data', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      let clicks = 0;
      await page.route('https://ads.lingxing.com/**', async (route) => {
        const url = new URL(route.request().url());
        const target = url.pathname === '/ad_report/target/index/index';
        await route.fulfill({
          body: target
            ? '<a href="/ad_report/target/index/index?profile_id=1471859509603819&id=campaign-u07">U07-1P-精准</a><p>关键词页</p>'
            : '<a id="keyword-nav" href="/ad_report/target/index/index?profile_id=1471859509603819&id=campaign-u07">词</a><button onclick="window.submitClicks += 1">保存</button><script>window.submitClicks=0</script>',
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      });
      page.on('request', (request) => {
        if (request.isNavigationRequest()) clicks += 1;
      });
      await page.goto('https://ads.lingxing.com/ak_download/download_center/download_report_log/index');

      await navigateToLingxingAdsCampaignKeywordTarget(page, {
        externalAccountId: '1471859509603819',
        campaignName: 'U07-1P-精准',
      });

      expect(new URL(page.url())).toMatchObject({
        origin: 'https://ads.lingxing.com',
        pathname: '/ad_report/target/index/index',
      });
      expect(new URL(page.url()).searchParams.get('profile_id')).toBe('1471859509603819');
      expect(new URL(page.url()).searchParams.get('id')).toBe('campaign-u07');
      expect(clicks).toBe(2);
    } finally {
      await browser.close();
    }
  });

  it('resolves one exact campaign, ad group, keyword and bid without clicking a save control', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      const html = `
        <table><tbody>
          <tr>
            <td>U07-1P-精准</td><td>精准</td><td>cupping set</td>
            <td><input class="select-item" value="keyword-set" /></td>
            <td><a href="/ad_group/index?ad_group_id=group-set">cupping set</a></td>
            <td><input class="form-control price" value="$2.55" /></td>
            <td><button class="Js-bid-save">save</button></td>
          </tr>
          <tr>
            <td>U07-1P-精准</td><td>精准</td><td>cupping</td>
            <td><input class="select-item" value="keyword-cupping" /></td>
            <td><a href="/ad_group/index?ad_group_id=group-cupping">cupping</a></td>
            <td><input class="form-control price" value="$2.51" /></td>
            <td><button class="Js-bid-save" onclick="window.saveClicks += 1">save</button></td>
          </tr>
          <tr>
            <td>OTHER-CAMPAIGN</td><td>精准</td><td>cupping</td>
            <td><input class="select-item" value="keyword-other" /></td>
            <td><a href="/ad_group/index?ad_group_id=group-other">cupping</a></td>
            <td><input class="form-control price" value="$2.51" /></td>
            <td><button class="Js-bid-save">save</button></td>
          </tr>
        </tbody></table>
        <script>window.saveClicks = 0;</script>
      `;
      await page.route('https://ads.lingxing.com/**', (route) => route.fulfill({
        body: html,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }));
      await page.goto('https://ads.lingxing.com/ad_report/target/index/index?profile_id=1471859509603819&id=campaign-u07');

      const resolved = await discoverLingxingAdsKeywordTarget(page, {
        externalAccountId: '1471859509603819',
        campaignName: 'U07-1P-精准',
        adGroupName: '精准',
        entityName: 'cupping',
        currentBidCents: 251,
      });

      expect(resolved).toMatchObject({
        adsAccountId: '1471859509603819',
        campaignId: 'campaign-u07',
        adGroupId: 'group-cupping',
        keywordId: 'keyword-cupping',
        bidCents: 251,
      });
      expect(await page.evaluate(() => (window as unknown as { saveClicks: number }).saveClicks)).toBe(0);
    } finally {
      await browser.close();
    }
  });

  it('reads the current bid from the named bid column when production omits the legacy price classes', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      const html = `
        <table>
          <thead><tr><th>关键词</th><th>匹配类型</th><th>广告组</th><th>建议竞价</th><th>竞价</th></tr></thead>
          <tbody><tr>
            <td>cupping<input class="select-item" value="keyword-cupping" /></td>
            <td>精准</td>
            <td><a href="/ad_group/index?ad_group_id=group-cupping">精准</a></td>
            <td>$2.37</td>
            <td><input class="form-control input-sm" value="2.51" /></td>
          </tr></tbody>
        </table>`;
      await page.route('https://ads.lingxing.com/**', (route) => route.fulfill({
        body: html,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }));
      await page.goto('https://ads.lingxing.com/ad_report/keyword/index/index?profile_id=1471859509603819&id=campaign-u07');

      await expect(discoverLingxingAdsKeywordTarget(page, {
        externalAccountId: '1471859509603819',
        campaignName: 'U07-1P-精准',
        adGroupName: '精准',
        entityName: 'cupping',
        currentBidCents: 251,
      })).resolves.toMatchObject({
        adGroupId: 'group-cupping',
        keywordId: 'keyword-cupping',
        bidCents: 251,
      });
    } finally {
      await browser.close();
    }
  });

  it('reads the stable keyword identity from a production row checkbox without the legacy select-item class', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.route('https://ads.lingxing.com/**', (route) => route.fulfill({
        body: `
          <table>
            <thead><tr><th></th><th>关键词</th><th>广告组</th><th>竞价</th></tr></thead>
            <tbody><tr>
              <td><input class="check-item" type="checkbox" value="keyword-cupping" /></td>
              <td>cupping</td>
              <td><a href="/ad_group/index?ad_group_id=group-cupping">精准</a></td>
              <td><input value="2.51" /></td>
            </tr></tbody>
          </table>`,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }));
      await page.goto('https://ads.lingxing.com/ad_report/keyword/index/index?profile_id=1471859509603819&id=campaign-u07');

      await expect(discoverLingxingAdsKeywordTarget(page, {
        externalAccountId: '1471859509603819',
        campaignName: 'U07-1P-精准',
        adGroupName: '精准',
        entityName: 'cupping',
        currentBidCents: 251,
      })).resolves.toMatchObject({ keywordId: 'keyword-cupping', bidCents: 251 });
    } finally {
      await browser.close();
    }
  });

  it('reports a stale live bid after merging the production fixed-column mirror for one stable identity', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.route('https://ads.lingxing.com/**', (route) => route.fulfill({
        body: `
          <table><tbody>
            <tr><td>cupping</td><td>精准</td>
              <td><input class="native select-item" type="checkbox" value="keyword-cupping" /></td>
              <td><a href="/ad_group/index?ad_group_id=group-cupping">精准</a></td>
              <td><input class="form-control price" value="1.80" /></td></tr>
            <tr data-dt-row="fixed"><td>cupping</td><td>精准</td>
              <td><input class="native select-item" type="checkbox" value="keyword-cupping" /></td>
              <td><a href="/ad_group/index?ad_group_id=group-cupping">精准</a></td></tr>
          </tbody></table>`,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }));
      await page.goto('https://ads.lingxing.com/ad_report/keyword/index/index?profile_id=1471859509603819&id=campaign-u07');

      await expect(discoverLingxingAdsKeywordTarget(page, {
        externalAccountId: '1471859509603819',
        campaignName: 'U07-1P-精准',
        adGroupName: '精准',
        entityName: 'cupping',
        currentBidCents: 251,
      })).rejects.toThrow('报表 $2.51，页面 $1.80');
    } finally {
      await browser.close();
    }
  });

  it('fails closed when the same business row is duplicated', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      const html = `
        <table><tbody>${[1, 2].map((index) => `
          <tr><td>U07-1P-精准</td><td>精准</td><td>cupping</td>
          <td><input class="select-item" value="keyword-${index}" /></td>
          <td><a href="/ad_group/index?ad_group_id=group-${index}">cupping</a></td>
          <td><input class="form-control price" value="$2.51" /></td></tr>`).join('')}
        </tbody></table>
      `;
      await page.route('https://ads.lingxing.com/**', (route) => route.fulfill({
        body: html,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }));
      await page.goto('https://ads.lingxing.com/ad_report/target/index/index?profile_id=1471859509603819&id=campaign-u07');

      await expect(discoverLingxingAdsKeywordTarget(page, {
        externalAccountId: '1471859509603819',
        campaignName: 'U07-1P-精准',
        adGroupName: '精准',
        entityName: 'cupping',
        currentBidCents: 251,
      })).rejects.toThrow('无法唯一定位');
    } finally {
      await browser.close();
    }
  });
});

describe('Lingxing Ads navigation continuity', () => {
  it('wires current-store recommendation target discovery through the execution authority bridge', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(mainSource).toContain("registerTrackedIpcHandler('execution-authority:discover-recommendation-target'");
    expect(mainSource).toContain("withLegacyOperatorBrowserLease(\n    'amazon_ads',\n    `discover-recommendation-target:");
    expect(mainSource).toContain('state.recommendationRepo.findByIdForStore(context.storeId, recommendationId)');
    expect(mainSource).toContain('navigateToLingxingAdsCampaignKeywordTarget(page, {');
    expect(mainSource).toContain('discoverLingxingAdsKeywordTarget(page, {');
    expect(mainSource).not.toContain('execution-authority:discover-recommendation-target-bypass');
  });

  it('binds an existing report row by report type instead of a newly generated name', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const waitForReady = mainSource.slice(
      mainSource.indexOf('async waitForReportReady(report, dateRange, createdReportIdentity)'),
      mainSource.indexOf('async downloadReport(report, downloadDir, dateRange, createdReportIdentity)'),
    );

    expect(mainSource).toContain(
      'generatedReportName: createdReportIdentity?.externalReportName ?? report.displayName',
    );
    expect(waitForReady).toContain(
      'const context = existingReport ? existingReportContext(report, dateRange, createdReportIdentity) : reportContext',
    );
  });

  it('routes the production report download through the authenticated canceled-download recovery', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const downloadReport = mainSource.slice(
      mainSource.indexOf('async downloadReport(report, downloadDir, dateRange, createdReportIdentity)'),
      mainSource.indexOf('async startAttemptTrace(report, dateRange, attemptIndex)'),
    );

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
});

describe('dismissLingxingAdsChangeAnnouncements', () => {
  it('clears every recognized announcement page using the live page count instead of assuming two', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      const html = `
        <div class="el-dialog announcement-one" role="dialog">
          <div class="el-dialog__header">【菜单名称】变更公告</div>
          <button type="button" class="announcement-action">下一条 (1/4)</button>
        </div>
        <div class="el-dialog announcement-two" role="dialog" style="display:none">
          <div class="el-dialog__header">【广告报表】变更公告</div>
          <button type="button" class="announcement-action">下一条 (1/2)</button>
        </div>
      `;
      await page.route('https://ads.lingxing.com/**', (route) => route.fulfill({
        body: html,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }));
      await page.goto('https://ads.lingxing.com/dashboard');
      await page.evaluate(() => {
        const wire = (selector: string, total: number, nextSelector?: string) => {
          const dialog = document.querySelector<HTMLElement>(selector)!;
          const button = dialog.querySelector<HTMLButtonElement>('.announcement-action')!;
          let current = 1;
          button.addEventListener('click', () => {
            dialog.dataset.clicks = String(Number(dialog.dataset.clicks ?? '0') + 1);
            if (current < total) {
              current += 1;
              button.textContent = current < total
                ? `下一条 (${current}/${total})`
                : '我知道了';
              return;
            }
            dialog.style.display = 'none';
            if (nextSelector) {
              const next = document.querySelector<HTMLElement>(nextSelector);
              if (next) next.style.display = 'block';
            }
          });
        };
        wire('.announcement-one', 4, '.announcement-two');
        wire('.announcement-two', 2);
      });

      await expect(dismissLingxingAdsChangeAnnouncements(page)).resolves.toBe(6);
      expect(await page.locator('.el-dialog:visible').count()).toBe(0);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('does not click an unrelated business confirmation dialog', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.route('https://ads.lingxing.com/**', (route) => route.fulfill({
        body: `
        <div class="el-dialog" role="dialog">
          <div class="el-dialog__header">归档策略</div>
          <button type="button" onclick="this.dataset.clicked='yes'">确定</button>
        </div>
        `,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }));
      await page.goto('https://ads.lingxing.com/dashboard');

      await expect(dismissLingxingAdsChangeAnnouncements(page)).resolves.toBe(0);
      expect(await page.locator('button').getAttribute('data-clicked')).toBeNull();
    } finally {
      await page.close();
      await browser.close();
    }
  });
});

describe('selectLingxingAdsProfileEvidence', () => {
  it('selects the exact US store alias from the authenticated Ads profile list', () => {
    const evidence = selectLingxingAdsProfileEvidence({
      data: [
        { alias: 'FT-CA', country: 'CA', profile_id: 'profile-ft-ca', type: 'seller' },
        { alias: 'JF-US', country: 'US', profile_id: 'PROFILE-JF-US', type: 'seller' },
        { alias: 'JF-MX', country: 'MX', profile_id: 'profile-jf-mx', type: 'seller' },
      ],
    }, 'JF-US');

    expect(evidence).toEqual({
      alias: 'JF-US',
      country: 'US',
      externalAccountId: 'profile-jf-us',
    });
  });

  it('rejects an exact alias that exists only outside the US marketplace', () => {
    expect(() => selectLingxingAdsProfileEvidence({
      data: [{ alias: 'JF-US', country: 'CA', profile_id: 'profile-wrong-country' }],
    }, 'JF-US')).toThrow('未找到美国站店铺');
  });
});

describe('assertLingxingAdsSelectedStoreTags', () => {
  it('rejects a multi-store Ads scope even when the expected US store is included', () => {
    expect(() => assertLingxingAdsSelectedStoreTags(['JF-US', '+1'], 'JF-US'))
      .toThrow('没有唯一锁定');
  });
});

describe('selectOnlyLingxingAdsStore', () => {
  it('uses the visible only-this-store action and reads back a single exact tag', async () => {
    let tags = ['FT-CA', '+1'];
    const onlyClick = vi.fn(async () => { tags = ['JF-US']; });
    const targetRow = {
      hover: vi.fn(async () => undefined),
      locator: vi.fn(() => ({
        getByText: vi.fn(() => ({
          isVisible: vi.fn(async () => true),
          click: onlyClick,
        })),
      })),
    };
    const rows = {
      evaluateAll: vi.fn(async () => ['FT-CA', 'JF-US']),
      nth: vi.fn(() => targetRow),
    };
    const dropdown = {
      waitFor: vi.fn(async () => undefined),
      locator: vi.fn(() => rows),
    };
    const dropdowns = {
      count: vi.fn(async () => 1),
      first: vi.fn(() => dropdown),
      nth: vi.fn(() => dropdown),
    };
    const storeSelect = {
      click: vi.fn(async () => undefined),
      locator: vi.fn(() => ({ allTextContents: vi.fn(async () => tags) })),
    };
    const selects = {
      count: vi.fn(async () => 1),
      nth: vi.fn(() => storeSelect),
    };
    const page = {
      keyboard: { press: vi.fn(async () => undefined) },
      locator: vi.fn((selector: string) => (
        selector === '.el-select-dropdown:visible' ? dropdowns : selects
      )),
      waitForTimeout: vi.fn(async () => undefined),
    };

    await selectOnlyLingxingAdsStore(page as never, 'JF-US');

    expect(storeSelect.click).toHaveBeenCalledTimes(2);
    expect(targetRow.hover).toHaveBeenCalledOnce();
    expect(onlyClick).toHaveBeenCalledOnce();
    expect(tags).toEqual(['JF-US']);
  });

  it('ignores a hidden legacy selector mirror when locking an arbitrary exact store alias', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(750);
    try {
      await page.setContent(`
        <style>
          .el-select-dropdown { display: none; }
          .el-select-dropdown.open { display: block; }
          .hidden-route-mirror { display: none; }
        </style>
        <div id="visible-store-select" class="el-select is-multiple">
          <div class="el-select__tags"></div>
          <span>搜索店铺</span>
        </div>
        <div id="visible-store-dropdown" class="el-select-dropdown">
          <ul>
            <li class="el-select-dropdown__item" title="NOVA-US">
              <span>NOVA-US</span>
              <button type="button" class="select-tag">仅筛选此项</button>
            </li>
          </ul>
        </div>
        <div class="hidden-route-mirror">
          <div class="el-select is-multiple"><div class="el-select__tags"></div></div>
          <div class="el-select-dropdown">
            <ul><li class="el-select-dropdown__item" title="NOVA-US">NOVA-US</li></ul>
          </div>
        </div>
      `);
      await page.evaluate(() => {
        const select = document.querySelector<HTMLElement>('#visible-store-select')!;
        const dropdown = document.querySelector<HTMLElement>('#visible-store-dropdown')!;
        select.addEventListener('click', () => dropdown.classList.add('open'));
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') dropdown.classList.remove('open');
        });
        dropdown.querySelector<HTMLButtonElement>('.select-tag')!.addEventListener('click', (event) => {
          event.stopPropagation();
          select.querySelector<HTMLElement>('.el-select__tags')!.innerHTML =
            '<span class="el-select__tags-text">NOVA-US</span>';
          dropdown.classList.remove('open');
        });
      });

      await selectOnlyLingxingAdsStore(page, 'NOVA-US');

      expect(await page.locator('#visible-store-select .el-select__tags-text').allTextContents())
        .toEqual(['NOVA-US']);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('binds a legacy store dropdown to the control that opened it when another filter leaves it visible', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <style>
          .el-select-dropdown { display: none; }
          .el-select-dropdown.open { display: block; }
        </style>
        <div id="store-select" class="el-select is-multiple">
          <div class="el-select__tags"></div>
          <span>全部店铺</span>
        </div>
        <div id="owner-select" class="el-select is-multiple">
          <div class="el-select__tags"></div>
          <span>Listing 负责人</span>
        </div>
        <div id="store-dropdown" class="el-select-dropdown">
          <ul>
            <li class="el-select-dropdown__item" title="ORBIT-US">
              <span>ORBIT-US</span>
              <button type="button" class="select-tag">仅筛选此项</button>
            </li>
          </ul>
        </div>
        <div id="owner-dropdown" class="el-select-dropdown">
          <ul><li class="el-select-dropdown__item" title="运营甲">运营甲</li></ul>
        </div>
      `);
      await page.evaluate(() => {
        const storeSelect = document.querySelector<HTMLElement>('#store-select')!;
        const ownerSelect = document.querySelector<HTMLElement>('#owner-select')!;
        const storeDropdown = document.querySelector<HTMLElement>('#store-dropdown')!;
        const ownerDropdown = document.querySelector<HTMLElement>('#owner-dropdown')!;
        storeSelect.addEventListener('click', () => storeDropdown.classList.add('open'));
        ownerSelect.addEventListener('click', () => {
          ownerSelect.setAttribute(
            'data-open-count',
            String(Number(ownerSelect.getAttribute('data-open-count') ?? '0') + 1),
          );
          ownerDropdown.classList.add('open');
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') ownerDropdown.classList.remove('open');
        });
        storeDropdown.querySelector<HTMLButtonElement>('.select-tag')!
          .addEventListener('click', (event) => {
            event.stopPropagation();
            storeSelect.querySelector<HTMLElement>('.el-select__tags')!.innerHTML =
              '<span class="el-select__tags-text">ORBIT-US</span>';
            storeDropdown.classList.remove('open');
          });
      });

      await selectOnlyLingxingAdsStore(page, 'ORBIT-US');

      expect(await page.locator('#store-select .el-select__tags-text').allTextContents())
        .toEqual(['ORBIT-US']);
      expect(await page.locator('#owner-select').getAttribute('data-open-count')).toBe('1');
      expect(await page.locator('#owner-select .el-select__tags-text').count()).toBe(0);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('selects an arbitrary exact store alias in the current Lingxing FilterSelect DOM', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <style>
          .fs-dropdown { display: none; }
          .fs-dropdown.visible { display: block; }
        </style>
        <div class="fs-wrap multiple" data-filter="report-type">
          <div class="fs-label-wrap"><div class="fs-label placeholder">报告类型</div></div>
          <div class="fs-dropdown"><div class="fs-options">
            <div class="fs-option" data-value="daily"><div class="fs-option-label"><span class="fs-option-label-detail">每日明细</span></div></div>
          </div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
        <div class="fs-wrap multiple" data-filter="store">
          <div class="fs-label-wrap"><div class="fs-label">FT-US 美国</div></div>
          <div class="fs-dropdown"><div class="fs-options">
            <div class="fs-option selected" data-value="store-ft-us"><span class="fs-checkbox"><i></i></span><div class="fs-option-label oneLine"><span class="fs-option-label-detail">FT-US 美国</span></div></div>
            <div class="fs-option" data-value="store-ft-us-us"><span class="fs-checkbox"><i></i></span><div class="fs-option-label oneLine"><span class="fs-option-label-detail">FT-US-US 美国</span></div></div>
            <div class="fs-option" data-value="store-jf-us"><span class="fs-checkbox"><i></i></span><div class="fs-option-label oneLine"><span class="fs-option-label-detail">JF-US 美国</span></div></div>
          </div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
      `);
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>('.fs-wrap.multiple').forEach((root) => {
          const dropdown = root.querySelector<HTMLElement>('.fs-dropdown');
          root.querySelector('.fs-label-wrap')?.addEventListener('click', () => dropdown?.classList.add('visible'));
          root.querySelectorAll('.fs-option').forEach((option) => {
            option.addEventListener('click', () => option.classList.toggle('selected'));
          });
          root.querySelector('.fs-save')?.addEventListener('click', () => {
            root.setAttribute('data-save-count', String(Number(root.getAttribute('data-save-count') ?? '0') + 1));
            const selected = [...root.querySelectorAll<HTMLElement>('.fs-option.selected')];
            const label = root.querySelector<HTMLElement>('.fs-label');
            if (label) label.textContent = selected.map((option) => option.textContent?.trim()).join('、');
            dropdown?.classList.remove('visible');
          });
        });
      });

      await selectOnlyLingxingAdsStore(page, 'FT-US-US');

      const result = await page.locator('[data-filter="store"]').evaluate((root) => ({
        label: root.querySelector('.fs-label')?.textContent?.trim(),
        saveCount: root.getAttribute('data-save-count'),
        selected: [...root.querySelectorAll<HTMLElement>('.fs-option.selected')]
          .map((option) => option.querySelector('.fs-option-label-detail')?.textContent?.trim()),
      }));
      expect(result).toEqual({
        label: 'FT-US-US 美国',
        saveCount: '1',
        selected: ['FT-US-US 美国'],
      });
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('waits for a delayed current FilterSelect before matching an arbitrary store alias', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent('<main data-loading="stores">店铺列表加载中</main>');
      await page.evaluate(() => {
        window.setTimeout(() => {
          document.body.innerHTML = `
            <style>.fs-dropdown { display: none; }.fs-dropdown.visible { display: block; }</style>
            <div class="fs-wrap multiple" data-filter="store">
              <div class="fs-label-wrap"><div class="fs-label placeholder">搜索店铺</div></div>
              <div class="fs-dropdown"><div class="fs-options">
                <div class="fs-option" data-value="store-bravo"><div class="fs-option-label"><span class="fs-option-label-detail">BRAVO-US 美国</span></div></div>
              </div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
            </div>`;
          const root = document.querySelector<HTMLElement>('.fs-wrap.multiple')!;
          const dropdown = root.querySelector<HTMLElement>('.fs-dropdown')!;
          root.querySelector('.fs-label-wrap')?.addEventListener('click', () => dropdown.classList.add('visible'));
          root.querySelector('.fs-option')?.addEventListener('click', (event) => {
            (event.currentTarget as HTMLElement).classList.toggle('selected');
          });
          root.querySelector('.fs-save')?.addEventListener('click', () => {
            const label = root.querySelector<HTMLElement>('.fs-label')!;
            label.textContent = root.querySelector<HTMLElement>('.fs-option.selected .fs-option-label-detail')?.textContent ?? '';
            dropdown.classList.remove('visible');
          });
        }, 250);
      });

      await selectOnlyLingxingAdsStore(page, 'BRAVO-US');

      expect((await page.locator('.fs-label').textContent())?.trim()).toBe('BRAVO-US 美国');
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('opens a current FilterSelect whose arbitrary store options mount only after interaction', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <style>.fs-dropdown { display: none; }.fs-dropdown.visible { display: block; }</style>
        <div class="fs-wrap multiple" data-filter="report-type">
          <div class="fs-label-wrap"><div class="fs-label placeholder">报告类型</div></div>
          <div class="fs-dropdown"><div class="fs-options"></div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
        <div class="fs-wrap multiple" data-filter="store">
          <div class="fs-label-wrap"><div class="fs-label placeholder">搜索店铺</div></div>
          <div class="fs-dropdown"><div class="fs-options"></div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
      `);
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>('.fs-wrap.multiple').forEach((root) => {
          const dropdown = root.querySelector<HTMLElement>('.fs-dropdown')!;
          const options = root.querySelector<HTMLElement>('.fs-options')!;
          root.querySelector('.fs-label-wrap')?.addEventListener('click', () => {
            if (!options.childElementCount) {
              const isStore = root.getAttribute('data-filter') === 'store';
              options.innerHTML = isStore
                ? '<div class="fs-option" data-value="store-orbit"><div class="fs-option-label"><span class="fs-option-label-detail">ORBIT-US 美国</span></div></div>'
                : '<div class="fs-option" data-value="daily"><div class="fs-option-label"><span class="fs-option-label-detail">每日明细</span></div></div>';
              options.querySelector('.fs-option')?.addEventListener('click', (event) => {
                (event.currentTarget as HTMLElement).classList.toggle('selected');
              });
            }
            dropdown.classList.add('visible');
          });
          root.querySelector('.fs-save')?.addEventListener('click', () => {
            const selected = root.querySelector<HTMLElement>('.fs-option.selected .fs-option-label-detail');
            const label = root.querySelector<HTMLElement>('.fs-label');
            if (label) label.textContent = selected?.textContent ?? '';
            dropdown.classList.remove('visible');
          });
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            document.querySelectorAll<HTMLElement>('.fs-dropdown.visible')
              .forEach((dropdown) => dropdown.classList.remove('visible'));
          }
        });
      });

      await selectOnlyLingxingAdsStore(page, 'ORBIT-US');

      expect((await page.locator('[data-filter="store"] .fs-label').textContent())?.trim())
        .toBe('ORBIT-US 美国');
      expect(await page.locator('[data-filter="store"] .fs-option.selected').count()).toBe(1);
      expect(await page.locator('[data-filter="report-type"] .fs-option.selected').count()).toBe(0);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('clears a persistent non-modal success toast before opening the current store FilterSelect', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <style>
          .fs-dropdown { display: none; }
          .fs-dropdown.visible { display: block; }
          #toast-container { position: fixed; inset: 0; z-index: 99; }
          .toast-success { display: block; pointer-events: auto; }
        </style>
        <div class="fs-wrap multiple" data-filter="store">
          <div class="fs-label-wrap"><div class="fs-label placeholder">搜索店铺</div></div>
          <div class="fs-dropdown"><div class="fs-options">
            <div class="fs-option" data-value="store-orbit"><div class="fs-option-label"><span class="fs-option-label-detail">ORBIT-US 美国</span></div></div>
          </div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
        <div id="toast-container"><div aria-live="polite" class="export-info toast-success">导出成功</div></div>
      `);
      await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('.fs-wrap.multiple')!;
        const dropdown = root.querySelector<HTMLElement>('.fs-dropdown')!;
        root.querySelector('.fs-label-wrap')?.addEventListener('click', () => dropdown.classList.add('visible'));
        root.querySelector('.fs-option')?.addEventListener('click', (event) => {
          (event.currentTarget as HTMLElement).classList.toggle('selected');
        });
        root.querySelector('.fs-save')?.addEventListener('click', () => {
          const selected = root.querySelector<HTMLElement>('.fs-option.selected .fs-option-label-detail');
          root.querySelector<HTMLElement>('.fs-label')!.textContent = selected?.textContent ?? '';
          dropdown.classList.remove('visible');
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            document.querySelector<HTMLElement>('.toast-success')!.style.display = 'none';
            document.querySelector<HTMLElement>('#toast-container')!.style.pointerEvents = 'none';
          }
        });
      });

      await selectOnlyLingxingAdsStore(page, 'ORBIT-US');

      expect((await page.locator('.fs-label').textContent())?.trim()).toBe('ORBIT-US 美国');
      expect(await page.locator('.toast-success:visible').count()).toBe(0);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('blocks duplicate exact aliases in the current Lingxing FilterSelect DOM', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div class="fs-wrap multiple">
          <div class="fs-label-wrap"><div class="fs-label placeholder">搜索店铺</div></div>
          <div class="fs-dropdown"><div class="fs-options">
            <div class="fs-option" data-value="one"><div class="fs-option-label"><span class="fs-option-label-detail">NORTH-US 美国</span></div></div>
            <div class="fs-option" data-value="two"><div class="fs-option-label"><span class="fs-option-label-detail">NORTH-US 美国</span></div></div>
          </div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
      `);

      await expect(selectOnlyLingxingAdsStore(page, 'NORTH-US'))
        .rejects.toThrow('存在重复的 NORTH-US');
      expect(await page.locator('.fs-option.selected').count()).toBe(0);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('collapses production label whitespace before exact FilterSelect matching', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <style>.fs-dropdown { display: none; }.fs-dropdown.visible { display: block; }</style>
        <div class="fs-wrap multiple">
          <div class="fs-label-wrap"><div class="fs-label placeholder">搜索店铺</div></div>
          <div class="fs-dropdown"><div class="fs-options">
            <div class="fs-option" data-value="alpha"><div class="fs-option-label"><span class="fs-option-label-detail">ALPHA-US  美国</span></div></div>
          </div><div class="fs-footer"><a class="fs-save">确定</a></div></div>
        </div>
      `);
      await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('.fs-wrap.multiple');
        const dropdown = root?.querySelector<HTMLElement>('.fs-dropdown');
        root?.querySelector('.fs-label-wrap')?.addEventListener('click', () => dropdown?.classList.add('visible'));
        root?.querySelector('.fs-option')?.addEventListener('click', (event) => {
          (event.currentTarget as HTMLElement).classList.toggle('selected');
        });
        root?.querySelector('.fs-save')?.addEventListener('click', () => {
          const label = root.querySelector<HTMLElement>('.fs-label');
          const optionLabel = root.querySelector<HTMLElement>('.fs-option.selected .fs-option-label-detail');
          if (label) label.textContent = optionLabel?.textContent ?? '';
          dropdown?.classList.remove('visible');
        });
      });

      await selectOnlyLingxingAdsStore(page, 'ALPHA-US');

      expect(await page.locator('.fs-option.selected').count()).toBe(1);
      expect((await page.locator('.fs-label').textContent())?.replace(/\s+/g, ' ').trim())
        .toBe('ALPHA-US 美国');
    } finally {
      await page.close();
      await browser.close();
    }
  });
});

describe('resolveLingxingStableIdentityFromAdsProfile', () => {
  it('enrolls the stable profile id only after matching typed ERP credentials', () => {
    expect(resolveLingxingStableIdentityFromAdsProfile({
      accountLabel: 'operator@example.com',
      collectionStoreName: 'JF-US',
      evidence: {
        alias: 'JF-US',
        country: 'US',
        externalAccountId: 'profile-jf-us',
      },
      credentialSubmission: {
        credentialSource: 'typed',
        credentialsSubmitted: true,
        username: 'operator@example.com',
      },
    })).toBe('profile-jf-us');
  });

  it('rejects a configured connection when the live profile id changes', () => {
    expect(() => resolveLingxingStableIdentityFromAdsProfile({
      accountLabel: 'operator@example.com',
      collectionStoreName: 'JF-US',
      configuredExternalAccountId: 'profile-old',
      evidence: {
        alias: 'JF-US',
        country: 'US',
        externalAccountId: 'profile-new',
      },
    })).toThrow('稳定店铺身份与当前连接不一致');
  });

  it('enrolls a dynamic US store from only the same verified Main-managed continuation', () => {
    expect(resolveLingxingStableIdentityFromVerifiedContinuation({
      accountLabel: 'operator@example.com',
      collectionStoreName: 'ORBIT-US',
      evidence: {
        alias: 'ORBIT-US',
        country: 'US',
        externalAccountId: 'profile-orbit-us',
      },
      continuation: {
        credentialSource: 'saved',
        credentialPersistence: 'main_managed',
        sessionIdentityVerified: true,
        username: 'operator@example.com',
      },
    })).toBe('profile-orbit-us');
  });

  it('rejects an unverified, non-Main-managed, or different-account continuation', () => {
    const base = {
      accountLabel: 'operator@example.com',
      collectionStoreName: 'ORBIT-US',
      evidence: {
        alias: 'ORBIT-US',
        country: 'US' as const,
        externalAccountId: 'profile-orbit-us',
      },
    };
    expect(() => resolveLingxingStableIdentityFromVerifiedContinuation({
      ...base,
      continuation: {
        credentialSource: 'saved',
        credentialPersistence: 'main_managed',
        sessionIdentityVerified: false,
        username: 'operator@example.com',
      },
    })).toThrow('同一已验证会话');
    expect(() => resolveLingxingStableIdentityFromVerifiedContinuation({
      ...base,
      continuation: {
        credentialSource: 'saved',
        credentialPersistence: 'cleared',
        sessionIdentityVerified: true,
        username: 'operator@example.com',
      },
    })).toThrow('同一已验证会话');
    expect(() => resolveLingxingStableIdentityFromVerifiedContinuation({
      ...base,
      continuation: {
        credentialSource: 'saved',
        credentialPersistence: 'saved',
        sessionIdentityVerified: true,
        username: 'another@example.com',
      },
    })).toThrow('同一已验证会话');
  });
});

describe('openLingxingAdsFromErp', () => {
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

describe('ensureLingxingErpAuthenticated', () => {
  it('submits the same operator credentials inside the isolated Ads browser profile', async () => {
    const fillAccount = vi.fn(async () => undefined);
    const fillPassword = vi.fn(async () => undefined);
    const clickLogin = vi.fn(async () => undefined);
    const accountInput = {
      isVisible: vi.fn(async () => true),
      fill: fillAccount,
    };
    const passwordInput = {
      isVisible: vi.fn(async () => true),
      fill: fillPassword,
    };
    const page = {
      url: () => 'https://erp.lingxing.com/erp/home',
      locator: vi.fn((selector: string) => ({
        first: () => selector.includes('account') || selector.includes('用户名')
          ? accountInput
          : selector.includes('button')
            ? { click: clickLogin }
            : passwordInput,
      })),
      waitForURL: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => ({ bodyText: '首页 产品 销售 广告', hasAccountInput: false })),
    };

    const result = await ensureLingxingErpAuthenticated(page as never, {
      username: 'operator@example.com',
      password: 'secret',
    });

    expect(fillAccount).toHaveBeenCalledWith('operator@example.com');
    expect(fillPassword).toHaveBeenCalledWith('secret');
    expect(clickLogin).toHaveBeenCalledOnce();
    expect(result).toEqual({ sessionReused: false });
  });
});

describe('readLingxingAdsProfileEvidence', () => {
  it('uses the profile-list response emitted by the ERP Ads entry without reloading the one-time SSO page', async () => {
    let responseHandler: ((response: unknown) => void) | undefined;
    const reload = vi.fn(async () => undefined);
    const waitForResponse = vi.fn(async () => {
      throw new Error('the already observed ERP-entry response must be used');
    });
    const adsPage = {
      url: () => 'https://ads.lingxing.com/home',
      title: vi.fn(async () => '仪表盘'),
      evaluate: vi.fn(async () => '领星广告系统 返回ERP 广告活动 ACoS'),
      isClosed: vi.fn(() => false),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      waitForURL: vi.fn(async () => undefined),
      waitForResponse,
      bringToFront: vi.fn(async () => undefined),
      reload,
    };
    const response = {
      url: () => 'https://ads.lingxing.com/common/common_list/common_list/get_profile_list',
      request: () => ({ method: () => 'POST' }),
      frame: () => ({ page: () => adsPage }),
      ok: () => true,
      json: vi.fn(async () => ({
        data: [{ alias: 'ORBIT-US', country: 'US', profile_id: 'profile-orbit-us' }],
      })),
    };
    const erpPage = {
      url: () => 'https://erp.lingxing.com/erp/home',
      waitForTimeout: vi.fn(async () => undefined),
      getByRole: vi.fn(() => ({
        first: () => ({
          isVisible: vi.fn(async () => true),
          click: vi.fn(async () => { responseHandler?.(response); }),
        }),
      })),
    };
    const context = {
      pages: vi.fn(() => [erpPage]),
      waitForEvent: vi.fn(async () => adsPage),
      on: vi.fn((event: string, handler: (candidate: unknown) => void) => {
        if (event === 'response') responseHandler = handler;
      }),
    };
    const controller = {
      getPage: () => erpPage,
      getContext: () => context,
      setActivePage: vi.fn(),
    };

    const openedPage = await openLingxingAdsFromErp(controller as never);
    const evidence = await readLingxingAdsProfileEvidence(openedPage, 'ORBIT-US');

    expect(context.on).toHaveBeenCalledWith('response', expect.any(Function));
    expect(evidence).toEqual({
      alias: 'ORBIT-US',
      country: 'US',
      externalAccountId: 'profile-orbit-us',
    });
    expect(waitForResponse).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the authenticated Ads page and reads only the exact profile-list response', async () => {
    const response = {
      url: () => 'https://ads.lingxing.com/common/common_list/common_list/get_profile_list',
      request: () => ({ method: () => 'POST' }),
      ok: () => true,
      json: vi.fn(async () => ({
        data: [{ alias: 'JF-US', country: 'US', profile_id: 'profile-jf-us' }],
      })),
    };
    const waitForResponse = vi.fn(async (predicate: (candidate: typeof response) => boolean) => {
      expect(predicate(response)).toBe(true);
      return response;
    });
    const reload = vi.fn(async () => undefined);
    const page = {
      url: () => 'https://ads.lingxing.com/home',
      waitForResponse,
      reload,
    };

    const evidence = await readLingxingAdsProfileEvidence(page as never, 'JF-US');

    expect(waitForResponse).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledWith({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    expect(evidence.externalAccountId).toBe('profile-jf-us');
  });
});
