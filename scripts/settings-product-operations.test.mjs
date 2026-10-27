import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { buildSettingsProductOperationsFixture } from './settings-product-operations-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('./playwright-loader.js');
let browser, bundle, pages = [];
beforeAll(async () => {
  bundle = await buildSettingsProductOperationsFixture();
  browser = await chromium.launch({ headless: true });
}, 30000);
afterEach(async () => { await Promise.all(pages.splice(0).map(page => page.close())); });
afterAll(async () => { await browser?.close(); });

async function pageFor(mode, options = {}) {
  const page = await browser.newPage();
  pages.push(page);
  page.setDefaultTimeout(5000);
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ mode, missing, asin }) => window.showFixture(mode, missing, asin), { mode, missing: options.missing ?? false, asin: options.asin ?? 'B012345678' });
  await page.waitForFunction(() => !document.body.textContent.includes('正在读取设置') && !document.body.textContent.includes('加载中...'));
  return page;
}

describe('Settings and product configuration real page operations', () => {
  it('admits one AI save before React renders and keeps the clear-key peer idle', async () => {
    const page = await pageFor('settings');
    await page.getByRole('button', { name: '编辑连接', exact: true }).click();
    await page.evaluate(() => window.invokeTwice('.settings-modal-footer button'));
    expect(await page.evaluate(() => window.calls.saves.length)).toBe(1);
    const save = page.getByRole('button', { name: '保存中...', exact: true });
    const clear = page.getByRole('button', { name: '清除本地 AI Key', exact: true });
    expect(await save.getAttribute('aria-busy')).toBe('true');
    expect(await clear.isDisabled()).toBe(true);
    expect(await clear.getAttribute('aria-busy')).toBeNull();
    await page.evaluate(() => window.resolveFixture('saves', 0, { success: true }));
    await page.getByText('AI 设置已保存。API Key 仅显示为已配置状态，不在页面展示明文。', { exact: true }).waitFor();
  });

  it('keeps only clear-key busy and records a local clipboard rejection through the runtime log bridge', async () => {
    const page = await pageFor('settings');
    await page.getByRole('button', { name: '编辑连接', exact: true }).click();
    await page.getByRole('button', { name: '清除本地 AI Key', exact: true }).click();
    const save = page.getByRole('button', { name: '保存 AI 设置', exact: true });
    expect(await save.isDisabled()).toBe(true);
    expect(await save.getAttribute('aria-busy')).toBeNull();
    expect(await page.getByRole('button', { name: '清除中...', exact: true }).getAttribute('aria-busy')).toBe('true');
    await page.evaluate(() => window.resolveFixture('saves', 0, { success: true }));
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByText('高级诊断与本地支持', { exact: true }).click();
    await page.evaluate(() => { window.clipboardFailure = true; });
    await page.getByRole('button', { name: '复制支持检查清单', exact: true }).click();
    await page.waitForFunction(() => window.calls.logs.some(log => log.event === 'settings.copy_diagnostics_failed'));
    expect(await page.getByText(/复制失败：/).count()).toBe(1);
    expect(await page.getByText('支持检查清单已复制。', { exact: true }).count()).toBe(0);
  });

  it('rejects an old A to B to A AI result without unlocking or replacing the current test', async () => {
    const page = await pageFor('settings');
    await page.getByRole('button', { name: '测试当前连接', exact: true }).click();
    await page.evaluate(() => window.bind('B'));
    await page.getByText('model-B', { exact: true }).waitFor();
    await page.evaluate(() => window.bind('A'));
    await page.getByRole('button', { name: '测试当前连接', exact: true }).click();
    await page.evaluate(() => window.resolveFixture('tests', 0, { success: true, message: 'OLD_RESULT_MUST_NOT_RENDER' }));
    expect(await page.getByRole('button', { name: '正在测试...', exact: true }).isDisabled()).toBe(true);
    expect(await page.locator('body').textContent()).not.toContain('OLD_RESULT_MUST_NOT_RENDER');
    expect(await page.evaluate(() => window.calls.tests.length)).toBe(2);
    await page.getByText('高级诊断与本地支持', { exact: true }).click();
    await page.evaluate(() => window.resolveFixture('tests', 1, { success: true, message: 'CURRENT_AI_TEST' }));
    await page.waitForFunction(() => document.body.textContent.includes('CURRENT_AI_TEST'));
    expect(await page.locator('body').innerText()).toContain('CURRENT_AI_TEST');
  }, 15000);

  it('admits one product save and rejects an old completion after same-name store A to B to A', async () => {
    const page = await pageFor('product');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.evaluate(() => window.invokeTwice('.product-config-modal-footer button'));
    expect(await page.evaluate(() => window.calls.productSaves.length)).toBe(1);
    await page.evaluate(() => window.bind('B'));
    await page.getByText('product-B', { exact: true }).waitFor();
    await page.evaluate(() => window.bind('A'));
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('button', { name: '保存完整产品配置', exact: true }).click();
    await page.evaluate(() => window.resolveFixture('productSaves', 0, { success: true }));
    expect(await page.getByRole('button', { name: '保存中...', exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.calls.dataEvents)).toBe(0);
    await page.evaluate(() => window.resolveFixture('productSaves', 1, { success: true }));
    await page.waitForFunction(() => window.calls.dataEvents === 1);
  });

  it('locks the whole product action group for one bulk write and shows missing-authority or ASIN reasons', async () => {
    const page = await pageFor('product');
    await page.getByText('更多产品操作', { exact: true }).click();
    await page.getByRole('button', { name: '批量设置', exact: true }).click();
    await page.evaluate(() => window.invokeTwice('.product-config-modal-footer button'));
    expect(await page.evaluate(() => window.calls.bulk.length)).toBe(1);
    expect(await page.getByRole('button', { name: '批量应用中...', exact: true }).getAttribute('aria-busy')).toBe('true');
    expect(await page.getByRole('button', { name: '关闭', exact: true }).first().isDisabled()).toBe(true);
    expect(await page.getByText('当前产品操作正在处理中，请稍候。', { exact: true }).count()).toBeGreaterThan(0);
    await page.evaluate(() => window.resolveFixture('bulk', 0, { success: true, updatedCount: 1 }));
    await page.getByRole('button', { name: '关闭', exact: true }).first().click();
    await page.evaluate(() => window.bind('A', true));
    await page.getByText('当前店铺权威尚未就绪，请在顶部选择店铺并重新连接后重试。', { exact: true }).first().waitFor();
    expect(await page.getByRole('button', { name: '编辑当前产品目标', exact: true }).isDisabled()).toBe(true);
    await page.evaluate(() => window.bind('A', false, ''));
    await page.getByRole('button', { name: '新建产品配置', exact: true }).click();
    expect(await page.getByRole('button', { name: '保存完整产品配置', exact: true }).isDisabled()).toBe(true);
    await page.getByText('保存前请先填写 ASIN。', { exact: true }).waitFor();
  });

  it('keeps a manual-save peer idle when Enter and blur admit only one inline save', async () => {
    const page = await pageFor('product');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const input = page.getByRole('spinbutton', { name: '当前售价', exact: true });
    await input.fill('49.99');
    await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="当前售价"]');
      const props = input[Object.keys(input).find(key => key.startsWith('__reactProps'))];
      props.onKeyDown({ key: 'Enter', preventDefault() {} });
      props.onBlur();
    });
    expect(await page.evaluate(() => window.calls.productSaves.length)).toBe(1);
    const manual = page.getByRole('button', { name: '保存完整产品配置', exact: true });
    expect(await manual.isDisabled()).toBe(true);
    expect(await manual.getAttribute('aria-busy')).toBeNull();
    await page.getByText('当前售价 保存中...', { exact: true }).waitFor();
    await page.evaluate(() => window.rejectFixture('productSaves', 0, 'LOCAL_SAVE_REJECTED'));
    await page.waitForFunction(() => window.calls.logs.some(log => log.event === 'product_config.save_failed'));
    expect(await page.locator('body').textContent()).not.toContain('产品配置已保存。');
  });

  it('does not publish an old product load across A to B to A before the current load completes', async () => {
    const page = await pageFor('product');
    await page.evaluate(() => { window.deferLoads = true; window.bind('A'); });
    await page.waitForFunction(() => window.calls.loads.length === 1);
    await page.evaluate(() => window.bind('B'));
    await page.waitForFunction(() => window.calls.loads.length === 2);
    await page.evaluate(() => window.bind('A'));
    await page.waitForFunction(() => window.calls.loads.length === 3);
    const row = title => [{ id: 1, asin: 'B012345678', store_name: 'same-name-store', marketplace_code: 'US', title }];
    await page.evaluate(result => window.resolveFixture('loads', 0, result), row('OLD_PRODUCT_LOAD'));
    expect(await page.locator('body').textContent()).not.toContain('OLD_PRODUCT_LOAD');
    await page.evaluate(result => window.resolveFixture('loads', 2, result), row('CURRENT_PRODUCT_LOAD'));
    await page.getByText('CURRENT_PRODUCT_LOAD', { exact: true }).waitFor();
  });
});

