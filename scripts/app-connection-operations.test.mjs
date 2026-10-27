import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { buildAppConnectionOperationsFixture } from './app-connection-operations-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('./playwright-loader.js');
let browser, bundle, pages = [];
beforeAll(async () => {
  bundle = await buildAppConnectionOperationsFixture();
  browser = await chromium.launch({ headless: true });
}, 30000);
afterEach(async () => { await Promise.all(pages.splice(0).map(page => page.close())); });
afterAll(async () => { await browser?.close(); });

async function pageForConnection(options = {}) {
  const page = await browser.newPage(); pages.push(page); page.setDefaultTimeout(5000);
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(options => window.bind('A', options), options);
  await page.waitForFunction(() => window.view?.lingxingCollectionStoreName === (window.options.missing ? '' : 'ERP A'));
  return page;
}

async function expectVisibleDescription(page, control, id, text) {
  expect(await control.getAttribute('aria-describedby')).toBe(id);
  const reason = page.locator(`[id="${id}"]`);
  expect(await reason.count()).toBe(1);
  expect(await reason.isVisible()).toBe(true);
  expect(await reason.textContent()).toContain(text);
}

describe('actual App connection operation feedback', () => {
  it('admits one login before render and freezes credentials, remember choice, and ERP identity', async () => {
    const page = await pageForConnection();
    const reconnect = page.locator('[data-login-action="reconnect-all"]');
    expect(await reconnect.getAttribute('aria-describedby')).toBeNull();
    await page.evaluate(() => window.invokeTwice('[data-login-action="reconnect-all"]'));
    await page.waitForFunction(() => window.calls.login.length === 1);
    expect(await page.getByRole('textbox', { name: '领星用户名', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByLabel('领星密码', { exact: true }).isDisabled()).toBe(true);
    expect(await page.getByLabel('领星下载中心店铺名称', { exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('checkbox', { name: '记住密码', exact: true }).isDisabled()).toBe(true);
    expect(await page.locator('[data-login-action="reconnect-all"]').getAttribute('aria-busy')).toBe('true');
    expect(await page.getByRole('button', { name: '解绑领星映射', exact: true }).getAttribute('aria-busy')).toBeNull();
    await page.getByText('正在建立当前店铺连接，请在可见浏览器完成登录，暂不能修改凭证或其他连接。', { exact: true }).first().waitFor();
    expect(await reconnect.isDisabled()).toBe(true);
    await expectVisibleDescription(page, reconnect, 'store-connection-operation-reason', '正在建立当前店铺连接，请在可见浏览器完成登录，暂不能修改凭证或其他连接。');
    expect(await page.evaluate(() => window.calls.login[0])).toMatchObject({ username: 'operator', credentialSource: 'typed', storeContext: { storeId: 'A', browserProfileId: 'profile-A' } });
    await page.evaluate(() => window.resolveFixture('login', 0, window.sessionFor('A')));
    await page.waitForFunction(() => window.view.loading === false);
    expect(await reconnect.isDisabled()).toBe(false);
    expect(await reconnect.getAttribute('aria-describedby')).toBeNull();
    expect(await page.locator('#store-connection-operation-reason').count()).toBe(0);
  });

  it('admits one ERP binding and rejects same-tick draft edits through the real input handler', async () => {
    const page = await pageForConnection({ missing: true });
    await page.getByLabel('领星下载中心店铺名称', { exact: true }).fill('New ERP shop');
    await page.evaluate(() => {
      window.invokeTwice('[data-package-ui-evidence-action="bind-lingxing-connection"]');
      const input=document.querySelector('[aria-label="领星用户名"]');
      input[Object.keys(input).find(key=>key.startsWith('__reactProps'))].onChange({target:{value:'changed-during-bind'}});
    });
    expect(await page.evaluate(() => window.calls.bind)).toEqual([{ username: 'operator', shop: 'New ERP shop', storeId: 'A' }]);
    expect(await page.getByLabel('领星用户名', { exact: true }).inputValue()).toBe('operator');
    expect(await page.locator('[data-package-ui-evidence-action="bind-lingxing-connection"]').getAttribute('aria-busy')).toBe('true');
    expect(await page.locator('[data-login-action="reconnect-all"]').getAttribute('aria-busy')).toBeNull();
    const bindButton = page.locator('[data-package-ui-evidence-action="bind-lingxing-connection"]');
    const reconnect = page.locator('[data-login-action="reconnect-all"]');
    expect(await bindButton.isDisabled()).toBe(true);
    expect(await reconnect.isDisabled()).toBe(true);
    await expectVisibleDescription(page, bindButton, 'store-connection-bind-reason', '正在绑定领星账号与下载中心店铺名称，请稍候再修改配置。');
    await expectVisibleDescription(page, reconnect, 'store-connection-operation-reason', '正在绑定领星账号与下载中心店铺名称，请稍候再修改配置。');
    await page.evaluate(() => window.resolveFixture('bind', 0, {}));
    await page.waitForFunction(() => window.view.connectionOperationBusy === false);
  });

  it('admits one confirmed unbind while peer entry and modal cancellation remain plain locked controls', async () => {
    const page = await pageForConnection({ withAds: true });
    await page.getByRole('button', { name: '解绑领星映射', exact: true }).click();
    await page.evaluate(() => {
      window.invokeTwice('[role="alertdialog"] footer button:last-child');
      const cancel=document.querySelector('[role="alertdialog"] footer button');
      cancel[Object.keys(cancel).find(key=>key.startsWith('__reactProps'))].onClick({});
      void window.view.handleLogin();
    });
    expect(await page.evaluate(() => window.calls.unbind.length)).toBe(1);
    expect(await page.evaluate(() => window.calls.login.length)).toBe(0);
    expect(await page.getByRole('button', { name: '解绑中…', exact: true }).getAttribute('aria-busy')).toBe('true');
    expect(await page.getByRole('button', { name: '取消', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: '解绑领星映射', exact: true }).getAttribute('aria-busy')).toBeNull();
    expect(await page.getByRole('button', { name: '解绑领星广告账户', exact: true }).isDisabled()).toBe(true);
    await page.getByText('正在解绑领星映射，请稍候；本机保存的密码会保留。', { exact: true }).first().waitFor();
    await page.evaluate(() => window.resolveFixture('unbind', 0, {}));
    await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
  });

  it('admits one Ads confirmation with the original one-time token and current store', async () => {
    const page = await pageForConnection({ candidate: true });
    await page.evaluate(() => window.invokeTwice('[data-login-action="confirm-ads-identity"]'));
    expect(await page.evaluate(() => window.calls.confirm.length)).toBe(1);
    expect(await page.evaluate(() => window.calls.confirm[0])).toMatchObject({ confirmationToken: 'candidate-A', storeContext: { storeId: 'A', sessionGeneration: 1 } });
    expect(await page.locator('[data-login-action="confirm-ads-identity"]').getAttribute('aria-busy')).toBe('true');
    expect(await page.getByLabel('领星用户名', { exact: true }).isDisabled()).toBe(true);
    await page.evaluate(() => window.resolveFixture('confirm', 0, window.sessionFor('A')));
    await page.waitForFunction(() => window.view.adsSessionConnected === true);
  });

  it('shows busy only on Ads retry while the full reconnect peer keeps its normal label', async () => {
    const page = await pageForConnection({ retry: true });
    await page.evaluate(() => window.invokeTwice('[data-login-action="retry-ads"]'));
    await page.waitForFunction(() => window.calls.login.length === 1);
    expect(await page.locator('[data-login-action="retry-ads"]').getAttribute('aria-busy')).toBe('true');
    const reconnect=page.locator('[data-login-action="reconnect-all"]');
    expect(await reconnect.getAttribute('aria-busy')).toBeNull();
    expect(await reconnect.textContent()).toBe('重新连接 ERP 与 Ads');
    expect(await reconnect.isDisabled()).toBe(true);
    await page.evaluate(() => window.resolveFixture('login', 0, window.sessionFor('A')));
  });

  it('admits one saved-session reset and keeps full reconnect as a plain disabled peer', async () => {
    const page = await pageForConnection({ saved: true, reset: true });
    await page.waitForFunction(() => window.view.configuredSavedSessionResetReady === true);
    await page.evaluate(() => window.invokeTwice('[data-login-action="reset-lingxing-session"]'));
    expect(await page.evaluate(() => window.calls.logout.length)).toBe(1);
    expect(await page.locator('[data-login-action="reset-lingxing-session"]').getAttribute('aria-busy')).toBe('true');
    expect(await page.locator('[data-login-action="reconnect-all"]').getAttribute('aria-busy')).toBeNull();
    expect(await page.getByLabel('领星密码', { exact: true }).isDisabled()).toBe(true);
    await page.evaluate(() => window.resolveFixture('logout', 0, {}));
    await page.waitForFunction(() => window.view.loading === false);
  });

  it('shows concrete missing binding, encryption, and authority recovery reasons', async () => {
    const page = await pageForConnection({ missing: true, blankUsername: true, encryptionUnavailable: true });
    await page.getByText('请先输入领星用户名，再绑定当前店铺。', { exact: true }).waitFor();
    const bindButton = page.locator('[data-package-ui-evidence-action="bind-lingxing-connection"]');
    const reconnect = page.locator('[data-login-action="reconnect-all"]');
    expect(await bindButton.isDisabled()).toBe(true);
    expect(await reconnect.isDisabled()).toBe(true);
    await expectVisibleDescription(page, bindButton, 'store-connection-bind-reason', '请先输入领星用户名，再绑定当前店铺。');
    await expectVisibleDescription(page, reconnect, 'store-connection-readiness', '未就绪：请先在步骤 1 输入领星用户名。');
    await page.getByText('本机加密当前不可用，暂不能记住密码；本次可输入密码登录，恢复本机加密后再保存。', { exact: true }).waitFor();
    expect(await page.getByRole('checkbox', { name: '记住密码', exact: true }).isDisabled()).toBe(true);
    await page.getByLabel('领星用户名', { exact: true }).fill('operator');
    await page.getByText('请填写与领星下载中心完全一致的店铺名称后再绑定。', { exact: true }).waitFor();
    expect(await bindButton.isDisabled()).toBe(true);
    expect(await reconnect.isDisabled()).toBe(true);
    await expectVisibleDescription(page, bindButton, 'store-connection-bind-reason', '请填写与领星下载中心完全一致的店铺名称后再绑定。');
    await expectVisibleDescription(page, reconnect, 'store-connection-readiness', '未就绪：请填写与领星下载中心显示完全一致的店铺名称。');
    await page.getByLabel('领星下载中心店铺名称', { exact: true }).fill('New ERP shop');
    expect(await bindButton.isDisabled()).toBe(false);
    expect(await bindButton.getAttribute('aria-describedby')).toBeNull();
    expect(await page.locator('#store-connection-bind-reason').count()).toBe(0);
    await page.evaluate(() => window.bind('A', { phase: 'switching' }));
    await page.getByText('当前店铺身份尚未就绪，请先在顶部确认店铺并等待状态恢复。', { exact: true }).first().waitFor();
    expect(await page.locator('[data-login-action="reconnect-all"]').isDisabled()).toBe(true);
    await expectVisibleDescription(page, reconnect, 'store-connection-operation-reason', '当前店铺身份尚未就绪，请先在顶部确认店铺并等待状态恢复。');
    expect(await page.evaluate(() => window.calls.login.length)).toBe(0);
    await page.evaluate(() => window.bind('A'));
    await page.waitForFunction(() => window.view.loginWorkbenchReady && !window.view.loading);
    expect(await reconnect.isDisabled()).toBe(false);
    expect(await reconnect.getAttribute('aria-describedby')).toBeNull();
    expect(await page.locator('#store-connection-operation-reason').count()).toBe(0);
  });

  it('logs an old A to B to A login failure without publishing or unlocking the current login', async () => {
    const page = await pageForConnection();
    await page.locator('[data-login-action="reconnect-all"]').click();
    await page.waitForFunction(() => window.calls.login.length === 1);
    await page.evaluate(() => window.bind('B'));
    await page.waitForFunction(() => window.view.lingxingCollectionStoreName === 'ERP B' && !window.view.loading);
    await page.evaluate(() => window.bind('A'));
    await page.waitForFunction(() => window.view.lingxingCollectionStoreName === 'ERP A' && !window.view.loading);
    await page.locator('[data-login-action="reconnect-all"]').click();
    await page.waitForFunction(() => window.calls.login.length === 2);
    await page.evaluate(() => window.rejectFixture('login', 0, 'OLD_LOGIN_FAILURE'));
    await page.waitForFunction(() => JSON.stringify(window.calls.logs).includes('OLD_LOGIN_FAILURE'));
    expect(await page.locator('[data-login-action="reconnect-all"]').getAttribute('aria-busy')).toBe('true');
    expect(await page.locator('body').textContent()).not.toContain('OLD_LOGIN_FAILURE');
    await page.evaluate(() => window.resolveFixture('login', 1, window.sessionFor('A')));
    await page.waitForFunction(() => !window.view.loading && window.view.adsSessionConnected);
  });

  it('rejects an old successful Ads confirmation across A to B to A without finishing the new confirmation', async () => {
    const page = await pageForConnection({ candidate: true });
    await page.locator('[data-login-action="confirm-ads-identity"]').click();
    await page.evaluate(() => window.bind('B', { candidate: true }));
    await page.waitForFunction(() => window.view.adsIdentityCandidate?.confirmationToken === 'candidate-B');
    await page.evaluate(() => window.bind('A', { candidate: true }));
    await page.waitForFunction(() => window.view.adsIdentityCandidate?.confirmationToken === 'candidate-A');
    await page.locator('[data-login-action="confirm-ads-identity"]').click();
    await page.evaluate(() => window.resolveFixture('confirm', 0, window.sessionFor('A')));
    expect(await page.locator('[data-login-action="confirm-ads-identity"]').getAttribute('aria-busy')).toBe('true');
    expect(await page.evaluate(() => window.view.adsSessionConnected)).toBe(false);
    await page.evaluate(() => window.resolveFixture('confirm', 1, window.sessionFor('A')));
    await page.waitForFunction(() => window.view.adsSessionConnected === true);
  });

  it('logs the original confirmation failure after unmount without restoring the component', async () => {
    const page = await pageForConnection({ candidate: true });
    await page.locator('[data-login-action="confirm-ads-identity"]').click();
    await page.evaluate(() => window.disposeFixture());
    await page.evaluate(() => window.rejectFixture('confirm', 0, 'UNMOUNTED_CONFIRM_FAILURE'));
    await page.waitForFunction(() => JSON.stringify(window.calls.logs).includes('UNMOUNTED_CONFIRM_FAILURE'));
    expect(await page.locator('#root').textContent()).toBe('');
  });

  it('retires pending feedback on a same-authority epoch change so the current login can be admitted', async () => {
    const page = await pageForConnection();
    await page.locator('[data-login-action="reconnect-all"]').click();
    await page.waitForFunction(() => window.calls.login.length === 1);
    await page.evaluate(() => window.advanceEpoch());
    await page.waitForFunction(() => !window.view.loading && !window.view.connectionOperationBusy);
    expect(await page.locator('[data-login-action="reconnect-all"]').isDisabled()).toBe(false);
    await page.locator('[data-login-action="reconnect-all"]').click();
    await page.waitForFunction(() => window.calls.login.length === 2);
    await page.evaluate(() => window.resolveFixture('login', 0, window.sessionFor('A')));
    expect(await page.locator('[data-login-action="reconnect-all"]').getAttribute('aria-busy')).toBe('true');
    expect(await page.evaluate(() => window.view.adsSessionConnected)).toBe(false);
    await page.evaluate(() => window.resolveFixture('login', 1, window.sessionFor('A')));
    await page.waitForFunction(() => !window.view.loading && window.view.adsSessionConnected);
  });
});
