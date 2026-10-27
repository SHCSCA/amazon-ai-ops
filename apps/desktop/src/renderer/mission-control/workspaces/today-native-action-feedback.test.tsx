import { beforeAll, describe, expect, it } from 'vitest';
import { currentWorkspaceActionFixture } from './current-workspace-action.test-support';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from './production-action-browser.test-support';
let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(currentWorkspaceActionFixture('today')); }, 30_000);

describe('current native Today recovery action feedback', () => {
  it('wires the actual workspace route recovery and admits one readonly refresh before rendering with immediate busy feedback', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '刷新今日状态', exact: true }).waitFor();
      await invokeActualReactActionTwice(page, '刷新今日状态');
      const active = page.getByRole('button', { name: '刷新中…', exact: true }); await active.waitFor();
      expect(await page.evaluate(() => (window as any).currentWorkspaceFixture.calls.refresh.length)).toBe(1);
      expect(await active.getAttribute('aria-busy')).toBe('true'); expect(await active.locator('.button-spinner').count()).toBe(1);
      const id = await active.getAttribute('aria-describedby'); expect(await page.locator(`[id="${id}"]`).textContent()).toContain('请等待完成');
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('refresh', 0, true));
      await page.getByRole('button', { name: '刷新今日状态', exact: true }).waitFor();
      await page.getByText('今日状态刷新未完成，请检查当前店铺连接后重试。', { exact: true }).waitFor();
      await page.getByRole('button', { name: '刷新今日状态', exact: true }).click();
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('refresh', 1));
      await page.getByText('已请求刷新当前店铺今日状态，请以最新投影为准。', { exact: true }).waitFor();
      expect(await page.locator('[data-production-today-projection]').count()).toBe(0);
      expect(await page.getByText('今日投影不可用', { exact: true }).count()).toBe(1);
    } finally { await browser.close(); }
  }, 30_000);

  it('discards an old same-name A to B to A refresh result without clearing the current epoch lock', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '刷新今日状态', exact: true }).click();
      await page.evaluate(() => (window as any).currentWorkspaceFixture.select('B'));
      await page.locator('#current-authority').filter({ hasText: 'B/1/2' }).waitFor();
      await page.evaluate(() => (window as any).currentWorkspaceFixture.select('A'));
      await page.locator('#current-authority').filter({ hasText: 'A/1/3' }).waitFor();
      await page.getByRole('button', { name: '刷新今日状态', exact: true }).click();
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('refresh', 0));
      expect(await page.getByRole('button', { name: '刷新中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByText('已请求刷新当前店铺今日状态，请以最新投影为准。', { exact: true }).count()).toBe(0);
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('refresh', 1));
      await page.getByRole('button', { name: '刷新今日状态', exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('logs a late refresh failure after leaving the actual Today view and cannot render old feedback', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '刷新今日状态', exact: true }).click();
      await page.evaluate(() => (window as any).currentWorkspaceFixture.unmount());
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('refresh', 0, true));
      await page.waitForFunction(() => (window as any).currentWorkspaceFixture.logs.some((x: { event: string }) => x.event === 'mission_control.bootstrap_failed'));
      expect(await page.locator('[data-workspace="today"]').count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('records a real bridge mode transport failure through Shell and keeps the confirmed mode without an unhandled rejection', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '刷新今日状态', exact: true }).waitFor();
      await page.getByRole('button', { name: 'AI 策略内自动', exact: true }).click();
      await page.getByRole('textbox', { name: '切换原因', exact: true }).fill('当前策略已经复核');
      await invokeActualReactActionTwice(page, '确认切换为AI 策略内自动');
      await page.waitForFunction(() => (window as any).currentWorkspaceFixture.calls.mode.length === 1);
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('mode', 0, true));
      await page.locator('.mission-control-mode-feedback').filter({ hasText: '当前操作失败，请重试。' }).waitFor();
      expect(await page.getByRole('button', { name: '人工审批', exact: true }).getAttribute('aria-pressed')).toBe('true');
      expect(await page.getByRole('button', { name: 'AI 策略内自动', exact: true }).getAttribute('aria-pressed')).toBe('false');
      expect(await page.evaluate(() => (window as any).currentWorkspaceFixture.logs.some((x: { event: string }) => x.event === 'mission_control.mode_command_failed'))).toBe(true);
      expect(await page.evaluate(() => (window as any).currentWorkspaceFixture.errors)).toEqual([]);
    } finally { await browser.close(); }
  }, 30_000);
});
