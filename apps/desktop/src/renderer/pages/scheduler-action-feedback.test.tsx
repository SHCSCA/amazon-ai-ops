import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from '../mission-control/workspaces/production-action-browser.test-support';
import { legacyActionFixture } from './legacy-action-browser.test-support';
let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(legacyActionFixture('scheduler')); }, 30_000);

describe('production Scheduler action feedback', () => {
  async function confirm(page: import('playwright').Page) {
    await page.getByRole('button', { name: '立即采集', exact: true }).click();
    await invokeActualReactActionTwice(page, '确认立即采集');
    await page.getByRole('button', { name: '正在触发…', exact: true }).waitFor();
  }

  it('admits one actual confirmed run before rendering with an active spinner and explained plain peers', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await confirm(page);
      const active = page.getByRole('button', { name: '正在触发…', exact: true });
      expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await active.locator('.button-spinner').count()).toBe(1);
      expect(await page.evaluate(() => (window as any).legacyFixture.calls.run.length)).toBe(1);
      const cancel = page.getByRole('button', { name: '取消', exact: true });
      expect(await cancel.isDisabled()).toBe(true); expect(await cancel.getAttribute('aria-busy')).toBeNull();
      const reason = await cancel.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('等待完成');
      await page.evaluate(() => (window as any).legacyFixture.finish('run', 0));
      await page.getByText('当前店铺采集已受理。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('drops an old A to B to A run receipt without dismissing or unlocking the current confirmation', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await confirm(page);
      await page.evaluate(() => (window as any).legacyFixture.select('B'));
      await page.locator('#fixture-authority').filter({ hasText: 'B/1' }).waitFor();
      await page.evaluate(() => (window as any).legacyFixture.select('A'));
      await page.locator('#fixture-authority').filter({ hasText: 'A/1' }).waitFor();
      await confirm(page);
      await page.evaluate(() => (window as any).legacyFixture.finish('run', 0));
      expect(await page.getByRole('button', { name: '正在触发…', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByText('当前店铺采集已受理。', { exact: true }).count()).toBe(0);
      await page.evaluate(() => (window as any).legacyFixture.finish('run', 1));
      await page.getByText('当前店铺采集已受理。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('locks a manual readonly preview before rendering and explains run-now while the scan is pending', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '立即采集', exact: true }).waitFor();
      await page.evaluate(() => (window as any).legacyFixture.holdRetention());
      await invokeActualReactActionTwice(page, '刷新只读预览');
      const active = page.getByRole('button', { name: '扫描中…', exact: true }); await active.waitFor();
      expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await page.evaluate(() => (window as any).legacyFixture.calls.retention.length)).toBe(1);
      const peer = page.getByRole('button', { name: '立即采集', exact: true });
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      const reason = await peer.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('等待完成');
      await page.evaluate(() => (window as any).legacyFixture.finish('retention', 0));
      await page.getByRole('button', { name: '刷新只读预览', exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one explicit schedule refresh before rendering and keeps the alternate refresh entry plain', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '立即采集', exact: true }).waitFor();
      await page.evaluate(() => (window as any).legacyFixture.holdSchedule());
      await invokeActualReactActionTwice(page, '刷新');
      const active = page.getByRole('button', { name: '读取中…', exact: true }); await active.waitFor();
      expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await page.evaluate(() => (window as any).legacyFixture.calls.planRead.length)).toBe(1);
      const peer = page.getByRole('button', { name: '刷新当前店铺', exact: true });
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      expect(await peer.locator('.button-spinner').count()).toBe(0);
      await page.evaluate(() => (window as any).legacyFixture.finish('planRead', 0));
      await page.getByRole('button', { name: '立即采集', exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).legacyFixture.calls.run.length)).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);
});
