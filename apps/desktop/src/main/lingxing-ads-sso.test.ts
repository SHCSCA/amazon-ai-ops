import { mainRuntimeModuleContracts, mainRuntimeModuleContract, mainRuntimeFunctionContract, mainRuntimeVariableContract, mainRuntimeSectionContract } from './main-runtime-source.test-support';
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { performance } from 'node:perf_hooks';
import { RuntimeLogger } from './runtime-logger';
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

const browserFixtureLogger = new RuntimeLogger();

// 夹具日志只用标准流；局部总预算不代表产品性能验收阈值。
async function traceBrowserFixturePhase<T>(fixture: string, phase: string, work: () => Promise<T>): Promise<T> {
  const startedAtMs = performance.now();
  const binding = { fixture, phase, clock: 'performance.now-ms', startedAtMs };
  browserFixtureLogger.info('test.lingxing_ads_fixture_phase_started', binding);
  try {
    const value = await work();
    const endedAtMs = performance.now();
    browserFixtureLogger.info('test.lingxing_ads_fixture_phase_completed', { ...binding, endedAtMs, elapsedMs: endedAtMs - startedAtMs });
    return value;
  } catch (error) {
    const endedAtMs = performance.now();
    try {
      browserFixtureLogger.error('test.lingxing_ads_fixture_phase_failed', { ...binding, endedAtMs, elapsedMs: endedAtMs - startedAtMs, error });
    } finally {
      throw error;
    }
  }
}

