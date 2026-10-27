import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from '../mission-control/workspaces/production-action-browser.test-support';
import { legacyActionFixture } from './legacy-action-browser.test-support';
let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(legacyActionFixture('events', false)); }, 30_000);

describe('production Operation events action feedback', () => {
  async function edit(page: import('playwright').Page) {
    await page.getByRole('button', { name: '记录事件', exact: true }).click();
    await page.getByPlaceholder('例如：10% Coupon 开始、大促报名、主图更新', { exact: true }).fill('本次事件草稿');
  }

  it('shows the actual missing-product recovery and fixed store reason and admits one save before rendering', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      const product = page.getByRole('button', { name: '当前产品', exact: true }); await product.waitFor();
      expect(await product.isDisabled()).toBe(true);
      const reason = await product.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('锁定 ASIN');
      await page.getByRole('button', { name: '前往产品管理', exact: true }).click();
      expect(await page.evaluate(() => (window as any).legacyFixture.routes)).toEqual(['product-management']);
      await edit(page);
      expect(await page.locator('input[readonly]').count()).toBe(2);
      expect(await page.locator('#operation-event-fixed-identity').textContent()).toContain('不能在事件表单跨店修改');
      await invokeActualReactActionTwice(page, '保存到上下文');
      const active = page.getByRole('button', { name: '保存中...', exact: true }); await active.waitFor();
      expect(await active.getAttribute('aria-busy')).toBe('true');
      const bannerPeer = page.getByRole('button', { name: '记录事件', exact: true });
      expect(await bannerPeer.isDisabled()).toBe(true); expect(await bannerPeer.getAttribute('aria-busy')).toBeNull();
      expect(await page.getByText('事件已提交，表单已清空，正在写入本地上下文...', { exact: true }).first().getAttribute('class')).toBe('muted-line');
      expect(await page.evaluate(() => (window as any).legacyFixture.calls.event.length)).toBe(1);
      const peer = page.getByRole('button', { name: '刷新', exact: true });
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      await page.evaluate(() => (window as any).legacyFixture.finish('event', 0, true));
      await page.getByRole('button', { name: '保存到上下文', exact: true }).waitFor();
      expect(await page.getByPlaceholder('例如：10% Coupon 开始、大促报名、主图更新', { exact: true }).inputValue()).toBe('本次事件草稿');
      expect(await page.getByText('保存失败，已恢复刚才填写的事件。', { exact: true }).first().isVisible()).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('does not restore an old A to B to A failed draft or release the new event save', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await edit(page); await page.getByRole('button', { name: '保存到上下文', exact: true }).click();
      await page.evaluate(() => (window as any).legacyFixture.select('B'));
      await page.locator('#fixture-authority').filter({ hasText: 'B/1' }).waitFor();
      await page.evaluate(() => (window as any).legacyFixture.select('A'));
      await page.locator('#fixture-authority').filter({ hasText: 'A/1' }).waitFor();
      await edit(page); await page.getByRole('button', { name: '保存到上下文', exact: true }).click();
      await page.evaluate(() => (window as any).legacyFixture.finish('event', 0, true));
      expect(await page.getByRole('button', { name: '保存中...', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByText('保存失败，已恢复刚才填写的事件。', { exact: true }).count()).toBe(0);
      await page.evaluate(() => (window as any).legacyFixture.finish('event', 1));
      await page.getByText('运营事件已记录，会进入广告表现和 AI 诊断上下文。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one actual event archive before rendering and keeps other actions plain and locked', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '全部事件', exact: true }).click();
      await page.getByText('记录A', { exact: true }).waitFor();
      await invokeActualReactActionTwice(page, '归档');
      const active = page.getByRole('button', { name: '归档中...', exact: true }); await active.waitFor();
      expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await page.evaluate(() => (window as any).legacyFixture.calls.archive.length)).toBe(1);
      const peer = page.getByRole('button', { name: '记录事件', exact: true });
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      await page.evaluate(() => (window as any).legacyFixture.finish('archive', 0));
      await page.getByText('运营事件已归档，历史记录仍保留。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one explicit readonly event refresh before rendering and keeps the unsent draft recoverable', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await edit(page);
      await page.evaluate(() => (window as any).legacyFixture.holdEvents());
      await invokeActualReactActionTwice(page, '刷新');
      const active = page.getByRole('button', { name: '刷新中...', exact: true }); await active.waitFor();
      expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await page.evaluate(() => (window as any).legacyFixture.calls.eventRead.length)).toBe(1);
      const peer = page.getByRole('button', { name: '保存到上下文', exact: true });
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      await page.evaluate(() => (window as any).legacyFixture.finish('eventRead', 0));
      await page.getByRole('button', { name: '刷新', exact: true }).waitFor();
      expect(await page.getByPlaceholder('例如：10% Coupon 开始、大促报名、主图更新', { exact: true }).inputValue()).toBe('本次事件草稿');
      expect(await page.evaluate(() => (window as any).legacyFixture.calls.event.length)).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);
});
