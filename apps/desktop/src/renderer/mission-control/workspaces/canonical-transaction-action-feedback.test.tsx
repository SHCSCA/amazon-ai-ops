import { beforeAll, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from './production-action-browser.test-support';
import { canonicalTransactionFixture, type CanonicalFeedbackPanel } from './canonical-transaction-feedback.test-support';

const bundles = new Map<CanonicalFeedbackPanel, string>();
beforeAll(async () => {
  for (const name of ['decisions', 'execution', 'memory'] as const) bundles.set(name, await bundleProductionActionFixture(canonicalTransactionFixture(name)));
}, 60_000);
async function open(name: CanonicalFeedbackPanel) { return openProductionActionFixture(bundles.get(name)!); }
async function count(page: Page, kind: string) { return page.evaluate(kind => ((window as any).canonicalFeedback.calls[kind] || []).length, kind); }
async function complete(page: Page, kind: string, index: number, failed = false) {
  await page.evaluate(({ kind, index, failed }) => (window as any).canonicalFeedback.complete(kind, index, failed), { kind, index, failed });
}
async function select(page: Page, id: string, generation = 1) {
  await page.evaluate(({ id, generation }) => (window as any).canonicalFeedback.select(id, generation), { id, generation });
  await page.locator('#fixture-authority').filter({ hasText: `${id}/${generation}/` }).waitFor();
}
async function view(page: Page, name: string) {
  await page.evaluate(name => (window as any).canonicalFeedback.view(name), name);
  await page.locator(`[data-canonical-surface="decisions"][data-view="${name}"]`).waitFor();
}
async function peerReason(page: Page, button: Locator) {
  expect(await button.isDisabled()).toBe(true);
  expect(await button.getAttribute('aria-busy')).not.toBe('true');
  expect(await button.locator('.workspace-spinner,.button-spinner').count()).toBe(0);
  const reasonId = await button.getAttribute('aria-describedby'); expect(reasonId).toBeTruthy();
  expect(await page.locator(`[id="${reasonId}"]`).textContent()).toMatch(/等待|稍候|进行中/);
}
async function activeOnly(page: Page, button: Locator) {
  expect(await button.isDisabled()).toBe(true);
  expect(await button.getAttribute('aria-busy')).toBe('true');
  expect(await button.locator('.workspace-spinner,.button-spinner').count()).toBe(1);
  expect(await page.locator('button[aria-busy="true"]').count()).toBe(1);
}
async function inventory(page: Page, name: string) {
  const controls = await page.evaluate(() => [...document.querySelectorAll('button,input,textarea,select')].map(element => {
    const fieldset = element.closest('fieldset:disabled');
    const ids = (element.getAttribute('aria-describedby') || fieldset?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    return { label: element.getAttribute('aria-label') || element.closest('label')?.textContent || element.textContent,
      visible: element.checkVisibility(), disabled: element.matches(':disabled'), busy: element.getAttribute('aria-busy') === 'true',
      reason: ids.map(id => document.getElementById(id)?.textContent).join(' ') || element.getAttribute('aria-description') || '' };
  }));
  const folder = path.resolve('output/development-completion-2026-10-16/renderer-pages/canonical-control-inventory'); mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, name + '.json'), JSON.stringify({ schema: 'canonical-ui-controls/1', name, controls }, null, 2));
  expect(controls.filter(item => item.visible && item.disabled && !item.reason)).toEqual([]);
}
async function revise(page: Page) { await page.getByRole('button', { name: '修订', exact: true }).click(); await page.getByRole('dialog', { name: '修订经营决策' }).waitFor(); }
async function invokeTwice(page: Page, locator: Locator) {
  await locator.evaluate((button: any) => { const props = button[Object.keys(button).find(key => key.startsWith('__reactProps$'))!]; props.onClick(); props.onClick(); });
}

