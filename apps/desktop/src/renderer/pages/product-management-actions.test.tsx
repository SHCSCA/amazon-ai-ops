import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from '../mission-control/workspaces/production-action-browser.test-support';
import { legacyActionFixture } from './legacy-action-browser.test-support';
let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(legacyActionFixture('product')); }, 30_000);

describe('production Product management action feedback', () => {
  async function edit(page: import('playwright').Page) {
    await page.getByText('产品A', { exact: true }).first().click();
    await page.getByRole('tab', { name: '维护', exact: true }).click();
    await page.getByPlaceholder('产品标题', { exact: true }).fill('本次产品草稿');
  }

  it('locks one actual product save before rendering and explains plain peers and disabled fields while preserving a failed draft', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await edit(page);
      const asin = page.getByPlaceholder('例如 B0...', { exact: true });
      await asin.fill('');
      const unavailable = page.getByRole('button', { name: '保存产品信息', exact: true });
      expect(await unavailable.isDisabled()).toBe(true);
      const missingReason = await unavailable.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${missingReason}"]`).textContent()).toContain('填写产品 ASIN');
      await asin.fill('B000000001');
      await invokeActualReactActionTwice(page, '保存产品信息');
      const active = page.getByRole('button', { name: '保存中...', exact: true }); await active.waitFor();
      expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await page.evaluate(() => (window as any).legacyFixture.calls.product.length)).toBe(1);
      const peer = page.locator('.product-config-modal-footer').getByRole('button', { name: '打开完整配置', exact: true });
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      const reason = await peer.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('等待完成');
      const field = page.getByPlaceholder('产品标题', { exact: true });
      expect(await field.isDisabled()).toBe(true);
      expect(await page.locator('#product-management-fields-pending').isVisible()).toBe(true);
      await page.evaluate(() => (window as any).legacyFixture.finish('product', 0, true));
      await page.getByRole('button', { name: '保存产品信息', exact: true }).waitFor();
      expect(await field.inputValue()).toBe('本次产品草稿');
      expect(await page.locator('.product-management-modal-body').getByText('本地操作失败，请重试。', { exact: true }).isVisible()).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('drops an old A to B to A product receipt without unlocking the current save or changing the explicit product lock', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await edit(page); await page.getByRole('button', { name: '保存产品信息', exact: true }).click();
      await page.evaluate(() => (window as any).legacyFixture.select('B'));
      await page.locator('#fixture-authority').filter({ hasText: 'B/1' }).waitFor();
      await page.evaluate(() => (window as any).legacyFixture.select('A'));
      await page.locator('#fixture-authority').filter({ hasText: 'A/1' }).waitFor();
      await edit(page); await page.getByRole('button', { name: '保存产品信息', exact: true }).click();
      await page.evaluate(() => (window as any).legacyFixture.finish('product', 0));
      expect(await page.getByRole('button', { name: '保存中...', exact: true }).isDisabled()).toBe(true);
      expect(await page.locator('.product-management-modal-body .ready-line').count()).toBe(0);
      expect(await page.getByPlaceholder('产品标题', { exact: true }).inputValue()).toBe('本次产品草稿');
      await page.evaluate(() => (window as any).legacyFixture.finish('product', 1));
      // 同一产品配置重新载入后，当前保存确认仍须保留。
      await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[placeholder="产品标题"]')?.value === '产品A', undefined, { timeout: 5_000 });
      await page.getByRole('tabpanel', { name: '维护', exact: true }).getByText('产品信息已保存；当前锁定产品保持不变。', { exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).legacyFixture.calls.product.length)).toBe(2);
    } finally { await browser.close(); }
  }, 30_000);
});