async function apiKeyAx(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const document = (await session.send('DOM.getDocument', { depth: 0 })).root;
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: document.nodeId, selector: 'input[type="password"]' });
    const { node } = await session.send('DOM.describeNode', { nodeId });
    const { nodes } = await session.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const actual = nodes.filter(value => !value.ignored && value.backendDOMNodeId === node.backendNodeId);
    expect(actual).toHaveLength(1); return actual[0];
  } finally { await session.detach(); }
}

describe('真实SettingsPage的API Key名称与秘密保存边界', () => {
  it('Chromium实际AX名称只含短字段名，原隐私hint是描述且必填为ARIA语义', async () => {
    const page = await pageFor('settings');
    await page.getByRole('button', { name: '编辑连接', exact: true }).click();
    const input = page.locator('input[type="password"]'), ax = await apiKeyAx(page);
    expect(ax.name.value).toBe('API Key'); expect(ax.role.value).toBe('textbox');
    expect(ax.description.value).toBe('仅保存脱敏状态，页面不展示完整 Key。');
    expect(ax.properties.find(value => value.name === 'required').value.value).toBe(false);
    expect(await input.getAttribute('type')).toBe('password'); expect(await input.getAttribute('autocomplete')).toBe('off');
    expect(await input.evaluate(element => element.required)).toBe(false);
    const refs = await input.evaluate(element => ({ labelId: element.getAttribute('aria-labelledby'), hintId: element.getAttribute('aria-describedby'),
      label: document.getElementById(element.getAttribute('aria-labelledby'))?.textContent,
      hint: document.getElementById(element.getAttribute('aria-describedby'))?.textContent }));
    expect(refs.labelId).toBeTruthy(); expect(refs.hintId).toBeTruthy(); expect(refs.labelId).not.toBe(refs.hintId);
    expect(refs.label).toBe('API Key'); expect(refs.hint).toBe('仅保存脱敏状态，页面不展示完整 Key。');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    for (const configured of [false, undefined]) {
      await page.evaluate(value => {
        window.electronAPI.getSettings = async () => ({ aiKeyConfigured: value,
          aiBaseUrl: 'https://provider.invalid/v1', aiModel: 'model-A' });
        window.bind('A');
      }, configured);
      await page.getByRole('button', { name: '填写并保存 AI 设置', exact: true }).click();
      const unconfigured = await apiKeyAx(page);
      expect(unconfigured.name.value).toBe('API Key');
      expect(unconfigured.description.value).toBe('仅保存脱敏状态，页面不展示完整 Key。');
      expect(unconfigured.properties.find(value => value.name === 'required').value.value).toBe(true);
      expect(await input.evaluate(element => element.required)).toBe(false);
      await page.getByRole('button', { name: '取消', exact: true }).click();
    }
  });
  it('已配置Key保持空input仍可独立保存Base URL和Model，不新增HTML必填阻断', async () => {
    const page = await pageFor('settings');
    await page.getByRole('button', { name: '编辑连接', exact: true }).click();
    const input = page.locator('input[type="password"]'); expect(await input.inputValue()).toBe('');
    expect(await input.getAttribute('aria-required')).toBe('false');
    await page.getByPlaceholder('https://api.deepseek.com', { exact: true }).fill('https://model-only.invalid/v2');
    await page.getByPlaceholder('deepseek-v4-flash', { exact: true }).fill('model-only-updated');
    await page.getByRole('button', { name: '保存 AI 设置', exact: true }).click();
    await page.waitForFunction(() => window.calls.saves.length === 1);
    expect(await page.evaluate(() => window.calls.saves[0])).toMatchObject({ aiApiKey: '', aiKeyConfigured: true,
      aiBaseUrl: 'https://model-only.invalid/v2', aiModel: 'model-only-updated' });
    expect(await input.evaluate(element => element.required)).toBe(false);
    await page.evaluate(() => window.resolveFixture('saves', 0, { success: true }));
    await page.getByText('AI 设置已保存。API Key 仅显示为已配置状态，不在页面展示明文。', { exact: true }).waitFor();
    expect(await input.inputValue()).toBe('');
  });
  it('编辑及保存清空后ID稳定，明文仅交原保存端口而不回显到页面或日志', async () => {
    const page = await pageFor('settings');
    await page.getByRole('button', { name: '编辑连接', exact: true }).click();
    const input = page.locator('input[type="password"]');
    const ids = await input.evaluate(element => [element.getAttribute('aria-labelledby'), element.getAttribute('aria-describedby')]);
    expect(ids.every(Boolean)).toBe(true);
    await input.fill('MODEL_ONLY_SECRET_FOR_CLEARING');
    expect(await input.evaluate(element => [element.getAttribute('aria-labelledby'), element.getAttribute('aria-describedby')])).toEqual(ids);
    await page.getByRole('button', { name: '保存 AI 设置', exact: true }).click();
    await page.waitForFunction(() => window.calls.saves.length === 1);
    expect(await page.evaluate(() => window.calls.saves[0].aiApiKey)).toBe('MODEL_ONLY_SECRET_FOR_CLEARING');
    await page.evaluate(() => window.resolveFixture('saves', 0, { success: true }));
    await page.waitForFunction(() => document.querySelector('input[type="password"]').value === '');
    expect(await input.evaluate(element => [element.getAttribute('aria-labelledby'), element.getAttribute('aria-describedby')])).toEqual(ids);
    expect((await apiKeyAx(page)).name.value).toBe('API Key');
    expect(await page.content()).not.toContain('MODEL_ONLY_SECRET_FOR_CLEARING');
    expect(await page.evaluate(() => JSON.stringify(window.calls.logs))).not.toContain('MODEL_ONLY_SECRET_FOR_CLEARING');
  });
});
