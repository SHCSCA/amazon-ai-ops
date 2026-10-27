import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { waitDeliveryMessage } from './isolated-v16-delivery-receipt.mjs';
import { openProductionPanelBrowser, withProductionPanel } from './isolated-v16-delivery-message.test-support.mjs';
import { BROWSER_LIFECYCLE_BUDGET } from './v16-performance-observe.test-support.mjs';

const refreshMessage = '最终验收已刷新，仍未就绪。';
const exportMessage = '未完成验收材料已导出，包含当前缺口，不能作为生产就绪证明。';
let runtime;
beforeAll(async () => { runtime = await openProductionPanelBrowser(); }, BROWSER_LIFECYCLE_BUDGET.setupHookMs);
afterAll(async () => { await runtime?.owned.close(); }, BROWSER_LIFECYCLE_BUDGET.teardownHookMs);
const setPanel = (page, state) => page.evaluate(state => window.deliveryPanelFixture.set(state), state);

describe('isolated delivery message waits on the real production Panel', () => {
  it.each([refreshMessage, exportMessage])('accepts the visible exact Panel title and body: %s', async message => {
    await withProductionPanel(runtime, async page => {
      await setPanel(page, { message });
      await page.getByRole('region', { name: '交付消息', exact: true }).waitFor();
      expect(await page.getByRole('heading', { name: '交付消息', exact: true, level: 3 }).count()).toBe(1);
      await waitDeliveryMessage(page, message, 1000);
    });
  });

  it('remains pending during the real React busy state and resolves only after the exact visible completion', async () => {
    await withProductionPanel(runtime, async page => {
      await setPanel(page, { busy: true });
      const button = page.getByRole('button', { name: '刷新中...', exact: true }); await button.waitFor();
      expect(await button.isDisabled()).toBe(true); expect(await button.getAttribute('aria-busy')).toBe('true');
      expect(await button.locator('.button-spinner').count()).toBe(1);
      let completed = false;
      const waiting = waitDeliveryMessage(page, refreshMessage, 2000).then(() => { completed = true; });
      await page.waitForTimeout(80); expect(completed).toBe(false);
      await setPanel(page, { busy: false, message: refreshMessage });
      await waiting; expect(completed).toBe(true);
      expect(await page.getByRole('button', { name: '刷新最终验收', exact: true }).isEnabled()).toBe(true);
    });
  });

  it('rejects identical text in another named production Panel', async () => {
    await withProductionPanel(runtime, async page => {
      await setPanel(page, { decoy: refreshMessage });
      await page.getByRole('region', { name: '其他消息', exact: true }).filter({ hasText: refreshMessage }).waitFor();
      await expect(waitDeliveryMessage(page, refreshMessage, 180)).rejects.toThrow(/Timeout/);
    });
  });

  it('rejects an exact body whose real production Panel has the wrong title', async () => {
    await withProductionPanel(runtime, async page => {
      await setPanel(page, { message: refreshMessage, title: '交付消息历史' });
      await page.getByRole('heading', { name: '交付消息历史', exact: true }).waitFor();
      await expect(waitDeliveryMessage(page, refreshMessage, 180)).rejects.toThrow(/Timeout/);
    });
  });

  it('rejects a hidden named production Panel even when its exact text exists', async () => {
    await withProductionPanel(runtime, async page => {
      await setPanel(page, { message: refreshMessage, hidden: true });
      const hidden = page.getByRole('region', { name: '交付消息', exact: true, includeHidden: true });
      await hidden.waitFor({ state: 'attached' }); expect(await hidden.isVisible()).toBe(false);
      await expect(waitDeliveryMessage(page, refreshMessage, 180)).rejects.toThrow(/Timeout/);
    });
  });

  it.each(['前缀', '后缀', '附加正文'])('rejects a non-exact production Panel body: %s', async kind => {
    await withProductionPanel(runtime, async page => {
      const state = kind === '前缀' ? { message: '历史：' + refreshMessage }
        : kind === '后缀' ? { message: refreshMessage + '历史' } : { message: refreshMessage, extra: '附加正文' };
      await setPanel(page, state);
      await page.getByRole('region', { name: '交付消息', exact: true }).filter({ hasText: refreshMessage }).waitFor();
      await expect(waitDeliveryMessage(page, refreshMessage, 180)).rejects.toThrow(/Timeout/);
    });
  });

  it('keeps a missing completion as a real visible-wait timeout', async () => {
    await withProductionPanel(runtime, async page => {
      await expect(waitDeliveryMessage(page, refreshMessage, 180)).rejects.toThrow(/Timeout/);
    });
  });

  it('treats regular-expression punctuation in the expected body as literal text', async () => {
    await withProductionPanel(runtime, async page => {
      const message = '本地导出 [NON_READY] (1+1).*?';
      await setPanel(page, { message });
      await waitDeliveryMessage(page, message, 1000);
      await setPanel(page, { message: '本地导出 [NON_READY] (1+1)替代正文' });
      await expect(waitDeliveryMessage(page, message, 180)).rejects.toThrow(/Timeout/);
    });
  });
});
