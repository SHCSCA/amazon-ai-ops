import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from '../mission-control/workspaces/production-action-browser.test-support';
import { legacyActionFixture } from './legacy-action-browser.test-support';
let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(legacyActionFixture('scope')); }, 30_000);

describe('production Operation scope action feedback', () => {
  it('admits one actual scope save before rendering with visible field and cancel reasons', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '编辑范围', exact: true }).click();
      await invokeActualReactActionTwice(page, '保存范围');
      const active = page.locator('.operation-scope-editor-actions').getByRole('button', { name: '保存中...', exact: true }); await active.waitFor();
      expect(await active.getAttribute('aria-busy')).toBe('true');
      const bannerPeer = page.getByRole('button', { name: '确认并保存范围', exact: true });
      expect(await bannerPeer.isDisabled()).toBe(true); expect(await bannerPeer.getAttribute('aria-busy')).toBeNull();
      expect(await bannerPeer.locator('.button-spinner').count()).toBe(0);
      expect(await page.evaluate(() => (window as any).legacyFixture.calls.scope.length)).toBe(1);
      const cancel = page.getByRole('button', { name: '取消', exact: true });
      expect(await cancel.isDisabled()).toBe(true); expect(await cancel.getAttribute('aria-busy')).toBeNull();
      const reason = await cancel.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('保存当前店铺范围');
      expect(await page.getByLabel('运营范围开始日期', { exact: true }).isDisabled()).toBe(true);
      expect(await page.locator('#operation-scope-fields-pending').isVisible()).toBe(true);
      await page.evaluate(() => (window as any).legacyFixture.finish('scope', 0));
      await page.getByText('范围已保存，后续页面会按此读取', { exact: true }).first().waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('does not apply an old A to B to A saved scope or release the new confirmation', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '编辑范围', exact: true }).click();
      await page.getByLabel('运营范围开始日期', { exact: true }).fill('2026-10-02');
      await page.getByRole('button', { name: '保存范围', exact: true }).click();
      await page.evaluate(() => (window as any).legacyFixture.select('B'));
      await page.locator('#fixture-authority').filter({ hasText: 'B/1' }).waitFor();
      await page.evaluate(() => (window as any).legacyFixture.select('A'));
      await page.locator('#fixture-authority').filter({ hasText: 'A/1' }).waitFor();
      await page.getByRole('button', { name: '编辑范围', exact: true }).click();
      await page.getByRole('button', { name: '保存范围', exact: true }).click();
      await page.evaluate(() => (window as any).legacyFixture.finish('scope', 0));
      expect(await page.locator('.operation-scope-editor-actions').getByRole('button', { name: '保存中...', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByLabel('运营范围开始日期', { exact: true }).inputValue()).toBe('2026-10-01');
      await page.evaluate(() => (window as any).legacyFixture.finish('scope', 1));
      await page.getByText('范围已保存，后续页面会按此读取', { exact: true }).first().waitFor();
    } finally { await browser.close(); }
  }, 30_000);
});
