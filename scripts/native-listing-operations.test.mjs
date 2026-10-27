import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { buildNativeListingOperationsFixture } from './native-listing-operations-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('./playwright-loader.js');
let browser, bundle, pages = [];
beforeAll(async () => {
  bundle = await buildNativeListingOperationsFixture();
  browser = await chromium.launch({ headless: true });
}, 30000);
afterEach(async () => { await Promise.all(pages.splice(0).map(page => page.close())); });
afterAll(async () => { await browser?.close(); });

async function pageForListing() {
  const page = await browser.newPage(); pages.push(page); page.setDefaultTimeout(5000);
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.bind('A'));
  await page.getByText('listing-A', { exact: true }).waitFor();
  return page;
}

describe('native Objects Listing actual operation boundaries', () => {
  it('admits one save, locks inputs, and reuses its ticket for reload without making Refresh busy', async () => {
    const page = await pageForListing();
    await page.getByRole('button', { name: '编辑 B012345678', exact: true }).click();
    await page.evaluate(() => window.invokeTwice('[role="dialog"] footer button:last-child'));
    expect(await page.evaluate(() => window.calls.update.length)).toBe(1);
    expect(await page.getByRole('textbox', { name: '标题', exact: true }).isDisabled()).toBe(true);
    const refresh = page.getByRole('button', { name: '刷新', exact: true });
    expect(await refresh.isDisabled()).toBe(true);
    expect(await refresh.getAttribute('aria-busy')).toBeNull();
    expect(await page.evaluate(() => window.calls.update[0].input)).toMatchObject({ id: 1, expectedRevision: 'revision-A-1' });
    await page.evaluate(() => { window.deferList = true; window.resolveFixture('update', 0, window.rowFor('A')); });
    await page.waitForFunction(() => window.waiting.list.length === 1);
    expect(await page.getByRole('button', { name: '保存中…', exact: true }).getAttribute('aria-busy')).toBe('true');
    expect(await refresh.getAttribute('aria-busy')).toBeNull();
    await page.evaluate(() => window.resolveFixture('list', 0, [window.rowFor('A')]));
    await page.getByText('B012345678 已保存到当前店铺，本地内容不会自动发布到 Amazon。', { exact: true }).waitFor();
  });

  it('admits one confirmed delete and preserves its exact CAS revision', async () => {
    const page = await pageForListing();
    await page.getByRole('button', { name: '删除 B012345678', exact: true }).click();
    await page.evaluate(() => window.invokeTwice('[role="alertdialog"] footer button:last-child'));
    expect(await page.evaluate(() => window.calls.remove.length)).toBe(1);
    expect(await page.evaluate(() => window.calls.remove[0].input)).toEqual({ id: 1, expectedRevision: 'revision-A-1' });
    expect(await page.getByRole('button', { name: '取消', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: '删除中…', exact: true }).getAttribute('aria-busy')).toBe('true');
    await page.evaluate(() => { window.deleted = true; window.resolveFixture('remove', 0, { id: 1, deleted: true }); });
    await page.getByText('B012345678 已从当前店铺内容库删除；历史版本仍保留。', { exact: true }).waitFor();
  });

  it('admits one local create with canonical ASIN and the captured store authority', async () => {
    const page = await pageForListing();
    await page.getByRole('button', { name: '新建 Listing', exact: true }).click();
    await page.getByRole('textbox', { name: 'ASIN *', exact: true }).fill('b012345679');
    await page.getByRole('textbox', { name: '标题', exact: true }).fill(' New local title ');
    await page.evaluate(() => window.invokeTwice('[role="dialog"] footer button:last-child'));
    expect(await page.evaluate(() => window.calls.create.length)).toBe(1);
    expect(await page.evaluate(() => window.calls.create[0])).toMatchObject({
      context: { storeId: 'A', browserProfileId: 'profile-A', sessionGeneration: 1 },
      input: { asin: 'B012345679', title: 'New local title', marketplace: 'US', currency: 'USD', source: 'manual' },
    });
    expect(await page.getByRole('textbox', { name: 'ASIN *', exact: true }).isDisabled()).toBe(true);
    await page.evaluate(() => window.resolveFixture('create', 0, { ...window.rowFor('A'), asin: 'B012345679' }));
    await page.getByText('B012345679 已保存到当前店铺，本地内容不会自动发布到 Amazon。', { exact: true }).waitFor();
  });

  it('cancels only a closed history read so its late result cannot unlock the new refresh', async () => {
    const page = await pageForListing();
    await page.evaluate(() => window.invokeTwice('[aria-label="查看 B012345678 版本历史"]'));
    expect(await page.evaluate(() => window.calls.versions.length)).toBe(1);
    expect(await page.evaluate(() => window.calls.versions[0].input)).toEqual({ listingContentId: 1, limit: 100, offset: 0 });
    await page.getByRole('button', { name: '关闭 Listing 版本历史', exact: true }).click();
    await page.evaluate(() => { window.deferList = true; });
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.evaluate(() => window.resolveFixture('versions', 0, window.versionsFor('A', 0, 1, 'OLD_HISTORY')));
    expect(await page.getByRole('button', { name: '刷新', exact: true }).getAttribute('aria-busy')).toBe('true');
    expect(await page.locator('body').textContent()).not.toContain('OLD_HISTORY');
    await page.evaluate(() => window.resolveFixture('list', 0, [window.rowFor('A')]));
    await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));
  });

  it('admits one version page read and keeps the read-only ledger selection and reason aligned', async () => {
    const page = await pageForListing();
    await page.evaluate(() => window.invokeTwice('[aria-label="查看当前店铺 Listing 版本账本"]'));
    expect(await page.evaluate(() => window.calls.versions.length)).toBe(1);
    expect(await page.evaluate(() => window.calls.versions[0].input)).toEqual({ limit: 100, offset: 0 });
    await page.evaluate(() => window.resolveFixture('versions', 0, window.versionsFor('A', 0, 100)));
    await page.getByRole('button', { name: '加载更多历史', exact: true }).waitFor();
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(button => button.textContent.includes('加载更多历史'));
      const props = button[Object.keys(button).find(key => key.startsWith('__reactProps'))]; props.onClick(); props.onClick();
    });
    expect(await page.evaluate(() => window.calls.versions.length)).toBe(2);
    expect(await page.evaluate(() => window.calls.versions[1].input)).toEqual({ limit: 100, offset: 100 });
    expect(await page.getByRole('button', { name: '加载中…', exact: true }).getAttribute('aria-busy')).toBe('true');
    await page.getByText('正在读取更多历史版本，请稍候；关闭账本可取消本次读取。', { exact: true }).waitFor();
    await page.evaluate(() => window.resolveFixture('versions', 1, window.versionsFor('A', 100, 1)));
    await page.getByText('已读取 101 条历史快照', { exact: true }).waitFor();
  });

  it('cancels a closed ledger page read without unlocking a newer mutation', async () => {
    const page = await pageForListing();
    await page.getByRole('button', { name: '查看当前店铺 Listing 版本账本', exact: true }).click();
    await page.evaluate(() => window.resolveFixture('versions', 0, window.versionsFor('A', 0, 100)));
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await page.getByRole('button', { name: '关闭 Listing 版本账本', exact: true }).click();
    await page.getByRole('button', { name: '编辑 B012345678', exact: true }).click();
    await page.getByRole('button', { name: '保存 Listing', exact: true }).click();
    await page.evaluate(() => window.rejectFixture('versions', 1, 'OLD_LEDGER_FAILURE'));
    expect(await page.getByRole('button', { name: '保存中…', exact: true }).getAttribute('aria-busy')).toBe('true');
    expect(await page.locator('body').textContent()).not.toContain('OLD_LEDGER_FAILURE');
    await page.waitForFunction(() => JSON.stringify(window.calls.logs).includes('OLD_LEDGER_FAILURE'));
    await page.evaluate(() => window.resolveFixture('update', 0, window.rowFor('A')));
    await page.getByText('B012345678 已保存到当前店铺，本地内容不会自动发布到 Amazon。', { exact: true }).waitFor();
  });

  it('rejects a prior A to B to A save even when canonical A fields repeat and keeps the current save locked', async () => {
    const page = await pageForListing();
    await page.getByRole('button', { name: '编辑 B012345678', exact: true }).click();
    await page.getByRole('button', { name: '保存 Listing', exact: true }).click();
    await page.evaluate(() => window.bind('B'));
    await page.getByText('listing-B', { exact: true }).waitFor();
    await page.evaluate(() => window.bind('A'));
    await page.getByText('listing-A', { exact: true }).waitFor();
    await page.getByRole('button', { name: '编辑 B012345678', exact: true }).click();
    await page.getByRole('button', { name: '保存 Listing', exact: true }).click();
    await page.evaluate(() => window.resolveFixture('update', 0, window.rowFor('A', 'OLD_A_SAVE')));
    expect(await page.locator('body').textContent()).not.toContain('OLD_A_SAVE');
    expect(await page.getByRole('button', { name: '保存中…', exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.calls.list.length)).toBe(3);
    await page.evaluate(() => window.resolveFixture('update', 1, window.rowFor('A')));
    await page.getByText('B012345678 已保存到当前店铺，本地内容不会自动发布到 Amazon。', { exact: true }).waitFor();
  });

  it('rejects an old query response and shows a concrete reason for missing ASIN or service', async () => {
    const page = await pageForListing();
    await page.evaluate(() => { window.deferList = true; });
    await page.getByRole('textbox', { name: '查询 Listing', exact: true }).fill('old');
    await page.waitForFunction(() => window.waiting.list.length === 1);
    await page.getByRole('textbox', { name: '查询 Listing', exact: true }).fill('new');
    await page.waitForFunction(() => window.waiting.list.length === 2);
    await page.evaluate(() => window.resolveFixture('list', 0, [window.rowFor('A', 'OLD_QUERY')]));
    expect(await page.locator('body').textContent()).not.toContain('OLD_QUERY');
    await page.evaluate(() => window.resolveFixture('list', 1, [window.rowFor('A', 'CURRENT_QUERY')]));
    await page.getByText('CURRENT_QUERY', { exact: true }).waitFor();
    await page.getByRole('button', { name: '新建 Listing', exact: true }).click();
    expect(await page.getByRole('button', { name: '保存 Listing', exact: true }).isDisabled()).toBe(true);
    await page.getByText('ASIN 必须是 10 位 ASCII 字母或数字。', { exact: true }).waitFor();
  });

  it('blocks non-ready authority and unavailable services with visible reasons', async () => {
    const page = await pageForListing();
    await page.evaluate(() => window.bind('A', { phase: 'loading' }));
    await page.getByText('当前店铺权威尚未就绪，请等待顶部店铺状态就绪后重试。', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: '新建 Listing', exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.calls.list.length)).toBe(1);
    await page.evaluate(() => { window.api.createStoreListingContent = undefined; window.bind('A'); });
    await page.getByText('Listing 创建服务尚未就绪。', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: '新建 Listing', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: '刷新', exact: true }).isDisabled()).toBe(false);
  });

  it('logs the original unmounted save failure without issuing a reload', async () => {
    const page = await pageForListing();
    await page.getByRole('button', { name: '编辑 B012345678', exact: true }).click();
    await page.getByRole('button', { name: '保存 Listing', exact: true }).click();
    await page.evaluate(() => window.disposeFixture());
    await page.evaluate(() => window.rejectFixture('update', 0, 'UNMOUNTED_SAVE_FAILURE'));
    await page.waitForFunction(() => JSON.stringify(window.calls.logs).includes('UNMOUNTED_SAVE_FAILURE'));
    expect(await page.evaluate(() => window.calls.list.length)).toBe(1);
    expect(await page.locator('#root').textContent()).toBe('');
  });
});
