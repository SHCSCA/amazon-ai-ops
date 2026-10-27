import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { PlaywrightLingxingKeywordBidPage } from './lingxing-keyword-bid-page';
import { command, TARGET_PATH } from './lingxing-keyword-bid-test-command';

let browser: Browser;
let page: Page;

function document(options: { marker?: string; bid?: string; header?: string; extraRow?: string; campaign?: string; group?: string; status?: string } = {}): string {
  return `<p>US USD</p><a class="Js-select-link" href="/ad_report/ad_group/index/index?profile_id=profile-100&id=campaign-200"><i class="fa fa-circle ${options.campaign ?? 'text-green'}"></i></a>
    <table><thead><tr><th>关键词</th><th>选择</th><th>广告组</th><th>建议竞价</th><th>${options.header ?? '竞价'}</th><th>操作</th></tr></thead><tbody>
    <tr><td>blue widget exact keyword</td><td>${options.marker ?? `<input class="check-item" type="checkbox" data-status="${options.status ?? 'enabled'}" value="keyword-400">`}</td>
    <td><a href="/ad_group/index?ad_group_id=ad-group-300">Group<i class="fa fa-circle ${options.group ?? 'text-green'}"></i></a></td><td><input value="9.99"></td>
    <td>${options.bid ?? '<input class="form-control input-sm" value="1.00">'}</td><td><button class="Js-bid-save" onclick="window.saveClicks++">保存</button></td></tr>${options.extraRow ?? ''}</tbody></table><script>window.saveClicks=0</script>`;
}

async function load(html: string): Promise<PlaywrightLingxingKeywordBidPage> {
  await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto(`https://ads.lingxing.com${TARGET_PATH}?profile_id=profile-100&id=campaign-200`);
  return new PlaywrightLingxingKeywordBidPage(page, 10);
}

beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
beforeEach(async () => { page = await browser.newPage({ serviceWorkers: 'block' }); });
afterEach(async () => { await page.close(); });
afterAll(async () => { await browser.close(); });

describe('Lingxing keyword bid real DOM formats', () => {
  it('uses one native checkbox and the exact bid header for readback, bounded fill and one save', async () => {
    const port = await load(document());
    await expect(port.assertServing('keyword-400')).resolves.toBeUndefined();
    await expect(port.readSnapshot(command())).resolves.toMatchObject({ keyword: { keywordId: 'keyword-400', bidCents: 100 } });
    await port.fillBid(command(), 90);
    expect(await page.locator('td:nth-child(4) input').inputValue()).toBe('9.99');
    expect(await page.locator('td:nth-child(5) input').inputValue()).toBe('0.90');
    const save = await port.prepareSave(command());
    await save.clickOnce();
    await expect(save.clickOnce()).rejects.toMatchObject({ code: 'DUPLICATE_SUBMIT' });
    expect(await page.evaluate(() => (window as unknown as { saveClicks: number }).saveClicks)).toBe(1);
  });

  it('deduplicates one checkbox matching both selectors while excluding the fixed-column mirror', async () => {
    const marker = '<input class="select-item" type="checkbox" data-status="enabled" value="keyword-400">';
    const port = await load(document({ marker, extraRow: `<tr data-dt-row="fixed"><td>${marker}</td></tr>` }));
    await expect(port.assertServing('keyword-400')).resolves.toBeUndefined();
    await expect(port.resolveCurrentKeywordIdentity({ adEntityId: 'keyword-400' })).resolves.toMatchObject({ status: 'RESOLVED', identity: { bidCents: 100 } });
  });

  it('rejects distinct legacy and native controls carrying the same keyword identity', async () => {
    const port = await load(document({ marker: '<input class="select-item" data-status="enabled" value="keyword-400"><input type="checkbox" data-status="enabled" value="keyword-400">' }));
    await expect(port.resolveCurrentKeywordIdentity({ adEntityId: 'keyword-400' })).resolves.toMatchObject({ status: 'BLOCKED', error: { code: 'KEYWORD_ROW_NOT_UNIQUE' } });
    expect(await page.locator('td:nth-child(5) input').inputValue()).toBe('1.00');
  });

  it('rejects competing legacy and named-column bids instead of selecting one', async () => {
    const port = await load(document({ bid: '<input class="form-control price" value="1.00"><input value="1.00">' }));
    await expect(port.fillBid(command(), 90)).rejects.toMatchObject({ code: 'BID_INPUT_NOT_UNIQUE' });
    expect(await page.locator('.form-control.price').inputValue()).toBe('1.00');
  });

  it('rejects duplicated exact bid columns', async () => {
    const port = await load(document({ header: '竞价</th><th>竞价' }));
    await expect(port.resolveCurrentKeywordIdentity({ adEntityId: 'keyword-400' })).resolves.toMatchObject({ status: 'BLOCKED', error: { code: 'BID_INPUT_NOT_UNIQUE' } });
  });

  it('does not treat the suggested bid as the current bid', async () => {
    const port = await load(document({ header: '建议竞价' }));
    await expect(port.resolveCurrentKeywordIdentity({ adEntityId: 'keyword-400' })).resolves.toMatchObject({ status: 'BLOCKED', error: { code: 'BID_INPUT_NOT_UNIQUE' } });
  });

  it.each([
    ['campaign', { campaign: 'text-gray' }],
    ['ad group', { group: 'text-gray' }],
    ['keyword', { status: 'paused' }],
  ])('blocks a non-serving %s before filling or saving', async (_label, options) => {
    const port = await load(document(options));
    await expect(port.fillBid(command(), 90)).rejects.toMatchObject({ code: 'AD_ENTITY_NOT_SERVING' });
    expect(await page.locator('td:nth-child(5) input').inputValue()).toBe('1.00');
    expect(await page.evaluate(() => (window as unknown as { saveClicks: number }).saveClicks)).toBe(0);
  });

  it('rejects a parent campaign identity that differs from the selected page', async () => {
    const port = await load(document().replace('id=campaign-200', 'id=campaign-other'));
    await expect(port.assertServing('keyword-400')).rejects.toMatchObject({ code: 'CAMPAIGN_STATE_UNAVAILABLE' });
  });
});