describe('canonical production transaction action feedback', () => {
  it('admits one native recommendation revision and locks editor fields with active-only feedback and failure retry', async () => {
    const { browser, page } = await open('decisions');
    try {
      await revise(page); await invokeActualReactActionTwice(page, '保存经营决策');
      const active = page.getByRole('button', { name: '保存中…', exact: true }); await active.waitFor();
      expect(await count(page, 'revise')).toBe(1); await activeOnly(page, active);
      expect(await page.getByLabel('决策标题 *', { exact: true }).isDisabled()).toBe(true);
      await peerReason(page, page.getByRole('button', { name: '取消', exact: true })); await inventory(page, 'decisions-recommendations-save');
      await complete(page, 'revise', 0, true); const retry = page.getByRole('button', { name: '保存经营决策', exact: true }); await retry.waitFor();
      expect(await retry.isEnabled()).toBe(true); await retry.click(); await complete(page, 'revise', 1);
      await page.getByText('经营决策已通过版本校验修订。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one native approval resolution and retains a reason-locked plain cancel action during rejection recovery', async () => {
    const { browser, page } = await open('decisions');
    try {
      await view(page, 'decisions/approval'); await page.getByRole('button', { name: '拒绝', exact: true }).click();
      await page.getByLabel('决议原因').fill('当前事实不足，需要重新分析'); await invokeActualReactActionTwice(page, '确认已拒绝');
      const active = page.getByRole('alertdialog').getByRole('button', { name: /确认.*中…/, exact: true }); await active.waitFor();
      expect(await count(page, 'resolve')).toBe(1); await activeOnly(page, active);
      expect(await page.getByLabel('决议原因').isDisabled()).toBe(true); await peerReason(page, page.getByRole('alertdialog').getByRole('button', { name: '取消' }));
      await inventory(page, 'decisions-approval-resolve'); await complete(page, 'resolve', 0, true);
      const retry = page.getByRole('button', { name: '确认已拒绝', exact: true }); await retry.waitFor(); expect(await retry.isEnabled()).toBe(true);
      await retry.click(); await complete(page, 'resolve', 1); await page.getByText(/经营决策已已拒绝/).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one native decided-grant revocation without treating the disabled batch authorization peer as running', async () => {
    const { browser, page } = await open('decisions');
    try {
      await view(page, 'decisions/decided'); await page.getByRole('button', { name: '撤销人工授权', exact: true }).click();
      await page.getByLabel('撤销原因').fill('停止剩余授权'); await invokeActualReactActionTwice(page, '确认撤销');
      const active = page.getByRole('alertdialog').getByRole('button', { name: /确认.*中…/, exact: true }); await active.waitFor();
      expect(await count(page, 'revoke')).toBe(1); await activeOnly(page, active); await inventory(page, 'decisions-decided-revoke');
      await complete(page, 'revoke', 0, true); const retry = page.getByRole('button', { name: '确认撤销', exact: true }); await retry.waitFor();
      expect(await retry.isEnabled()).toBe(true); await retry.click(); await complete(page, 'revoke', 1);
      await page.getByText('人工授权已撤销，原记录保留在审计链。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('invalidates old native view mutations and permits an independent new-view action before the old result settles', async () => {
    const { browser, page } = await open('decisions');
    try {
      await revise(page); await page.getByRole('button', { name: '保存经营决策', exact: true }).click();
      await view(page, 'decisions/approval'); await page.getByRole('button', { name: '批准', exact: true }).click();
      await page.getByLabel('决议原因').fill('当前批次人工确认'); await page.getByRole('button', { name: '确认已批准', exact: true }).click();
      await complete(page, 'revise', 0); await activeOnly(page, page.getByRole('alertdialog').getByRole('button', { name: /确认.*中…/ }));
      expect(await page.getByText('经营决策已通过版本校验修订。', { exact: true }).count()).toBe(0);
      await complete(page, 'resolve', 0, true); await page.getByRole('button', { name: '确认已批准', exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('keeps a new native decision revision busy after a same-label store ABA result and ignores an unmounted continuation', async () => {
    const { browser, page } = await open('decisions');
    try {
      await revise(page); await page.getByRole('button', { name: '保存经营决策', exact: true }).click();
      await select(page, 'B'); await select(page, 'A'); await revise(page); await page.getByRole('button', { name: '保存经营决策', exact: true }).click();
      await complete(page, 'revise', 0); await activeOnly(page, page.getByRole('button', { name: '保存中…', exact: true }));
      await page.evaluate(() => (window as any).canonicalFeedback.mount(false)); await page.evaluate(() => (window as any).canonicalFeedback.mount(true));
      await complete(page, 'revise', 1); await page.getByRole('button', { name: '修订', exact: true }).waitFor();
      expect(await page.getByText('经营决策已通过版本校验修订。', { exact: true }).count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('admits a single native execution takeover and leaves both alias and cancel controls plain with recovery reasons', async () => {
    const { browser, page } = await open('execution');
    try {
      await page.getByRole('button', { name: '接管浏览器', exact: true }).waitFor(); await invokeActualReactActionTwice(page, '接管浏览器');
      const active = page.getByRole('button', { name: '接管中…', exact: true }); await active.waitFor(); expect(await count(page, 'takeover')).toBe(1); await activeOnly(page, active);
      await peerReason(page, page.getByRole('button', { name: '检查 / 接管浏览器', exact: true })); await inventory(page, 'execution-takeover-header');
      await complete(page, 'takeover', 0, true); const retry = page.getByRole('button', { name: '接管浏览器', exact: true }); await retry.waitFor();
      expect(await retry.isEnabled()).toBe(true); await retry.click(); await complete(page, 'takeover', 1);
      await page.getByText('当前店铺的可见广告页面已置前并完成会话检查。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('keeps the native execution control alias as the only active initiator and admits cancel only once', async () => {
    const { browser, page } = await open('execution');
    try {
      await page.getByRole('button', { name: '检查 / 接管浏览器', exact: true }).click();
      await activeOnly(page, page.getByRole('button', { name: '接管中…', exact: true })); await peerReason(page, page.getByRole('button', { name: '接管浏览器', exact: true }));
      await complete(page, 'takeover', 0);
      const cancel = page.getByRole('group', { name: '执行控制', exact: true }).getByRole('button', { name: '取消未提交批次', exact: true }); await cancel.waitFor();
      await invokeTwice(page, cancel); await activeOnly(page, page.getByRole('button', { name: '取消中…', exact: true })); expect(await count(page, 'cancel')).toBe(1);
      await peerReason(page, page.getByRole('button', { name: '取消未提交批次', exact: true })); await complete(page, 'cancel', 0, true); await cancel.waitFor();
      expect(await cancel.isEnabled()).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one native execution refresh and rejects a late refresh failure after session-generation replacement', async () => {
    const { browser, page } = await open('execution');
    try {
      const refresh = page.getByRole('button', { name: '刷新当前执行投影', exact: true }); await refresh.waitFor();
      await page.getByRole('button', { name: '接管浏览器', exact: true }).waitFor();
      await page.evaluate(() => { (window as any).canonicalFeedback.state.deferReads = true; }); await invokeTwice(page, refresh);
      await activeOnly(page, refresh); expect(await count(page, 'executionRead')).toBe(1);
      await select(page, 'A', 2); await complete(page, 'executionRead', 0, true);
      expect(await refresh.getAttribute('aria-busy')).not.toBe('true'); await complete(page, 'executionRead', 1);
      expect(await page.getByText('暂时无法完成，请重试。', { exact: true }).count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('rejects old native execution ABA and unmount results without releasing the replacement operation', async () => {
    const { browser, page } = await open('execution');
    try {
      await page.getByRole('button', { name: '接管浏览器', exact: true }).click(); await select(page, 'B'); await select(page, 'A');
      await page.getByRole('button', { name: '接管浏览器', exact: true }).click(); await complete(page, 'takeover', 0);
      await activeOnly(page, page.getByRole('button', { name: '接管中…', exact: true }));
      await page.evaluate(() => (window as any).canonicalFeedback.mount(false)); await page.evaluate(() => (window as any).canonicalFeedback.mount(true)); await complete(page, 'takeover', 1);
      await page.getByRole('button', { name: '接管浏览器', exact: true }).waitFor();
      expect(await page.getByText('当前店铺的可见广告页面已置前并完成会话检查。', { exact: true }).count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one native memory correction, locks immutable and editable fields, and permits a faithful retry', async () => {
    const { browser, page } = await open('memory');
    try {
      await page.getByRole('button', { name: '追加修正', exact: true }).click(); await page.getByLabel('信号 / 依据').fill('修正事实'); await invokeTwice(page, page.getByRole('dialog').getByRole('button', { name: '追加修正', exact: true }));
      const active = page.getByRole('button', { name: '追加中…', exact: true }); await active.waitFor(); expect(await count(page, 'append')).toBe(1); await activeOnly(page, active);
      expect(await page.getByLabel('标题 *', { exact: true }).isDisabled()).toBe(true); await peerReason(page, page.getByRole('button', { name: '取消', exact: true }));
      await inventory(page, 'memory-correction'); await complete(page, 'append', 0, true); const retry = page.getByRole('dialog').getByRole('button', { name: '追加修正', exact: true }); await retry.waitFor();
      expect(await retry.isEnabled()).toBe(true); await retry.click(); await complete(page, 'append', 1); await page.getByText('修正记录已追加，原记录保持不变。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one current native memory export and explains peer locks while retaining export failure recovery', async () => {
    const { browser, page } = await open('memory');
    try {
      await page.getByRole('button', { name: '导出时间线', exact: true }).waitFor(); await invokeActualReactActionTwice(page, '导出时间线');
      const active = page.getByRole('button', { name: '导出中…', exact: true }); await active.waitFor(); expect(await count(page, 'export')).toBe(1); await activeOnly(page, active);
      await peerReason(page, page.getByRole('button', { name: '重建搜索索引', exact: true })); await inventory(page, 'memory-export');
      await complete(page, 'export', 0, true); const retry = page.getByRole('button', { name: '导出时间线', exact: true }); await retry.waitFor(); expect(await retry.isEnabled()).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('does not download or publish an old native memory export after authority ABA or unmount', async () => {
    const { browser, page } = await open('memory');
    try {
      await page.getByRole('button', { name: '导出时间线', exact: true }).click(); await select(page, 'B'); await select(page, 'A');
      await page.getByRole('button', { name: '导出时间线', exact: true }).click(); await complete(page, 'export', 0);
      await activeOnly(page, page.getByRole('button', { name: '导出中…', exact: true }));
      await page.evaluate(() => (window as any).canonicalFeedback.mount(false)); await page.evaluate(() => (window as any).canonicalFeedback.mount(true)); await complete(page, 'export', 1);
      await page.getByRole('button', { name: '导出时间线', exact: true }).waitFor(); expect(await page.getByText(/已导出当前店铺/).count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('offers actual native decision and memory refresh recovery and ignores stale read failures', async () => {
    for (const name of ['decisions', 'memory'] as const) {
      const { browser, page } = await open(name);
      try {
        const label = name === 'decisions' ? '刷新经营决策' : '刷新因果记忆'; const kind = name === 'decisions' ? 'decisionRead' : 'memoryRead';
        const refresh = page.getByRole('button', { name: label, exact: true }); await refresh.waitFor();
        await page.evaluate(() => { (window as any).canonicalFeedback.state.deferReads = true; }); await invokeActualReactActionTwice(page, label);
        expect(await count(page, kind)).toBe(1); await select(page, 'B'); await select(page, 'A', 2);
        await complete(page, kind, 0, true); await complete(page, kind, 1, true); await complete(page, kind, 2);
        await refresh.waitFor(); expect(await refresh.isEnabled()).toBe(true); expect(await page.getByText('暂时无法完成，请重试。', { exact: true }).count()).toBe(0);
        if (name === 'memory') {
          await refresh.click(); await complete(page, kind, 3);
          await page.getByRole('status').filter({ hasText: '当前店铺因果记忆已刷新。' }).waitFor();
          expect(await refresh.isEnabled()).toBe(true);
        }
      } finally { await browser.close(); }
    }
  }, 30_000);

  it('invalidates current-store native operations while the production provider reconnects and records real failures once', async () => {
    for (const name of ['decisions', 'execution', 'memory'] as const) {
      const { browser, page } = await open(name);
      try {
        if (name === 'decisions') { await revise(page); await page.getByRole('button', { name: '保存经营决策', exact: true }).click(); }
        else await page.getByRole('button', { name: name === 'execution' ? '接管浏览器' : '导出时间线', exact: true }).click();
        const kind = name === 'decisions' ? 'revise' : name === 'execution' ? 'takeover' : 'export';
        await page.evaluate(() => (window as any).canonicalFeedback.reconnect());
        await page.waitForFunction(() => ((window as any).canonicalFeedback.calls.bootstrap || []).length === 1);
        await complete(page, kind, 0, true); await complete(page, 'bootstrap', 0);
        const next = page.getByRole('button', { name: name === 'decisions' ? '修订' : name === 'execution' ? '接管浏览器' : '导出时间线', exact: true });
        await next.waitFor(); expect(await next.isEnabled()).toBe(true);
        expect(await page.getByText('暂时无法完成，请重试。', { exact: true }).count()).toBe(0);
        const captured = await page.evaluate(() => ({ logs: (window as any).canonicalFeedback.logs, errors: (window as any).canonicalFeedback.errors }));
        expect(captured.errors).toEqual([]); expect(captured.logs.filter((record: any) => record.level === 'error')).toHaveLength(1);
      } finally { await browser.close(); }
    }
  }, 30_000);

  it('ignores native memory append ABA results and keeps the new correction field lock until its own request settles', async () => {
    const { browser, page } = await open('memory');
    try {
      const append = async () => { await page.getByRole('button', { name: '追加修正', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '追加修正', exact: true }).click(); };
      await append(); await select(page, 'B'); await select(page, 'A', 2); await append(); await complete(page, 'append', 0);
      await activeOnly(page, page.getByRole('button', { name: '追加中…', exact: true }));
      expect(await page.getByLabel('标题 *', { exact: true }).isDisabled()).toBe(true); expect(await page.getByText('修正记录已追加，原记录保持不变。', { exact: true }).count()).toBe(0);
      await complete(page, 'append', 1); await page.getByText('修正记录已追加，原记录保持不变。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);
});

describe('执行来源展开语义', () => {
  it('生产原按钮支持click Enter Space展开折叠并保持同一对象和焦点', async () => {
    const { browser, page } = await open('execution');
    try {
      const button = page.getByRole('button', { name: '执行来源', exact: true });
      const panel = page.locator('section.execution-authority-bar');
      await button.waitFor();
      const originalButton = await button.elementHandle(), originalPanel = await panel.elementHandle();
      expect(originalButton).toBeTruthy(); expect(originalPanel).toBeTruthy();
      expect(await button.getAttribute('aria-expanded')).toBe('false');
      const panelId = await panel.getAttribute('id'); expect(panelId).toBeTruthy();
      expect(await button.getAttribute('aria-controls')).toBe(panelId);
      expect(await button.getAttribute('aria-pressed')).toBeNull();
      expect(await panel.evaluate(element => (element as HTMLElement).hidden)).toBe(true);
      expect(await page.locator('[data-canonical-surface="execution"]').getAttribute('data-mutations-disabled')).toBeNull();
      async function state(expanded: boolean) {
        expect(await button.getAttribute('aria-expanded')).toBe(String(expanded));
        expect(await button.getAttribute('aria-controls')).toBe(panelId);
        expect(await panel.evaluate(element => (element as HTMLElement).hidden)).toBe(!expanded);
        expect(await button.evaluate((element, original) => element === original, originalButton)).toBe(true);
        expect(await panel.evaluate((element, original) => element === original, originalPanel)).toBe(true);
        expect(await button.evaluate(element => document.activeElement === element)).toBe(true);
      }
      await button.click(); await state(true);
      await button.click(); await state(false);
      await button.press('Enter'); await state(true);
      await button.press('Enter'); await state(false);
      await button.press('Space'); await state(true);
      await button.press('Space'); await state(false);
      await page.getByRole('button', { name: '查看执行来源与边界', exact: true }).click();
      expect(await button.getAttribute('aria-expanded')).toBe('true');
      expect(await panel.evaluate(element => (element as HTMLElement).hidden)).toBe(false);
      await button.click(); await state(false);
      await page.getByRole('button', { name: '更多执行选项', exact: true }).click();
      expect(await button.getAttribute('aria-expanded')).toBe('true');
      await button.click(); await state(false);
      for (const operation of ['takeover', 'cancel', 'identity', 'queue', 'start', 'reconcile']) expect(await count(page, operation)).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);
});
