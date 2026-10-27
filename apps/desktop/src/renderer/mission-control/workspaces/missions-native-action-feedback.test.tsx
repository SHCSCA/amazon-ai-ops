import { beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { currentWorkspaceActionFixture } from './current-workspace-action.test-support';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from './production-action-browser.test-support';
let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(currentWorkspaceActionFixture('missions')); }, 30_000);
async function open() {
  const value = await openProductionActionFixture(bundle);
  try { await value.page.getByRole('button', { name: '暂停任务', exact: true }).waitFor(); return value; }
  catch (caught) {
    const diagnostics = await value.page.evaluate(() => ({ text: document.body.innerText, errors: (window as any).currentWorkspaceFixture.errors }));
    await value.browser.close(); throw new Error(String(caught) + JSON.stringify(diagnostics));
  }
}
async function select(page: Page, id: string, generation = 1) {
  await page.evaluate(({ id, generation }) => (window as any).currentWorkspaceFixture.select(id, generation), { id, generation });
  await page.locator('[data-mission-id="mission-' + id + '"]').waitFor();
  await page.getByRole('button', { name: '暂停任务', exact: true }).waitFor();
}

describe('current native Missions action feedback', () => {
  it('admits one actual transition before rendering and describes the plain analysis peer while the selected action is busy', async () => {
    const { browser, page } = await open();
    try {
      await invokeActualReactActionTwice(page, '暂停任务');
      const active = page.getByRole('button', { name: '更新状态中…', exact: true }); await active.waitFor();
      expect(await page.evaluate(() => (window as any).currentWorkspaceFixture.calls.transition.length)).toBe(1);
      expect(await active.locator('.button-spinner').count()).toBe(1);
      const peer = page.getByRole('button', { name: '运行分析', exact: true });
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      const reason = await peer.getAttribute('aria-describedby'); expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('请等待结果');
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('transition', 0, true));
      await page.getByRole('button', { name: '暂停任务', exact: true }).waitFor();
      expect(await page.locator('.mission-domain-feedback').textContent()).toContain('当前操作失败');
      await page.getByRole('button', { name: '暂停任务', exact: true }).click();
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('transition', 1));
      await page.getByRole('button', { name: '恢复任务', exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('drops an old same-name store receipt after A to B to A without clearing the current transition lock', async () => {
    const { browser, page } = await open();
    try {
      await page.getByRole('button', { name: '暂停任务', exact: true }).click(); await select(page, 'B'); await select(page, 'A');
      await page.getByRole('button', { name: '暂停任务', exact: true }).click();
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('transition', 0));
      expect(await page.getByRole('button', { name: '更新状态中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.locator('.mission-domain-feedback').filter({ hasText: '运营任务已暂停' }).count()).toBe(0);
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('transition', 1));
      await page.getByRole('button', { name: '恢复任务', exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('does not request old analysis receipts after a session generation change and preserves the new analysis lock', async () => {
    const { browser, page } = await open();
    try {
      await invokeActualReactActionTwice(page, '运行分析');
      await page.getByRole('button', { name: '分析中…', exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).currentWorkspaceFixture.calls.analysis.length)).toBe(1);
      await select(page, 'A', 2); await page.getByRole('button', { name: '运行分析', exact: true }).click();
      const before = await page.evaluate(() => { const x = (window as any).currentWorkspaceFixture.calls; return [x.list.length, x.lineage.length, x.projection.length]; });
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('analysis', 0));
      expect(await page.getByRole('button', { name: '分析中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.evaluate(() => { const x = (window as any).currentWorkspaceFixture.calls; return [x.list.length, x.lineage.length, x.projection.length]; })).toEqual(before);
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('analysis', 1, true));
      await page.getByRole('button', { name: '重试分析', exact: true }).waitFor();
      expect(await page.locator('.mission-domain-feedback').textContent()).toContain('当前分析失败');
    } finally { await browser.close(); }
  }, 30_000);

  it('retires a pending action when selecting another actual Mission and does not let its old receipt clear the new action', async () => {
    const { browser, page } = await open();
    try {
      await page.getByRole('button', { name: '暂停任务', exact: true }).click();
      await page.locator('details.mission-domain-switcher > summary').click();
      await page.getByRole('button', { name: /另一个任务/ }).click();
      await page.locator('[data-mission-id="mission-second-A"]').waitFor();
      await page.getByRole('button', { name: '暂停任务', exact: true }).click();
      expect(await page.evaluate(() => (window as any).currentWorkspaceFixture.calls.transition.length)).toBe(2);
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('transition', 0));
      expect(await page.getByRole('button', { name: '更新状态中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.locator('.mission-domain-feedback').filter({ hasText: '运营任务已暂停' }).count()).toBe(0);
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('transition', 1));
      await page.getByRole('button', { name: '恢复任务', exact: true }).waitFor();
      expect(await page.locator('[data-mission-id="mission-second-A"]').count()).toBe(1);
    } finally { await browser.close(); }
  }, 30_000);

  it('ignores an old failure receipt after its second await instead of writing its error into a new store epoch', async () => {
    const { browser, page } = await open();
    try {
      await page.getByRole('button', { name: '运行分析', exact: true }).click();
      await page.evaluate(() => { const x = (window as any).currentWorkspaceFixture; x.holdFailure(); x.finish('analysis', 0, true); });
      await page.waitForFunction(() => (window as any).currentWorkspaceFixture.calls.failure.length === 1);
      await select(page, 'B'); await select(page, 'A');
      await page.getByRole('button', { name: '运行分析', exact: true }).click();
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('failure', 0));
      expect(await page.getByRole('button', { name: '分析中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.locator('.mission-domain-feedback').filter({ hasText: '当前分析失败' }).count()).toBe(0);
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('analysis', 1, true));
      await page.waitForFunction(() => (window as any).currentWorkspaceFixture.calls.failure.length >= 4);
      await page.evaluate(() => { const x = (window as any).currentWorkspaceFixture; x.calls.failure.forEach((_: unknown, i: number) => { if (i) x.finish('failure', i); }); });
      await page.getByRole('button', { name: '重试分析', exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('uses the actual facts view checkpoint editor with immediate submission lock and a described readonly fieldset', async () => {
    const { browser, page } = await open();
    try {
      await page.evaluate(() => (window as any).currentWorkspaceFixture.facts());
      await page.getByRole('button', { name: '记录事实检查点', exact: true }).click();
      await page.getByRole('textbox', { name: '标题', exact: true }).fill('当前事实记录');
      await invokeActualReactActionTwice(page, '追加检查点');
      const active = page.getByRole('button', { name: '保存中…', exact: true }); await active.waitFor();
      expect(await page.evaluate(() => (window as any).currentWorkspaceFixture.calls.checkpoint.length)).toBe(1);
      const input = page.getByRole('textbox', { name: '标题', exact: true }); expect(await input.isDisabled()).toBe(true);
      const id = await input.locator('xpath=ancestor::fieldset').getAttribute('aria-describedby');
      expect(await page.locator(`[id="${id}"]`).textContent()).toContain('完成或失败后可继续编辑');
      await page.evaluate(() => (window as any).currentWorkspaceFixture.finish('checkpoint', 0));
      await page.getByText('检查点“当前事实记录”已追加到因果链。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('explains missing real creation dependencies and keeps actual recovery routes available', async () => {
    const { browser, page } = await open();
    try {
      await page.getByRole('button', { name: '新建运营任务', exact: true }).first().click();
      const batch = page.getByRole('combobox', { name: '已完成数据批次 *', exact: true });
      expect(await batch.isDisabled()).toBe(true);
      const id = await batch.getAttribute('aria-describedby'); expect(await page.locator(`[id="${id}"]`).textContent()).toContain('先采集并导入报表');
      await page.getByRole('button', { name: '先采集', exact: true }).click();
      expect(await page.evaluate(() => (window as any).currentWorkspaceFixture.routes)).toContain('data-collection');
      expect(await page.getByRole('button', { name: '保存运营任务', exact: true }).isDisabled()).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);
});