describe('discoverLingxingAdsKeywordTarget', () => {
  it('uses campaign, ad group and match type authority instead of choosing the first same-name same-bid row', () => {
    const headers = ['广告活动', '匹配类型', '关键词', '广告组', '竞价'];
    const rows = [
      {
        headers,
        cellTexts: ['Campaign A', '精准', 'door lock', 'Group A', '$1.49'],
        keywordIds: ['keyword-a'],
        adGroupIds: ['group-a'],
        adGroupNames: ['Group A'],
        bidValues: ['$1.49'],
      },
      {
        headers,
        cellTexts: ['Campaign B', '词组', 'door lock', 'Group B', '$1.49'],
        keywordIds: ['keyword-b-phrase'],
        adGroupIds: ['group-b'],
        adGroupNames: ['Group B'],
        bidValues: ['$1.49'],
      },
      {
        headers,
        cellTexts: ['Campaign B', '精准', 'door lock', 'Group B', '$1.49'],
        keywordIds: ['keyword-b-exact'],
        adGroupIds: ['group-b'],
        adGroupNames: ['Group B'],
        bidValues: ['$1.49'],
      },
    ];

    expect(resolveLingxingKeywordTargetRows(rows, {
      campaignName: 'Campaign B',
      adGroupName: 'Group B',
      entityName: 'door lock',
      matchType: 'exact',
      currentBidCents: 149,
    })).toEqual({ adGroupId: 'group-b', keywordId: 'keyword-b-exact', bidCents: 149 });
    expect(() => resolveLingxingKeywordTargetRows(rows.map((row) => ({
      ...row,
      headers: row.headers.filter((header) => header !== '匹配类型'),
    })), {
      campaignName: 'Campaign B',
      adGroupName: 'Group B',
      entityName: 'door lock',
      matchType: 'exact',
      currentBidCents: 149,
    })).toThrow('缺少唯一匹配方式');
  });

  it('switches the Ads header to one exact US store and verifies the selected label', async () => {
    const fixture = 'header-exact-us';
    const browser = await traceBrowserFixturePhase(fixture, 'browser-launch', () => chromium.launch({ headless: true }));
    try {
      const page = await traceBrowserFixturePhase(fixture, 'page-create', () => browser.newPage());
      await traceBrowserFixturePhase(fixture, 'fixture-setup', async () => {
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

      });

      await traceBrowserFixturePhase(fixture, 'production-call', () => ensureLingxingAdsHeaderStore(page, 'JF-US'));

      await traceBrowserFixturePhase(fixture, 'assertion', async () => {
      expect(await page.locator('#store-control').innerText()).toBe('JF-US 美国');
      });
    } finally {
      await traceBrowserFixturePhase(fixture, 'browser-close', () => browser.close());
    }
  }, 30_000);

  it('switches an arbitrary Chinese and spaced Ads header store by one exact display name', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <button id="store-control" style="position:fixed;left:20px;top:10px">旧 店-一 美国</button>
        <div id="menu" style="position:fixed;left:20px;top:50px" hidden>
          <button id="target-store">华东 一号店-US 美国</button>
        </div>
        <script>
          document.querySelector('#store-control').onclick = () => { document.querySelector('#menu').hidden = false; };
          document.querySelector('#target-store').onclick = () => {
            document.querySelector('#store-control').textContent = '华东 一号店-US 美国';
            document.querySelector('#menu').hidden = true;
          };
        </script>
      `);

      await ensureLingxingAdsHeaderStore(page, '华东 一号店-US');

      expect(await page.locator('#store-control').innerText()).toBe('华东 一号店-US 美国');
    } finally {
      await browser.close();
    }
  });

  it('rejects an already-selected arbitrary store when the Ads header control is not unique', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <button id="store-control-one" style="position:fixed;left:20px;top:10px">华东 一号店-US 美国</button>
        <button id="store-control-two" style="position:fixed;left:240px;top:10px">华南 二号店-US 美国</button>
      `);

      await expect(ensureLingxingAdsHeaderStore(page, '华东 一号店-US'))
        .rejects.toThrow('无法唯一定位当前账户下拉');
    } finally {
      await browser.close();
    }
  });

  it('uses the authenticated current-profile keyword route when the sidebar has no anchor', async () => {
    const fixture = 'current-profile-no-anchor';
    const browser = await traceBrowserFixturePhase(fixture, 'browser-launch', () => chromium.launch({ headless: true }));
    try {
      const page = await traceBrowserFixturePhase(fixture, 'page-create', () => browser.newPage());
      await traceBrowserFixturePhase(fixture, 'fixture-setup', async () => {
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

      });

      await traceBrowserFixturePhase(fixture, 'production-call', () => navigateToLingxingAdsCampaignKeywordTarget(page, {
        externalAccountId: '1471859509603819',
        campaignName: 'U07-1P-精准',
      }));

      await traceBrowserFixturePhase(fixture, 'assertion', async () => {
      const url = new URL(page.url());
      expect(url.searchParams.get('profile_id')).toBe('1471859509603819');
      expect(url.searchParams.get('id')).toBe('campaign-u07');
      });
    } finally {
      await traceBrowserFixturePhase(fixture, 'browser-close', () => browser.close());
    }
  }, 30_000);

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
  }, 30_000);

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
        <a class="Js-select-link" href="/ad_report/ad_group/index/index?profile_id=1471859509603819&id=campaign-u07"><i class="fa fa-circle text-green"></i></a><table><thead><tr><th>广告活动</th><th>匹配类型</th><th>关键词</th><th>选择</th><th>广告组</th><th>竞价</th><th>动作</th></tr></thead><tbody>
          <tr>
            <td>U07-1P-精准</td><td>精准</td><td>cupping set</td>
            <td><input data-status="enabled" class="select-item" value="keyword-set" /></td>
            <td><a href="/ad_group/index?ad_group_id=group-set">精准<i class="fa fa-circle text-green"></i></a></td>
            <td><input class="form-control price" value="$2.55" /></td>
            <td><button class="Js-bid-save">save</button></td>
          </tr>
          <tr>
            <td>U07-1P-精准</td><td>精准</td><td>cupping</td>
            <td><input data-status="enabled" class="select-item" value="keyword-cupping" /></td>
            <td><a href="/ad_group/index?ad_group_id=group-cupping">精准<i class="fa fa-circle text-green"></i></a></td>
            <td><input class="form-control price" value="$2.51" /></td>
            <td><button class="Js-bid-save" onclick="window.saveClicks += 1">save</button></td>
          </tr>
          <tr>
            <td>OTHER-CAMPAIGN</td><td>精准</td><td>cupping</td>
            <td><input data-status="enabled" class="select-item" value="keyword-other" /></td>
            <td><a href="/ad_group/index?ad_group_id=group-other">精准<i class="fa fa-circle text-green"></i></a></td>
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
        matchType: 'exact',
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
        <a class="Js-select-link" href="/ad_report/ad_group/index/index?profile_id=1471859509603819&id=campaign-u07"><i class="fa fa-circle text-green"></i></a><table>
          <thead><tr><th>关键词</th><th>匹配类型</th><th>广告组</th><th>建议竞价</th><th>竞价</th></tr></thead>
          <tbody><tr>
            <td>cupping<input data-status="enabled" class="select-item" value="keyword-cupping" /></td>
            <td>精准</td>
            <td><a href="/ad_group/index?ad_group_id=group-cupping">精准<i class="fa fa-circle text-green"></i></a></td>
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
        matchType: 'exact',
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
          <a class="Js-select-link" href="/ad_report/ad_group/index/index?profile_id=1471859509603819&id=campaign-u07"><i class="fa fa-circle text-green"></i></a><table>
            <thead><tr><th></th><th>关键词</th><th>匹配类型</th><th>广告组</th><th>竞价</th></tr></thead>
            <tbody><tr>
              <td><input data-status="enabled" class="check-item" type="checkbox" value="keyword-cupping" /></td>
              <td>cupping</td>
              <td>精准</td>
              <td><a href="/ad_group/index?ad_group_id=group-cupping">精准<i class="fa fa-circle text-green"></i></a></td>
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
        matchType: 'exact',
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
          <table><thead><tr><th>关键词</th><th>匹配类型</th><th>选择</th><th>广告组</th><th>竞价</th></tr></thead><tbody>
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
        matchType: 'exact',
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
        <table><thead><tr><th>广告活动</th><th>匹配类型</th><th>关键词</th><th>选择</th><th>广告组</th><th>竞价</th></tr></thead><tbody>${[1, 2].map((index) => `
          <tr><td>U07-1P-精准</td><td>精准</td><td>cupping</td>
          <td><input class="select-item" value="keyword-${index}" /></td>
          <td><a href="/ad_group/index?ad_group_id=group-${index}">精准</a></td>
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
        matchType: 'exact',
        currentBidCents: 251,
      })).rejects.toThrow('无法唯一定位');
    } finally {
      await browser.close();
    }
  });
});
